/** Operator-only stdin envelope, run in the exact reviewed web image. No provider
 * request, retry, tenant seed, token exchange or release/version operation.
 * Private operator credential enters stdin, never argv/env/logs. Reserve recordId
 * and the public input SHA durably on host before invocation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDurableCore, sha256CanonicalJson } from '@insignia/database';
import { Pool } from 'pg';

/** Bound original observations; a fresh Active read cannot restamp Function evidence. */
export function qualifyReleaseObservations(activeObservation, functionObservation, now) {
  assert.ok(Number.isFinite(now));
  const observedAt = activeObservation.observedAt;
  const functionObservedAt = functionObservation.observedAt;
  assert.equal(typeof observedAt, 'string');
  assert.equal(typeof functionObservedAt, 'string');
  const observedMs = Date.parse(observedAt);
  const functionObservedMs = Date.parse(functionObservedAt);
  for (const value of [observedMs, functionObservedMs])
    assert.ok(Number.isFinite(value) && value <= now && now - value < 30_000);
  assert.deepEqual(new Set(Object.keys(functionObservation)),
    new Set(['shopId','installationGeneration','appClientId','observedAt','transform','validation']));
  for (const kind of ['transform','validation'])
    assert.deepEqual(new Set(Object.keys(functionObservation[kind])),
      new Set(['functionId','handle','apiType','apiVersion','inputQuerySha256']));
  const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {
    observedAt, observedMs, functionObservedAt, functionObservedMs,
    expiresAt: new Date(Math.min(observedMs,functionObservedMs) + 30_000).toISOString(),
    activeObservationEvidenceSha256: hash(activeObservation),
    functionObservationEvidenceSha256: hash(functionObservation),
    // This exact composite receipt contains both original timestamps/identities.
    proof: hash({version:'m5-release-observations-v1',activeObservation,functionObservation}),
  };
}

let recordId = null;
let writeAttempted = false;
let writeAcknowledged = false;
let runtime;
let operator;
let operatorClient;
let transactionOpened = false;
let commitAttempted = false;
let rollbackAcknowledged = false;
try {
  let size = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    size += chunk.length;
    assert.ok(size <= 256_000);
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  recordId = input.recordId;
  assert.match(recordId, /^[0-9a-f-]{36}$/);
  assert.equal(input.operator.user, 'insignia_release_operator');
  assert.match(input.operator.password, /^[A-Za-z0-9_-]{64}$/);
  const observedAt = input.activeObservation.observedAt;
  const observedMs = Date.parse(observedAt);
  assert.ok(Number.isFinite(observedMs) && observedMs <= Date.now() && Date.now() - observedMs < 30_000);
  const versions = input.activeObservation.versions;
  assert.equal(versions.length, 5);
  assert.deepEqual(
    new Set(versions.map((v) => v.versionId)),
    new Set([
      'gid://shopify/Version/1158986629121',
      'gid://shopify/Version/1158837927937',
      'gid://shopify/Version/1153019904001',
      'gid://shopify/Version/1152880803841',
      'gid://shopify/Version/1146748534785',
    ]),
  );
  assert.equal(versions.filter((v) => v.status === 'active').length, 1);
  assert.ok(versions.every((v) => v.status === (v.versionId.endsWith('/1158986629121') ? 'active' : 'inactive')));
  assert.equal(versions.find((v) => v.status === 'active').versionTag, 'm5-019r-9b94149272d1');
  const readiness = input.readiness;
  assert.equal(readiness.version, 'm5-admin-technical-readiness-v1');
  assert.equal(readiness.shop, 'insignia-rewrite-dev.myshopify.com');
  assert.equal(readiness.functions.observation.appClientId, '1443cf6d03d39edae7c101a943c5c684');
  const observations = qualifyReleaseObservations(input.activeObservation, readiness.functions.observation, Date.now());
  const proof = observations.proof;
  runtime = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
  const state = await runtime.tenants.getManagedInstallationState(readiness.shop);
  assert.ok(state?.active);
  assert.equal(state.shopId, readiness.tenantShopId);
  assert.equal(state.currentGeneration, readiness.installationGeneration);
  assert.equal(state.externalInstallationId, readiness.externalInstallationId);
  assert.equal('gid://shopify/Shop/' + state.shopifyShopId, readiness.shopId);
  assert.equal(readiness.functions.observation.shopId, state.shopId);
  assert.equal(readiness.functions.observation.installationGeneration, state.currentGeneration);
  const scope = {
    shopId: state.shopId,
    installationGeneration: state.currentGeneration,
    appClientId: '1443cf6d03d39edae7c101a943c5c684',
  };
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
  const expected = {
    schemaVersion: 1,
    ...scope,
    appVersionRef: '1158986629121',
    devPreviewRef: null,
    sourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  };
  for (const kind of ['transform', 'validation']) {
    const observation = readiness.functions.observation[kind];
    assert.ok(observation && typeof observation.functionId === 'string' && observation.functionId.length > 0);
    assert.notEqual(observation.functionId, 'c56038d4-146a-405e-b47d-a055249eeeb3');
    assert.notEqual(observation.functionId, '552059da-2dc1-47f8-8fc0-14a5ccb6f665');
    for (const key of ['handle', 'apiType', 'apiVersion', 'inputQuerySha256'])
      assert.equal(observation[key], artifacts[kind][key]);
    expected[kind] = { ...artifacts[kind], functionId: observation.functionId };
  }
  const record = {
    version: 'm5-trusted-release-v1',
    recordId,
    activeAppVersionRef: '1158986629121',
    attestation: {
      ...expected,
      evidenceKind: 'RELEASE_BOUND',
      observedAt,
      expiresAt: observations.expiresAt,
    },
  };
  const digest = sha256CanonicalJson({
    trustedRecord: record,
    expectedBuild: expected,
    activeVersionObservedAt: observedAt,
    activeVersionEvidenceSha256: proof,
  });
  const address = new URL(process.env.DATABASE_URL);
  address.username = input.operator.user;
  address.password = input.operator.password;
  const deadline = Date.parse(observations.expiresAt);
  function remainingAuthority() {
    const now = Date.now();
    assert.ok(now >= observedMs && now >= observations.functionObservedMs && now < deadline,
      'Original authority expired before append');
    return deadline - now;
  }
  const connectionBudget = remainingAuthority();
  operator = new Pool({ connectionString: address.href, connectionTimeoutMillis: connectionBudget,
    query_timeout: connectionBudget,
    options: `-c statement_timeout=${connectionBudget}ms -c lock_timeout=${connectionBudget}ms` });
  operatorClient = await operator.connect();
  remainingAuthority();
  await operatorClient.query('BEGIN');
  transactionOpened = true;
  const writeBudget = remainingAuthority();
  await operatorClient.query(`SET LOCAL statement_timeout = '${writeBudget}ms'; SET LOCAL lock_timeout = '${writeBudget}ms'`);
  remainingAuthority();
  writeAttempted = true;
  const inserted = await operatorClient.query(
    `INSERT INTO trusted_release_records(record_id,shop_id,installation_generation,app_client_id,active_app_version_ref,expected_build,trusted_record,active_version_observed_at,active_version_evidence_sha256,evidence_digest)
     SELECT $1,$2,$3::bigint,$4,$5,$6::jsonb,$7::jsonb,$8::timestamptz,$9,$10
     WHERE clock_timestamp() >= $8::timestamptz AND clock_timestamp() >= $11::timestamptz
       AND clock_timestamp() < $12::timestamptz`,
    [recordId,state.shopId,state.currentGeneration,scope.appClientId,expected.appVersionRef,
      expected,record,observedAt,proof,digest,observations.functionObservedAt,observations.expiresAt],
  );
  assert.equal(inserted.rowCount, 1);
  // A foreign-key/trigger wait can follow SELECT evaluation. Recheck in the
  // database after INSERT has fully completed; expiry rolls back the candidate.
  const current = await operatorClient.query(
    `SELECT clock_timestamp() >= $1::timestamptz AND clock_timestamp() >= $2::timestamptz
      AND clock_timestamp() < $3::timestamptz AS authority_current`,
    [observedAt,observations.functionObservedAt,observations.expiresAt]);
  assert.equal(current.rows[0]?.authority_current, true);
  remainingAuthority();
  commitAttempted = true;
  await operatorClient.query('COMMIT');
  transactionOpened = false;
  writeAcknowledged = true;
  const qualified = await runtime.trustedReleaseRecords.read({
    scope,
    expectedActiveAppVersionRef: '1158986629121',
    now: new Date(),
  });
  assert.equal(qualified?.record.recordId, recordId);
  assert.equal(qualified.evidenceDigest, digest);
  console.log(
    JSON.stringify({
      classification: 'TRUSTED_RELEASE_APPEND_ACK_RUNTIME_QUALIFIED',
      recordId,
      writeAttempted,
      writeAcknowledged,
      providerRequests: 0,
      observedAt,
      activeVersionEvidenceSha256: proof,
      activeObservationEvidenceSha256: observations.activeObservationEvidenceSha256,
      functionObservationEvidenceSha256: observations.functionObservationEvidenceSha256,
      functionObservedAt: observations.functionObservedAt,
      authorityExpiresAt: observations.expiresAt,
      evidenceDigest: digest,
      expectedBuild: expected,
      trustedRecord: record,
    }),
  );
} catch {
  if (transactionOpened && operatorClient) {
    try { await operatorClient.query('ROLLBACK'); rollbackAcknowledged = true; }
    catch { rollbackAcknowledged = false; }
    transactionOpened = false;
  }
  console.log(
    JSON.stringify({
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
    }),
  );
  process.exitCode = 1;
} finally {
  operatorClient?.release(true);
  await operator?.end();
  await runtime?.close();
}
