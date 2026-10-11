import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { executeSchemaProvision, reserveSchemaProvision } from './schema-provision.mjs';

const { Pool } = createRequire(new URL('../../apps/worker/package.json', import.meta.url))('pg');

test('frozen schema operator provisions exact migrations and restricted roles once, rejecting changed input', {
  skip: !process.env.M5_SCHEMA_TEST_URL,
  timeout: 45000,
}, async () => {
  const admin = new Pool({ connectionString: process.env.M5_SCHEMA_TEST_URL });
  const expectedDatabase = `m5schema_${randomUUID().replaceAll('-', '')}`;
  const address = new URL(process.env.M5_SCHEMA_TEST_URL);
  address.pathname = `/${expectedDatabase}`;
  const ownerConnectionString = address.href;
  const expectedOwner = address.username;
  const pool = new Pool({ connectionString: ownerConnectionString });
  const directory = await mkdtemp(join(tmpdir(), 'insignia-schema-plan-'));
  const staging = await mkdtemp(join(tmpdir(), 'insignia-schema-source-'));
  const ownedRoles = [
    'insignia_runtime',
    'insignia_release_owner',
    'insignia_release_operator',
    'insignia_queue_enqueue',
    'insignia_queue_consume',
    'insignia_worker',
    'insignia_release_append',
  ];
  let databaseCreated = false,
    rolesAllocated = false;
  let failure;
  const failures = [];
  try {
    assert.equal(
      (await admin.query('select rolname from pg_roles where rolname=any($1)', [ownedRoles])).rowCount,
      0,
      'isolated cluster roles must be unallocated',
    );
    await admin.query(`create database ${expectedDatabase}`);
    databaseCreated = true;
    await pool.query(
      "create role insignia_runtime login password 'synthetic_test_password' nosuperuser nocreatedb nocreaterole noreplication nobypassrls",
    );
    rolesAllocated = true;
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const migrations = join(root, 'packages/database/migrations');
    for (const name of (await readdir(migrations))
      .filter((x) => x.endsWith('.sql'))
      .sort()
      .slice(0, 15))
      await copyFile(join(migrations, name), join(staging, name));
    await promisify(execFile)(
      join(root, 'node_modules/.bin/dbmate'),
      ['--no-dump-schema', '--migrations-dir', staging, 'up'],
      { cwd: root, env: { ...process.env, DATABASE_URL: ownerConnectionString }, timeout: 30000 },
    );
    await pool.query('create role insignia_worker nologin');
    await assert.rejects(
      reserveSchemaProvision({ directory, ownerConnectionString, expectedDatabase, expectedOwner }),
      /unexpected_roles/,
    );
    await pool.query('drop role insignia_worker');
    const plan = await reserveSchemaProvision({ directory, ownerConnectionString, expectedDatabase, expectedOwner });
    assert.equal(plan.fromMigrationCount, 15);
    const frozen = JSON.parse(await readFile(join(directory, 'plan.json'), 'utf8'));
    await writeFile(
      join(directory, 'plan.json'),
      JSON.stringify({ ...frozen, sources: { ...frozen.sources, 'pnpm-lock.yaml': '0'.repeat(64) } }),
    );
    await assert.rejects(executeSchemaProvision(directory), /frozen_source_changed/);
    assert.equal((await pool.query('select count(*)::int as n from schema_migrations')).rows[0].n, 15);
    await writeFile(join(directory, 'plan.json'), JSON.stringify(frozen));
    const credentialsBefore = await readFile(join(directory, 'credentials.json'), 'utf8');
    await writeFile(join(directory, 'credentials.json'), `${credentialsBefore} `);
    await assert.rejects(executeSchemaProvision(directory), /frozen_credentials_changed/);
    await writeFile(join(directory, 'credentials.json'), credentialsBefore);
    const result = await executeSchemaProvision(directory);
    assert.equal(result.status, 'APPLIED');
    assert.equal(result.queue.version, 43);
    assert.equal((await pool.query('select count(*)::int as n from schema_migrations')).rows[0].n, 18);
    const secrets = JSON.parse(await readFile(join(directory, 'credentials.json'), 'utf8'));
    for (const [role, url] of [
      ['insignia_worker', secrets.workerUrl],
      ['insignia_release_append', secrets.releaseUrl],
    ]) {
      const runtime = new Pool({ connectionString: url });
      try {
        assert.equal((await runtime.query('select current_user as role')).rows[0].role, role);
        for (const sql of [
          'create table public.escape(id int)',
          'create table pgboss.escape(id int)',
          'truncate trusted_release_records',
          'delete from trusted_release_records',
        ]) {
          await assert.rejects(runtime.query(sql), { code: '42501' });
        }
      } finally {
        await runtime.end();
      }
    }
    // Synthetic schema-valid append proves the real LOGIN can insert; not a release attestation.
    await pool.query(
      "begin; insert into shops(shop_id,shop_domain,current_generation) values('synthetic-schema-shop','synthetic-schema.myshopify.com',1); insert into installation_generations(shop_id,generation) values('synthetic-schema-shop',1); commit",
    );
    const observation = new Date().toISOString();
    const build = {
      shopId: 'synthetic-schema-shop',
      installationGeneration: '1',
      appClientId: 'synthetic-app',
      appVersionRef: 'synthetic-version',
    };
    const record = {
      version: 'm5-trusted-release-v1',
      recordId: 'synthetic-record',
      activeAppVersionRef: 'synthetic-version',
      attestation: { ...build, evidenceKind: 'RELEASE_BOUND', observedAt: observation },
    };
    const append = new Pool({ connectionString: secrets.releaseUrl });
    try {
      await append.query(
        'insert into trusted_release_records(record_id,shop_id,installation_generation,app_client_id,active_app_version_ref,expected_build,trusted_record,active_version_observed_at,active_version_evidence_sha256,evidence_digest) values($1,$2,1,$3,$4,$5,$6,$7,$8,$9)',
        [
          record.recordId,
          build.shopId,
          build.appClientId,
          build.appVersionRef,
          build,
          record,
          observation,
          'a'.repeat(64),
          'b'.repeat(64),
        ],
      );
    } finally {
      await append.end();
    }
    for (const sql of [
      "update trusted_release_records set evidence_digest=repeat('c',64) where record_id='synthetic-record'",
      "delete from trusted_release_records where record_id='synthetic-record'",
      'truncate trusted_release_records',
    ])
      await assert.rejects(pool.query(sql), { code: '23514' });
    assert.deepEqual(
      (await pool.query("select trusted_record from trusted_release_records where record_id='synthetic-record'"))
        .rows[0].trusted_record,
      record,
    );
    const rights = (
      await pool.query(
        "select has_table_privilege('insignia_runtime','trusted_release_records','SELECT') as read, has_table_privilege('insignia_runtime','trusted_release_records','INSERT,UPDATE,DELETE,TRUNCATE') as write",
      )
    ).rows[0];
    assert.deepEqual(rights, { read: true, write: false });
    await assert.rejects(executeSchemaProvision(directory), /already_reserved/);
    await assert.rejects(
      reserveSchemaProvision({
        directory: join(directory, 'changed'),
        ownerConnectionString,
        expectedDatabase,
        expectedOwner,
      }),
      /unexpected_migrations/,
    );
  } catch (error) {
    failure = error;
  } finally {
    for (const close of [
      () => pool.end(),
      async () => {
        if (databaseCreated) await admin.query(`drop database ${expectedDatabase}`);
      },
      async () => {
        if (rolesAllocated) for (const role of ownedRoles.reverse()) await admin.query(`drop role if exists ${role}`);
      },
      () => admin.end(),
      () => rm(directory, { recursive: true, force: true }),
      () => rm(staging, { recursive: true, force: true }),
    ]) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failure) {
    if (failures.length)
      throw new AggregateError([failure, ...failures], 'isolated schema control and cleanup failed', {
        cause: failure,
      });
    throw failure;
  }
  if (failures.length) throw new AggregateError(failures, 'isolated schema control cleanup failed');
});

test('operator CLI never prints private endpoint or credentials on failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-private-schema-cli-'));
  try {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('./schema-provision.mjs', import.meta.url)), 'reserve'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (x) => {
      stdout += x;
    });
    child.stderr.on('data', (x) => {
      stderr += x;
    });
    const closed = new Promise((resolve, reject) => {
      child.once('close', resolve);
      child.once('error', reject);
    });
    child.stdin.end(
      JSON.stringify({
        directory,
        ownerConnectionString: 'postgres://synthetic:sensitive_synthetic_password@127.0.0.1:1/unreachable',
        expectedDatabase: 'unreachable',
        expectedOwner: 'synthetic',
      }),
    );
    assert.equal(await closed, 1);
    assert.equal(stdout, '');
    assert.equal(stderr, 'schema_operator_failed_private_receipts_required\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
