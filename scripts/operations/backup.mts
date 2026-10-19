/** Private local backup/recovery operator. Never enables a restored service. */
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { packArchive, unpackArchive } from './backup-archive.mts';
import {
  array,
  check,
  digest,
  durable,
  HOLD,
  jsonFile,
  privateDirectory,
  record,
  remove,
  requireTmpfs,
  root,
  run,
  sourceEnvironment,
  syncDirectory,
  text,
  timestamp,
} from './backup-files.mts';
import { acquireFileLock } from './backup-lock.mts';

export { digest, HOLD, privateDirectory, sourceEnvironment, timestamp } from './backup-files.mts';
export type SnapshotObject = { key: string; sha256: string; expiresAt: string };
export type Snapshot = Record<string, unknown> & {
  format: string;
  quiesced: boolean;
  capturedAt: string;
  databaseExpiresAt: string;
  absoluteExpiresAt: string;
  promisedCleanupAt: string | null;
  quiescence: { id: string; startedAt: string; until: string };
  objects: SnapshotObject[];
};
export function snapshot(value: unknown): Snapshot {
  const raw = record(value),
    window = record(raw.quiescence);
  check(typeof raw.quiesced === 'boolean', 'Quiescence required');
  check(raw.promisedCleanupAt === null || typeof raw.promisedCleanupAt === 'string', 'Explicit cutoff required');
  return {
    ...raw,
    format: text(raw.format),
    quiesced: raw.quiesced,
    capturedAt: text(raw.capturedAt),
    databaseExpiresAt: text(raw.databaseExpiresAt),
    absoluteExpiresAt: text(raw.absoluteExpiresAt),
    promisedCleanupAt: raw.promisedCleanupAt,
    quiescence: { ...window, id: text(window.id), startedAt: text(window.startedAt), until: text(window.until) },
    objects: array(raw.objects).map((value) => {
      const item = record(value);
      return { ...item, key: text(item.key), sha256: text(item.sha256), expiresAt: text(item.expiresAt) };
    }),
  };
}
export function validateObjects(rootPath: string, objects: readonly SnapshotObject[], allowExpired = false): void {
  const seen = new Set<string>();
  for (const obj of objects) {
    const key = obj.key;
    check(
      Boolean(key) &&
        !key.startsWith('/') &&
        !key.split('/').some((part) => ['', '.', '..'].includes(part)) &&
        !seen.has(key),
      'invalid object identity',
    );
    seen.add(key);
    const candidate = join(rootPath, key);
    for (let part = resolve(candidate); ; part = dirname(part)) {
      check(!lstatSync(part).isSymbolicLink(), 'missing or unsafe object');
      if (dirname(part) === part) break;
    }
    check(lstatSync(candidate).isFile(), 'missing or unsafe object');
    check(/^[a-f0-9]{64}$/.test(obj.sha256) && digest(candidate) === obj.sha256, 'object hash mismatch');
    check(allowExpired || timestamp(obj.expiresAt) > Date.now(), 'expired object');
  }
}
export function checkWindow(manifest: Snapshot): void {
  check(
    Boolean(manifest.quiescence.id) &&
      timestamp(manifest.quiescence.startedAt) <= timestamp(manifest.capturedAt) &&
      timestamp(manifest.quiescence.until) > Date.now(),
    'snapshot exclusion window expired',
  );
}
export type BackupOptions = {
  store: string;
  objects: string;
  objectManifest: string;
  recipient: string;
  scratch: string;
  pgDump: string;
};
export async function backup(args: BackupOptions): Promise<Record<string, unknown>> {
  sourceEnvironment();
  const store = privateDirectory(args.store, true),
    lock = acquireFileLock(join(store, '.lock'));
  try {
    const manifest = snapshot(jsonFile(args.objectManifest));
    check(
      manifest.format === 'insignia-offline-object-snapshot-v1' && manifest.quiesced,
      'qualified quiesced object snapshot required',
    );
    checkWindow(manifest);
    const objectRoot = privateDirectory(args.objects, true);
    requireTmpfs(objectRoot);
    validateObjects(objectRoot, manifest.objects);
    const now = Date.now();
    check(timestamp(manifest.capturedAt) <= now && now - timestamp(manifest.capturedAt) <= 3600000, 'stale snapshot');
    check(timestamp(manifest.databaseExpiresAt) > now, 'expired database payload retention');
    const absolute = timestamp(manifest.absoluteExpiresAt);
    check(absolute > now, 'absolute retention and explicit cutoff policy required');
    const expires = Math.min(
      now + 7 * 86400000,
      absolute,
      manifest.promisedCleanupAt === null ? Infinity : timestamp(manifest.promisedCleanupAt),
    );
    check(expires > now, 'explicit cleanup cutoff reached');
    const id = randomUUID(),
      artifact = join(store, `${id}.cms`);
    durable(join(store, `${id}.intent.json`), {
      format: 'insignia-backup-intent-v1',
      id,
      expiresAt: new Date(expires).toISOString(),
    });
    const scratch = privateDirectory(args.scratch, true);
    requireTmpfs(scratch);
    const stage = mkdtempSync(join(scratch, '.backup-'));
    let dumpSha256 = '';
    try {
      const dump = join(stage, 'database.dump');
      run([args.pgDump, '--format=custom', '--no-password', '--file', dump]);
      dumpSha256 = digest(dump);
      checkWindow(manifest);
      const archive = join(stage, 'snapshot.tar'),
        manifestPath = join(stage, 'objects.json');
      writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
      await packArchive(archive, [
        { path: dump, name: 'database.dump' },
        ...manifest.objects.map((obj) => ({ path: join(objectRoot, obj.key), name: `objects/${obj.key}` })),
        { path: manifestPath, name: 'objects.json' },
      ]);
      validateObjects(objectRoot, manifest.objects);
      const encrypted = join(stage, 'snapshot.cms');
      run([
        'openssl',
        'cms',
        '-encrypt',
        '-binary',
        '-aes-256-gcm',
        '-outform',
        'DER',
        '-in',
        archive,
        '-out',
        encrypted,
        args.recipient,
      ]);
      const encryptedFd = openSync(encrypted, constants.O_RDONLY);
      try {
        fsyncSync(encryptedFd);
      } finally {
        closeSync(encryptedFd);
      }
      const target = openSync(
        artifact,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        const input = openSync(encrypted, constants.O_RDONLY);
        try {
          const chunk = Buffer.alloc(1024 * 1024);
          while (true) {
            const length = readSync(input, chunk);
            if (length === 0) break;
            let offset = 0;
            while (offset < length) offset += writeSync(target, chunk, offset, length - offset);
          }
        } finally {
          closeSync(input);
        }
        fsyncSync(target);
      } finally {
        closeSync(target);
      }
      syncDirectory(store);
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
    checkWindow(manifest);
    const completed = Date.now();
    check(completed < expires, 'backup expired before completion');
    const value = {
      format: 'insignia-encrypted-backup-v1',
      id,
      createdAt: new Date(now).toISOString(),
      completedAt: new Date(completed).toISOString(),
      expiresAt: new Date(expires).toISOString(),
      absoluteExpiresAt: manifest.absoluteExpiresAt,
      promisedCleanupAt: manifest.promisedCleanupAt,
      originalDatabaseExpiresAt: manifest.databaseExpiresAt,
      dumpSha256,
      quiescenceId: manifest.quiescence.id,
      sha256: digest(artifact),
      bytes: lstatSync(artifact).size,
      objects: manifest.objects.length,
      readiness: 'BACKUP_CREATED_RESTORE_UNQUALIFIED',
    };
    durable(join(store, `${id}.json`), value);
    prune(store, Date.now());
    return value;
  } finally {
    lock.close();
  }
}
export function prune(store: string, now: number): void {
  let failures = 0;
  const entries = readdirSync(store);
  for (const name of [
    ...entries.filter((name) => name.endsWith('.intent.json')),
    ...entries.filter((name) => name.endsWith('.json')),
  ]) {
    const intent = name.endsWith('.intent.json');
    if (!(intent ? /^[a-f0-9-]{36}\.intent\.json$/ : /^[a-f0-9-]{36}\.json$/).test(name)) continue;
    const path = join(store, name);
    try {
      let info: ReturnType<typeof lstatSync>;
      try {
        info = lstatSync(path);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
        throw error;
      }
      check(!info.isSymbolicLink(), 'unsafe retention sidecar');
      const value = record(jsonFile(path)),
        suffix = intent ? '.intent.json' : '.json';
      check(
        value.format === (intent ? 'insignia-backup-intent-v1' : 'insignia-encrypted-backup-v1') &&
          text(value.id) + suffix === name,
        'invalid retention ownership',
      );
      if (timestamp(value.expiresAt) > now) continue;
      for (const ending of ['.cms', '.json']) {
        const owned = join(store, text(value.id) + ending);
        let info: ReturnType<typeof lstatSync>;
        try {
          info = lstatSync(owned);
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
          throw error;
        }
        check(!info.isSymbolicLink(), 'unsafe retention artifact');
        remove(owned);
      }
      remove(path);
      syncDirectory(store);
    } catch {
      failures++;
    }
  }
  check(failures === 0, 'retention completed with damaged identities requiring inspection');
}
export function removeStagedExclusions(
  stage: string,
  manifest: Pick<Snapshot, 'objects'>,
  exclusions: ReadonlySet<string>,
  now: number,
): number {
  let removed = 0;
  for (const obj of manifest.objects) {
    if (exclusions.has(obj.key) || timestamp(obj.expiresAt) <= now) {
      check(!obj.key.startsWith('/') && !obj.key.split('/').includes('..'), 'unsafe restored object identity');
      const candidate = join(stage, 'objects', obj.key);
      check(!lstatSync(candidate).isSymbolicLink(), 'unsafe restored object identity');
      remove(candidate);
      removed++;
    }
  }
  return removed;
}
export type RestoreOptions = {
  artifact: string;
  receipt: string;
  identity: string;
  destination: string;
  exclusions: string;
  createdb: string;
  pgRestore: string;
  psql: string;
  node: string;
  exclusionScript: string;
};
export async function restore(args: RestoreOptions): Promise<Record<string, unknown>> {
  check(
    !['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'DATABASE_URL'].some((name) => process.env[name]),
    'ambient database authority is forbidden for restore',
  );
  const host = process.env.PGHOST ?? '',
    database = process.env.PGDATABASE ?? '';
  check(
    host.startsWith('/') && !host.includes(',') && /^insignia_recovery_[a-z0-9_]{1,40}$/.test(database),
    'isolated recovery database and Unix socket required',
  );
  privateDirectory(host);
  const stage = privateDirectory(args.destination, true);
  requireTmpfs(stage);
  check(readdirSync(stage).length === 0, 'empty recovery destination required');
  durable(join(stage, 'HOLD.json'), { readiness: HOLD, startedAt: new Date().toISOString() });
  let completed = false;
  try {
    const value = await restoreSnapshot(args, stage, host, database);
    completed = true;
    return value;
  } finally {
    for (const name of [
      'snapshot.tar',
      'database.dump',
      'expiry-replay.json',
      'restore-pre.sql',
      'restore-data.sql',
      'restore-post.sql',
      'restore-fix.sql',
    ])
      remove(join(stage, name));
    if (!completed) {
      rmSync(join(stage, 'objects'), { recursive: true, force: true });
      remove(join(stage, 'objects.json'));
      remove(join(stage, 'objects.sanitized.json'));
    }
    syncDirectory(stage);
  }
}
async function restoreSnapshot(
  args: RestoreOptions,
  stage: string,
  host: string,
  database: string,
): Promise<Record<string, unknown>> {
  const metadata = record(jsonFile(args.receipt));
  check(
    metadata.format === 'insignia-encrypted-backup-v1' &&
      /^[a-f0-9-]{36}$/.test(text(metadata.id)) &&
      basename(args.artifact) === `${metadata.id}.cms` &&
      basename(args.receipt) === `${metadata.id}.json` &&
      timestamp(metadata.expiresAt) > Date.now() &&
      digest(args.artifact) === metadata.sha256,
    'invalid or expired backup',
  );
  const fd = openSync(args.exclusions, constants.O_RDONLY | constants.O_NOFOLLOW);
  let exclusion: Record<string, unknown>;
  try {
    const info = fstatSync(fd);
    check(
      info.uid === process.getuid?.() && (info.mode & 0o077) === 0 && info.size <= 64 * 1024 * 1024,
      'private current exclusion export required',
    );
    exclusion = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(fd))));
  } finally {
    closeSync(fd);
  }
  const coverage = timestamp(record(exclusion.data).exportedAt),
    now = Date.now();
  check(
    coverage >= timestamp(metadata.completedAt) && coverage <= now && now - coverage <= 900000,
    'fresh post-backup erasure coverage required',
  );
  const archive = join(stage, 'snapshot.tar');
  run([
    'openssl',
    'cms',
    '-decrypt',
    '-binary',
    '-inform',
    'DER',
    '-in',
    args.artifact,
    '-inkey',
    args.identity,
    '-out',
    archive,
  ]);
  const names = await unpackArchive(archive);
  await unpackArchive(archive, stage);
  check(digest(join(stage, 'database.dump')) === metadata.dumpSha256, 'database dump checksum mismatch');
  const manifest = snapshot(jsonFile(join(stage, 'objects.json'))),
    expected = new Set(['database.dump', 'objects.json', ...manifest.objects.map((obj) => `objects/${obj.key}`)]);
  check(
    names.size === expected.size && [...names].every((name) => expected.has(name)),
    'archive object inventory mismatch',
  );
  validateObjects(join(stage, 'objects'), manifest.objects, true);
  const environment: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('PG') && key !== 'DATABASE_URL'),
  );
  for (const key of ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSFILE', 'PGPASSWORD'])
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  run([args.createdb, '--no-password', database], { env: environment });
  for (const [section, name] of [
    ['pre-data', 'restore-pre.sql'],
    ['data', 'restore-data.sql'],
    ['post-data', 'restore-post.sql'],
  ] as const) {
    const path = join(stage, name);
    closeSync(openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600));
    run(
      [
        args.pgRestore,
        '--no-password',
        '--exit-on-error',
        '--section',
        section,
        '--file',
        path,
        join(stage, 'database.dump'),
      ],
      { env: environment },
    );
  }
  const migration = readFileSync(
      join(root, 'packages/database/migrations/20261018000500_restore_validation_namespace.sql'),
      'utf8',
    ),
    correction = migration.split('-- migrate:up')[1]?.split('-- migrate:down')[0];
  check(correction, 'Restore correction missing');
  const fixFd = openSync(
    join(stage, 'restore-fix.sql'),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fixFd, correction);
  } finally {
    closeSync(fixFd);
  }
  run(
    [
      args.psql,
      '--no-password',
      '-X',
      '--set',
      'ON_ERROR_STOP=1',
      '--single-transaction',
      '--dbname',
      database,
      '--file',
      join(stage, 'restore-pre.sql'),
      '--file',
      join(stage, 'restore-fix.sql'),
      '--file',
      join(stage, 'restore-data.sql'),
      '--file',
      join(stage, 'restore-post.sql'),
    ],
    { env: environment },
  );
  environment.DATABASE_URL = `postgresql:///${database}?host=${encodeURIComponent(host)}`;
  run([args.node, args.exclusionScript, 'import', args.exclusions], { env: environment });
  const expiryPath = join(stage, 'expiry-replay.json');
  run([args.node, new URL('./backup-expiry.mts', import.meta.url).pathname, expiryPath], { env: environment });
  const expiry = record(jsonFile(expiryPath));
  check(expiry.databaseExpiryReplayed === true, 'actual expiry replay required');
  const removed = removeStagedExclusions(stage, manifest, new Set(array(expiry.keys).map(text)), Date.now());
  for (const name of ['snapshot.tar', 'database.dump', 'expiry-replay.json']) remove(join(stage, name));
  const filtered = {
    ...manifest,
    objects: manifest.objects.filter((obj) => existsSync(join(stage, 'objects', obj.key))),
  };
  const sanitized = join(stage, 'objects.sanitized.json');
  durable(sanitized, filtered);
  renameSync(sanitized, join(stage, 'objects.json'));
  syncDirectory(stage);
  const value = {
    readiness: HOLD,
    databaseExpiryReplayed: true,
    stagedObjectsRemoved: removed,
    databaseRestored: true,
    erasureImportCompleted: true,
    objectsStagedOnly: true,
    finishedAt: new Date().toISOString(),
  };
  durable(join(stage, 'restored.json'), value);
  return value;
}
export async function main(argv = process.argv.slice(2)): Promise<void> {
  process.umask(0o077);
  try {
    const [action, ...args] = argv;
    const { values } = parseArgs({
      args,
      options: Object.fromEntries(
        [
          'store',
          'objects',
          'object-manifest',
          'recipient',
          'scratch',
          'pg-dump',
          'artifact',
          'receipt',
          'identity',
          'destination',
          'exclusions',
          'createdb',
          'pg-restore',
          'psql',
          'node',
          'exclusion-script',
        ].map((name) => [name, { type: 'string' }]),
      ),
      strict: true,
    });
    const value = (name: string, fallback?: string) => text(values[name] ?? fallback);
    let result: unknown;
    if (action === 'prune') {
      const store = privateDirectory(value('store'), true),
        lock = acquireFileLock(join(store, '.lock'));
      try {
        prune(store, Date.now());
        result = { retentionCompleted: true };
      } finally {
        lock.close();
      }
    } else if (action === 'create')
      result = await backup({
        store: value('store'),
        objects: value('objects'),
        objectManifest: value('object-manifest'),
        recipient: value('recipient'),
        scratch: value('scratch'),
        pgDump: value('pg-dump', 'pg_dump'),
      });
    else {
      check(action === 'restore', 'Backup action required');
      result = await restore({
        artifact: value('artifact'),
        receipt: value('receipt'),
        identity: value('identity'),
        destination: value('destination'),
        exclusions: value('exclusions'),
        createdb: value('createdb', 'createdb'),
        pgRestore: value('pg-restore', 'pg_restore'),
        psql: value('psql', 'psql'),
        node: value('node', 'node'),
        exclusionScript: value(
          'exclusion-script',
          new URL('../privacy/restore-exclusions.mts', import.meta.url).pathname,
        ),
      });
    }
    console.log(JSON.stringify(result));
  } catch {
    console.log(JSON.stringify({ status: 'FAILED', readiness: HOLD }));
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
