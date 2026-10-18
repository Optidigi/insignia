/** Encrypted archives only. Single-dispatch immutable remote backup namespace. */
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { parseListing } from './backup-snapshot.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HOLD = 'HOLD_REPLICA_OPERATOR_SETTLEMENT';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fail() {
  throw new Error(HOLD);
}
function valid(receipt, now = Date.now(), allowExpired = false) {
  if (
    receipt?.format !== 'insignia-encrypted-backup-v1' ||
    !UUID.test(receipt.id) ||
    !Number.isSafeInteger(receipt.bytes) ||
    receipt.bytes < 1 ||
    receipt.bytes > 1024 ** 3 ||
    !/^([a-f0-9]{64})$/.test(receipt.sha256) ||
    receipt.readiness !== 'BACKUP_CREATED_RESTORE_UNQUALIFIED'
  )
    fail();
  const created = Date.parse(receipt.createdAt),
    completed = Date.parse(receipt.completedAt),
    expires = Date.parse(receipt.expiresAt);
  if (
    !Number.isFinite(created) ||
    !Number.isFinite(completed) ||
    !Number.isFinite(expires) ||
    completed < created ||
    completed > now ||
    expires <= completed ||
    expires > created + 7 * 86400_000 ||
    (!allowExpired && expires <= now)
  )
    fail();
  return receipt;
}
async function privateDirectory(path, create = false) {
  if (create) await mkdir(path, { mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o077) fail();
}
async function privateJson(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid() || info.mode & 0o077 || info.size > 16384) fail();
    return JSON.parse(await handle.readFile('utf8'));
  } finally {
    await handle.close();
  }
}
async function durable(path, value) {
  const temporary = join(dirname(path), '.replica-' + randomUUID() + '.tmp');
  const file = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await link(temporary, path);
    const directory = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await unlink(temporary);
  }
}
async function small(response, max = 16384) {
  if (!response.ok) fail();
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > max) fail();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function jsonGet(transport, key, optional = false) {
  const response = await transport.request('GET', key);
  if (optional && response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  return JSON.parse((await small(response)).toString('utf8'));
}
async function put(transport, key, bytes, headers = {}) {
  const response = await transport.request('PUT', key, {
    body: bytes,
    headers: {
      'if-none-match': '*',
      'content-type': 'application/json',
      'content-length': String(bytes.byteLength),
      'x-amz-content-sha256': sha(bytes),
      ...headers,
    },
  });
  await response.body?.cancel();
  if (!response.ok) fail(); // Never retry even 412/5xx/lost response.
}
async function checkArchive(transport, receipt, { maxBytes = 1024 ** 3, output = null } = {}) {
  if (receipt.bytes > maxBytes) fail();
  const response = await transport.request('GET', receipt.id + '/archive.cms');
  if (!response.ok) {
    await response.body?.cancel();
    fail();
  }
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > receipt.bytes || bytes > maxBytes) fail();
    hash.update(chunk);
    if (output) {
      let offset = 0;
      while (offset < chunk.length) {
        const result = await output.write(chunk, offset, chunk.length - offset, null);
        if (!Number.isSafeInteger(result.bytesWritten) || result.bytesWritten < 1) fail();
        offset += result.bytesWritten;
      }
    }
  }
  if (bytes !== receipt.bytes || hash.digest('hex') !== receipt.sha256) fail();
}
function intent(receipt) {
  return { format: 'insignia-backup-replica-intent-v1', id: receipt.id, expiresAt: receipt.expiresAt, source: receipt };
}
function matchesIntent(value, receipt) {
  return JSON.stringify(value) === JSON.stringify(intent(receipt));
}
async function remoteComplete(transport, receipt, now, maxBytes) {
  const value = await jsonGet(transport, receipt.id + '/receipt.json', true);
  if (!value) return false;
  if (
    value.format !== 'insignia-backup-replica-receipt-v1' ||
    JSON.stringify(value.source) !== JSON.stringify(receipt) ||
    !Number.isFinite(Date.parse(value.replicatedAt)) ||
    Date.parse(value.replicatedAt) > now
  )
    fail();
  const reserved = await jsonGet(transport, receipt.id + '/intent.json');
  if (!matchesIntent(reserved, receipt)) fail();
  await checkArchive(transport, receipt, { maxBytes });
  return true;
}

function completion(receipt, transport) {
  if (!transport.identity || typeof transport.identity !== 'object') fail();
  return {
    format: 'insignia-backup-replica-completion-v1',
    id: receipt.id,
    sha256: receipt.sha256,
    bytes: receipt.bytes,
    expiresAt: receipt.expiresAt,
    sourceCompletedAt: receipt.completedAt,
    completedAt: new Date().toISOString(),
    remoteIdentity: transport.identity,
    readiness: 'OFFHOST_CIPHERTEXT_VERIFIED',
  };
}
export async function replicate({
  receipt,
  artifact,
  journalDirectory,
  transport,
  now = Date.now(),
  maxBytes = 1024 ** 3,
}) {
  valid(receipt, now);
  await privateDirectory(journalDirectory);
  const pending = join(journalDirectory, receipt.id + '.pending.json'),
    complete = join(journalDirectory, receipt.id + '.complete.json');
  // An independently observed complete response may settle an earlier lost receipt acknowledgement.
  if (await remoteComplete(transport, receipt, now, maxBytes)) {
    valid(receipt, Date.now());
    try {
      const prior = await privateJson(complete),
        expected = completion(receipt, transport);
      for (const field of ['format', 'id', 'sha256', 'bytes', 'expiresAt', 'sourceCompletedAt', 'readiness'])
        if (prior[field] !== expected[field]) fail();
      if (JSON.stringify(prior.remoteIdentity) !== JSON.stringify(expected.remoteIdentity)) fail();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await durable(complete, completion(receipt, transport));
    }
    valid(receipt, Date.now());
    return { readiness: 'OFFHOST_CIPHERTEXT_VERIFIED', id: receipt.id };
  }
  try {
    await lstat(pending);
    fail();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const file = await open(artifact, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.uid !== process.getuid() ||
      info.mode & 0o077 ||
      info.size !== receipt.bytes ||
      info.size > maxBytes
    )
      fail();
    const hash = createHash('sha256');
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
    if (hash.digest('hex') !== receipt.sha256) fail();
    await durable(pending, { ...intent(receipt), readiness: 'REMOTE_MUTATION_RESERVED' });
    // Remote deadline is durable before any ciphertext write. All writes are create-once.
    await put(transport, receipt.id + '/intent.json', Buffer.from(JSON.stringify(intent(receipt))));
    const response = await transport.request('PUT', receipt.id + '/archive.cms', {
      body: Readable.toWeb(file.createReadStream({ start: 0, autoClose: false })),
      headers: {
        'if-none-match': '*',
        'content-type': 'application/octet-stream',
        'content-length': String(receipt.bytes),
        'x-amz-content-sha256': receipt.sha256,
        'x-amz-meta-backup-id': receipt.id,
        'x-amz-meta-expires-at': receipt.expiresAt,
        'x-amz-meta-sha256': receipt.sha256,
      },
    });
    await response.body?.cancel();
    if (!response.ok) fail();
    await checkArchive(transport, receipt, { maxBytes });
    valid(receipt, Date.now());
    await put(
      transport,
      receipt.id + '/receipt.json',
      Buffer.from(
        JSON.stringify({
          format: 'insignia-backup-replica-receipt-v1',
          source: receipt,
          replicatedAt: new Date().toISOString(),
        }),
      ),
    );
    if (!(await remoteComplete(transport, receipt, Date.now(), maxBytes))) fail();
    valid(receipt, Date.now());
    await durable(complete, completion(receipt, transport));
    valid(receipt, Date.now());
    return { readiness: 'OFFHOST_CIPHERTEXT_VERIFIED', id: receipt.id };
  } finally {
    await file.close();
  }
}

export async function download({ id, directory, transport, maxBytes = 1024 ** 3, now = Date.now() }) {
  if (!UUID.test(id)) fail();
  await privateDirectory(directory, true);
  if ((await readdir(directory)).length) fail();
  await durable(join(directory, 'HOLD.json'), { readiness: 'HOLD_ERASURE_REPLAY_BEFORE_SERVICE_EXPOSURE' });
  const remote = await jsonGet(transport, id + '/receipt.json');
  const receipt = valid(remote.source, now);
  if (receipt.id !== id || !(await remoteComplete(transport, receipt, now, maxBytes))) fail();
  const path = join(directory, id + '.cms');
  const file = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await checkArchive(transport, receipt, { maxBytes, output: file });
    await file.sync();
  } finally {
    await file.close();
  }
  valid(receipt, Date.now());
  await durable(join(directory, id + '.json'), receipt);
  return { id, readiness: 'HOLD_ERASURE_REPLAY_BEFORE_SERVICE_EXPOSURE' };
}

export async function pruneReplica({ transport, now = Date.now(), maxBytes = 1024 ** 3 }) {
  const keys = await transport.list();
  const inventory = new Map();
  let held = false,
    deleted = 0;
  for (const key of keys) {
    const match = /^([a-f0-9-]{36})\/(intent\.json|archive\.cms|receipt\.json|deleting\.json)$/.exec(key);
    if (!match || !UUID.test(match[1])) {
      held = true;
      continue;
    }
    const parts = inventory.get(match[1]) ?? new Set();
    if (parts.has(match[2])) held = true;
    parts.add(match[2]);
    inventory.set(match[1], parts);
  }
  for (const [id, parts] of inventory) {
    try {
      if (!parts.has('intent.json') || parts.has('deleting.json')) fail();
      const reserved = await jsonGet(transport, id + '/intent.json');
      const receipt = valid(reserved.source, now, true);
      if (receipt.id !== id || !matchesIntent(reserved, receipt)) fail();
      if (parts.has('receipt.json')) {
        const complete = await jsonGet(transport, id + '/receipt.json');
        if (
          complete.format !== 'insignia-backup-replica-receipt-v1' ||
          JSON.stringify(complete.source) !== JSON.stringify(receipt)
        )
          fail();
      }
      if (Date.parse(receipt.expiresAt) > now) continue;
      // A negative GET cannot settle an in-flight PUT. Preserve its deadline and HOLD.
      if (!parts.has('archive.cms')) fail();
      const ownership = await transport.request('HEAD', id + '/archive.cms');
      await ownership.body?.cancel();
      if (
        !ownership.ok ||
        ownership.headers.get('x-amz-meta-backup-id') !== id ||
        ownership.headers.get('x-amz-meta-expires-at') !== receipt.expiresAt ||
        ownership.headers.get('x-amz-meta-sha256') !== receipt.sha256
      )
        fail();
      // Known ownership/deadline, not successful payload integrity, authorizes expiry.
      await put(
        transport,
        id + '/deleting.json',
        Buffer.from(JSON.stringify({ format: 'insignia-backup-replica-deletion-v1', id, source: receipt })),
      );
      for (const suffix of [
        'archive.cms',
        ...(parts.has('receipt.json') ? ['receipt.json'] : []),
        'intent.json',
        'deleting.json',
      ]) {
        const response = await transport.request('DELETE', id + '/' + suffix);
        await response.body?.cancel();
        if (!response.ok) fail();
      }
      deleted++;
    } catch {
      held = true;
    }
  }
  if (held) fail();
  return { deleted, readiness: 'REMOTE_RETENTION_CHECKED' };
}

async function retentionStatus(journalDirectory, overdueCount, remoteIdentity) {
  await privateDirectory(journalDirectory);
  const path = join(journalDirectory, 'retention.json'),
    temporary = join(journalDirectory, '.retention-' + randomUUID() + '.tmp');
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o077) fail();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const file = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(JSON.stringify({ observedAt: Date.now(), overdueCount, remoteIdentity }));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
  const directory = await open(journalDirectory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
export async function pruneWithStatus({ journalDirectory, ...options }) {
  await retentionStatus(journalDirectory, null, options.transport.identity);
  const result = await pruneReplica(options);
  await retentionStatus(journalDirectory, 0, options.transport.identity);
  return result;
}

async function makeTransport(config) {
  if (!Number.isSafeInteger(config.maxBytes) || config.maxBytes < 1 || config.maxBytes > 1024 ** 3) fail();
  if (
    config.format !== 'insignia-backup-replica-config-v1' ||
    config.exclusiveNamespace !== true ||
    !/^https:\/\/[a-f0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com\/$/.test(config.endpoint ?? '') ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket ?? '') ||
    !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(config.prefix ?? '') ||
    config.prefix.split('/').some((p) => p === '.' || p === '..')
  )
    fail();
  const source = config.source;
  const endpointPattern = /^https:\/\/[a-f0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com\/$/;
  const prefixPattern = /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*$/;
  if (
    !source ||
    !endpointPattern.test(source.endpoint ?? '') ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(source.bucket ?? '') ||
    !prefixPattern.test(source.prefix ?? '') ||
    source.prefix.split('/').some((p) => p === '.' || p === '..')
  )
    fail();
  if (
    source.bucket === config.bucket &&
    (source.prefix === config.prefix ||
      source.prefix.startsWith(config.prefix + '/') ||
      config.prefix.startsWith(source.prefix + '/'))
  )
    fail();
  if (
    typeof config.store !== 'string' ||
    typeof config.journalDirectory !== 'string' ||
    typeof config.profile !== 'string'
  )
    fail();
  const localStore = resolve(config.store),
    localJournal = resolve(config.journalDirectory);
  if (
    localStore === localJournal ||
    localStore.startsWith(localJournal + '/') ||
    localJournal.startsWith(localStore + '/')
  )
    fail();
  if (process.env.ARTWORK_STORAGE_PROFILE && resolve(config.profile) === resolve(process.env.ARTWORK_STORAGE_PROFILE))
    fail();
  for (const [name, value] of [
    ['ARTWORK_R2_ENDPOINT', source.endpoint],
    ['ARTWORK_R2_BUCKET', source.bucket],
    ['ARTWORK_R2_PREFIX', source.prefix],
  ])
    if (process.env[name] && process.env[name] !== value) fail();
  const profile = await privateJson(config.profile);
  const { AwsClient } = createRequire(await realpath(new URL('../../packages/storage/package.json', import.meta.url)))(
    'aws4fetch',
  );
  const aws = new AwsClient({
    accessKeyId: profile.accessKeyId,
    secretAccessKey: profile.secretAccessKey,
    region: 'auto',
    service: 's3',
  });
  async function request(method, key, { headers = {}, body } = {}) {
    const url = new URL('/' + config.bucket + '/' + config.prefix + '/' + key, config.endpoint);
    const signed = await aws.sign(url, { method, headers, body, duplex: 'half' });
    return fetch(new Request(signed, { redirect: 'error', signal: AbortSignal.timeout(120_000) })); // sign only; fetch never retries.
  }
  return {
    identity: { endpoint: config.endpoint, bucket: config.bucket, prefix: config.prefix },
    request,
    list: async () => {
      const keys = [],
        tokens = new Set();
      let token = null;
      do {
        const url = new URL('/' + config.bucket, config.endpoint);
        url.search = new URLSearchParams({
          'list-type': '2',
          'encoding-type': 'url',
          prefix: config.prefix + '/',
          ...(token ? { 'continuation-token': token } : {}),
        });
        const signed = await aws.sign(url, { method: 'GET' });
        const response = await fetch(new Request(signed, { redirect: 'error', signal: AbortSignal.timeout(30_000) }));
        const page = parseListing((await small(response, 10 * 1024 * 1024)).toString('utf8'), config.prefix + '/');
        keys.push(...page.keys);
        token = page.next;
        if ((token && tokens.has(token)) || keys.length > 10000) fail();
        if (token) tokens.add(token);
      } while (token);
      return keys;
    },
  };
}
export async function replicateStore({ store, journalDirectory, transport, maxBytes = 1024 ** 3 }) {
  await privateDirectory(store);
  await privateDirectory(journalDirectory);
  const names = (await readdir(store)).filter((n) => UUID.test(n.slice(0, -5)) && n.endsWith('.json')).sort();
  if (names.length > 4096) fail();
  let replicated = 0,
    held = false;
  for (const name of names) {
    try {
      const receipt = await privateJson(join(store, name));
      if (name !== receipt.id + '.json') fail();
      if (Date.parse(receipt.expiresAt) <= Date.now()) continue;
      await replicate({ receipt, artifact: join(store, receipt.id + '.cms'), journalDirectory, transport, maxBytes });
      replicated++;
    } catch {
      held = true;
    }
  }
  if (held || !replicated) fail();
  return { replicated, readiness: 'OFFHOST_CIPHERTEXT_VERIFIED' };
}
async function main() {
  process.umask(0o077);
  const [action, configPath, ...args] = process.argv.slice(2);
  const config = await privateJson(configPath);
  if (action === 'prune')
    await retentionStatus(config.journalDirectory, null, {
      endpoint: config.endpoint,
      bucket: config.bucket,
      prefix: config.prefix,
    });
  const transport = await makeTransport(config);
  let result;
  if (action === 'replicate') {
    result = await replicateStore({
      store: config.store,
      journalDirectory: config.journalDirectory,
      transport,
      maxBytes: config.maxBytes,
    });
  } else if (action === 'prune')
    result = await pruneWithStatus({ transport, journalDirectory: config.journalDirectory, maxBytes: config.maxBytes });
  else if (action === 'download' && args.length === 2)
    result = await download({ id: args[0], directory: resolve(args[1]), transport, maxBytes: config.maxBytes });
  else fail();
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(HOLD);
    process.exitCode = 1;
  });
