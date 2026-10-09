import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { expect, test } from 'vitest';
import { createDurableCore, sha256CanonicalJson } from '../src/index.js';

const connectionString = process.env.DATABASE_URL;
async function appendFixture(
  pool: Pool,
  core: ReturnType<typeof createDurableCore>,
  replacement?: {
    scope: { shopId: string; installationGeneration: string; appClientId: string };
    version?: string;
    digest?: string;
  },
) {
  const shopId = replacement?.scope.shopId ?? randomUUID();
  if (!replacement)
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, {
        shopId,
        shopDomain: 'm' + randomUUID().replaceAll('-', '') + '.myshopify.com',
        shopifyShopId: (BigInt('0x' + shopId.replaceAll('-', '').slice(0, 12)) + 1n).toString(),
      }),
    );
  const observedAt = new Date().toISOString();
  const build = {
    schemaVersion: 1,
    shopId,
    installationGeneration: '1',
    appClientId: replacement?.scope.appClientId ?? 'trusted-' + shopId,
    sourceCommit: 'a'.repeat(40),
    appVersionRef: replacement?.version ?? '1158986629121',
    devPreviewRef: null,
    transform: {
      functionId: 'transform-id',
      handle: 'insignia-experimental-v2-transform',
      apiType: 'cart_transform',
      apiVersion: '2026-07',
      inputQuerySha256: 'b'.repeat(64),
      wasmSha256: 'c'.repeat(64),
    },
    validation: {
      functionId: 'validation-id',
      handle: 'insignia-experimental-v2-validation',
      apiType: 'cart_checkout_validation',
      apiVersion: '2026-07',
      inputQuerySha256: 'd'.repeat(64),
      wasmSha256: 'e'.repeat(64),
    },
  };
  const record = {
    version: 'm5-trusted-release-v1',
    recordId: randomUUID(),
    activeAppVersionRef: build.appVersionRef,
    attestation: {
      ...build,
      evidenceKind: 'RELEASE_BOUND',
      observedAt,
      expiresAt: new Date(Date.parse(observedAt) + 30_000).toISOString(),
    },
  };
  const proof = 'f'.repeat(64);
  const digest = sha256CanonicalJson({
    trustedRecord: record,
    expectedBuild: build,
    activeVersionObservedAt: observedAt,
    activeVersionEvidenceSha256: proof,
  });
  await pool.query(
    'INSERT INTO trusted_release_records(record_id,shop_id,installation_generation,app_client_id,active_app_version_ref,expected_build,trusted_record,active_version_observed_at,active_version_evidence_sha256,evidence_digest) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9)',
    [
      record.recordId,
      shopId,
      build.appClientId,
      build.appVersionRef,
      build,
      record,
      observedAt,
      proof,
      replacement?.digest ?? digest,
    ],
  );
  return { scope: { shopId, installationGeneration: '1', appClientId: build.appClientId }, record, build };
}

test('operator release evidence is append-only and the runtime role has SELECT-only access', async () => {
  const pool = new Pool({ connectionString });
  const core = createDurableCore(new Pool({ connectionString }));
  const role = 'm5022_read_' + randomUUID().replaceAll('-', '');
  try {
    const { record } = await appendFixture(pool, core);
    await expect(
      pool.query('UPDATE trusted_release_records SET evidence_digest=$1 WHERE record_id=$2', [
        '0'.repeat(64),
        record.recordId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('DELETE FROM trusted_release_records WHERE record_id=$1', [record.recordId]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query('TRUNCATE trusted_release_records')).rejects.toMatchObject({ code: '23514' });
    await pool.query('CREATE ROLE ' + role + ' NOLOGIN');
    await pool.query('GRANT SELECT ON trusted_release_records TO ' + role);
    const client = await pool.connect();
    try {
      await client.query('SET ROLE ' + role);
      expect(
        (await client.query('SELECT record_id FROM trusted_release_records WHERE record_id=$1', [record.recordId]))
          .rowCount,
      ).toBe(1);
      for (const statement of [
        "INSERT INTO trusted_release_records(record_id) VALUES('forbidden')",
        'UPDATE trusted_release_records SET record_id=record_id',
        'DELETE FROM trusted_release_records',
        'TRUNCATE trusted_release_records',
      ])
        await expect(client.query(statement)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }
  } finally {
    await pool.query('DROP OWNED BY ' + role).catch(() => {});
    await pool.query('DROP ROLE ' + role).catch(() => {});
    await core.close();
    await pool.end();
  }
});

test('trusted release source loads exact active scope only through a read-only runtime credential', async () => {
  const pool = new Pool({ connectionString });
  const operatorCore = createDurableCore(new Pool({ connectionString }));
  const role = 'm5022_source_' + randomUUID().replaceAll('-', '');
  let runtime: ReturnType<typeof createDurableCore> | undefined;
  try {
    const fixture = await appendFixture(pool, operatorCore);
    await pool.query('CREATE ROLE ' + role + ' NOLOGIN');
    await pool.query('GRANT USAGE ON SCHEMA public TO ' + role);
    await pool.query('GRANT SELECT ON trusted_release_records,shops,installation_generations TO ' + role);
    runtime = createDurableCore(new Pool({ connectionString, options: '-c role=' + role }));
    const input = { scope: fixture.scope, expectedActiveAppVersionRef: '1158986629121', now: new Date() };
    expect(await runtime.trustedReleaseRecords.read(input)).toMatchObject({
      record: fixture.record,
      expectedBuild: fixture.build,
    });
    expect(await operatorCore.trustedReleaseRecords.read(input)).toBeNull();
    expect(
      await runtime.trustedReleaseRecords.read({ ...input, expectedActiveAppVersionRef: '1153019904001' }),
    ).toBeNull();
    expect(
      await runtime.trustedReleaseRecords.read({ ...input, scope: { ...fixture.scope, installationGeneration: '2' } }),
    ).toBeNull();
    expect(await runtime.trustedReleaseRecords.read({ ...input, now: new Date(Date.now() + 31_000) })).toBeNull();
    expect(
      await runtime.trustedReleaseRecords.read({
        ...input,
        now: new Date(Date.parse(fixture.record.attestation.observedAt) - 1),
      }),
    ).toBeNull();
    // Append a new invalid proof: an older valid record must never rescue it.
    await appendFixture(pool, operatorCore, { scope: fixture.scope, digest: '0'.repeat(64) });
    expect(await runtime.trustedReleaseRecords.read({ ...input, now: new Date() })).toBeNull();
    await appendFixture(pool, operatorCore, { scope: fixture.scope, version: '1153019904001' });
    expect(await runtime.trustedReleaseRecords.read({ ...input, now: new Date() })).toBeNull();
    const restored = await appendFixture(pool, operatorCore, { scope: fixture.scope });
    expect(await runtime.trustedReleaseRecords.read({ ...input, now: new Date() })).toMatchObject({
      record: restored.record,
    });
    // A latest independent app-level Active observation cannot be ignored by another shop.
    const other = await appendFixture(pool, operatorCore);
    await appendFixture(pool, operatorCore, {
      scope: { ...other.scope, appClientId: fixture.scope.appClientId },
      version: '1153019904001',
    });
    expect(await runtime.trustedReleaseRecords.read({ ...input, now: new Date() })).toBeNull();
  } finally {
    await runtime?.close();
    await operatorCore.close();
    await pool.query('DROP OWNED BY ' + role).catch(() => {});
    await pool.query('DROP ROLE ' + role).catch(() => {});
    await pool.end();
  }
});

// Exercise the actual migration runner in isolated databases: a rollback must
// preserve authority, including its migration-history entry, before teardown.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const execFileAsync = promisify(execFile);
async function migrate(url: string, direction: 'up' | 'rollback') {
  // This regression targets trusted-release rollback, even after later schema
  // migrations exist. Run its exact era without altering production history.
  const directory = await mkdtemp(join(tmpdir(), 'insignia-trusted-release-migrations-'));
  try {
    const source = root + 'packages/database/migrations';
    for (const file of await readdir(source)) {
      if (/^\d{14}.*\.sql$/.test(file) && file.slice(0, 14) <= '20261008000100')
        await copyFile(join(source, file), join(directory, file));
    }
    return await execFileAsync(
      root + 'node_modules/.bin/dbmate',
      ['--no-dump-schema', '--migrations-dir', directory, direction],
      { cwd: root, env: { ...process.env, DATABASE_URL: url }, timeout: 30_000 },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function disposableMigrationDatabase(
  check: (pool: Pool, core: ReturnType<typeof createDurableCore>, url: string) => Promise<void>,
) {
  if (!connectionString) throw new Error('Migration regression requires a disposable PostgreSQL DATABASE_URL');
  const admin = new Pool({ connectionString });
  const name = 'm5022r_' + randomUUID().replaceAll('-', '');
  const url = new URL(connectionString);
  url.pathname = '/' + name;
  let pool: Pool | undefined;
  let core: ReturnType<typeof createDurableCore> | undefined;
  try {
    await admin.query('CREATE DATABASE ' + name);
    await migrate(url.href, 'up');
    pool = new Pool({ connectionString: url.href });
    core = createDurableCore(new Pool({ connectionString: url.href }));
    await check(pool, core, url.href);
  } finally {
    await core?.close();
    await pool?.end();
    // Whole disposable-database teardown follows assertions. Never delete or
    // truncate evidence to make a down migration succeed.
    await admin.query('DROP DATABASE IF EXISTS ' + name);
    await admin.end();
  }
}

async function releaseSchema(pool: Pool) {
  return (
    await pool.query(`SELECT
      'trusted_release_records'::regclass::oid AS relation,
      'forbid_trusted_release_rewrite()'::regprocedure::oid AS guard,
      pg_get_functiondef('forbid_trusted_release_rewrite()'::regprocedure) AS guard_definition,
      (SELECT jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid)) ORDER BY tgname)
        FROM pg_trigger WHERE tgrelid='trusted_release_records'::regclass AND NOT tgisinternal) AS triggers,
      (SELECT jsonb_agg(indexdef ORDER BY indexname) FROM pg_indexes WHERE tablename='trusted_release_records' AND schemaname='public') AS indexes,
      (SELECT relacl::text FROM pg_class WHERE oid='trusted_release_records'::regclass) AS permissions,
      (SELECT jsonb_agg(version ORDER BY version) FROM schema_migrations) AS migrations,
      (SELECT jsonb_agg(to_jsonb(r)::text ORDER BY record_seq) FROM trusted_release_records r) AS records`)
  ).rows[0];
}

test('empty trusted-release migration rolls down and up through dbmate', async () => {
  await disposableMigrationDatabase(async (pool, _core, url) => {
    expect((await pool.query("SELECT to_regclass('trusted_release_records') AS relation")).rows[0].relation).toBe(
      'trusted_release_records',
    );
    await migrate(url, 'rollback');
    expect((await pool.query("SELECT to_regclass('trusted_release_records') AS relation")).rows[0].relation).toBeNull();
    expect(
      (await pool.query("SELECT to_regprocedure('forbid_trusted_release_rewrite()') AS guard")).rows[0].guard,
    ).toBeNull();
    expect((await pool.query("SELECT version FROM schema_migrations WHERE version='20261008000100'")).rowCount).toBe(0);
    await migrate(url, 'up');
    const schema = await releaseSchema(pool);
    expect(schema.triggers).toHaveLength(2);
    expect(schema.records).toBeNull();
    expect(schema.migrations).toContain('20261008000100');
  });
}, 60_000);

test('non-empty trusted-release down fails and preserves exact records, schema, history and rewrite guards', async () => {
  await disposableMigrationDatabase(async (pool, core, url) => {
    const fixture = await appendFixture(pool, core);
    const before = await releaseSchema(pool);
    await expect(migrate(url, 'rollback')).rejects.toThrow('trusted release evidence prevents schema rollback');
    expect(await releaseSchema(pool)).toEqual(before);
    expect(before.records).toHaveLength(1);
    for (const statement of [
      'UPDATE trusted_release_records SET record_id=record_id WHERE record_id=$1',
      'DELETE FROM trusted_release_records WHERE record_id=$1',
    ]) {
      await expect(pool.query(statement, [fixture.record.recordId])).rejects.toMatchObject({ code: '23514' });
    }
    await expect(pool.query('TRUNCATE trusted_release_records')).rejects.toMatchObject({ code: '23514' });
    expect(await releaseSchema(pool)).toEqual(before);
  });
}, 60_000);

test('rollback waits for an in-flight append and preserves it once committed', async () => {
  await disposableMigrationDatabase(async (pool, core, url) => {
    const writer = new Pool({ connectionString: url, max: 1 });
    let rollback: Promise<{ error: unknown }> | undefined;
    try {
      await writer.query('BEGIN');
      const fixture = await appendFixture(writer, core);
      rollback = migrate(url, 'rollback').then(
        () => ({ error: null }),
        (error: unknown) => ({ error }),
      );
      let waiting = false;
      for (let attempt = 0; attempt < 500; attempt++) {
        const lock = await pool.query(`SELECT 1 FROM pg_locks
          WHERE relation='trusted_release_records'::regclass AND mode='AccessExclusiveLock' AND NOT granted`);
        if (lock.rowCount === 1) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await writer.query('COMMIT');
      const result = await rollback;
      expect(result.error).toMatchObject({ code: 2 });
      expect(String(result.error)).toContain('trusted release evidence prevents schema rollback');
      const surviving = await pool.query('SELECT trusted_record FROM trusted_release_records WHERE record_id=$1', [
        fixture.record.recordId,
      ]);
      expect(surviving.rows[0].trusted_record).toEqual(fixture.record);
      expect((await releaseSchema(pool)).triggers).toHaveLength(2);
    } finally {
      await writer.query('ROLLBACK');
      await rollback;
      await writer.end();
    }
  });
}, 60_000);
