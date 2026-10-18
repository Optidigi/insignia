import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, statfs } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function fail() {
  throw new Error('Backup snapshot unavailable; readiness HOLD');
}
function key(value) {
  if (
    typeof value !== 'string' ||
    value.length > 512 ||
    !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(value) ||
    value.split('/').some((p) => p === '.' || p === '..')
  )
    fail();
  return value;
}
function future(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time) || time <= Date.now()) fail();
  return new Date(time).toISOString();
}
function windowOpen(window) {
  if (
    !window ||
    typeof window.id !== 'string' ||
    !window.id ||
    !Number.isFinite(Date.parse(window.startedAt)) ||
    Date.parse(window.startedAt) > Date.now()
  )
    fail();
  future(window.until);
}

export function objectReferences(artwork, merchant) {
  const references = [];
  const add = (keyValue, expiresAt, required, sha256) =>
    references.push({ key: key(keyValue), expiresAt: future(expiresAt), required, ...(sha256 ? { sha256 } : {}) });
  for (const row of artwork) {
    if (row.state === 'DELETED') continue;
    if (row.active === false || ['DELETING', 'PROMOTING', 'INSPECTING', 'REJECTED'].includes(row.state)) fail(); // settle in-flight effects/cleanup first
    const expires =
      row.state === 'UPLOADING'
        ? new Date(Math.min(new Date(row.expires_at).getTime(), new Date(row.collected_at).getTime() + 86400_000))
        : row.expires_at;
    future(expires);
    if (row.state === 'USABLE') {
      add(row.original_key, expires, true, row.manifest?.sha256);
      add(row.preview_key, expires, true, row.manifest?.previewSha256);
    }
    if (!row.quarantine_cleaned_at)
      add(row.quarantine_key, row.state === 'USABLE' ? row.upload_until : expires, row.state === 'QUEUED');
    if (!['USABLE', 'UPLOADING', 'QUEUED', 'REJECTED'].includes(row.state)) fail();
  }
  for (const row of merchant) {
    if (row.state === 'DELETED') continue;
    if (row.active === false || ['WRITING', 'DELETING', 'RETIRED'].includes(row.state)) fail();
    // Referenced live images have no abandon deadline. Snapshot itself still has seven-day maximum.
    const expires = row.live_referenced ? new Date(Date.now() + 7 * 86400_000) : row.abandon_at;
    for (const [name, hashName] of [
      ['original_key', 'sha256'],
      ['preview_key', 'previewSha256'],
    ])
      add(row[name], expires, row.state === 'USABLE', row.manifest?.[hashName]);
  }
  if (new Set(references.map((row) => row.key)).size !== references.length) fail();
  return references;
}

function xml(value) {
  return value.replace(
    /&(?:amp|lt|gt|quot|apos);/g,
    (match) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[match],
  );
}
export function parseListing(body, prefix) {
  if (body.length > 10 * 1024 * 1024 || /<!|<Error(?:\s|>)/.test(body) || !/<ListBucketResult(?:\s[^>]*)?>/.test(body))
    fail();
  const truncated = [...body.matchAll(/<IsTruncated>(true|false)<\/IsTruncated>/g)];
  if (truncated.length !== 1) fail();
  const keys = [...body.matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) => {
    const full = decodeURIComponent(xml(match[1]));
    if (!full.startsWith(prefix)) fail();
    return key(full.slice(prefix.length));
  });
  const tokens = [...body.matchAll(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/g)];
  if (truncated[0][1] === 'true' && tokens.length !== 1) fail();
  if (truncated[0][1] === 'false' && tokens.length) fail();
  return { keys, next: tokens.length ? xml(tokens[0][1]) : null };
}

async function privateFile(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const stat = await file.stat();
  if (!stat.isFile() || stat.uid !== process.getuid() || stat.mode & 0o077 || stat.size > 16384) {
    await file.close();
    fail();
  }
  try {
    return JSON.parse(await file.readFile('utf8'));
  } finally {
    await file.close();
  }
}
async function writePrivate(path, bytes) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function captureSnapshot({
  directory,
  references,
  databaseExpiresAt,
  absoluteExpiresAt,
  promisedCleanupAt = null,
  quiescence,
  list,
  read,
}) {
  windowOpen(quiescence);
  future(databaseExpiresAt);
  future(absoluteExpiresAt);
  if (promisedCleanupAt !== null) future(promisedCleanupAt);
  const listed = new Set(),
    tokens = new Set();
  let next = null;
  do {
    const page = await list(next);
    for (const item of page.keys) {
      key(item);
      if (listed.has(item)) fail();
      listed.add(item);
    }
    next = page.next;
    if (next && tokens.has(next)) fail();
    if (next) tokens.add(next);
    if (tokens.size > 10000 || listed.size > 1_000_000) fail();
  } while (next);
  const expected = new Map(references.map((row) => [row.key, row]));
  if ([...listed].some((item) => !expected.has(item)) || references.some((row) => row.required && !listed.has(row.key)))
    fail();
  const objects = [];
  for (const name of [...listed].sort()) {
    windowOpen(quiescence);
    const reference = expected.get(name);
    future(reference.expiresAt);
    const bytes = await read(name);
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) fail();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (reference.sha256 && reference.sha256 !== sha256) fail();
    await writePrivate(resolve(directory, name), bytes);
    objects.push({ key: name, sha256, expiresAt: reference.expiresAt });
  }
  windowOpen(quiescence);
  objects.forEach((row) => {
    future(row.expiresAt);
  });
  return {
    format: 'insignia-offline-object-snapshot-v1',
    quiesced: true,
    quiescence,
    capturedAt: new Date().toISOString(),
    databaseExpiresAt,
    absoluteExpiresAt,
    promisedCleanupAt,
    objects,
  };
}

export async function databaseSnapshot(client) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const artwork = (
      await client.query(
        'SELECT a.*, EXISTS(SELECT 1 FROM public.shops s JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=a.shop_id AND s.current_generation=a.installation_generation AND i.deactivated_at IS NULL) AS active FROM public.artwork_assets a ORDER BY a.asset_id',
      )
    ).rows;
    const merchant = (
      await client.query(
        `SELECT a.*, EXISTS(SELECT 1 FROM public.shops s JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=a.shop_id AND s.current_generation=a.installation_generation AND i.deactivated_at IS NULL) AS active, EXISTS(SELECT 1 FROM public.config_revision_preview_assets r WHERE r.asset_id=a.asset_id) AND EXISTS(SELECT 1 FROM public.shops s JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=a.shop_id AND s.current_generation=a.installation_generation AND i.deactivated_at IS NULL) AS live_referenced FROM public.merchant_preview_assets a ORDER BY a.asset_id`,
      )
    ).rows;
    const deadlines = (
      await client.query(`SELECT min(deadline) AS deadline FROM (
      SELECT purge_after AS deadline FROM public.inbox_messages WHERE erasure_state<>'erased' AND octet_length(payload)>0
      UNION ALL SELECT purge_after FROM public.outbox_events WHERE erasure_state<>'erased'
      UNION ALL SELECT CASE WHEN state='UPLOADING' THEN least(expires_at,collected_at+interval '24 hours') ELSE expires_at END FROM public.artwork_assets WHERE state<>'DELETED'
      UNION ALL SELECT forget_after FROM public.webhook_obligation_facts WHERE facts_erased_at IS NULL
      UNION ALL SELECT expires_at FROM public.buyer_sessions
      UNION ALL SELECT expires_at FROM public.design_drafts
      UNION ALL SELECT retain_private_until FROM public.quote_proposals
      UNION ALL SELECT expires_at FROM public.purchase_design_payloads WHERE erased_at IS NULL
      UNION ALL SELECT expires_at FROM public.purchase_offer_payloads WHERE erased_at IS NULL
      UNION ALL SELECT expires_at FROM public.purchase_artwork_events WHERE kind='ATTACH' AND erased_at IS NULL
    ) deadlines`)
    ).rows[0].deadline;
    const absolute = (
      await client.query(`SELECT coalesce(min(((collected_at AT TIME ZONE 'UTC')+interval '6 months') AT TIME ZONE 'UTC'),((clock_timestamp() AT TIME ZONE 'UTC')+interval '6 months') AT TIME ZONE 'UTC') AS deadline FROM (
      SELECT collected_at FROM public.artwork_assets WHERE state<>'DELETED'
      UNION ALL SELECT collected_at FROM public.inbox_messages WHERE erasure_state<>'erased' AND octet_length(payload)>0
      UNION ALL SELECT collected_at FROM public.outbox_events WHERE erasure_state<>'erased'
      UNION ALL SELECT collected_at FROM public.webhook_obligation_facts WHERE facts_erased_at IS NULL
      UNION ALL SELECT created_at AS collected_at FROM public.buyer_sessions
      UNION ALL SELECT created_at AS collected_at FROM public.quote_proposals
      UNION ALL SELECT collected_at FROM public.purchase_design_payloads WHERE erased_at IS NULL
      UNION ALL SELECT collected_at FROM public.purchase_offer_payloads WHERE erased_at IS NULL
      UNION ALL SELECT occurred_at AS collected_at FROM public.purchase_artwork_events WHERE kind='ATTACH' AND erased_at IS NULL
    ) private_collection`)
    ).rows[0].deadline;
    const result = {
      absoluteExpiresAt: future(absolute),
      references: objectReferences(artwork, merchant),
      databaseExpiresAt: future(deadlines ?? new Date(Date.now() + 7 * 86400_000)),
    };
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export function assertSourceEnvironment(environment = process.env) {
  if (
    ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'PGOPTIONS', 'DATABASE_URL'].some((name) => environment[name]) ||
    environment.PGHOST?.includes(',') ||
    environment.PGPORT?.includes(',') ||
    environment.PGDATABASE?.includes('://') ||
    environment.PGDATABASE?.includes('=')
  )
    fail();
}
async function main() {
  assertSourceEnvironment();
  if (!Object.hasOwn(process.env, 'BACKUP_PROMISED_CLEANUP_AT')) fail();
  process.umask(0o077);
  const [directory, manifestPath, windowPath] = process.argv.slice(2);
  if (!directory || !manifestPath || !windowPath || !isAbsolute(directory)) fail();
  const stat = await lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid() ||
    stat.mode & 0o077 ||
    (await statfs(directory)).type !== 0x01021994
  )
    fail();
  if ((await readdir(directory)).length) fail();
  const quiescence = await privateFile(windowPath);
  windowOpen(quiescence);
  const endpoint = process.env.ARTWORK_R2_ENDPOINT,
    bucket = process.env.ARTWORK_R2_BUCKET,
    prefix = process.env.ARTWORK_R2_PREFIX;
  if (
    !/^https:\/\/[a-f0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com\/$/.test(endpoint ?? '') ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket ?? '')
  )
    fail();
  key(prefix);
  const profile = await privateFile(process.env.ARTWORK_STORAGE_PROFILE);
  const { createR2ArtworkStorage } = await import('../../packages/storage/dist/index.js');
  const storage = createR2ArtworkStorage({
    endpoint,
    bucket,
    prefix,
    accessKeyId: profile.accessKeyId,
    secretAccessKey: profile.secretAccessKey,
  });
  const { AwsClient } = createRequire(await realpath(new URL('../../packages/storage/package.json', import.meta.url)))(
    'aws4fetch',
  );
  const aws = new AwsClient({
    accessKeyId: profile.accessKeyId,
    secretAccessKey: profile.secretAccessKey,
    region: 'auto',
    service: 's3',
  });
  const { Pool } = createRequire(new URL('../../apps/worker/package.json', import.meta.url))('pg');
  const pool = new Pool({ max: 1 });
  const client = await pool.connect();
  try {
    const data = await databaseSnapshot(client);
    const manifest = await captureSnapshot({
      directory,
      ...data,
      promisedCleanupAt:
        process.env.BACKUP_PROMISED_CLEANUP_AT === 'none' ? null : future(process.env.BACKUP_PROMISED_CLEANUP_AT),
      quiescence,
      list: async (token) => {
        const url = new URL('/' + bucket, endpoint);
        url.search = new URLSearchParams({
          'list-type': '2',
          'encoding-type': 'url',
          prefix: prefix + '/',
          ...(token ? { 'continuation-token': token } : {}),
        });
        const signed = await aws.sign(url, { method: 'GET' });
        const response = await fetch(new Request(signed, { redirect: 'error', signal: AbortSignal.timeout(30_000) }));
        if (!response.ok) {
          await response.body?.cancel();
          fail();
        }
        const length = Number(response.headers.get('content-length'));
        if (length > 10 * 1024 * 1024) {
          await response.body?.cancel();
          fail();
        }
        // Bound even chunked/untrusted bodies.
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 10 * 1024 * 1024) fail();
          chunks.push(chunk);
        }
        return parseListing(Buffer.concat(chunks).toString('utf8'), prefix + '/');
      },
      read: async (key) => storage.read({ key, maxBytes: 5 * 1024 * 1024 }),
    });
    await writePrivate(manifestPath, JSON.stringify({ ...manifest, source: { endpoint, bucket, prefix } }));
    console.log(
      JSON.stringify({ capturedObjects: manifest.objects.length, readiness: 'SNAPSHOT_CREATED_BACKUP_PENDING' }),
    );
  } finally {
    client.release();
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error('Backup snapshot failed; readiness HOLD');
    process.exitCode = 1;
  });
