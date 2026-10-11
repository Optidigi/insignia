/** Private operator stdin only, in the reviewed runtime image. Host must durably
 * reserve recordId + input digest before invocation. This is not a web endpoint:
 * caller JSON does not authenticate native receipts. No provider calls or retry.
 * Historical m5-023 operator stays immutable. Module hash binds the independently
 * audited, complete six-module SDK projection; it proves no external coverage. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = '1443cf6d03d39edae7c101a943c5c684';
const VERSION = '1162611916801';
const TAG = 'm5-runtime-b673985e1e38';
const MODULE_HASH = '3e2e3a127cdca7febc95995e40da57617b39c98130776740408b3fb32cacab64';
const VERSION_IDS = [VERSION, '1158986629121', '1158837927937', '1153019904001', '1152880803841', '1146748534785'];
const artifacts = {
  transform: {
    handle: 'insignia-experimental-v2-transform',
    apiType: 'cart_transform',
    apiVersion: '2026-07',
    inputQuerySha256: '8d93a08697dd56e4aa3f857c3509e4d828a5f4195cb2e8cd878749c3e5729053',
    wasmSha256: '49248769ae4ce578af7c5e7fa77f8c230c8fd4f45b2d673c22cfed87ff946576',
  },
  validation: {
    handle: 'insignia-experimental-v2-validation',
    apiType: 'cart_checkout_validation',
    apiVersion: '2026-07',
    inputQuerySha256: 'a0cd5d7262514c134efc8e9ce964b25b877ce56fc10d0cba6bdd1af82f2dc8c5',
    wasmSha256: '3193f60bbb29cdc473ce7ae73e88d1064ca7be2f03da2aade4e17ae1390366c6',
  },
};
function keys(value, expected) {
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Same JSON semantics as packages/database/src/hash/canonical.ts; runtime checks
// the final digest against that package's implementation before any append.
function canonical(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value));
    return JSON.stringify(value);
  }
  assert.ok(value && typeof value === 'object' && !ancestors.has(value));
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items = [];
      for (let i = 0; i < value.length; i++) {
        assert.ok(Object.hasOwn(value, i));
        items.push(canonical(value[i], ancestors));
      }
      return `[${items.join(',')}]`;
    }
    assert.ok(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
    const names = Object.keys(value).sort();
    assert.equal(Reflect.ownKeys(value).length, names.length);
    return `{${names.map((k) => `${JSON.stringify(k)}:${canonical(value[k], ancestors)}`).join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}
const canonicalHash = (value) => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
function time(value, now, fresh = true) {
  assert.equal(typeof value, 'string');
  const ms = Date.parse(value);
  assert.ok(Number.isFinite(ms) && ms <= now && (!fresh || now - ms < 30_000));
  return ms;
}

/** Pure, zero IO. Independent original Active/Function times determine expiry;
 * immutable module provenance is included in proof without restamping/expiring.
 * Operator-owned native receipts must be supplied through the private host path. */
export function qualifyReleaseAppendInput(input, now) {
  assert.ok(Number.isFinite(now));
  keys(input, ['recordId', 'operator', 'activeObservation', 'moduleObservation', 'readiness']);
  assert.match(input.recordId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  keys(input.operator, ['user', 'password']);
  assert.equal(input.operator.user, 'insignia_release_append');
  assert.match(input.operator.password, /^[0-9a-f]{64}$/);
  const active = input.activeObservation;
  keys(active, ['observedAt', 'versions']);
  const observedMs = time(active.observedAt, now);
  assert.equal(active.versions.length, 6);
  assert.deepEqual(
    new Set(active.versions.map((v) => v.versionId)),
    new Set(VERSION_IDS.map((v) => `gid://shopify/Version/${v}`)),
  );
  for (const v of active.versions) {
    keys(v, ['versionId', 'versionTag', 'status']);
    assert.equal(v.status, v.versionId === `gid://shopify/Version/${VERSION}` ? 'active' : 'inactive');
    assert.equal(typeof v.versionTag, 'string');
  }
  assert.equal(active.versions.find((v) => v.status === 'active').versionTag, TAG);
  const modules = input.moduleObservation;
  keys(modules, ['appId', 'appClientId', 'versionId', 'versionTag', 'observedAt', 'modules']);
  assert.equal(modules.appId, '429028933633');
  assert.equal(modules.appClientId, APP);
  assert.equal(modules.versionId, VERSION);
  assert.equal(modules.versionTag, TAG);
  time(modules.observedAt, now, false);
  assert.ok(Array.isArray(modules.modules) && modules.modules.length === 6);
  const handles = modules.modules.map((m) => {
    assert.equal(typeof m.handle, 'string');
    return m.handle;
  });
  assert.equal(new Set(handles).size, 6);
  const sorted = [...modules.modules].sort((a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0));
  assert.equal(canonicalHash(sorted), MODULE_HASH);
  const readiness = input.readiness;
  assert.equal(readiness.version, 'm5-admin-technical-readiness-v1');
  assert.equal(readiness.shop, 'insignia-rewrite-dev.myshopify.com');
  assert.match(readiness.tenantShopId, /^[A-Za-z0-9_-]{1,128}$/);
  assert.match(readiness.installationGeneration, /^[1-9][0-9]*$/);
  assert.match(readiness.shopId, /^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/);
  assert.equal(typeof readiness.externalInstallationId, 'string');
  assert.ok(readiness.externalInstallationId.length > 0);
  const functions = readiness.functions.observation;
  keys(functions, ['shopId', 'installationGeneration', 'appClientId', 'observedAt', 'transform', 'validation']);
  assert.equal(functions.shopId, readiness.tenantShopId);
  assert.equal(functions.installationGeneration, readiness.installationGeneration);
  assert.equal(functions.appClientId, APP);
  const functionObservedMs = time(functions.observedAt, now);
  const scope = {
    shopId: readiness.tenantShopId,
    installationGeneration: readiness.installationGeneration,
    appClientId: APP,
  };
  const expected = {
    schemaVersion: 1,
    ...scope,
    appVersionRef: VERSION,
    devPreviewRef: null,
    // Preserved Function artifacts: this is their source, not the config runtime commit.
    sourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  };
  for (const kind of ['transform', 'validation']) {
    const f = functions[kind];
    keys(f, ['functionId', 'handle', 'apiType', 'apiVersion', 'inputQuerySha256']);
    assert.equal(typeof f.functionId, 'string');
    assert.ok(f.functionId.length > 0 && f.functionId.length <= 256);
    // CLI registration IDs are not Admin Function identity authority.
    assert.ok(!['c56038d4-146a-405e-b47d-a055249eeeb3', '552059da-2dc1-47f8-8fc0-14a5ccb6f665'].includes(f.functionId));
    for (const k of ['handle', 'apiType', 'apiVersion', 'inputQuerySha256']) assert.equal(f[k], artifacts[kind][k]);
    expected[kind] = { ...artifacts[kind], functionId: f.functionId };
  }
  assert.notEqual(functions.transform.functionId, functions.validation.functionId);
  const observations = {
    observedAt: active.observedAt,
    observedMs,
    functionObservedAt: functions.observedAt,
    functionObservedMs,
    expiresAt: new Date(Math.min(observedMs, functionObservedMs) + 30_000).toISOString(),
    activeObservationEvidenceSha256: hash(active),
    functionObservationEvidenceSha256: hash(functions),
    moduleObservationEvidenceSha256: hash(modules),
    proof: hash({
      version: 'm5-runtime-release-observations-v1',
      activeObservation: active,
      functionObservation: functions,
      moduleObservation: modules,
    }),
  };
  const record = {
    version: 'm5-trusted-release-v1',
    recordId: input.recordId,
    activeAppVersionRef: VERSION,
    attestation: {
      ...expected,
      evidenceKind: 'RELEASE_BOUND',
      observedAt: active.observedAt,
      expiresAt: observations.expiresAt,
    },
  };
  const digestInput = {
    trustedRecord: record,
    expectedBuild: expected,
    activeVersionObservedAt: active.observedAt,
    activeVersionEvidenceSha256: observations.proof,
  };
  return { scope, expected, record, observations, digestInput, digest: canonicalHash(digestInput) };
}

/** Database boundary; injected IO exists for local settlement controls only.
 * Executable below supplies fixed official runtime dependencies, never caller IO. */
export async function appendTrustedRelease(
  input,
  { Pool, createDurableCore, sha256CanonicalJson, databaseUrl, now = Date.now },
) {
  let recordId = null,
    writeAttempted = false,
    writeAcknowledged = false;
  let runtime,
    operator,
    client,
    transactionOpened = false,
    commitAttempted = false,
    rollbackAcknowledged = false;
  try {
    const q = qualifyReleaseAppendInput(input, now());
    recordId = input.recordId;
    const { scope, expected, record, observations, digest } = q;
    assert.equal(sha256CanonicalJson(q.digestInput), digest);
    const deadline = Date.parse(observations.expiresAt);
    function remainingAuthority() {
      const value = now();
      assert.ok(value >= observations.observedMs && value >= observations.functionObservedMs && value < deadline);
      return deadline - value;
    }
    remainingAuthority();
    runtime = createDurableCore(new Pool({ connectionString: databaseUrl }));
    const state = await runtime.tenants.getManagedInstallationState(input.readiness.shop);
    assert.ok(state?.active);
    assert.equal(state.shopId, scope.shopId);
    assert.equal(state.currentGeneration, scope.installationGeneration);
    assert.equal(state.externalInstallationId, input.readiness.externalInstallationId);
    assert.equal(`gid://shopify/Shop/${state.shopifyShopId}`, input.readiness.shopId);
    const address = new URL(databaseUrl);
    address.username = input.operator.user;
    address.password = input.operator.password;
    const budget = remainingAuthority();
    operator = new Pool({
      connectionString: address.href,
      connectionTimeoutMillis: budget,
      query_timeout: budget,
      options: `-c statement_timeout=${budget}ms -c lock_timeout=${budget}ms`,
    });
    client = await operator.connect();
    remainingAuthority();
    const identity = await client.query(`SELECT current_user = 'insignia_release_append'
      AND pg_has_role(current_user,'insignia_release_operator','MEMBER')
      AND NOT pg_has_role(current_user,'insignia_release_owner','MEMBER')
      AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname='insignia_release_operator' AND NOT rolcanlogin)
      AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolcanlogin
        AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) AS qualified`);
    assert.equal(identity.rows[0]?.qualified, true);
    remainingAuthority();
    await client.query('BEGIN');
    transactionOpened = true;
    const writeBudget = remainingAuthority();
    await client.query(`SET LOCAL statement_timeout = '${writeBudget}ms'; SET LOCAL lock_timeout = '${writeBudget}ms'`);
    remainingAuthority();
    writeAttempted = true;
    const inserted = await client.query(
      `INSERT INTO trusted_release_records(record_id,shop_id,installation_generation,app_client_id,active_app_version_ref,expected_build,trusted_record,active_version_observed_at,active_version_evidence_sha256,evidence_digest)
      SELECT $1,$2,$3::bigint,$4,$5,$6::jsonb,$7::jsonb,$8::timestamptz,$9,$10
      WHERE clock_timestamp() >= $8::timestamptz AND clock_timestamp() >= $11::timestamptz AND clock_timestamp() < $12::timestamptz`,
      [
        recordId,
        scope.shopId,
        scope.installationGeneration,
        APP,
        VERSION,
        expected,
        record,
        observations.observedAt,
        observations.proof,
        digest,
        observations.functionObservedAt,
        observations.expiresAt,
      ],
    );
    assert.equal(inserted.rowCount, 1);
    // INSERT may wait on FK/trigger after its SELECT. Expired authority rolls back.
    const current = await client.query(
      `SELECT clock_timestamp() >= $1::timestamptz AND clock_timestamp() >= $2::timestamptz
      AND clock_timestamp() < $3::timestamptz AS authority_current`,
      [observations.observedAt, observations.functionObservedAt, observations.expiresAt],
    );
    assert.equal(current.rows[0]?.authority_current, true);
    remainingAuthority();
    commitAttempted = true;
    await client.query('COMMIT');
    transactionOpened = false;
    writeAcknowledged = true;
    const qualified = await runtime.trustedReleaseRecords.read({
      scope,
      expectedActiveAppVersionRef: VERSION,
      now: new Date(now()),
    });
    assert.equal(qualified?.record.recordId, recordId);
    assert.equal(qualified.evidenceDigest, digest);
    return {
      classification: 'TRUSTED_RELEASE_APPEND_ACK_RUNTIME_QUALIFIED',
      recordId,
      writeAttempted,
      writeAcknowledged,
      providerRequests: 0,
      observedAt: observations.observedAt,
      functionObservedAt: observations.functionObservedAt,
      authorityExpiresAt: observations.expiresAt,
      activeVersionEvidenceSha256: observations.proof,
      activeObservationEvidenceSha256: observations.activeObservationEvidenceSha256,
      functionObservationEvidenceSha256: observations.functionObservationEvidenceSha256,
      moduleObservationEvidenceSha256: observations.moduleObservationEvidenceSha256,
      evidenceDigest: digest,
      expectedBuild: expected,
      trustedRecord: record,
    };
  } catch {
    if (transactionOpened && client) {
      try {
        await client.query('ROLLBACK');
        rollbackAcknowledged = true;
      } catch {
        rollbackAcknowledged = false;
      }
    }
    return {
      classification: 'TRUSTED_RELEASE_APPEND_STOPPED',
      recordId,
      writeAttempted,
      writeAcknowledged,
      commitAttempted,
      rollbackAcknowledged,
      writeSettledNoAppend: writeAttempted && !commitAttempted && rollbackAcknowledged,
      ambiguousWrite: !writeAcknowledged && (commitAttempted || (writeAttempted && !rollbackAcknowledged)),
      retryAuthorized: false,
      providerRequests: 0,
      secretValuesLogged: false,
    };
  } finally {
    // Cleanup must never overwrite settled COMMIT/ROLLBACK facts. The host owns
    // the process deadline; each remaining close is attempted without logging.
    try {
      client?.release(true);
    } catch {
      /* Preserve settlement. */
    }
    try {
      await operator?.end();
    } catch {
      /* Preserve settlement. */
    }
    try {
      await runtime?.close();
    } catch {
      /* Preserve settlement. */
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of process.stdin) {
      size += chunk.length;
      assert.ok(size <= 256_000);
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    // Reject malformed authority before loading runtime/database dependencies.
    qualifyReleaseAppendInput(input, Date.now());
    // Host fixes cwd to /srv/insignia/web in the reviewed image (apps/web for
    // local qualification). The portable image has no repository apps/ tree.
    const require = createRequire(new URL('package.json', pathToFileURL(`${process.cwd()}/`)));
    const { Pool } = require('pg');
    const { createDurableCore, sha256CanonicalJson } = await import(
      pathToFileURL(require.resolve('@insignia/database')).href
    );
    const result = await appendTrustedRelease(input, {
      Pool,
      createDurableCore,
      sha256CanonicalJson,
      databaseUrl: process.env.DATABASE_URL,
    });
    console.log(JSON.stringify(result));
    if (result.classification !== 'TRUSTED_RELEASE_APPEND_ACK_RUNTIME_QUALIFIED') process.exitCode = 1;
  } catch {
    console.log(
      JSON.stringify({
        classification: 'TRUSTED_RELEASE_APPEND_STOPPED',
        recordId: null,
        writeAttempted: false,
        writeAcknowledged: false,
        commitAttempted: false,
        rollbackAcknowledged: false,
        writeSettledNoAppend: false,
        ambiguousWrite: false,
        retryAuthorized: false,
        providerRequests: 0,
        secretValuesLogged: false,
      }),
    );
    process.exitCode = 1;
  }
}
