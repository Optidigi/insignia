import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  backup,
  HOLD,
  prune,
  type RestoreOptions,
  removeStagedExclusions,
  restore,
  timestamp,
  validateObjects,
} from './backup.mts';
import { unpackArchive } from './backup-archive.mts';
import { array, jsonFile, record, text } from './backup-files.mts';

function cleanEnvironment() {
  const original = { ...process.env };
  for (const key of ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'PGOPTIONS', 'DATABASE_URL']) delete process.env[key];
  return () => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, original);
  };
}
function temporary() {
  return mkdtempSync('/dev/shm/insignia-backup-');
}
const emptyRestore: RestoreOptions = {
  artifact: '',
  receipt: '',
  identity: '',
  destination: '',
  exclusions: '',
  createdb: 'createdb',
  pgRestore: 'pg_restore',
  psql: 'psql',
  node: process.execPath,
  exclusionScript: '',
};

test('archive source rejects missing originals, traversal and symlink identities', () => {
  const directory = temporary();
  try {
    assert.throws(() =>
      validateObjects(directory, [{ key: 'missing', sha256: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' }]),
    );
    assert.throws(() =>
      validateObjects(directory, [{ key: '../escape', sha256: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' }]),
    );
    writeFileSync(join(directory, 'actual'), 'fixture');
    symlinkSync(join(directory, 'actual'), join(directory, 'alias'));
    assert.throws(() =>
      validateObjects(directory, [{ key: 'alias', sha256: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z' }]),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('actual encryption preserves exact original bytes and seven-day/absolute/promised retention without deleting unowned files', async () => {
  const restoreEnv = cleanEnvironment(),
    directory = temporary();
  try {
    const objects = join(directory, 'objects');
    mkdirSync(objects, { mode: 0o700 });
    const original = Buffer.from('original exact bytes\x00\xff', 'latin1');
    writeFileSync(join(objects, 'original.png'), original);
    const now = Date.now(),
      deadline = new Date(now + 7200000).toISOString(),
      manifestPath = join(directory, 'manifest.json');
    const policy = {
      format: 'insignia-offline-object-snapshot-v1',
      quiesced: true,
      absoluteExpiresAt: new Date(now + 180 * 86400000).toISOString(),
      promisedCleanupAt: null as string | null,
      quiescence: { id: 'test-window', startedAt: new Date(now - 1000).toISOString(), until: deadline },
      databaseExpiresAt: new Date(now + 10800000).toISOString(),
      capturedAt: new Date(now).toISOString(),
      objects: [
        { key: 'original.png', sha256: createHash('sha256').update(original).digest('hex'), expiresAt: deadline },
      ],
    };
    writeFileSync(manifestPath, JSON.stringify(policy));
    const dump = join(directory, 'pg_dump');
    const fixture = new URL('./backup-dump.fixture.mts', import.meta.url).pathname;
    assert(!process.execPath.includes("'") && !fixture.includes("'"));
    writeFileSync(dump, `#!/bin/sh\nexec '${process.execPath}' '${fixture}' "$@"\n`, { mode: 0o700 });
    const key = join(directory, 'key.pem'),
      certificate = join(directory, 'recipient.pem');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=local-recovery-test',
        '-keyout',
        key,
        '-out',
        certificate,
      ],
      { stdio: 'ignore' },
    );
    const options = {
      store: join(directory, 'store'),
      objects,
      objectManifest: manifestPath,
      scratch: join(directory, 'scratch'),
      pgDump: dump,
      recipient: certificate,
    };
    const result = await backup(options);
    assert.equal(timestamp(result.expiresAt) - timestamp(result.createdAt), 7 * 86400000);
    assert(timestamp(result.expiresAt) > timestamp(deadline));
    const artifact = join(options.store, `${text(result.id)}.cms`);
    assert(!readFileSync(artifact).includes(original));
    const archive = join(directory, 'recovered.tar');
    execFileSync(
      'openssl',
      ['cms', '-decrypt', '-binary', '-inform', 'DER', '-in', artifact, '-inkey', key, '-out', archive],
      { stdio: 'ignore' },
    );
    const destination = join(directory, 'recovered');
    mkdirSync(destination, { mode: 0o700 });
    await unpackArchive(archive);
    await unpackArchive(archive, destination);
    assert.deepEqual(readFileSync(join(destination, 'objects/original.png')), original);
    assert.equal(readFileSync(join(destination, 'database.dump'), 'utf8'), 'purchase records fixture');
    const archived = record(jsonFile(join(destination, 'objects.json')));
    assert.equal(record(array(archived.objects)[0]).expiresAt, deadline);
    const receiptPath = join(options.store, `${text(result.id)}.json`),
      originalReceipt = readFileSync(receiptPath);
    policy.absoluteExpiresAt = new Date(now + 18 * 3600000).toISOString();
    policy.promisedCleanupAt = new Date(now + 12 * 3600000).toISOString();
    writeFileSync(manifestPath, JSON.stringify(policy));
    const promised = await backup(options);
    assert.equal(timestamp(promised.expiresAt), timestamp(policy.promisedCleanupAt));
    policy.promisedCleanupAt = null;
    writeFileSync(manifestPath, JSON.stringify(policy));
    const absolute = await backup(options);
    assert.equal(timestamp(absolute.expiresAt), timestamp(policy.absoluteExpiresAt));
    assert.deepEqual(readFileSync(receiptPath), originalReceipt);
    const unrelated = join(options.store, 'do-not-delete.cms');
    writeFileSync(unrelated, 'unowned');
    prune(options.store, timestamp(result.expiresAt) + 1000);
    assert(!existsSync(artifact));
    assert(existsSync(unrelated));
    assert.deepEqual(readFileSync(join(objects, 'original.png')), original);
  } finally {
    restoreEnv();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('restore refuses network/runtime databases and alternate TCP authority before effects', async () => {
  const restoreEnv = cleanEnvironment();
  try {
    process.env.PGHOST = 'production.example';
    process.env.PGDATABASE = 'production';
    await assert.rejects(restore(emptyRestore), /isolated recovery/);
    process.env.PGHOST = '/private/owned/socket';
    process.env.PGDATABASE = 'insignia_recovery_test';
    process.env.PGHOSTADDR = '127.0.0.1';
    await assert.rejects(restore(emptyRestore), /ambient database authority/);
  } finally {
    restoreEnv();
  }
});

test('damaged intent retains its identity but does not block independent expired partial deletion', () => {
  const directory = temporary();
  try {
    const broken = join(directory, '11111111-1111-1111-1111-111111111111.intent.json');
    writeFileSync(broken, '{');
    const id = '22222222-2222-2222-2222-222222222222';
    writeFileSync(
      join(directory, `${id}.intent.json`),
      JSON.stringify({ format: 'insignia-backup-intent-v1', id, expiresAt: '2000-01-01T00:00:00Z' }),
    );
    const artifact = join(directory, `${id}.cms`);
    writeFileSync(artifact, 'interrupted ciphertext');
    assert.throws(() => prune(directory, Date.now()), /damaged identities/);
    assert(!existsSync(artifact));
    assert(existsSync(broken));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('alternate libpq authority rejects before store or dump access', async () => {
  const restoreEnv = cleanEnvironment();
  try {
    for (const name of ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'PGOPTIONS', 'DATABASE_URL']) {
      process.env[name] = 'forbidden';
      await assert.rejects(
        backup({ store: '', objects: '', objectManifest: '', recipient: '', scratch: '', pgDump: '' }),
        /alternate source database authority/,
      );
      delete process.env[name];
    }
  } finally {
    restoreEnv();
  }
});

test('expired and erased staged originals are removed without restamping retained history', () => {
  const directory = temporary();
  try {
    mkdirSync(join(directory, 'objects'));
    for (const name of ['expired', 'erased', 'retained']) writeFileSync(join(directory, 'objects', name), 'original');
    const manifest = {
      objects: [
        { key: 'expired', sha256: '', expiresAt: '2000-01-01T00:00:00Z' },
        { key: 'erased', sha256: '', expiresAt: '2099-01-01T00:00:00Z' },
        { key: 'retained', sha256: '', expiresAt: '2099-01-01T00:00:00Z' },
      ],
    };
    assert.equal(removeStagedExclusions(directory, manifest, new Set(['erased']), Date.now()), 2);
    assert(!existsSync(join(directory, 'objects/expired')));
    assert(!existsSync(join(directory, 'objects/erased')));
    assert.equal(readFileSync(join(directory, 'objects/retained'), 'utf8'), 'original');
    assert.equal(manifest.objects[0]?.expiresAt, '2000-01-01T00:00:00Z');
    assert.equal(HOLD, 'HOLD_STORAGE_ERASURE_AND_AUTHORITY_REQUALIFICATION');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
