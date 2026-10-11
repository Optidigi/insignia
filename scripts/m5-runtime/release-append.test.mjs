import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { sha256CanonicalJson } from '../../packages/database/src/hash/canonical.ts';
import { appendTrustedRelease, qualifyReleaseAppendInput } from './release-append.mjs';

const baseline = JSON.parse(
  await readFile(new URL('../../deployment/m5-runtime/native-module-baseline.json', import.meta.url)),
);
const now = Date.parse('2026-10-11T12:00:00.000Z');
const at = (age = 0) => new Date(now - age).toISOString();
const ids = ['1162611916801', '1158986629121', '1158837927937', '1153019904001', '1152880803841', '1146748534785'];
function fixture() {
  return {
    recordId: '00000000-0000-4000-8000-000000000001',
    operator: { user: 'insignia_release_append', password: 'a'.repeat(64) },
    activeObservation: {
      observedAt: at(1000),
      versions: ids.map((id, i) => ({
        versionId: `gid://shopify/Version/${id}`,
        status: i ? 'inactive' : 'active',
        versionTag: i ? 'historical' : 'm5-runtime-b673985e1e38',
      })),
    },
    moduleObservation: {
      appId: '429028933633',
      appClientId: '1443cf6d03d39edae7c101a943c5c684',
      versionId: '1162611916801',
      versionTag: 'm5-runtime-b673985e1e38',
      observedAt: at(86400000),
      modules: structuredClone(baseline),
    },
    readiness: {
      version: 'm5-admin-technical-readiness-v1',
      shop: 'insignia-rewrite-dev.myshopify.com',
      tenantShopId: 'managed-shop',
      installationGeneration: '3',
      externalInstallationId: 'gid://shopify/AppInstallation/123',
      shopId: 'gid://shopify/Shop/123',
      functions: {
        observation: {
          shopId: 'managed-shop',
          installationGeneration: '3',
          appClientId: '1443cf6d03d39edae7c101a943c5c684',
          observedAt: at(3000),
          transform: {
            functionId: 'admin-transform-object',
            handle: 'insignia-experimental-v2-transform',
            apiType: 'cart_transform',
            apiVersion: '2026-07',
            inputQuerySha256: '8d93a08697dd56e4aa3f857c3509e4d828a5f4195cb2e8cd878749c3e5729053',
          },
          validation: {
            functionId: 'admin-validation-object',
            handle: 'insignia-experimental-v2-validation',
            apiType: 'cart_checkout_validation',
            apiVersion: '2026-07',
            inputQuerySha256: 'a0cd5d7262514c134efc8e9ce964b25b877ce56fc10d0cba6bdd1af82f2dc8c5',
          },
        },
      },
    },
  };
}
test('real approved module baseline qualifies; original evidence is unchanged and expiry is minimum', () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const result = qualifyReleaseAppendInput(input, now);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.expected.appVersionRef, ids[0]);
  assert.equal(result.expected.sourceCommit, '9b94149272d1b62c34f44dda3bde209e80b4ae22');
  assert.equal(result.observations.expiresAt, at(-27000));
  assert.equal(result.record.attestation.expiresAt, result.observations.expiresAt);
});
const invalid = {
  'missing candidate': (x) => x.activeObservation.versions.shift(),
  'six rows with wrong version': (x) => (x.activeObservation.versions[0].versionId = 'gid://shopify/Version/999'),
  'six rows duplicate identity': (x) =>
    (x.activeObservation.versions[5] = structuredClone(x.activeObservation.versions[4])),
  'wrong active version': (x) => {
    x.activeObservation.versions[0].status = 'inactive';
    x.activeObservation.versions[1].status = 'active';
  },
  'wrong active tag': (x) => (x.activeObservation.versions[0].versionTag = 'wrong'),
  'missing module observation': (x) => delete x.moduleObservation,
  'wrong module app': (x) => (x.moduleObservation.appId = '1'),
  'wrong module client': (x) => (x.moduleObservation.appClientId = '0'.repeat(32)),
  'wrong module version': (x) => (x.moduleObservation.versionId = ids[1]),
  'wrong module tag': (x) => (x.moduleObservation.versionTag = 'wrong'),
  'missing sixth module': (x) => x.moduleObservation.modules.pop(),
  'six modules duplicate': (x) => (x.moduleObservation.modules[5] = structuredClone(x.moduleObservation.modules[0])),
  'six modules changed UID': (x) => (x.moduleObservation.modules[3].registrationUuid = 'different'),
  'six modules changed Function identity': (x) => (x.moduleObservation.modules[3].config.module_id = 'different'),
  'six modules changed scopes': (x) => x.moduleObservation.modules[0].config.optional_scopes.pop(),
  'six modules changed destination': (x) => (x.moduleObservation.modules[1].config.app_url = 'https://other.example'),
  'unexpected module hash cannot confer authority': (x) =>
    (x.moduleObservation.canonicalSortedModulesSha256 = 'a'.repeat(64)),
  'wrong Function query': (x) => (x.readiness.functions.observation.transform.inputQuerySha256 = 'a'.repeat(64)),
  'missing Function identity': (x) => (x.readiness.functions.observation.transform.functionId = ''),
  'same Function identities': (x) =>
    (x.readiness.functions.observation.validation.functionId = x.readiness.functions.observation.transform.functionId),
  'wrong Function generation': (x) => (x.readiness.functions.observation.installationGeneration = '4'),
  'wrong operator': (x) => (x.operator.user = 'insignia_release_operator'),
  'nonhex password': (x) => (x.operator.password = 'G'.repeat(64)),
};
for (const [name, mutate] of Object.entries(invalid))
  test(name, () => {
    const input = fixture();
    mutate(input);
    assert.throws(() => qualifyReleaseAppendInput(input, now));
  });
for (const observation of ['active', 'function'])
  for (const time of [undefined, 'bad', at(-1), at(30000)])
    test(`${observation} rejects ${time}`, () => {
      const input = fixture();
      const target =
        observation === 'function' ? input.readiness.functions.observation : input[`${observation}Observation`];
      target.observedAt = time;
      assert.throws(() => qualifyReleaseAppendInput(input, now));
    });
for (const time of [undefined, 'bad', at(-1)])
  test(`module provenance rejects ${time}`, () => {
    const input = fixture();
    input.moduleObservation.observedAt = time;
    assert.throws(() => qualifyReleaseAppendInput(input, now));
  });
test('timestamp equality permits now; hash includes each independent timestamp', () => {
  const input = fixture();
  const before = qualifyReleaseAppendInput(input, now);
  for (const target of [input.activeObservation, input.moduleObservation, input.readiness.functions.observation])
    target.observedAt = at();
  const after = qualifyReleaseAppendInput(input, now);
  assert.equal(after.observations.expiresAt, at(-30000));
  assert.notEqual(after.observations.proof, before.observations.proof);
});
test('invalid input stops before any runtime or operator construction, with zero external requests', async () => {
  const input = fixture();
  input.moduleObservation.modules[3].registrationUuid = 'wrong';
  let calls = 0;
  const result = await appendTrustedRelease(input, {
    now: () => now,
    createDurableCore() {
      calls++;
      throw Error();
    },
    Pool: class {
      constructor() {
        calls++;
        throw Error();
      }
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.classification, 'TRUSTED_RELEASE_APPEND_STOPPED');
  assert.equal(result.providerRequests, 0);
  assert.equal(result.retryAuthorized, false);
  assert.equal(JSON.stringify(result).includes(input.operator.password), false);
});
function databaseBoundary(input, faults = {}) {
  const q = qualifyReleaseAppendInput(input, now);
  const state = {
    active: true,
    shopId: 'managed-shop',
    currentGeneration: faults.generation ?? '3',
    externalInstallationId: 'gid://shopify/AppInstallation/123',
    shopifyShopId: '123',
  };
  const operations = [];
  const client = {
    async query(sql) {
      operations.push(sql.startsWith('INSERT') ? 'INSERT' : sql);
      if (sql.includes('AS qualified')) return { rows: [{ qualified: faults.role !== false }] };
      if (sql.startsWith('INSERT')) {
        if (faults.insert) throw Error('private database error');
        return { rowCount: 1 };
      }
      if (sql.includes('AS authority_current')) return { rows: [{ authority_current: faults.authority !== false }] };
      if (sql === 'COMMIT' && faults.commit) throw Error('acknowledgement lost');
      if (sql === 'ROLLBACK' && faults.rollback) throw Error('rollback lost');
      return { rows: [] };
    },
    release() {
      if (faults.cleanup) throw Error('cleanup failed');
    },
  };
  const dependencies = {
    now: () => now,
    databaseUrl: 'postgresql://runtime:synthetic@invalid.invalid/test',
    sha256CanonicalJson,
    Pool: class {
      async connect() {
        return client;
      }
      async end() {}
    },
    createDurableCore() {
      return {
        tenants: {
          async getManagedInstallationState() {
            return state;
          },
        },
        trustedReleaseRecords: {
          async read() {
            return faults.readback ? null : { record: q.record, evidenceDigest: q.digest };
          },
        },
        async close() {},
      };
    },
  };
  return { dependencies, operations };
}
test('cleanup failure cannot replace an acknowledged append with a false no-write receipt', async () => {
  const input = fixture();
  const db = databaseBoundary(input, { cleanup: true });
  const result = await appendTrustedRelease(input, db.dependencies);
  assert.equal(result.classification, 'TRUSTED_RELEASE_APPEND_ACK_RUNTIME_QUALIFIED');
  assert.equal(result.writeAcknowledged, true);
});
test('runtime readback must qualify the exact reserved record and canonical digest', async () => {
  const input = fixture();
  const db = databaseBoundary(input);
  const result = await appendTrustedRelease(input, db.dependencies);
  assert.equal(result.classification, 'TRUSTED_RELEASE_APPEND_ACK_RUNTIME_QUALIFIED');
  assert.equal(result.trustedRecord.recordId, input.recordId);
  assert.equal(result.expectedBuild.transform.functionId, input.readiness.functions.observation.transform.functionId);
  assert.equal(result.providerRequests, 0);
});
for (const faults of [{ generation: '4' }, { role: false }])
  test(`unqualified DB binding stops without append: ${JSON.stringify(faults)}`, async () => {
    const input = fixture();
    const db = databaseBoundary(input, faults);
    const result = await appendTrustedRelease(input, db.dependencies);
    assert.equal(result.classification, 'TRUSTED_RELEASE_APPEND_STOPPED');
    assert.equal(result.writeAttempted, false);
    assert.equal(db.operations.includes('INSERT'), false);
  });
test('post-INSERT database expiry rolls back and settles no append', async () => {
  const input = fixture();
  const db = databaseBoundary(input, { authority: false });
  const result = await appendTrustedRelease(input, db.dependencies);
  assert.equal(result.writeAttempted, true);
  assert.equal(result.commitAttempted, false);
  assert.equal(result.rollbackAcknowledged, true);
  assert.equal(result.writeSettledNoAppend, true);
  assert.equal(result.ambiguousWrite, false);
  assert.equal(result.retryAuthorized, false);
});
for (const faults of [{ commit: true }, { insert: true, rollback: true }])
  test(`lost database acknowledgement remains ambiguous, never retryable: ${JSON.stringify(faults)}`, async () => {
    const input = fixture();
    const db = databaseBoundary(input, faults);
    const result = await appendTrustedRelease(input, db.dependencies);
    assert.equal(result.classification, 'TRUSTED_RELEASE_APPEND_STOPPED');
    assert.equal(result.writeAcknowledged, false);
    assert.equal(result.ambiguousWrite, true);
    assert.equal(result.retryAuthorized, false);
    assert.equal(result.writeSettledNoAppend, false);
  });
test('unqualified readback preserves acknowledged COMMIT and forbids retry', async () => {
  const input = fixture();
  const db = databaseBoundary(input, { readback: true });
  const result = await appendTrustedRelease(input, db.dependencies);
  assert.equal(result.classification, 'TRUSTED_RELEASE_APPEND_STOPPED');
  assert.equal(result.writeAcknowledged, true);
  assert.equal(result.commitAttempted, true);
  assert.equal(result.ambiguousWrite, false);
  assert.equal(result.retryAuthorized, false);
});
test('executable rejects malformed private envelope before runtime loading with closed, secret-free output', () => {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./release-append.mjs', import.meta.url))], {
    input: JSON.stringify({ operator: { password: 'SYNTHETIC_PRIVATE_CONTROL' } }),
    env: {},
    timeout: 5000,
    maxBuffer: 4096,
  });
  assert.equal(child.status, 1);
  assert.equal(child.stderr.toString(), '');
  const result = JSON.parse(child.stdout.toString());
  assert.equal(result.classification, 'TRUSTED_RELEASE_APPEND_STOPPED');
  assert.equal(result.writeAttempted, false);
  assert.equal(result.ambiguousWrite, false);
  assert.equal(result.providerRequests, 0);
  assert.equal(result.retryAuthorized, false);
  assert.equal(child.stdout.toString().includes('SYNTHETIC_PRIVATE_CONTROL'), false);
});

test('isolated PG18: fresh append LOGIN commits, runtime reader qualifies, mutation and generation escapes fail', {
  skip: !process.env.M5_SCHEMA_TEST_URL,
  timeout: 90000,
}, async () => {
  // This cluster must be dedicated to controls and serialized with schema tests.
  // All installation/version/Function observations below are SYNTHETIC, never
  // native evidence or authorization to act on the similarly named real shop.
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
  const { Pool } = require('pg');
  const { createDurableCore, sha256CanonicalJson: actualHash } = await import(
    pathToFileURL(require.resolve('@insignia/database'))
  );
  const { reserveSchemaProvision, executeSchemaProvision } = await import('./schema-provision.mjs');
  const address = new URL(process.env.M5_SCHEMA_TEST_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(address.hostname), 'isolated loopback PG only');
  const expectedDatabase = `m5append_${randomUUID().replaceAll('-', '')}`;
  const expectedOwner = address.username;
  const admin = new Pool({ connectionString: address.href });
  address.pathname = `/${expectedDatabase}`;
  const ownerConnectionString = address.href;
  const owner = new Pool({ connectionString: ownerConnectionString });
  const directory = await mkdtemp(join(tmpdir(), 'insignia-append-plan-'));
  const staging = await mkdtemp(join(tmpdir(), 'insignia-append-migrations-'));
  const roles = [
    'insignia_runtime',
    'insignia_release_owner',
    'insignia_release_operator',
    'insignia_queue_enqueue',
    'insignia_queue_consume',
    'insignia_worker',
    'insignia_release_append',
  ];
  let databaseCreated = false,
    rolesAllocated = false,
    ownerCore,
    failure;
  const cleanupFailures = [];
  try {
    assert.equal(
      (await admin.query("select current_setting('server_version_num')::int/10000 as major")).rows[0].major,
      18,
    );
    assert.equal(
      (await admin.query('select rolname from pg_roles where rolname=any($1)', [roles])).rowCount,
      0,
      'cluster roles must be unallocated; never reuse another test/runtime roles',
    );
    await admin.query(`create database ${expectedDatabase}`);
    databaseCreated = true;
    const runtimePassword = randomBytes(32).toString('hex');
    await writeFile(join(directory, 'runtime-credential.json'), JSON.stringify({ runtimePassword }), {
      flag: 'wx',
      mode: 0o600,
    });
    await owner.query('begin');
    await owner.query(
      "set local log_statement='none'; set local log_min_duration_statement=-1; set local log_min_duration_sample=-1; set local log_statement_sample_rate=0; set local log_min_error_statement='panic'; set local log_parameter_max_length=0; set local log_parameter_max_length_on_error=0",
    );
    await owner.query(
      `create role insignia_runtime login password '${runtimePassword}' nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
    );
    rolesAllocated = true;
    await owner.query('commit');
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
    // reserveSchemaProvision requires an empty private directory. Keep the
    // runtime credential beside, not inside, its exclusively allocated plan.
    const planDirectory = join(directory, 'schema');
    await reserveSchemaProvision({ directory: planDirectory, ownerConnectionString, expectedDatabase, expectedOwner });
    assert.equal((await executeSchemaProvision(planDirectory)).status, 'APPLIED');
    // Existing m5-023 genuine runtime-reader control grants these two reads.
    // The production runtime has application grants already; our new isolated
    // role starts empty. No owner/append membership or tenant write is granted.
    await owner.query('grant select on shops,installation_generations to insignia_runtime');
    assert.deepEqual(
      (
        await owner.query(`select
      has_table_privilege('insignia_runtime','shops','SELECT') and has_table_privilege('insignia_runtime','installation_generations','SELECT') as tenant_read,
      has_table_privilege('insignia_runtime','trusted_release_records','SELECT') as release_read,
      has_table_privilege('insignia_runtime','trusted_release_records','INSERT,UPDATE,DELETE,TRUNCATE') as release_write`)
      ).rows[0],
      { tenant_read: true, release_read: true, release_write: false },
    );
    const secrets = JSON.parse(await readFile(join(planDirectory, 'credentials.json'), 'utf8'));
    const runtimeAddress = new URL(ownerConnectionString);
    runtimeAddress.username = 'insignia_runtime';
    runtimeAddress.password = runtimePassword;
    ownerCore = createDurableCore(new Pool({ connectionString: ownerConnectionString }));
    const shop = await ownerCore.transactions.run((tx) =>
      ownerCore.tenants.createShop(tx, {
        shopId: randomUUID(),
        shopDomain: 'insignia-rewrite-dev.myshopify.com',
        shopifyShopId: '987654321',
        externalInstallationId: 'gid://shopify/AppInstallation/987654321',
      }),
    );
    function freshInput(generation = '1') {
      const input = fixture();
      const observedAt = new Date().toISOString();
      input.recordId = randomUUID();
      input.operator.password = secrets.releasePassword;
      input.activeObservation.observedAt = observedAt;
      input.moduleObservation.observedAt = observedAt;
      Object.assign(input.readiness, {
        tenantShopId: shop.shopId,
        installationGeneration: generation,
        shopId: 'gid://shopify/Shop/987654321',
        externalInstallationId: 'gid://shopify/AppInstallation/987654321',
      });
      Object.assign(input.readiness.functions.observation, {
        shopId: shop.shopId,
        installationGeneration: generation,
        observedAt,
      });
      return input;
    }
    const dependencies = { Pool, createDurableCore, sha256CanonicalJson: actualHash, databaseUrl: runtimeAddress.href };
    const input = freshInput();
    const result = await appendTrustedRelease(input, dependencies);
    assert.equal(
      result.classification,
      'TRUSTED_RELEASE_APPEND_ACK_RUNTIME_QUALIFIED',
      'actual restricted runtime must qualify its own append',
    );
    assert.equal(result.trustedRecord.recordId, input.recordId);
    assert.equal(result.evidenceDigest, actualHash(qualifyReleaseAppendInput(input, Date.now()).digestInput));
    const append = new Pool({ connectionString: secrets.releaseUrl });
    try {
      assert.equal((await append.query('select current_user as role')).rows[0].role, 'insignia_release_append');
      for (const sql of [
        'update trusted_release_records set record_id=record_id',
        'delete from trusted_release_records',
        'truncate trusted_release_records',
      ])
        await assert.rejects(append.query(sql), { code: '42501' });
    } finally {
      await append.end();
    }
    const wrong = await appendTrustedRelease(freshInput('2'), dependencies);
    assert.equal(wrong.classification, 'TRUSTED_RELEASE_APPEND_STOPPED');
    assert.equal(wrong.writeAttempted, false);
    assert.equal(
      await ownerCore.transactions.run((tx) =>
        ownerCore.tenants.startInstallation(tx, shop.shopId, 'gid://shopify/AppInstallation/987654322'),
      ),
      '2',
    );
    const stale = await appendTrustedRelease(freshInput('1'), dependencies);
    assert.equal(stale.classification, 'TRUSTED_RELEASE_APPEND_STOPPED');
    assert.equal(stale.writeAttempted, false);
    assert.equal((await owner.query('select count(*)::int as n from trusted_release_records')).rows[0].n, 1);
  } catch (error) {
    failure = error;
  } finally {
    for (const close of [
      async () => {
        await ownerCore?.close();
      },
      () => owner.end(),
      async () => {
        if (databaseCreated) await admin.query(`drop database ${expectedDatabase}`);
      },
      async () => {
        if (rolesAllocated) for (const role of [...roles].reverse()) await admin.query(`drop role if exists ${role}`);
      },
      () => admin.end(),
      () => rm(directory, { recursive: true, force: true }),
      () => rm(staging, { recursive: true, force: true }),
    ]) {
      try {
        await close();
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
  }
  if (failure) {
    if (cleanupFailures.length)
      throw new AggregateError([failure, ...cleanupFailures], 'isolated append control and cleanup failed', {
        cause: failure,
      });
    throw failure;
  }
  if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'isolated append control cleanup failed');
});
