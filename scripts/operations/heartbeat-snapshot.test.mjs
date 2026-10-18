import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { collectDatabaseSnapshot, readBackupState } from './heartbeat-snapshot.mjs';

const now = Date.parse('2026-10-18T12:00:00Z');
test('exports only coarse counts under a read-only transaction and validates returned bounds', async () => {
  const commands = [];
  const db = {
    query: async (sql) => {
      commands.push(sql);
      return sql.includes('stalled_count')
        ? { rows: [{ stalled_count: '3', overdue_count: '4', observed_at: new Date(now) }] }
        : { rows: [] };
    },
  };
  assert.deepEqual(await collectDatabaseSnapshot(db, now, 900), {
    processing: { observedAt: now, stalledCount: 3 },
    deletion: { observedAt: now, overdueCount: 4 },
  });
  assert.match(commands[0], /READ ONLY/);
  assert.equal(commands.at(-1), 'COMMIT');
  await assert.rejects(
    collectDatabaseSnapshot(
      {
        query: async (sql) =>
          sql.includes('stalled_count')
            ? { rows: [{ stalled_count: '-1', overdue_count: '0', observed_at: new Date(now) }] }
            : { rows: [] },
      },
      now,
      900,
    ),
  );
});
test('database failure rolls back; stale/future database clock cannot refresh healthy evidence', async () => {
  const commands = [];
  await assert.rejects(
    collectDatabaseSnapshot(
      {
        query: async (sql) => {
          commands.push(sql);
          if (sql.includes('stalled_count')) throw new Error('database unavailable');
          return { rows: [] };
        },
      },
      now,
      900,
    ),
  );
  assert.equal(commands.at(-1), 'ROLLBACK');
  await assert.rejects(
    collectDatabaseSnapshot(
      {
        query: async (sql) =>
          sql.includes('stalled_count')
            ? { rows: [{ stalled_count: '0', overdue_count: '0', observed_at: new Date(now - 120_001) }] }
            : { rows: [] },
      },
      now,
      900,
    ),
  );
});
test('reads actual private durable backup receipt and matching artifact metadata; expired and incomplete backups cannot refresh freshness', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'heartbeat-backup-'));
  const id = '12345678-1234-1234-1234-123456789abc';
  const receipt = {
    format: 'insignia-encrypted-backup-v1',
    id,
    createdAt: new Date(now - 60_000).toISOString(),
    completedAt: new Date(now - 30_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    bytes: 4,
    sha256: 'a'.repeat(64),
    readiness: 'BACKUP_CREATED_RESTORE_UNQUALIFIED',
  };
  try {
    await chmod(directory, 0o700);
    await writeFile(join(directory, `${id}.cms`), 'data', { mode: 0o600 });
    await writeFile(join(directory, `${id}.json`), JSON.stringify(receipt), { mode: 0o600 });
    assert.deepEqual(await readBackupState(directory, now), { completedAt: now - 30_000, overdueCount: 0 });
    await writeFile(
      join(directory, `${id}.json`),
      JSON.stringify({ ...receipt, expiresAt: new Date(now - 1).toISOString() }),
    );
    assert.deepEqual(await readBackupState(directory, now), { completedAt: null, overdueCount: 1 });
    await rm(join(directory, `${id}.cms`));
    await assert.rejects(readBackupState(directory, now));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('runtime exporter invalidates healthy snapshots on source failures without exposing credentials', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const directory = await mkdtemp(join(tmpdir(), 'heartbeat-runtime-'));
  try {
    const startup = join(directory, 'startup.json');
    const config = join(directory, 'config.json');
    await writeFile(
      startup,
      JSON.stringify({ databaseUrl: 'postgresql://testmonitor:test-only-password@127.0.0.1:1/absent' }),
      { mode: 0o600 },
    );
    await writeFile(
      config,
      JSON.stringify({
        outputDirectory: directory,
        databaseStartupFile: startup,
        backupStore: join(directory, 'missing'),
        stalledAfterSeconds: 900,
      }),
      { mode: 0o600 },
    );
    await writeFile(join(directory, 'processing.json'), JSON.stringify({ observedAt: now, stalledCount: 0 }));
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      ['scripts/operations/heartbeat-snapshot.mjs'],
      { env: { ...process.env, INSIGNIA_HEARTBEAT_SNAPSHOT_CONFIG: config }, timeout: 10_000 },
    );
    assert.equal(stdout, 'heartbeat_snapshot_incomplete\n');
    assert.equal(stderr, '');
    assert.equal(JSON.parse(await readFile(join(directory, 'processing.json'), 'utf8')).stalledCount, null);
    assert.equal(JSON.parse(await readFile(join(directory, 'deletion.json'), 'utf8')).overdueCount, null);
    assert.equal(JSON.parse(await readFile(join(directory, 'backup.json'), 'utf8')).completedAt, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('expired interrupted backup ciphertext stays visible and orphan or malformed inventory is unknown', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'heartbeat-interrupted-'));
  const id = '12345678-1234-1234-1234-123456789abc';
  const intent = { format: 'insignia-backup-intent-v1', id, expiresAt: new Date(now - 1).toISOString() };
  try {
    await writeFile(join(directory, `${id}.intent.json`), JSON.stringify(intent), { mode: 0o600 });
    await writeFile(join(directory, `${id}.cms`), 'partial ciphertext', { mode: 0o600 });
    assert.deepEqual(await readBackupState(directory, now), { completedAt: null, overdueCount: 1 });
    await rm(join(directory, `${id}.intent.json`));
    await assert.rejects(readBackupState(directory, now), /[Oo]rphan/);
    await writeFile(join(directory, `${id}.intent.json`), JSON.stringify({ ...intent, expiresAt: 'invalid' }), {
      mode: 0o600,
    });
    await assert.rejects(readBackupState(directory, now), /[Ii]nvalid/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('required off-host completion binds source and exact remote target; deletion needs fresh target-bound retention', async () => {
  const root = await mkdtemp(join(tmpdir(), 'heartbeat-replica-'));
  const store = join(root, 'store'),
    journal = join(root, 'journal');
  const id = '12345678-1234-1234-1234-123456789abc';
  const target = {
    endpoint: 'https://00000000000000000000000000000000.r2.cloudflarestorage.com/',
    bucket: 'test-replica',
    prefix: 'private',
  };
  const source = {
    format: 'insignia-encrypted-backup-v1',
    id,
    createdAt: new Date(now - 60_000).toISOString(),
    completedAt: new Date(now - 30_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    bytes: 4,
    sha256: 'a'.repeat(64),
    readiness: 'BACKUP_CREATED_RESTORE_UNQUALIFIED',
  };
  const completion = {
    format: 'insignia-backup-replica-completion-v1',
    id,
    sha256: source.sha256,
    bytes: source.bytes,
    expiresAt: source.expiresAt,
    sourceCompletedAt: source.completedAt,
    completedAt: new Date(now - 10_000).toISOString(),
    remoteIdentity: target,
    readiness: 'OFFHOST_CIPHERTEXT_VERIFIED',
  };
  const options = { replicaRequired: true, replicaJournalDirectory: journal, replicaRemoteIdentity: target };
  try {
    await mkdir(store, { mode: 0o700 });
    await mkdir(journal, { mode: 0o700 });
    await writeFile(join(store, `${id}.cms`), 'data', { mode: 0o600 });
    await writeFile(join(store, `${id}.json`), JSON.stringify(source), { mode: 0o600 });
    assert.equal(
      (await readBackupState(store, now, options)).completedAt,
      null,
      'local success cannot refresh required off-host freshness',
    );
    const putCompletion = (value) =>
      writeFile(join(journal, `${id}.complete.json`), JSON.stringify(value), { mode: 0o600 });
    await putCompletion(completion);
    assert.deepEqual(await readBackupState(store, now, options), {
      completedAt: now - 30_000,
      overdueCount: 0,
      replicaOverdueCount: null,
    });
    for (const wrong of [
      { ...completion, remoteIdentity: { ...target, prefix: 'other' } },
      { ...completion, sha256: 'b'.repeat(64) },
      { ...completion, bytes: 5 },
      { ...completion, sourceCompletedAt: new Date(now - 20_000).toISOString() },
      { ...completion, expiresAt: new Date(now + 50_000).toISOString() },
      { ...completion, completedAt: new Date(now + 1).toISOString() },
    ]) {
      await putCompletion(wrong);
      assert.equal((await readBackupState(store, now, options)).completedAt, null);
    }
    await putCompletion(completion);
    const retention = { observedAt: now, overdueCount: 0, remoteIdentity: target };
    const putRetention = (value) => writeFile(join(journal, 'retention.json'), JSON.stringify(value), { mode: 0o600 });
    for (const wrong of [
      { ...retention, observedAt: now - 120_001 },
      { ...retention, overdueCount: null },
      { ...retention, remoteIdentity: { ...target, bucket: 'other' } },
    ]) {
      await putRetention(wrong);
      assert.equal((await readBackupState(store, now, options)).replicaOverdueCount, null);
    }
    await putRetention(retention);
    assert.equal((await readBackupState(store, now, options)).replicaOverdueCount, 0);
    await putRetention({ ...retention, overdueCount: 2 });
    assert.equal((await readBackupState(store, now, options)).replicaOverdueCount, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime deletion health requires fresh remote retention even when local backup and database are healthy', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const directory = await mkdtemp(join(tmpdir(), 'heartbeat-required-runtime-'));
  const store = join(directory, 'store'),
    journal = join(directory, 'journal'),
    output = join(directory, 'aggregates');
  const id = '12345678-1234-1234-1234-123456789abc';
  const target = {
    endpoint: 'https://00000000000000000000000000000000.r2.cloudflarestorage.com/',
    bucket: 'test-replica',
    prefix: 'private',
  };
  try {
    for (const path of [store, journal, output]) await mkdir(path, { mode: 0o700 });
    const observed = Date.now();
    const source = {
      format: 'insignia-encrypted-backup-v1',
      id,
      createdAt: new Date(observed - 60_000).toISOString(),
      completedAt: new Date(observed - 30_000).toISOString(),
      expiresAt: new Date(observed + 60_000).toISOString(),
      bytes: 4,
      sha256: 'a'.repeat(64),
      readiness: 'BACKUP_CREATED_RESTORE_UNQUALIFIED',
    };
    await writeFile(join(store, `${id}.cms`), 'data', { mode: 0o600 });
    await writeFile(join(store, `${id}.json`), JSON.stringify(source), { mode: 0o600 });
    await writeFile(
      join(journal, `${id}.complete.json`),
      JSON.stringify({
        format: 'insignia-backup-replica-completion-v1',
        id,
        sha256: source.sha256,
        bytes: source.bytes,
        expiresAt: source.expiresAt,
        sourceCompletedAt: source.completedAt,
        completedAt: new Date(observed - 10_000).toISOString(),
        remoteIdentity: target,
        readiness: 'OFFHOST_CIPHERTEXT_VERIFIED',
      }),
      { mode: 0o600 },
    );
    const startup = join(directory, 'startup.json'),
      config = join(directory, 'config.json'),
      preload = join(directory, 'offline.mjs');
    await writeFile(startup, JSON.stringify({ databaseUrl: 'postgresql://test-only@127.0.0.1:1/offline' }), {
      mode: 0o600,
    });
    await writeFile(
      config,
      JSON.stringify({
        databaseStartupFile: startup,
        outputDirectory: output,
        backupStore: store,
        stalledAfterSeconds: 900,
        replicaRequired: true,
        replicaJournalDirectory: journal,
        replicaRemoteIdentity: target,
      }),
      { mode: 0o600 },
    );
    await writeFile(
      preload,
      `import {createRequire} from 'node:module'; const {Pool}=createRequire(${JSON.stringify(new URL('../../apps/worker/package.json', import.meta.url).pathname)})('pg'); Pool.prototype.connect=async()=>({query:async sql=>({rows:sql.includes('stalled_count')?[{stalled_count:'0',overdue_count:'0',observed_at:new Date()}]:[]}),release(){}});`,
      { mode: 0o600 },
    );
    const run = async () => {
      await promisify(execFile)(process.execPath, ['--import', preload, 'scripts/operations/heartbeat-snapshot.mjs'], {
        env: { ...process.env, INSIGNIA_HEARTBEAT_SNAPSHOT_CONFIG: config },
        timeout: 10_000,
      });
      return JSON.parse(await readFile(join(output, 'deletion.json'), 'utf8'));
    };
    assert.equal((await run()).overdueCount, null);
    const putRetention = (value) => writeFile(join(journal, 'retention.json'), JSON.stringify(value), { mode: 0o600 });
    await putRetention({ observedAt: Date.now(), overdueCount: 0, remoteIdentity: target });
    assert.equal((await run()).overdueCount, 0);
    await putRetention({ observedAt: Date.now(), overdueCount: null, remoteIdentity: target });
    assert.equal((await run()).overdueCount, null);
    await putRetention({
      observedAt: Date.now(),
      overdueCount: 0,
      remoteIdentity: { ...target, prefix: 'wrong-target' },
    });
    assert.equal((await run()).overdueCount, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
