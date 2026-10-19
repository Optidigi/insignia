/** Opt-in real local-cluster regression; no ambient endpoint is contacted. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('default isolated database loop discards auxiliary endpoint and opt-in selectors', {
  skip: !process.env.INSIGNIA_PG_BIN
    ? 'Set INSIGNIA_PG_BIN to installed PostgreSQL18 tools for actual fixture qualification'
    : false,
  timeout: 120000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-isolation-control-'));
  let connections = 0;
  // This is the existing role test's admitted synthetic address, owned solely
  // as a sentinel here. Even a rejected connection is an isolation regression.
  const sentinel = createServer((socket) => {
    connections++;
    socket.destroy();
  });
  await new Promise<void>((accept, reject) => {
    sentinel.once('error', reject);
    sentinel.listen(58199, '127.0.0.1', accept);
  });
  try {
    const status = await new Promise<number | null>((accept, reject) => {
      const child = spawn(process.execPath, ['scripts/database/isolated.mts'], {
        env: {
          ...process.env,
          TMPDIR: directory,
          DATABASE_URL: 'postgresql://invalid.invalid/not-authorized',
          PGHOST: 'invalid.invalid',
          PGSERVICE: 'not-authorized',
          WEB_RUNTIME_GRANTS_TEST_URL: 'postgresql://synthetic_m8_owner@127.0.0.1:58199/postgres',
          PRIVACY_RESTORE_TEST_URL: 'postgresql://invalid.invalid/not-authorized',
          M5_SCHEMA_TEST_URL: 'postgresql://invalid.invalid/not-authorized',
          M6_RUNTIME_GRANTS: '1',
          M6_INSPECTION_INTEGRATION: '1',
          CREDENTIAL_RECONNECT_TEST: '1',
          M4_PERSISTED_VECTOR_OUTPUT: join(directory, 'must-not-write-vector.json'),
          M5_RECOVERY_EXAMPLE_PATH: join(directory, 'must-not-write-recovery.json'),
        },
        stdio: 'ignore',
        timeout: 100000,
        killSignal: 'SIGTERM',
      });
      child.once('error', reject);
      child.once('exit', accept);
    });
    assert.equal(connections, 0, 'Auxiliary target must receive no connection');
    assert.equal(status, 0, 'Actual default migration/regression loop must pass with poisoned selectors');
    assert.deepEqual(
      (await readdir(directory)).filter(
        (name) => name.startsWith('insignia-isolated-pg-') || name.startsWith('must-not-write-'),
      ),
      [],
      'Owned cluster must be removed and poisoned output paths unused',
    );
  } finally {
    await new Promise<void>((accept) => sentinel.close(() => accept()));
    await rm(directory, { recursive: true, force: true });
  }
});
