import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { packageOperations } from './package-operations.mts';
import { jsonRecord, object, requiredEnv } from './validation.mts';

const identity = { sourceHead: '1'.repeat(40), sourceTree: '2'.repeat(40) };
async function fixture(parent: string) {
  const worker = join(parent, 'worker');
  await mkdir(join(worker, 'dist'), { recursive: true });
  await mkdir(join(worker, 'node_modules/pg'), { recursive: true });
  await mkdir(join(worker, 'node_modules/@insignia/storage/dist'), { recursive: true });
  await writeFile(join(worker, 'package.json'), JSON.stringify({ name: '@insignia/worker', type: 'module' }));
  await writeFile(join(worker, 'dist/main.js'), 'export {};\n');
  await writeFile(join(worker, 'node_modules/pg/package.json'), JSON.stringify({ name: 'pg', main: 'index.cjs' }));
  await writeFile(
    join(worker, 'node_modules/pg/index.cjs'),
    'exports.Pool=class { async connect(){throw Error("test-only unavailable DB")} async end(){} };\n',
  );
  const storage = join(worker, 'node_modules/@insignia/storage');
  await writeFile(join(storage, 'package.json'), JSON.stringify({ name: '@insignia/storage', type: 'module' }));
  await writeFile(join(storage, 'dist/index.js'), 'export function createR2ArtworkStorage(){ return {} }\n');
  await mkdir(join(storage, 'node_modules/aws4fetch'), { recursive: true });
  await writeFile(
    join(storage, 'node_modules/aws4fetch/package.json'),
    JSON.stringify({ name: 'aws4fetch', main: 'index.cjs' }),
  );
  await writeFile(
    join(storage, 'node_modules/aws4fetch/index.cjs'),
    'exports.AwsClient=class {async sign(url){return url}};\n',
  );
  return worker;
}
async function verifyClosure(artifact: string) {
  const result = spawnSync(
    join(artifact, 'bin/node'),
    [
      '--input-type=module',
      '-e',
      `
import {createRequire} from 'node:module';
import {realpath} from 'node:fs/promises';
import {createR2ArtworkStorage} from './packages/storage/dist/index.js';
const {AwsClient}=createRequire(await realpath(new URL('./packages/storage/package.json',import.meta.url)))('aws4fetch');
const {Pool}=createRequire(new URL('./apps/worker/package.json',import.meta.url))('pg');
if(typeof createR2ArtworkStorage!=='function'||typeof AwsClient!=='function'||typeof Pool!=='function')throw Error('closure missing');
await import('./scripts/operations/backup.mts');
await import('./scripts/operations/backup-run.mts');
await import('./scripts/operations/heartbeat.mts');
await import('./scripts/operations/heartbeat-snapshot.mts');
const backup=await import('./scripts/operations/backup-snapshot.mts');
if(backup.objectReferences([],[]).length!==0)throw Error('copied backup helper failed');
const replica=await import('./scripts/operations/backup-replica.mts');
if(typeof replica.replicateStore!=='function')throw Error('replica closure missing');
await import('./scripts/privacy/restore-exclusions.mts');
`,
    ],
    { cwd: artifact, env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
}
async function verifyCollector(artifact: string, scratch: string) {
  const config = join(scratch, 'config.json');
  const startup = join(scratch, 'startup.json');
  const output = join(scratch, 'aggregates');
  await mkdir(output, { mode: 0o700 });
  await writeFile(
    startup,
    JSON.stringify({ databaseUrl: 'postgresql://testmonitor:test-only-password@127.0.0.1:1/absent' }),
    { mode: 0o600 },
  );
  await writeFile(
    config,
    JSON.stringify({
      outputDirectory: output,
      databaseStartupFile: startup,
      backupStore: join(scratch, 'missing-backup'),
      stalledAfterSeconds: 900,
    }),
    { mode: 0o600 },
  );
  const result = spawnSync(join(artifact, 'bin/node'), [join(artifact, 'scripts/operations/heartbeat-snapshot.mts')], {
    cwd: '/',
    env: { PATH: '/usr/bin:/bin', INSIGNIA_HEARTBEAT_SNAPSHOT_CONFIG: config },
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'heartbeat_snapshot_incomplete\n');
  assert.equal(jsonRecord(await readFile(join(output, 'processing.json'), 'utf8')).stalledCount, null);
}

async function verifyBackupCli(artifact: string) {
  const scratch = await mkdtemp('/dev/shm/insignia-operations-cli-');
  try {
    const objects = join(scratch, 'objects');
    await mkdir(objects, { mode: 0o700 });
    const window = join(scratch, 'window.json');
    const profile = join(scratch, 'profile.json');
    const preload = join(scratch, 'offline.mjs');
    await writeFile(
      window,
      JSON.stringify({
        id: 'offline-test',
        startedAt: new Date().toISOString(),
        until: new Date(Date.now() + 60_000).toISOString(),
      }),
      { mode: 0o600 },
    );
    await writeFile(profile, JSON.stringify({ accessKeyId: 'test-only-access', secretAccessKey: 'test-only-secret' }), {
      mode: 0o600,
    });
    await writeFile(
      preload,
      `import {createRequire} from 'node:module';
const {Pool}=createRequire(${JSON.stringify(join(artifact, 'apps/worker/package.json'))})('pg');
Pool.prototype.connect=async()=>{process.stdout.write('packaged_backup_database_reached\\n');throw Error('offline boundary')};
globalThis.fetch=()=>{throw Error('Provider calls prohibited')};
`,
      { mode: 0o600 },
    );
    const result = spawnSync(
      join(artifact, 'bin/node'),
      [
        '--import',
        preload,
        join(artifact, 'scripts/operations/backup-snapshot.mts'),
        objects,
        join(scratch, 'manifest.json'),
        window,
      ],
      {
        cwd: '/',
        env: {
          PATH: '/usr/bin:/bin',
          ARTWORK_R2_ENDPOINT: 'https://00000000000000000000000000000000.r2.cloudflarestorage.com/',
          ARTWORK_R2_BUCKET: 'test-only-bucket',
          ARTWORK_R2_PREFIX: 'offline',
          ARTWORK_STORAGE_PROFILE: profile,
          BACKUP_PROMISED_CLEANUP_AT: '',
        },
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, 'packaged_backup_database_reached\n', result.stderr);
    assert.match(result.stderr, /Backup snapshot failed; readiness HOLD/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function verifyReplicaCli(artifact: string) {
  const scratch = await mkdtemp(join(tmpdir(), 'insignia-replica-cli-'));
  try {
    const journal = join(scratch, 'journal'),
      store = join(scratch, 'store');
    await mkdir(journal, { mode: 0o700 });
    await mkdir(store, { mode: 0o700 });
    const profile = join(scratch, 'profile.json'),
      config = join(scratch, 'config.json'),
      preload = join(scratch, 'offline.mjs');
    await writeFile(profile, JSON.stringify({ accessKeyId: 'test-only-access', secretAccessKey: 'test-only-secret' }), {
      mode: 0o600,
    });
    const target = {
      endpoint: 'https://00000000000000000000000000000000.r2.cloudflarestorage.com/',
      bucket: 'test-backups',
      prefix: 'private',
    };
    await writeFile(
      config,
      JSON.stringify({
        format: 'insignia-backup-replica-config-v1',
        exclusiveNamespace: true,
        maxBytes: 1024,
        ...target,
        source: { endpoint: target.endpoint, bucket: 'test-artwork', prefix: 'artwork' },
        store,
        journalDirectory: journal,
        profile,
      }),
      { mode: 0o600 },
    );
    await writeFile(
      preload,
      "globalThis.fetch=()=>{process.stdout.write('packaged_replica_transport_reached\\n');throw Error('Provider calls prohibited')};\n",
      { mode: 0o600 },
    );
    const result = spawnSync(
      join(artifact, 'bin/node'),
      ['--import', preload, join(artifact, 'scripts/operations/backup-replica.mts'), 'prune', config],
      { cwd: '/', env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 10_000 },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, 'packaged_replica_transport_reached\n', result.stderr);
    assert.match(result.stderr, /HOLD_REPLICA_OPERATOR_SETTLEMENT/);
    const retention = jsonRecord(await readFile(join(journal, 'retention.json'), 'utf8'));
    assert.equal(retention.overdueCount, null);
    assert.deepEqual(retention.remoteIdentity, target);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

test('operations package relocates with its complete module paths, executable Node and digest inventory', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'insignia-operations-'));
  try {
    const worker = await fixture(scratch);
    const receipt = await packageOperations({
      workerPackage: worker,
      destination: join(scratch, 'package'),
      ...identity,
    });
    const artifact = join(scratch, 'relocated');
    await rename(join(scratch, 'package'), artifact);
    await rm(worker, { recursive: true, force: true });
    await verifyClosure(artifact);
    await verifyCollector(artifact, scratch);
    await verifyBackupCli(artifact);
    await verifyReplicaCli(artifact);
    const raw = await readFile(join(artifact, 'manifest.json'));
    assert.equal(createHash('sha256').update(raw).digest('hex'), receipt.manifestSha256);
    const manifest = jsonRecord(raw.toString('utf8'));
    assert.equal(manifest.sourceTree, identity.sourceTree);
    assert.equal(manifest.sourceHead, identity.sourceHead);
    const notices: unknown = JSON.parse(await readFile(join(artifact, 'THIRD-PARTY-NOTICES.json'), 'utf8'));
    assert(Array.isArray(notices));
    for (const name of ['tar-stream', 'b4a', 'fast-fifo', 'streamx']) {
      const item = notices.map(object).find((value) => value.name === name);
      assert(item, `runtime bundle must retain ${name} license`);
      assert(Array.isArray(item.licenseFiles) && item.licenseFiles.length > 0);
      for (const file of item.licenseFiles) {
        assert(typeof file === 'string');
        assert((await readFile(join(artifact, file), 'utf8')).length > 0);
        assert(object(manifest.files)[file], 'third-party notices must be byte-bound by the artifact');
      }
    }
    for (const key of [
      'bin/node',
      'NODE-LICENSE',
      'scripts/operations/backup.mts',
      'scripts/operations/backup-run.mts',
      'scripts/operations/backup-replica.mts',
      'scripts/privacy/restore-exclusions.mts',
      'packages/database/migrations/20261018000500_restore_validation_namespace.sql',
      'apps/worker/node_modules/pg/index.cjs',
    ]) {
      assert.equal(
        object(object(manifest.files)[key]).sha256,
        createHash('sha256')
          .update(await readFile(join(artifact, key)))
          .digest('hex'),
      );
    }
    assert.deepEqual(object(manifest.files)['packages/storage'], {
      kind: 'link',
      target: '../apps/worker/node_modules/@insignia/storage',
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('operations packaging rejects private worker input and escaping dependency links', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'insignia-operations-invalid-'));
  try {
    const worker = await fixture(scratch);
    await writeFile(join(worker, 'dist/credentials.json'), 'test-only private fixture');
    await assert.rejects(
      packageOperations({ workerPackage: worker, destination: join(scratch, 'private'), ...identity }),
      /Private file/,
    );
    await rm(join(worker, 'dist/credentials.json'));
    await symlink('/etc/passwd', join(worker, 'node_modules/escape'));
    await assert.rejects(
      packageOperations({ workerPackage: worker, destination: join(scratch, 'escape'), ...identity }),
      /escaped/,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('actual portable worker operations dependencies and collector work after relocation without checkout', {
  skip: !process.env.M5_WORKER_PACKAGE_ENTRY && 'Current portable worker is supplied by runtime CI',
}, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'insignia-operations-real-'));
  try {
    const artifact = join(scratch, 'artifact');
    await packageOperations({
      workerPackage: join(requiredEnv('M5_WORKER_PACKAGE_ENTRY'), '../..'),
      destination: artifact,
      ...identity,
    });
    await verifyClosure(artifact);
    await verifyCollector(artifact, scratch);
    await verifyBackupCli(artifact);
    await verifyReplicaCli(artifact);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
