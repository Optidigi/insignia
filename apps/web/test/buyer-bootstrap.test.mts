type Dependencies = NonNullable<Parameters<typeof createBuyerBootstrap>[1]>;

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBuyerBootstrap } from '../src/server/buyer/bootstrap.ts';
import { proposalDiagnostics, proposalTiming } from '../src/server/buyer/diagnostics.ts';
import { buyerFixture, coreFixture, releaseEvidenceFixture, required } from './http-fixtures.mts';

function environment() {
  return {
    INSIGNIA_M7_BUYER_ENABLED: '1',
    DATABASE_URL: 'postgres://synthetic:synthetic@127.0.0.1:58197/synthetic_m7',
    SHOPIFY_CLIENT_ID: 'synthetic-app',
    SHOPIFY_CLIENT_SECRET: 'synthetic-private-secret',
    APP_URL: 'https://app.invalid',
    ARTWORK_PROXY_PATH_PREFIX: '/apps/insignia',
    INSIGNIA_SHOPIFY_APP_ID: '7',
    INSIGNIA_CREDENTIAL_KEY_ID: 'synthetic',
    INSIGNIA_CREDENTIAL_KEY_BASE64: Buffer.alloc(32, 1).toString('base64'),
    INSIGNIA_PARTNER_ORGANIZATION_ID: '9',
    INSIGNIA_PARTNER_ACCESS_TOKEN: 'synthetic-partner-token',
    INSIGNIA_M5_ENTITLEMENT_POLICY_JSON: JSON.stringify({
      policyVersion: 'synthetic-policy',
      maxAgeMs: 300000,
      plans: [
        {
          planHandle: 'synthetic-flat',
          billing: 'recurring-only',
          policyId: 'synthetic-exact-policy',
          features: ['base'],
        },
      ],
    }),
    INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON: JSON.stringify({ appKey: 'synthetic-app' }),
  };
}
const legacyExpectedFunctions = {
  appKey: 'synthetic-app',
  transformInputQuerySha256: 'a'.repeat(64),
  validationInputQuerySha256: 'b'.repeat(64),
  observationVersion: 2,
};
function seam() {
  let allocated = 0,
    closed = 0,
    composition: Parameters<NonNullable<Dependencies['createServices']>>[0] | undefined;
  const readers: Parameters<ReturnType<typeof coreFixture>['trustedReleaseRecords']['read']>[0][] = [];
  const core = coreFixture({
    tenants: {
      getActiveProviderScope: async (scope) => ({ ...scope, shopDomain: 'owned.myshopify.com', shopifyShopId: '11' }),
      getActiveAuthorizationScope: async (scope) => ({
        ...scope,
        shopDomain: 'owned.myshopify.com',
        shopifyShopId: '11',
        authorizationGeneration: '11111111-1111-4111-8111-111111111111',
        authorizationEpoch: 0,
      }),
      getManagedInstallationState: async () => ({
        active: true,
        shopDomain: 'owned.myshopify.com',
        shopifyShopId: '11',
        shopId: 'tenant',
        currentGeneration: '1',
        externalInstallationId: 'gid://shopify/AppInstallation/12',
      }),
    },
    credentials: {
      acquire: async () => ({
        kind: 'usable',
        accessToken: 'synthetic-offline-token',
        accessExpiresAt: new Date(Date.now() + 600000),
      }),
      install: async () => 'synthetic-version',
      replaceClaim: async () => 'replaced',
      releaseClaim: async () => true,
      markReauthRequired: async () => true,
    },
    trustedReleaseRecords: {
      read: async (target) => {
        readers.push(target);
        return null;
      },
    },
    close: async () => {
      closed++;
    },
  });
  const services = buyerFixture({});
  const dependencies: Dependencies = {
    releaseCollector: { collect: async ({ requestId }) => ({ requestId, state: 'STOPPED', recordId: null }) },
    createCore: (options) => {
      allocated++;
      assert.equal(options.max, 10);
      assert.equal(options.connectionTimeoutMillis, 5000);
      return core;
    },
    createServices: (input) => {
      composition = input;
      return services;
    },
  };
  return {
    dependencies,
    services,
    core,
    readers,
    stats: () => ({ allocated, closed }),
    getComposition: () => composition,
  };
}
test('disabled bootstrap reads only the explicit enable flag and allocates no resources', async () => {
  const value = seam(),
    env = new Proxy(
      {},
      {
        get: (_target, key) => {
          assert.equal(key, 'INSIGNIA_M7_BUYER_ENABLED');
          return undefined;
        },
      },
    );
  assert.equal(await createBuyerBootstrap(env, value.dependencies), undefined);
  assert.deepEqual(value.stats(), { allocated: 0, closed: 0 });
});
test('missing or malformed actual resources fail before core allocation without a diagnostic fallback', async () => {
  for (const update of [
    { DATABASE_URL: undefined },
    { INSIGNIA_CREDENTIAL_KEY_BASE64: 'invalid' },
    { INSIGNIA_PARTNER_ACCESS_TOKEN: undefined },
    { INSIGNIA_M5_ENTITLEMENT_POLICY_JSON: '{}' },
    { INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON: JSON.stringify({ ...legacyExpectedFunctions, appKey: 'other' }) },
    { INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON: JSON.stringify({ appKey: 'other' }) },
    { INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON: JSON.stringify({}) },
    { INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON: JSON.stringify({ appKey: 'synthetic-app', unknown: true }) },
    { INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON: JSON.stringify({ ...legacyExpectedFunctions, observationVersion: 1 }) },
    {
      INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON: JSON.stringify({
        ...legacyExpectedFunctions,
        validationInputQuerySha256: 'X',
      }),
    },
  ]) {
    const value = seam();
    assert.equal(await createBuyerBootstrap({ ...environment(), ...update }, value.dependencies), undefined);
    assert.deepEqual(value.stats(), { allocated: 0, closed: 0 });
  }
});
test('enabled bootstrap binds existing credential lifecycle and immutable trusted release reads to concrete provider ports', async () => {
  const value = seam(),
    env = environment();
  assert.equal(await createBuyerBootstrap(env, value.dependencies), value.services);
  assert.equal(value.stats().allocated, 1);
  const composition = required(value.getComposition());
  assert.deepEqual(composition.entitlementPolicy, JSON.parse(env.INSIGNIA_M5_ENTITLEMENT_POLICY_JSON));
  const credential = await composition.credentials.acquire({ shopId: 'tenant', installationGeneration: '1' });
  assert(credential.kind === 'usable');
  assert.equal(credential.shopDomain, 'owned.myshopify.com');
  assert.equal(credential.kind, 'usable');
  const scope = { shopId: 'tenant', installationGeneration: '1', appClientId: 'synthetic-app' };
  assert.equal(await composition.artifactPorts.expectedBuild.read(scope), null);
  assert.equal(await composition.artifactPorts.trustedEvidence.read(scope), null);
  assert.equal(value.readers.length, 4, 'Each missing lookup rechecks evidence before requesting collection');
  for (const reader of value.readers) {
    assert.equal(reader.expectedActiveAppVersionRef, '1163229200385');
    assert.equal(reader.scope.shopId, scope.shopId);
    assert.equal(reader.scope.installationGeneration, scope.installationGeneration);
    assert.equal(reader.scope.appClientId, scope.appClientId);
  }
  assert.equal(await composition.artifactPorts.expectedBuild.read({ ...scope, appClientId: 'other' }), null);
  assert.equal(value.readers.length, 4);
});
test('a production composition failure closes its dedicated core and exposes no provider secret', async () => {
  const value = seam();
  value.dependencies.createServices = () => {
    throw new Error('synthetic-private-secret');
  };
  assert.equal(await createBuyerBootstrap(environment(), value.dependencies), undefined);
  assert.deepEqual(value.stats(), { allocated: 1, closed: 1 });
});

test('bootstrap uses configured Partner transport and passes stored release evidence without restamping', async () => {
  const value = seam(),
    env = environment();
  let subscriptions = 0;
  value.dependencies.fetchImpl = async (url, options) => {
    subscriptions++;
    assert.equal(url, 'https://partners.shopify.com/9/api/2026-07/graphql.json');
    assert(options);
    assert.equal(new Headers(options.headers).get('x-shopify-access-token'), 'synthetic-partner-token');
    assert.equal(options.redirect, 'error');
    assert(typeof options.body === 'string');
    assert.deepEqual(JSON.parse(options.body).variables, {
      appId: 'gid://shopify/App/7',
      shopId: 'gid://shopify/Shop/11',
    });
    return new Response(JSON.stringify({ data: { activeSubscription: null } }));
  };
  const evidence = releaseEvidenceFixture();
  const expectedBuild = evidence.expectedBuild,
    attestation = evidence.record.attestation;
  value.core.trustedReleaseRecords = { read: async () => evidence };
  await createBuyerBootstrap(env, value.dependencies);
  const ports = required(value.getComposition());
  const observed = await ports.readSubscription({ appId: 'gid://shopify/App/7', shopId: 'gid://shopify/Shop/11' });
  assert.equal(observed.active, false);
  assert.equal(subscriptions, 1);
  const scope = { shopId: 'tenant', installationGeneration: '1', appClientId: 'synthetic-app' };
  assert.equal(await ports.artifactPorts.expectedBuild.read(scope), expectedBuild);
  assert.equal(await ports.artifactPorts.trustedEvidence.read(scope), attestation);
  assert.equal(attestation.observedAt, '2000-01-01T00:00:00.000Z');
});

test('M8 buyer bootstrap reads the selected release without enabling buyer mode or trusting arbitrary version text', async () => {
  const controls = seam();
  const env = { ...environment(), INSIGNIA_RELEASE_PROFILE: 'm8-read-orders-617057f' };
  assert.equal(await createBuyerBootstrap(env, controls.dependencies), controls.services);
  const input = required(controls.getComposition());
  const scope = { shopId: 'tenant', installationGeneration: '1', appClientId: 'synthetic-app' };
  assert.equal(await input.artifactPorts.expectedBuild.read(scope), null);
  assert.equal(required(controls.readers.at(-1)).expectedActiveAppVersionRef, '1165513097217');
  await input.core.close();
  const denied = seam();
  assert.equal(
    await createBuyerBootstrap({ ...environment(), INSIGNIA_RELEASE_PROFILE: '1165513097217' }, denied.dependencies),
    undefined,
  );
  assert.equal(denied.stats().allocated, 0);
});

test('buyer release reads recover expired evidence through one independent collection and durable reread', async () => {
  const value = seam();
  const now = new Date('2026-10-13T22:00:05.000Z');
  value.dependencies.clock = () => now;
  const source = releaseEvidenceFixture('2026-10-13T22:00:00.000Z', '2026-10-13T22:00:30.000Z');
  const expectedBuild = { ...source.expectedBuild, appVersionRef: '1165513097217' };
  const attestation = { ...source.record.attestation, appVersionRef: '1165513097217' };
  const recordId = '22222222-2222-4222-8222-222222222222';
  let appended = false,
    collections = 0;
  value.core.trustedReleaseRecords = {
    read: async () =>
      appended ? { ...source, expectedBuild, record: { ...source.record, recordId, attestation } } : null,
  };
  value.dependencies.releaseCollector = {
    async collect(request) {
      collections++;
      assert.equal(request.expectedActiveAppVersionRef, '1165513097217');
      assert.equal(request.binding.externalInstallationId, 'gid://shopify/AppInstallation/12');
      assert.deepEqual(Object.keys(request).sort(), [
        'binding',
        'deadlineMs',
        'expectedActiveAppVersionRef',
        'requestId',
      ]);
      assert.ok(request.deadlineMs <= +now + 300000);
      await new Promise((resolve) => setImmediate(resolve));
      appended = true;
      return { requestId: request.requestId, state: 'COMPLETE', recordId };
    },
  };
  await createBuyerBootstrap(
    { ...environment(), INSIGNIA_RELEASE_PROFILE: 'm8-read-orders-617057f' },
    value.dependencies,
  );
  const ports = required(value.getComposition()).artifactPorts;
  const scope = { shopId: 'tenant', installationGeneration: '1', appClientId: 'synthetic-app' };
  const result = await Promise.all([ports.expectedBuild.read(scope), ports.trustedEvidence.read(scope)]);
  assert.deepEqual(result, [expectedBuild, attestation]);
  assert.equal(collections, 1);
  assert.equal(attestation.observedAt, '2026-10-13T22:00:00.000Z');
});

test('buyer collection deadline respects real credential expiry and does not collect an unusable grant', async () => {
  const now = new Date('2026-10-13T22:00:00.000Z');
  for (const remaining of [45000, 30000]) {
    const value = seam();
    value.dependencies.clock = () => now;
    value.core.credentials.acquire = async () => ({
      kind: 'usable',
      accessToken: 'synthetic-offline-token',
      accessExpiresAt: new Date(+now + remaining),
    });
    let calls = 0;
    value.dependencies.releaseCollector = {
      async collect(request) {
        calls++;
        assert.equal(request.deadlineMs, +now + 15000);
        return { requestId: request.requestId, state: 'STOPPED', recordId: null };
      },
    };
    await createBuyerBootstrap(environment(), value.dependencies);
    const scope = { shopId: 'tenant', installationGeneration: '1', appClientId: 'synthetic-app' };
    assert.equal(await required(value.getComposition()).artifactPorts.expectedBuild.read(scope), null);
    assert.equal(calls, remaining === 45000 ? 1 : 0);
  }
});

test('buyer release collection cannot survive authorization or installation drift', async () => {
  for (const drift of ['authorization', 'installation']) {
    const value = seam();
    let changed = false;
    const original = value.core.tenants.getActiveAuthorizationScope;
    value.core.tenants.getActiveAuthorizationScope = async (scope) => ({
      ...required(await original(scope)),
      authorizationEpoch: changed && drift === 'authorization' ? 1 : 0,
    });
    value.core.tenants.getManagedInstallationState = async () => ({
      active: true,
      shopDomain: 'owned.myshopify.com',
      shopifyShopId: '11',
      shopId: 'tenant',
      currentGeneration: '1',
      externalInstallationId:
        changed && drift === 'installation' ? 'gid://shopify/AppInstallation/99' : 'gid://shopify/AppInstallation/12',
    });
    value.dependencies.releaseCollector = {
      async collect(request) {
        changed = true;
        return { requestId: request.requestId, state: 'COMPLETE', recordId: '22222222-2222-4222-8222-222222222222' };
      },
    };
    await createBuyerBootstrap(environment(), value.dependencies);
    await assert.rejects(
      required(value.getComposition()).artifactPorts.expectedBuild.read({
        shopId: 'tenant',
        installationGeneration: '1',
        appClientId: 'synthetic-app',
      }),
      /Buyer release authority changed/,
    );
  }
});

test('bootstrap admits an explicit recurring-only policy and rejects mixed meter or allowance configuration before allocation', async () => {
  const policy = {
    policyVersion: 'synthetic-recurring-v1',
    maxAgeMs: 30000,
    plans: [
      {
        billing: 'recurring-only',
        planHandle: 'synthetic-flat-only',
        policyId: 'synthetic-recurring',
        shopId: 'gid://shopify/Shop/11',
        features: ['base'],
      },
    ],
  };
  const value = seam();
  assert.equal(
    await createBuyerBootstrap(
      { ...environment(), INSIGNIA_M5_ENTITLEMENT_POLICY_JSON: JSON.stringify(policy) },
      value.dependencies,
    ),
    value.services,
  );
  assert.deepEqual(required(value.getComposition()).entitlementPolicy, policy);
  for (const fields of [{ usageHandle: 'meter' }, { includedUsage: 100 }, { billing: 'unknown' }]) {
    const rejected = seam();
    const invalid = { ...policy, plans: [{ ...policy.plans[0], ...fields }] };
    assert.equal(
      await createBuyerBootstrap(
        { ...environment(), INSIGNIA_M5_ENTITLEMENT_POLICY_JSON: JSON.stringify(invalid) },
        rejected.dependencies,
      ),
      undefined,
    );
    assert.deepEqual(rejected.stats(), { allocated: 0, closed: 0 });
  }
});

test('Lean buyer rejects a hybrid commercial policy before allocating runtime resources', async () => {
  const value = seam();
  const env = environment();
  const policy = JSON.parse(env.INSIGNIA_M5_ENTITLEMENT_POLICY_JSON);
  delete policy.plans[0].billing;
  policy.plans[0].usageHandle = 'synthetic-usage';
  policy.plans[0].includedUsage = 100;
  env.INSIGNIA_M5_ENTITLEMENT_POLICY_JSON = JSON.stringify(policy);
  assert.equal(await createBuyerBootstrap(env, value.dependencies), undefined);
  assert.deepEqual(value.stats(), { allocated: 0, closed: 0 });
});

test('buyer bootstrap accepts bounded formatted JSON configuration used by the deployed merchant policy', async () => {
  const value = seam();
  const env = environment();
  for (const key of ['INSIGNIA_M5_ENTITLEMENT_POLICY_JSON', 'INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON'] as const)
    env[key] = `\n${JSON.stringify(JSON.parse(env[key]), null, 2)}\n`;
  assert.equal(await createBuyerBootstrap(env, value.dependencies), value.services);
  assert.deepEqual(
    required(value.getComposition()).entitlementPolicy,
    JSON.parse(env.INSIGNIA_M5_ENTITLEMENT_POLICY_JSON),
  );
  assert.deepEqual(required(value.getComposition()).expectedFunctions, { appKey: 'synthetic-app' });
  for (const invalid of ['\n', '\nnot-json\n', '[{}]', ' '.repeat(16385)]) {
    const denied = seam();
    assert.equal(
      await createBuyerBootstrap({ ...env, INSIGNIA_M5_ENTITLEMENT_POLICY_JSON: invalid }, denied.dependencies),
      undefined,
    );
    assert.deepEqual(denied.stats(), { allocated: 0, closed: 0 });
  }
});

test('legacy expected-Function query fields are accepted and ignored; the trusted release record supplies queries', async () => {
  const value = seam();
  const env = { ...environment(), INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON: JSON.stringify(legacyExpectedFunctions) };
  assert.equal(await createBuyerBootstrap(env, value.dependencies), value.services);
  assert.deepEqual(required(value.getComposition()).expectedFunctions, { appKey: 'synthetic-app' });
});

test('acceptance release ports share one record read and background refresh collects ahead of expiry', async () => {
  const value = seam();
  let now = new Date('2026-10-13T22:00:05.000Z');
  value.dependencies.clock = () => now;
  const timers: { run: () => void; delayMs: number }[] = [];
  value.dependencies.releaseRefreshTimer = (run, delayMs) => {
    timers.push({ run, delayMs });
    return {};
  };
  const source = releaseEvidenceFixture('2026-10-13T22:00:00.000Z', '2026-10-13T22:00:30.000Z');
  let observedAt = Date.parse('2026-10-13T22:00:00.000Z'),
    reads = 0,
    collections = 0;
  const recordId = '22222222-2222-4222-8222-222222222222';
  const evidence = () => ({
    ...source,
    record: {
      ...source.record,
      recordId,
      attestation: {
        ...source.record.attestation,
        observedAt: new Date(observedAt).toISOString(),
        expiresAt: new Date(observedAt + 30000).toISOString(),
      },
    },
  });
  // The stored reader keeps its exact 30 s rule; it is evaluated at the instant it is given.
  value.core.trustedReleaseRecords = {
    read: async (target) => {
      reads++;
      return +target.now - observedAt <= 30000 ? evidence() : null;
    },
  };
  value.dependencies.releaseCollector = {
    async collect(request) {
      collections++;
      observedAt = +now;
      return { requestId: request.requestId, state: 'COMPLETE', recordId };
    },
  };
  await createBuyerBootstrap(environment(), value.dependencies);
  const input = required(value.getComposition());
  const scope = { shopId: 'tenant', installationGeneration: '1', appClientId: 'synthetic-app' };
  const [build, attestation] = await Promise.all([
    input.artifactPorts.expectedBuild.read(scope),
    input.artifactPorts.trustedEvidence.read(scope),
  ]);
  assert.ok(build && attestation);
  assert.equal(reads, 1, 'one stored read serves both release ports of an observation');
  assert.equal(collections, 0);

  // A proposal touches the refresher; nothing runs on the request path.
  required(input.releaseRefresh)({ shopId: 'tenant', installationGeneration: '1' }, new Date(+now + 300000));
  assert.equal(collections, 0);
  assert.equal(timers.length, 1);
  // The 5 s old record is fresh enough: no collection, next check when it turns 22 s old.
  required(timers.shift()).run();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(collections, 0);
  assert.equal(required(timers[0]).delayMs, 25000);
  now = new Date(+now + 25000);
  required(timers.shift()).run();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(collections, 1, 'a 30 s-near record is collected ahead of expiry');
  assert.equal(observedAt, +now);
  await input.core.close();
});

test('an acceptance that finds the release record stale collects synchronously and fails closed without one', async () => {
  const value = seam();
  const now = new Date('2026-10-13T22:01:00.000Z');
  value.dependencies.clock = () => now;
  let collections = 0;
  value.core.trustedReleaseRecords = { read: async () => null };
  value.dependencies.releaseCollector = {
    async collect(request) {
      collections++;
      return { requestId: request.requestId, state: 'STOPPED', recordId: null };
    },
  };
  await createBuyerBootstrap(environment(), value.dependencies);
  const input = required(value.getComposition());
  const scope = { shopId: 'tenant', installationGeneration: '1', appClientId: 'synthetic-app' };
  const timing = await proposalDiagnostics(async () => {
    assert.equal(await input.artifactPorts.trustedEvidence.read(scope), null);
    return proposalTiming('22222222-2222-4222-8222-222222222222', 'acceptance', 'failure');
  });
  assert.equal(collections, 1, 'the stale record triggered one synchronous collection');
  // The timing names the slow sub-call: the collection this request started (#345).
  assert.deepEqual(
    required(timing).spans.map((span) => [span.stage, span.outcome]),
    [['release-collect', 'success']],
  );
});

test('bootstrap reuses one Partner subscription read per shop for 60 s', async () => {
  const value = seam();
  let now = new Date('2026-11-10T00:00:00.000Z'),
    subscriptions = 0;
  value.dependencies.clock = () => now;
  value.dependencies.fetchImpl = async () => {
    subscriptions++;
    return new Response(JSON.stringify({ data: { activeSubscription: null } }));
  };
  await createBuyerBootstrap(environment(), value.dependencies);
  const input = required(value.getComposition());
  const target = { appId: 'gid://shopify/App/7', shopId: 'gid://shopify/Shop/11' };
  await input.readSubscription(target);
  await input.readSubscription(target);
  assert.equal(subscriptions, 1);
  now = new Date(+now + 60000);
  await input.readSubscription(target);
  assert.equal(subscriptions, 2);
  await input.core.close();
});
