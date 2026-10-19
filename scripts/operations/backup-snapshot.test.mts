import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertSourceEnvironment, captureSnapshot, objectReferences, parseListing } from './backup-snapshot.mts';

test('captures actual referenced original/preview bytes across paginated listing; unknown or missing keys fail closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'backup-snapshot-'));
  const until = new Date(Date.now() + 600_000).toISOString();
  const bytes = Buffer.from('original retained bytes');
  const refs = [{ key: 'originals/a', expiresAt: until, required: true }];
  try {
    const options = {
      directory,
      references: refs,
      databaseExpiresAt: until,
      absoluteExpiresAt: new Date(Date.now() + 180 * 86400_000).toISOString(),
      quiescence: { id: 'test-window', startedAt: new Date().toISOString(), until },
      list: async (token: string | null) =>
        token ? { keys: ['originals/a'], next: null } : { keys: [], next: 'second' },
      read: async () => bytes,
    };
    const manifest = await captureSnapshot(options);
    assert.equal(manifest.objects.length, 1);
    assert.deepEqual(await readFile(join(directory, 'originals/a')), bytes);
    await assert.rejects(captureSnapshot({ ...options, list: async () => ({ keys: ['unaccounted'], next: null }) }));
    await assert.rejects(captureSnapshot({ ...options, list: async () => ({ keys: [], next: null }) }));
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('lifecycle references preserve required originals and cleanup/expiry distinctions', () => {
  const row = {
    state: 'USABLE',
    original_key: 'originals/a',
    preview_key: 'previews/a.png',
    quarantine_key: 'quarantine/a',
    quarantine_cleaned_at: new Date(),
    expires_at: new Date(Date.now() + 600_000),
    manifest: null,
  };
  assert.deepEqual(
    objectReferences([row], []).map((r) => [r.key, r.required]),
    [
      ['originals/a', true],
      ['previews/a.png', true],
    ],
  );
  assert.throws(() => objectReferences([{ ...row, state: 'DELETING' }], []));
  assert.throws(() => objectReferences([{ ...row, expires_at: new Date(0) }], []));
  assert.deepEqual(
    parseListing(
      '<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>prefix%2Foriginals%2Fa</Key></Contents><NextContinuationToken>a&amp;b</NextContinuationToken></ListBucketResult>',
      'prefix/',
    ),
    { keys: ['originals/a'], next: 'a&b' },
  );
  assert.throws(() => parseListing('<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>', 'prefix/'));
});

test('incomplete upload keeps original 24-hour cleanup deadline and reusable quarantine cannot outlive upload window', () => {
  const collected = new Date(Date.now() - 3600_000);
  const row = {
    state: 'UPLOADING',
    quarantine_key: 'quarantine/a',
    original_key: 'originals/a',
    preview_key: 'previews/a.png',
    collected_at: collected,
    upload_until: new Date(Date.now() - 1),
    expires_at: new Date(Date.now() + 6 * 86400_000),
  };
  const refs = objectReferences([row], []);
  assert.ok(refs[0]);
  assert.equal(refs[0].expiresAt, new Date(+collected + 86400_000).toISOString());
  assert.equal(refs[0].required, false);
  assert.throws(() => objectReferences([{ ...row, state: 'USABLE' }], []));
  assert.throws(() => objectReferences([{ ...row, state: 'REJECTED' }], []));
  assert.throws(() => objectReferences([{ ...row, active: false }], []));
});

test('source exporter rejects alternate libpq service/host authority before credentials or provider effects', () => {
  for (const name of ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'PGOPTIONS', 'DATABASE_URL'])
    assert.throws(() => assertSourceEnvironment({ [name]: 'forbidden' }));
  assert.throws(() => assertSourceEnvironment({ PGDATABASE: 'postgresql://other/database' }));
  assert.throws(() => assertSourceEnvironment({ PGHOST: '/socket,/other' }));
  assert.doesNotThrow(() =>
    assertSourceEnvironment({ PGHOST: '/owned/socket', PGUSER: 'backup', PGDATABASE: 'insignia' }),
  );
});
