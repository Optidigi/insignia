import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { Client } = createRequire('/home/serveradmin/insignia-m5-023-worktree/packages/database/package.json')('pg');
import { qualifyRuntimeDatabase } from '/home/serveradmin/insignia-m5-023-worktree/docs/delivery/evidence/m5-023/operators/runtime-database.mjs';
const database = 'insignia_m5_023';
const admin = new Client({ connectionString: `postgres://serveradmin@127.0.0.1:55424/${database}?sslmode=disable` });
await admin.connect();
const descriptor = { entry: '/home/serveradmin/insignia-m5-023-worktree/packages/database/package.json',
  serverAddresses: ['127.0.0.1'], database };
process.env.DATABASE_URL = `postgres://insignia_runtime@127.0.0.1:55424/${database}?sslmode=disable`;
try {
  await admin.query('CREATE SCHEMA IF NOT EXISTS m5023_schema_probe; GRANT USAGE ON SCHEMA m5023_schema_probe TO insignia_runtime');
  delete process.env.PGOPTIONS;
  assert.deepEqual(await qualifyRuntimeDatabase(descriptor), { qualified: true });
  process.env.PGOPTIONS = '-c search_path=m5023_schema_probe,public';
  assert.deepEqual(await qualifyRuntimeDatabase(descriptor), { qualified: false });
  delete process.env.PGOPTIONS;
  await admin.query('ALTER ROLE insignia_runtime IN DATABASE insignia_m5_023 SET search_path=m5023_schema_probe,public');
  assert.deepEqual(await qualifyRuntimeDatabase(descriptor), { qualified: false });
  await admin.query('ALTER ROLE insignia_runtime IN DATABASE insignia_m5_023 RESET search_path');
  assert.deepEqual(await qualifyRuntimeDatabase(descriptor), { qualified: true });
  assert.deepEqual(await qualifyRuntimeDatabase({ ...descriptor, serverAddresses: ['127.0.0.2'] }), { qualified: false });
  process.env.DATABASE_URL = `postgres://serveradmin@127.0.0.1:55424/${database}?sslmode=disable`;
  assert.deepEqual(await qualifyRuntimeDatabase(descriptor), { qualified: false });
  console.log('PASS actual local PG18 session: exact public runtime baseline/reset, PGOPTIONS and role-default alternate schema denied, wrong role/server denied. Provider requests=0; production connections/writes=0. Local schema/role test setup only; no production-name claim.');
} finally {
  await admin.query('ALTER ROLE insignia_runtime IN DATABASE insignia_m5_023 RESET search_path');
  await admin.end();
}
