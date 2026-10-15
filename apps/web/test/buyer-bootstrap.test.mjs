import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBuyerBootstrap } from '../src/server/buyer/bootstrap.ts';

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
          usageHandle: 'synthetic-usage',
          policyId: 'synthetic-exact-policy',
          features: ['base'],
          includedUsage: 100,
        },
      ],
    }),
    INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON: JSON.stringify({
      appKey: 'synthetic-app',
      transformInputQuerySha256: 'a'.repeat(64),
      validationInputQuerySha256: 'b'.repeat(64),
      observationVersion: 2,
    }),
  };
}
function seam() {
  let allocated = 0,
    closed = 0,
    composition;
  const readers = [];
  const core = {
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
      install: async () => {},
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
  };
  const services = { guest: { syntheticBoundaryOnly: true } };
  const dependencies = {
    releaseCollector: { collect: async ({ requestId }) => ({ requestId, state: 'STOPPED', recordId: null }) },
    createCore: (options) => {
      allocated++;
      assert.equal(options.max, 4);
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
    {
      INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON: JSON.stringify({
        appKey: 'other',
        transformInputQuerySha256: 'a'.repeat(64),
        validationInputQuerySha256: 'b'.repeat(64),
        observationVersion: 2,
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
  const composition = value.getComposition();
  assert.deepEqual(composition.entitlementPolicy, JSON.parse(env.INSIGNIA_M5_ENTITLEMENT_POLICY_JSON));
  const credential = await composition.credentials.acquire({ shopId: 'tenant', installationGeneration: '1' });
  assert.equal(credential.shopDomain, 'owned.myshopify.com');
  assert.equal(credential.kind, 'usable');
  const scope = { shopId: 'tenant', installationGeneration: '1', appClientId: 'synthetic-app' };
  assert.equal(await composition.artifactPorts.expectedBuild.read(scope), null);
  assert.equal(await composition.artifactPorts.trustedEvidence.read(scope), null);
  assert.equal(value.readers.length, 2);
  assert.equal(value.readers[0].expectedActiveAppVersionRef, '1163229200385');
  assert.equal(value.readers[0].scope.shopId, scope.shopId);
  assert.equal(value.readers[0].scope.installationGeneration, scope.installationGeneration);
  assert.equal(value.readers[0].scope.appClientId, scope.appClientId);
  assert.equal(await composition.artifactPorts.expectedBuild.read({ ...scope, appClientId: 'other' }), null);
  assert.equal(value.readers.length, 2);
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
    assert.equal(options.headers['x-shopify-access-token'], 'synthetic-partner-token');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body).variables, {
      appId: 'gid://shopify/App/7',
      shopId: 'gid://shopify/Shop/11',
    });
    return new Response(JSON.stringify({ data: { activeSubscription: null } }));
  };
  const expectedBuild = { schemaVersion: 2, syntheticBoundaryOnly: true };
  const attestation = { observedAt: '2000-01-01T00:00:00.000Z', expiresAt: '2000-01-01T00:00:30.000Z' };
  value.core.trustedReleaseRecords.read = async () => ({ expectedBuild, record: { attestation } });
  await createBuyerBootstrap(env, value.dependencies);
  const ports = value.getComposition();
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
  const input = controls.getComposition();
  const scope = { shopId: 'tenant', installationGeneration: '1', appClientId: 'synthetic-app' };
  assert.equal(await input.artifactPorts.expectedBuild.read(scope), null);
  assert.equal(controls.readers.at(-1).expectedActiveAppVersionRef, '1165513097217');
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
  const expectedBuild = { schemaVersion: 2, appVersionRef: '1165513097217' };
  const attestation = { observedAt: '2026-10-13T22:00:00.000Z', expiresAt: '2026-10-13T22:00:30.000Z' };
  const recordId = '22222222-2222-4222-8222-222222222222';
  let appended = false,
    collections = 0;
  value.core.trustedReleaseRecords.read = async () =>
    appended ? { expectedBuild, record: { recordId, attestation } } : null;
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
  const ports = value.getComposition().artifactPorts;
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
    assert.equal(await value.getComposition().artifactPorts.expectedBuild.read(scope), null);
    assert.equal(calls, remaining === 45000 ? 1 : 0);
  }
});

test('buyer release collection cannot survive authorization or installation drift', async () => {
  for (const drift of ['authorization', 'installation']) {
    const value = seam();
    let changed = false;
    const original = value.core.tenants.getActiveAuthorizationScope;
    value.core.tenants.getActiveAuthorizationScope = async (scope) => ({
      ...(await original(scope)),
      authorizationEpoch: changed && drift === 'authorization' ? 1 : 0,
    });
    value.core.tenants.getManagedInstallationState = async () => ({
      active: true,
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
      value.getComposition().artifactPorts.expectedBuild.read({
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
  assert.deepEqual(value.getComposition().entitlementPolicy, policy);
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
