import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, opendir, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const aggregateSql = `WITH clock AS (SELECT statement_timestamp() AS at),
stalled AS (
 SELECT count(state) AS n FROM public.outbox_events,clock
 WHERE state='failed' OR (state='leased' AND lease_until<at) OR (state='pending' AND available_at<at-$1*interval '1 second')
 UNION ALL SELECT count(state) FROM public.inbox_messages,clock
 WHERE state='failed' OR (state='leased' AND lease_until<at) OR (state='pending' AND received_at<at-$1*interval '1 second')
 UNION ALL SELECT count(state) FROM public.artwork_assets,clock
 WHERE state IN ('QUEUED','INSPECTING','PROMOTING') AND expires_at>at
 AND coalesce(retry_at,collected_at)<at-$1*interval '1 second' AND (claim_until IS NULL OR claim_until<at)
 UNION ALL SELECT count(state) FROM public.merchant_preview_assets,clock
 WHERE state='WRITING' AND updated_at<at-$1*interval '1 second'
), overdue AS (
 SELECT count(state) AS n FROM public.inbox_messages,clock WHERE erasure_state<>'erased' AND purge_after<=at
 UNION ALL SELECT count(state) FROM public.outbox_events,clock WHERE erasure_state<>'erased' AND purge_after<=at
 UNION ALL SELECT count(state) FROM public.artwork_assets a,clock
 WHERE state<>'DELETED' AND (expires_at<=at OR (state='UPLOADING' AND collected_at<=at-interval '24 hours') OR state IN ('REJECTED','DELETING') OR (state='USABLE' AND quarantine_cleaned_at IS NULL AND upload_until<=at) OR NOT EXISTS(
 SELECT 1 FROM public.shops s JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
 WHERE s.shop_id=a.shop_id AND s.current_generation=a.installation_generation AND i.deactivated_at IS NULL))
 UNION ALL SELECT count(state) FROM public.merchant_preview_assets a,clock
 WHERE state NOT IN ('WRITING','DELETED') AND (state IN ('RETIRED','DELETING') OR NOT EXISTS(
 SELECT 1 FROM public.shops s JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
 WHERE s.shop_id=a.shop_id AND s.current_generation=a.installation_generation AND i.deactivated_at IS NULL)
 OR (abandon_at<=at AND NOT EXISTS(SELECT 1 FROM public.config_revision_preview_assets r WHERE r.asset_id=a.asset_id)))
 UNION ALL SELECT count(expires_at) FROM public.purchase_offer_payloads a,clock WHERE erased_at IS NULL AND (expires_at<=at OR NOT EXISTS(
 SELECT 1 FROM public.shops s JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
 WHERE s.shop_id=a.shop_id AND s.current_generation=a.installation_generation AND i.deactivated_at IS NULL))
 UNION ALL SELECT count(expires_at) FROM public.purchase_design_payloads a,clock WHERE erased_at IS NULL AND (expires_at<=at OR NOT EXISTS(
 SELECT 1 FROM public.shops s JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
 WHERE s.shop_id=a.shop_id AND s.current_generation=a.installation_generation AND i.deactivated_at IS NULL))
 UNION ALL SELECT count(kind) FROM public.purchase_artwork_events a,clock WHERE kind='ATTACH' AND erased_at IS NULL AND (expires_at<=at OR NOT EXISTS(
 SELECT 1 FROM public.shops s JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
 WHERE s.shop_id=a.shop_id AND s.current_generation=a.installation_generation AND i.deactivated_at IS NULL))
 UNION ALL SELECT count(expires_at) FROM public.buyer_sessions b,clock WHERE expires_at<=at OR NOT EXISTS(
 SELECT 1 FROM public.shops s JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
 WHERE s.shop_id=b.shop_id AND s.current_generation=b.installation_generation AND i.deactivated_at IS NULL)
 UNION ALL SELECT count(forget_after) FROM public.webhook_obligation_facts,clock WHERE facts_erased_at IS NULL AND forget_after<=at
 UNION ALL SELECT count(expires_at) FROM public.design_drafts,clock WHERE expires_at<=at
 UNION ALL SELECT count(retain_private_until) FROM public.quote_proposals,clock WHERE retain_private_until<=at
)
SELECT (SELECT sum(n)::text FROM stalled) AS stalled_count,
       (SELECT sum(n)::text FROM overdue) AS overdue_count, at AS observed_at FROM clock`;

const boundedCount = (value) => {
  if (!/^\d{1,10}$/.test(String(value)) || Number(value) > 1_000_000_000) throw new Error('Invalid aggregate result');
  return Number(value);
};
export async function collectDatabaseSnapshot(client, now = Date.now(), stalledAfterSeconds = 900) {
  if (!Number.isSafeInteger(stalledAfterSeconds) || stalledAfterSeconds < 60 || stalledAfterSeconds > 86400)
    throw new Error('Stalled processing policy required');
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout='5s'");
    const { rows } = await client.query(aggregateSql, [stalledAfterSeconds]);
    const row = rows[0];
    const observedAt = new Date(row?.observed_at).getTime();
    if (!Number.isSafeInteger(observedAt) || observedAt > now + 5000 || now - observedAt > 120_000)
      throw new Error('Database clock unqualified');
    const processing = { observedAt, stalledCount: boundedCount(row.stalled_count) };
    const deletion = { observedAt, overdueCount: boundedCount(row.overdue_count) };
    await client.query('COMMIT');
    return { processing, deletion };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function privateFile(path, maxBytes = 4096) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.uid !== process.getuid() || info.mode & 0o077 || info.size > maxBytes)
      throw new Error('Private bounded file required');
    const bytes = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(bytes);
    if (bytesRead > maxBytes) throw new Error('Oversized private file');
    return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
  } finally {
    await file.close();
  }
}
async function privateDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.uid !== process.getuid() || info.mode & 0o077)
    throw new Error('Private owned directory required');
}
function sameRemoteIdentity(actual, expected) {
  return (
    actual &&
    expected &&
    Object.keys(actual).sort().join(',') === 'bucket,endpoint,prefix' &&
    Object.keys(expected).sort().join(',') === 'bucket,endpoint,prefix' &&
    ['endpoint', 'bucket', 'prefix'].every(
      (key) => typeof expected[key] === 'string' && expected[key].length > 0 && actual[key] === expected[key],
    )
  );
}
async function replicaComplete(receipt, options, now) {
  try {
    const marker = await privateFile(join(options.replicaJournalDirectory, `${receipt.id}.complete.json`));
    const completed = Date.parse(marker.completedAt);
    return (
      marker.format === 'insignia-backup-replica-completion-v1' &&
      marker.readiness === 'OFFHOST_CIPHERTEXT_VERIFIED' &&
      marker.id === receipt.id &&
      marker.sha256 === receipt.sha256 &&
      marker.bytes === receipt.bytes &&
      marker.expiresAt === receipt.expiresAt &&
      marker.sourceCompletedAt === receipt.completedAt &&
      Number.isFinite(completed) &&
      completed >= Date.parse(receipt.completedAt) &&
      completed <= now &&
      completed < Date.parse(receipt.expiresAt) &&
      sameRemoteIdentity(marker.remoteIdentity, options.replicaRemoteIdentity)
    );
  } catch {
    return false;
  }
}
async function replicaRetention(options, now) {
  try {
    const marker = await privateFile(join(options.replicaJournalDirectory, 'retention.json'));
    if (
      !sameRemoteIdentity(marker.remoteIdentity, options.replicaRemoteIdentity) ||
      !Number.isSafeInteger(marker.observedAt) ||
      marker.observedAt > now ||
      now - marker.observedAt > 120_000 ||
      !Number.isSafeInteger(marker.overdueCount) ||
      marker.overdueCount < 0 ||
      marker.overdueCount > 1_000_000_000
    )
      return null;
    return marker.overdueCount;
  } catch {
    return null;
  }
}
export async function readBackupState(directory, now = Date.now(), options = {}) {
  await privateDirectory(directory);
  if (options.replicaRequired) {
    if (!sameRemoteIdentity(options.replicaRemoteIdentity, options.replicaRemoteIdentity))
      throw new Error('Replica target required');
    await privateDirectory(options.replicaJournalDirectory);
  }
  let completedAt = null,
    overdueCount = 0,
    inspected = 0;
  const inventory = new Map();
  const pattern = /^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(\.intent\.json|\.json|\.cms)$/;
  for await (const entry of await opendir(directory)) {
    if (++inspected > 4096) throw new Error('Backup store inventory limit');
    if (entry.name === '.lock') continue;
    const match = pattern.exec(entry.name);
    if (!match || !entry.isFile()) throw new Error('Invalid backup inventory');
    const items = inventory.get(match[1]) ?? {};
    items[match[2]] = entry.name;
    inventory.set(match[1], items);
  }
  for (const [id, items] of inventory) {
    const intent = items['.intent.json'] ? await privateFile(join(directory, items['.intent.json'])) : null;
    const intentExpires = intent ? Date.parse(intent.expiresAt) : null;
    if (
      intent &&
      (intent.format !== 'insignia-backup-intent-v1' || intent.id !== id || !Number.isFinite(intentExpires))
    )
      throw new Error('Invalid backup intent');
    const receipt = items['.json'] ? await privateFile(join(directory, items['.json'])) : null;
    if (!items['.cms']) {
      if (receipt) throw new Error('Backup artifact missing');
      // A durable intent without ciphertext is a known interrupted/reserved operation.
      if (intentExpires <= now) overdueCount++;
      continue;
    }
    if (!intent && !receipt) throw new Error('Orphan backup ciphertext');
    const artifact = await lstat(join(directory, items['.cms']));
    if (!artifact.isFile() || artifact.uid !== process.getuid() || artifact.mode & 0o077)
      throw new Error('Invalid backup artifact');
    if (!receipt) {
      if (intentExpires <= now) overdueCount++;
      continue;
    }
    const created = Date.parse(receipt.createdAt);
    const completed = Date.parse(receipt.completedAt ?? receipt.createdAt);
    const expires = Date.parse(receipt.expiresAt);
    if (
      receipt.format !== 'insignia-encrypted-backup-v1' ||
      receipt.id !== id ||
      !/^[a-f0-9]{64}$/.test(receipt.sha256) ||
      !Number.isFinite(created) ||
      !Number.isFinite(completed) ||
      completed < created ||
      completed > now ||
      !Number.isFinite(expires) ||
      expires <= created ||
      (intent && expires !== intentExpires) ||
      !Number.isSafeInteger(receipt.bytes) ||
      receipt.bytes < 1 ||
      artifact.size !== receipt.bytes ||
      receipt.readiness !== 'BACKUP_CREATED_RESTORE_UNQUALIFIED'
    )
      throw new Error('Invalid backup receipt');
    if (expires <= now) overdueCount++;
    else if (!options.replicaRequired || (await replicaComplete(receipt, options, now)))
      completedAt = Math.max(completedAt ?? 0, completed);
  }
  return {
    completedAt,
    overdueCount,
    ...(options.replicaRequired ? { replicaOverdueCount: await replicaRetention(options, now) } : {}),
  };
}

async function writeSnapshot(directory, kind, snapshot) {
  const temporary = join(directory, `.heartbeat-${randomUUID()}.tmp`);
  const file = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(JSON.stringify(snapshot));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, join(directory, `${kind}.json`));
}
async function run() {
  const config = await privateFile(
    process.env.INSIGNIA_HEARTBEAT_SNAPSHOT_CONFIG ?? '/run/insignia/heartbeat-snapshot.json',
  );
  await privateDirectory(config.outputDirectory);
  const credentials = await privateFile(config.databaseStartupFile);
  const { Pool } = createRequire(new URL('../../apps/worker/package.json', import.meta.url))('pg');
  // A dedicated SELECT-only database role is required; no app credential inheritance.
  const pool = new Pool({
    connectionString: credentials.databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
    query_timeout: 6000,
  });
  const once = async () => {
    const now = Date.now();
    let backup, database;
    try {
      backup = await readBackupState(config.backupStore, now, config);
    } catch {
      backup = null;
    }
    try {
      const client = await pool.connect();
      try {
        database = await collectDatabaseSnapshot(client, now, config.stalledAfterSeconds);
      } finally {
        client.release();
      }
    } catch {
      database = null;
    }
    // Failed collection actively replaces old healthy observations with unknown.
    await writeSnapshot(config.outputDirectory, 'backup', { completedAt: backup?.completedAt ?? null });
    await writeSnapshot(
      config.outputDirectory,
      'processing',
      database?.processing ?? { observedAt: now, stalledCount: null },
    );
    await writeSnapshot(
      config.outputDirectory,
      'deletion',
      database && backup && (!config.replicaRequired || backup.replicaOverdueCount !== null)
        ? {
            observedAt: database.deletion.observedAt,
            overdueCount: boundedCount(
              database.deletion.overdueCount + backup.overdueCount + (backup.replicaOverdueCount ?? 0),
            ),
          }
        : { observedAt: now, overdueCount: null },
    );
    process.stdout.write(
      database &&
        backup &&
        (!config.replicaRequired || (backup.completedAt !== null && backup.replicaOverdueCount !== null))
        ? 'heartbeat_snapshot_collected\n'
        : 'heartbeat_snapshot_incomplete\n',
    );
  };
  try {
    do {
      await once();
      if (!process.argv.includes('--loop')) break;
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    } while (process.argv.includes('--loop'));
  } finally {
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  run().catch(() => {
    process.stderr.write('heartbeat_snapshot_failed\n');
    process.exitCode = 1;
  });
