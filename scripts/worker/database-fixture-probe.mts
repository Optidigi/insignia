function required<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined);
  return value;
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const { Pool }: typeof import('pg') = createRequire(resolve('apps/worker/package.json'))('pg');
const options = { connectionTimeoutMillis: 3000, query_timeout: 5000, statement_timeout: 4000 };
const ownerUrl = required(process.env.DATABASE_URL);
const pool = new Pool({ ...options, connectionString: ownerUrl });
let login: import('pg').Pool | undefined;
try {
  const serverVersion = required(
    (await pool.query<{ server_version_num: string }>('show server_version_num')).rows[0],
  ).server_version_num;
  assert.equal(Math.floor(Number(serverVersion) / 10000), 18);
  await pool.query(await readFile('scripts/worker/queue-roles.sql', 'utf8'));
  await pool.query(
    "create role image_worker login password 'synthetic-worker' nosuperuser nocreatedb nocreaterole noreplication nobypassrls; grant insignia_queue_consume to image_worker",
  );
  login = new Pool({
    ...options,
    connectionString: ownerUrl.replace('insignia_test:synthetic-owner', 'image_worker:synthetic-worker'),
  });
  const currentUser = required(
    (await login.query<{ current_user: string }>('select current_user')).rows[0],
  ).current_user;
  assert.equal(currentUser, 'image_worker');
  const roleFlags = (
    await login.query<{
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
    }>('select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user')
  ).rows[0];
  assert.deepEqual(roleFlags, {
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false,
  });
  const memberships = (
    await login.query<{ rolname: string }>(
      'select r.rolname from pg_auth_members m join pg_roles r on r.oid=m.roleid where m.member=(select oid from pg_roles where rolname=current_user) order by r.rolname',
    )
  ).rows.map((row) => row.rolname);
  assert.deepEqual(memberships, ['insignia_queue_consume']);
  const denied = [];
  for (const sql of [
    'create table pgboss.escape(id int)',
    'create schema escape',
    'truncate pgboss.job',
    'update pgboss.version set version=42',
  ]) {
    await assert.rejects(login.query(sql), { code: '42501' });
    denied.push({ sql, sqlstate: '42501' });
  }
  assert.equal(
    required((await login.query<{ version: number }>('select version from pgboss.version')).rows[0]).version,
    43,
  );
  console.log(JSON.stringify({ serverVersion, currentUser, roleFlags, memberships, denied, schemaVersion: 43 }));
} finally {
  // The parent bounds the entire child lifetime, including both pool.end waits.
  try {
    await login?.end();
  } finally {
    await pool.end();
  }
}
