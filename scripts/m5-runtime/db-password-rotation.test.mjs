import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { installQueue } from '../m5-024/install-queue.mjs';
import { executeDatabasePasswordRotation, reserveDatabasePasswordRotation } from './db-password-rotation.mjs';

const { Pool } = createRequire(new URL('../../apps/worker/package.json', import.meta.url))('pg');
const groups = [
  'insignia_release_owner',
  'insignia_release_operator',
  'insignia_queue_enqueue',
  'insignia_queue_consume',
];
const owned = ['insignia_rewrite', 'insignia_runtime', 'insignia_worker', 'insignia_release_append', ...groups];
test('owner-only two-password rotation proves new SCRAM logins and old rejection without changing queue/trust grants or history', {
  skip: !process.env.M5_DB_ROTATION_TEST_URL,
  timeout: 60000,
}, async () => {
  const admin = new Pool({ connectionString: process.env.M5_DB_ROTATION_TEST_URL });
  const a = await admin.connect();
  const name = `m5rotate_${randomUUID().replaceAll('-', '')}`;
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'insignia-db-rotate-'));
  const staging = await mkdtemp(join(tmpdir(), 'insignia-rotation-migrations-'));
  const extra = [];
  let pool;
  let created = false;
  let allocated = false;
  const oldOwner = randomBytes(32).toString('hex'),
    oldRuntime = randomBytes(32).toString('hex');
  const ownerUrl = new URL(process.env.M5_DB_ROTATION_TEST_URL);
  ownerUrl.username = 'insignia_rewrite';
  ownerUrl.password = oldOwner;
  ownerUrl.pathname = `/${name}`;
  const runtimeUrl = new URL(ownerUrl);
  runtimeUrl.username = 'insignia_runtime';
  runtimeUrl.password = oldRuntime;
  try {
    assert.equal(
      (await a.query('select rolname from pg_roles where rolname=any($1)', [owned])).rowCount,
      0,
      'owned isolated roles must be absent',
    );
    await a.query(
      "set log_statement='none';set log_min_error_statement='panic';set log_parameter_max_length=0;set log_parameter_max_length_on_error=0",
    );
    await a.query(
      `create role insignia_rewrite login superuser password '${oldOwner}';create role insignia_runtime login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${oldRuntime}'`,
    );
    allocated = true;
    await a.query(`create database ${name} owner insignia_rewrite`);
    created = true;
    const names = (await readdir(join(root, 'packages/database/migrations')))
      .filter((n) => n.endsWith('.sql'))
      .sort()
      .slice(0, 18);
    assert.equal(names.at(-1), '20261009000200_m5_webhook_recovery_selection.sql');
    for (const n of names) await copyFile(join(root, 'packages/database/migrations', n), join(staging, n));
    await promisify(execFile)(
      join(root, 'node_modules/.bin/dbmate'),
      ['--no-dump-schema', '--migrations-dir', staging, 'up'],
      { env: { ...process.env, DATABASE_URL: ownerUrl.href }, timeout: 30000 },
    );
    await installQueue(ownerUrl.href);
    pool = new Pool({ connectionString: ownerUrl.href });
    await pool.query(
      await readFile(join(root, 'docs/delivery/evidence/m5-023/operators/trusted-release-roles.sql'), 'utf8'),
    );
    await pool.query(await readFile(join(root, 'scripts/m5-024/queue-roles.sql'), 'utf8'));
    await pool.query(
      'create role insignia_worker login connection limit 4;create role insignia_release_append login connection limit 2;grant insignia_queue_consume to insignia_worker;grant insignia_release_operator to insignia_release_append',
    );
    const receiptId = randomUUID();
    const receiptBody = Buffer.from('synthetic preserved receipt');
    await pool.query(
      "insert into inbox_messages(id,source,payload,payload_sha256,received_at,retention_class,purge_after) values($1,'other',$2,$3,clock_timestamp(),'shopify-webhook',clock_timestamp()+interval '1 day')",
      [receiptId, receiptBody, 'a'.repeat(64)],
    );
    const before = (
      await pool.query(
        'select (select count(*) from pgboss.job) as jobs,(select count(*) from trusted_release_records) as release,(select count(*) from inbox_messages) as inbox',
      )
    ).rows[0];
    const plan = await reserveDatabasePasswordRotation({
      directory,
      ownerConnectionString: ownerUrl.href,
      runtimeConnectionString: runtimeUrl.href,
      expectedDatabase: name,
    });
    assert.equal(plan.status, 'FROZEN');
    const planPath = join(directory, 'plan.json');
    const originalPlan = await readFile(planPath);
    const changedPlan = JSON.parse(originalPlan);
    changedPlan.sources['pnpm-lock.yaml'] = '0'.repeat(64);
    await writeFile(planPath, JSON.stringify(changedPlan));
    await assert.rejects(executeDatabasePasswordRotation(directory), /frozen_source_changed/);
    assert.ok(!(await readdir(directory)).includes('attempt.json'));
    await writeFile(planPath, originalPlan);
    const credentialPath = join(directory, 'credentials.json');
    const originalCredentials = await readFile(credentialPath);
    await writeFile(credentialPath, Buffer.concat([originalCredentials, Buffer.from(' ')]));
    await assert.rejects(executeDatabasePasswordRotation(directory), /frozen_credentials_changed/);
    assert.ok(!(await readdir(directory)).includes('attempt.json'));
    await writeFile(credentialPath, originalCredentials);
    const result = await executeDatabasePasswordRotation(directory);
    assert.equal(result.status, 'ROTATED_VERIFIED');
    const credentials = JSON.parse(await readFile(join(directory, 'credentials.json'), 'utf8'));
    assert.match(credentials.ownerPassword, /^[a-f0-9]{64}$/);
    assert.match(credentials.runtimePassword, /^[a-f0-9]{64}$/);
    for (const url of [credentials.ownerUrl, credentials.runtimeUrl]) {
      const fresh = new Pool({ connectionString: url });
      try {
        assert.equal((await fresh.query('select current_database() as db')).rows[0].db, name);
      } finally {
        await fresh.end();
      }
    }
    for (const url of [ownerUrl.href, runtimeUrl.href]) {
      const old = new Pool({ connectionString: url });
      try {
        await assert.rejects(old.query('select 1'), { code: '28P01' });
      } finally {
        await old.end();
      }
    }
    assert.deepEqual(
      (
        await pool.query(
          'select (select count(*) from pgboss.job) as jobs,(select count(*) from trusted_release_records) as release,(select count(*) from inbox_messages) as inbox',
        )
      ).rows[0],
      before,
    );
    assert.deepEqual(
      (await pool.query('select payload,payload_sha256 from inbox_messages where id=$1', [receiptId])).rows,
      [{ payload: receiptBody, payload_sha256: 'a'.repeat(64) }],
    );
    await assert.rejects(executeDatabasePasswordRotation(directory), /attempt_already_reserved/);
    const drift = await mkdtemp(join(tmpdir(), 'insignia-db-rotate-drift-'));
    extra.push(drift);
    await reserveDatabasePasswordRotation({
      directory: drift,
      ownerConnectionString: credentials.ownerUrl,
      runtimeConnectionString: credentials.runtimeUrl,
      expectedDatabase: name,
    });
    await a.query('alter role insignia_runtime connection limit 3');
    assert.deepEqual(await executeDatabasePasswordRotation(drift), {
      status: 'STOP_ROTATION_UNCERTAIN',
      phase: 'CAS',
      commitAcknowledged: false,
    });
    await assert.rejects(executeDatabasePasswordRotation(drift), /attempt_already_reserved/);
    await a.query('alter role insignia_runtime connection limit -1');
    const unavailable = await mkdtemp(join(tmpdir(), 'insignia-db-rotate-unavailable-'));
    extra.push(unavailable);
    await reserveDatabasePasswordRotation({
      directory: unavailable,
      ownerConnectionString: credentials.ownerUrl,
      runtimeConnectionString: credentials.runtimeUrl,
      expectedDatabase: name,
    });
    const externalPassword = randomBytes(32).toString('hex');
    await a.query(`alter role insignia_rewrite password '${externalPassword}'`);
    assert.deepEqual(await executeDatabasePasswordRotation(unavailable), {
      status: 'STOP_ROTATION_UNCERTAIN',
      phase: 'CONNECT',
      commitAcknowledged: false,
    });
    await assert.rejects(executeDatabasePasswordRotation(unavailable), /attempt_already_reserved/);
    await a.query(`alter role insignia_rewrite password '${credentials.ownerPassword}'`);
    if (process.env.M5_DB_ROTATION_LOG_PATH) {
      const log = await readFile(process.env.M5_DB_ROTATION_LOG_PATH, 'utf8');
      for (const secret of [
        oldOwner,
        oldRuntime,
        credentials.ownerPassword,
        credentials.runtimePassword,
        externalPassword,
      ])
        assert.equal(log.includes(secret), false, 'secret leaked into server log');
    }
  } finally {
    await pool?.end();
    if (created) await a.query(`drop database ${name}`);
    if (allocated) {
      for (const role of [...owned].reverse()) await a.query(`drop role if exists ${role}`);
    }
    a.release();
    await admin.end();
    await rm(directory, { recursive: true, force: true });
    await rm(staging, { recursive: true, force: true });
    for (const d of extra) await rm(d, { recursive: true, force: true });
  }
});
