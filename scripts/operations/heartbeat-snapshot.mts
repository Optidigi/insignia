import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, opendir, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface AggregateDatabase {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export type RemoteIdentity = { endpoint: string; bucket: string; prefix: string };
export type BackupStateOptions = {
  replicaRequired?: boolean;
  replicaJournalDirectory?: string;
  replicaRemoteIdentity?: RemoteIdentity;
};
type RequiredReplica = { replicaJournalDirectory: string; replicaRemoteIdentity: RemoteIdentity };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid private record');
  return Object.fromEntries(Object.entries(value));
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw Error('Invalid private field');
  return value;
}
function date(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  return Date.parse(string(value));
}
function requiredReplica(options: BackupStateOptions): RequiredReplica {
  if (!options.replicaJournalDirectory || !options.replicaRemoteIdentity) throw Error('Replica target required');
  return {
    replicaJournalDirectory: options.replicaJournalDirectory,
    replicaRemoteIdentity: options.replicaRemoteIdentity,
  };
}
function receiptValue(value: unknown) {
  const row = record(value);
  if (typeof row.bytes !== 'number') throw Error('Invalid backup receipt');
  return {
    ...row,
    format: string(row.format),
    id: string(row.id),
    sha256: string(row.sha256),
    createdAt: string(row.createdAt),
    completedAt: row.completedAt === undefined ? undefined : string(row.completedAt),
    expiresAt: string(row.expiresAt),
    bytes: row.bytes,
    readiness: string(row.readiness),
  };
}
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
 UNION ALL SELECT (public.uninstall_privacy_status()->>'unrecoveredBlockedReceiptCount')::bigint
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

const boundedCount = (value: unknown) => {
  if (!/^\d{1,10}$/.test(String(value)) || Number(value) > 1_000_000_000) throw new Error('Invalid aggregate result');
  return Number(value);
};
export async function collectDatabaseSnapshot(client: AggregateDatabase, now = Date.now(), stalledAfterSeconds = 900) {
  if (!Number.isSafeInteger(stalledAfterSeconds) || stalledAfterSeconds < 60 || stalledAfterSeconds > 86400)
    throw new Error('Stalled processing policy required');
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout='5s'");
    const { rows } = await client.query(aggregateSql, [stalledAfterSeconds]);
    const row = rows[0];
    const observedAt = date(row?.observed_at);
    if (!Number.isSafeInteger(observedAt) || observedAt > now + 5000 || now - observedAt > 120_000)
      throw new Error('Database clock unqualified');
    const processing = { observedAt, stalledCount: boundedCount(row?.stalled_count) };
    const deletion = { observedAt, overdueCount: boundedCount(row?.overdue_count) };
    await client.query('COMMIT');
    return { processing, deletion };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function privateFile(path: string, maxBytes = 4096) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.uid !== process.getuid?.() || info.mode & 0o077 || info.size > maxBytes)
      throw new Error('Private bounded file required');
    const bytes = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(bytes);
    if (bytesRead > maxBytes) throw new Error('Oversized private file');
    return record(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')));
  } finally {
    await file.close();
  }
}
async function privateDirectory(path: string) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || info.mode & 0o077)
    throw new Error('Private owned directory required');
}
function sameRemoteIdentity(actual: unknown, expected: unknown) {
  return (
    actual &&
    typeof actual === 'object' &&
    !Array.isArray(actual) &&
    expected &&
    typeof expected === 'object' &&
    !Array.isArray(expected) &&
    Object.keys(actual).sort().join(',') === 'bucket,endpoint,prefix' &&
    Object.keys(expected).sort().join(',') === 'bucket,endpoint,prefix' &&
    ['endpoint', 'bucket', 'prefix'].every(
      (key) =>
        typeof record(expected)[key] === 'string' &&
        string(record(expected)[key]).length > 0 &&
        record(actual)[key] === record(expected)[key],
    )
  );
}
async function replicaComplete(receipt: ReturnType<typeof receiptValue>, options: RequiredReplica, now: number) {
  try {
    const marker = await privateFile(join(options.replicaJournalDirectory, `${receipt.id}.complete.json`));
    const completed = date(marker.completedAt);
    return (
      marker.format === 'insignia-backup-replica-completion-v1' &&
      marker.readiness === 'OFFHOST_CIPHERTEXT_VERIFIED' &&
      marker.id === receipt.id &&
      marker.sha256 === receipt.sha256 &&
      marker.bytes === receipt.bytes &&
      marker.expiresAt === receipt.expiresAt &&
      marker.sourceCompletedAt === receipt.completedAt &&
      Number.isFinite(completed) &&
      completed >= date(receipt.completedAt) &&
      completed <= now &&
      completed < Date.parse(receipt.expiresAt) &&
      sameRemoteIdentity(marker.remoteIdentity, options.replicaRemoteIdentity)
    );
  } catch {
    return false;
  }
}
async function replicaRetention(options: RequiredReplica, now: number) {
  try {
    const marker = await privateFile(join(options.replicaJournalDirectory, 'retention.json'));
    if (
      !sameRemoteIdentity(marker.remoteIdentity, options.replicaRemoteIdentity) ||
      typeof marker.observedAt !== 'number' ||
      !Number.isSafeInteger(marker.observedAt) ||
      marker.observedAt > now ||
      now - marker.observedAt > 120_000 ||
      typeof marker.overdueCount !== 'number' ||
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
export async function readBackupState(directory: string, now = Date.now(), options: BackupStateOptions = {}) {
  await privateDirectory(directory);
  if (options.replicaRequired) {
    if (!sameRemoteIdentity(options.replicaRemoteIdentity, options.replicaRemoteIdentity))
      throw new Error('Replica target required');
    await privateDirectory(requiredReplica(options).replicaJournalDirectory);
  }
  let completedAt = null,
    overdueCount = 0,
    inspected = 0;
  const inventory = new Map<string, Partial<Record<'.intent.json' | '.json' | '.cms', string>>>();
  const pattern = /^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(\.intent\.json|\.json|\.cms)$/;
  for await (const entry of await opendir(directory)) {
    if (++inspected > 4096) throw new Error('Backup store inventory limit');
    if (entry.name === '.lock') continue;
    const match = pattern.exec(entry.name);
    if (!match || !entry.isFile()) throw new Error('Invalid backup inventory');
    const id = match[1],
      suffix = match[2];
    if (!id || (suffix !== '.intent.json' && suffix !== '.json' && suffix !== '.cms'))
      throw Error('Invalid backup inventory');
    const items = inventory.get(id) ?? {};
    items[suffix] = entry.name;
    inventory.set(id, items);
  }
  for (const [id, items] of inventory) {
    const intent = items['.intent.json'] ? await privateFile(join(directory, items['.intent.json'])) : null;
    const intentExpires = intent ? date(intent.expiresAt) : null;
    if (
      intent &&
      (intent.format !== 'insignia-backup-intent-v1' || intent.id !== id || !Number.isFinite(intentExpires))
    )
      throw new Error('Invalid backup intent');
    const receipt = items['.json'] ? receiptValue(await privateFile(join(directory, items['.json']))) : null;
    if (!items['.cms']) {
      if (receipt) throw new Error('Backup artifact missing');
      // A durable intent without ciphertext is a known interrupted/reserved operation.
      if (intentExpires !== null && intentExpires <= now) overdueCount++;
      continue;
    }
    if (!intent && !receipt) throw new Error('Orphan backup ciphertext');
    const artifact = await lstat(join(directory, items['.cms']));
    if (!artifact.isFile() || artifact.uid !== process.getuid?.() || artifact.mode & 0o077)
      throw new Error('Invalid backup artifact');
    if (!receipt) {
      if (intentExpires !== null && intentExpires <= now) overdueCount++;
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
    else if (!options.replicaRequired || (await replicaComplete(receipt, requiredReplica(options), now)))
      completedAt = Math.max(completedAt ?? 0, completed);
  }
  return {
    completedAt,
    overdueCount,
    ...(options.replicaRequired ? { replicaOverdueCount: await replicaRetention(requiredReplica(options), now) } : {}),
  };
}

async function writeSnapshot(directory: string, kind: string, snapshot: unknown) {
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
  const rawConfig = await privateFile(
    process.env.INSIGNIA_HEARTBEAT_SNAPSHOT_CONFIG ?? '/run/insignia/heartbeat-snapshot.json',
  );
  if (rawConfig.stalledAfterSeconds !== undefined && typeof rawConfig.stalledAfterSeconds !== 'number')
    throw Error('Stalled processing policy required');
  if (rawConfig.replicaRequired !== undefined && typeof rawConfig.replicaRequired !== 'boolean')
    throw Error('Replica policy required');
  const config = {
    ...rawConfig,
    outputDirectory: string(rawConfig.outputDirectory),
    databaseStartupFile: string(rawConfig.databaseStartupFile),
    backupStore: string(rawConfig.backupStore),
    stalledAfterSeconds: typeof rawConfig.stalledAfterSeconds === 'number' ? rawConfig.stalledAfterSeconds : 900,
    replicaRequired: rawConfig.replicaRequired === true,
    ...(rawConfig.replicaJournalDirectory === undefined
      ? {}
      : { replicaJournalDirectory: string(rawConfig.replicaJournalDirectory) }),
    ...(rawConfig.replicaRemoteIdentity === undefined
      ? {}
      : {
          replicaRemoteIdentity: {
            endpoint: string(record(rawConfig.replicaRemoteIdentity).endpoint),
            bucket: string(record(rawConfig.replicaRemoteIdentity).bucket),
            prefix: string(record(rawConfig.replicaRemoteIdentity).prefix),
          },
        }),
  };
  await privateDirectory(config.outputDirectory);
  const credentials = await privateFile(config.databaseStartupFile);
  const { Pool }: typeof import('pg') = createRequire(new URL('../../apps/worker/package.json', import.meta.url))('pg');
  // A dedicated SELECT-only database role is required; no app credential inheritance.
  const pool = new Pool({
    connectionString: string(credentials.databaseUrl),
    max: 1,
    connectionTimeoutMillis: 5000,
    query_timeout: 6000,
  });
  const once = async () => {
    const now = Date.now();
    let backup: Awaited<ReturnType<typeof readBackupState>> | null,
      database: Awaited<ReturnType<typeof collectDatabaseSnapshot>> | null;
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
