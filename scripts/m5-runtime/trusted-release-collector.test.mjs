import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { qualifyReleaseAppendInput } from './release-append.mjs';
import { collectFreshTrustedRelease, recordPhaseName } from './trusted-release-collector.mjs';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { createFunctionOwnershipReconciler, FUNCTION_OWNERSHIP_QUERY } = await import(
  pathToFileURL(require.resolve('@insignia/shopify'))
);

const baseline = JSON.parse(
  await readFile(new URL('../../deployment/m5-runtime/native-function-module-baseline.json', import.meta.url)),
);
const versions = [
  '1163229200385',
  '1162611916801',
  '1158986629121',
  '1158837927937',
  '1153019904001',
  '1152880803841',
  '1146748534785',
].map((id, i) => ({
  versionId: `gid://shopify/Version/${id}`,
  versionTag: i ? `synthetic-inactive-${i}` : 'm5-functions-9c2e56b42fbf',
  status: i ? 'inactive' : 'active',
}));
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'trusted-release-collector-'));
  const config = {
    directory: join(root, recordPhaseName('11111111-1111-4111-8111-111111111111')),
    recordId: '11111111-1111-4111-8111-111111111111',
    operator: { user: 'insignia_release_append', password: 'a'.repeat(64) },
  };
  const time = Date.parse('2026-10-11T12:00:00.000Z');
  const binding = {
    shop: 'insignia-rewrite-dev.myshopify.com',
    tenantShopId: 'synthetic-tenant',
    installationGeneration: '1',
    shopId: 'gid://shopify/Shop/123',
    externalInstallationId: 'gid://shopify/AppInstallation/321',
    authorizationGeneration: '22222222-2222-4222-8222-222222222222',
    authorizationEpoch: 0,
  };
  const functions = {
    transform: 'present',
    validation: 'present',
    runtimeIdentity: 'unverifiable',
    readiness: 'unknown',
    observation: {
      shopId: binding.tenantShopId,
      installationGeneration: '1',
      appClientId: '1443cf6d03d39edae7c101a943c5c684',
      observedAt: new Date(time).toISOString(),
      transform: {
        functionId: 'synthetic-transform',
        handle: 'insignia-experimental-v2-transform',
        apiType: 'cart_transform',
        apiVersion: '2026-07',
        inputQuerySha256: '8d93a08697dd56e4aa3f857c3509e4d828a5f4195cb2e8cd878749c3e5729053',
      },
      validation: {
        functionId: 'synthetic-validation',
        handle: 'insignia-experimental-v2-validation',
        apiType: 'cart_checkout_validation',
        apiVersion: '2026-07',
        inputQuerySha256: 'a0cd5d7262514c134efc8e9ce964b25b877ce56fc10d0cba6bdd1af82f2dc8c5',
      },
    },
  };
  let appends = 0,
    acquisitions = 0;
  const ports = {
    now: () => time,
    readTenant: async () => ({ ...binding }),
    management: {
      async authenticate() {},
      async open(reserve) {
        for (const op of ['ActiveAppReleaseFromApiKey', 'AppVersions', 'AppVersionByTag']) await reserve(op);
        return {
          versions,
          totalResults: 7,
          moduleObservation: {
            appId: '429028933633',
            appClientId: '1443cf6d03d39edae7c101a943c5c684',
            versionId: '1163229200385',
            versionTag: 'm5-functions-9c2e56b42fbf',
            observedAt: new Date(time).toISOString(),
            modules: structuredClone(baseline),
          },
        };
      },
      async close(reserve) {
        await reserve('AppVersions');
        return { versions, totalResults: 7, observedAt: new Date(time).toISOString() };
      },
    },
    acquireToken: async () => {
      acquisitions++;
      return 'SYNTHETIC_ACCESS_TOKEN';
    },
    readInstallation: async () => ({
      shop: binding.shop,
      shopId: binding.shopId,
      installationId: binding.externalInstallationId,
      appId: '429028933633',
      appClientId: '1443cf6d03d39edae7c101a943c5c684',
      grants: [
        'write_products',
        'read_products',
        'read_publications',
        'read_product_listings',
        'read_cart_transforms',
        'read_validations',
        'write_cart_transforms',
        'write_validations',
      ],
    }),
    readFunctions: async () => structuredClone(functions),
    async append(input) {
      appends++;
      qualifyReleaseAppendInput(input, time);
      return {
        classification: 'TRUSTED_RELEASE_APPEND_ACK_RUNTIME_QUALIFIED',
        recordId: input.recordId,
        writeAttempted: true,
        writeAcknowledged: true,
      };
    },
  };
  return {
    root,
    config,
    ports,
    binding,
    functions,
    get appends() {
      return appends;
    },
    get acquisitions() {
      return acquisitions;
    },
    close: () => rm(root, { recursive: true, force: true }),
  };
}

test('v2 collector binds nullable native queries to independently read Active targets without altering observations', async () => {
  const f = await fixture();
  try {
    f.functions.observation.schemaVersion = 2;
    for (const kind of ['transform', 'validation']) {
      const item = f.functions.observation[kind];
      item.functionId = baseline.find((m) => m.handle === item.handle).registrationUuid;
      item.inputQuerySha256 = null;
    }
    const before = JSON.stringify(f.functions);
    const result = await collectFreshTrustedRelease(f.config, f.ports);
    assert.equal(result.classification, 'TRUSTED_RELEASE_COLLECT_APPEND_ACK');
    assert.equal(f.appends, 1);
    assert.equal(JSON.stringify(f.functions), before);
  } finally {
    await f.close();
  }
});

test('one original fresh observation set reaches unchanged append validation through durable reservations', async () => {
  const f = await fixture();
  try {
    const result = await collectFreshTrustedRelease(f.config, f.ports);
    assert.equal(result.classification, 'TRUSTED_RELEASE_COLLECT_APPEND_ACK');
    assert.equal(f.appends, 1);
    const receipt = await readFile(join(f.config.directory, 'observations.json'), 'utf8');
    assert.ok(!receipt.includes('SYNTHETIC_ACCESS_TOKEN') && !receipt.includes('a'.repeat(64)));
    assert.equal(JSON.parse(receipt).activeObservation.observedAt, '2026-10-11T12:00:00.000Z');
    assert.equal(
      (await collectFreshTrustedRelease(f.config, f.ports)).classification,
      'TRUSTED_RELEASE_COLLECT_NOT_RESUMABLE',
    );
    assert.equal(f.appends, 1);
  } finally {
    await f.close();
  }
});

test('original reconciler requires complete exact query-bound native deployments before append', async () => {
  for (const failure of [null, 'missing', 'duplicate', 'drift', 'partial']) {
    const f = await fixture();
    try {
      f.ports.readFunctions = async (_token, binding) => {
        const config = (handle) => baseline.find((m) => m.handle === handle).config;
        const functions = [
          {
            id: 'synthetic-transform',
            handle: f.functions.observation.transform.handle,
            appKey: f.functions.observation.appClientId,
            apiVersion: '2026-07',
            apiType: 'cart_transform',
            inputQuery: config(f.functions.observation.transform.handle).targets[0].input_query,
          },
          {
            id: 'synthetic-validation',
            handle: f.functions.observation.validation.handle,
            appKey: f.functions.observation.appClientId,
            apiVersion: '2026-07',
            apiType: 'cart_checkout_validation',
            inputQuery: config(f.functions.observation.validation.handle).targets[0].input_query,
          },
        ];
        if (failure === 'drift') functions[0].inputQuery = 'query SyntheticDrift { shop { id } }';
        if (failure === 'duplicate') functions.push({ ...functions[0] });
        const connection = (nodes) => ({ nodes, pageInfo: { hasNextPage: failure === 'partial' } });
        const body = {
          data: {
            shop: { id: binding.shopId },
            shopifyFunctions: connection(functions),
            cartTransforms: connection(
              failure === 'missing'
                ? []
                : [{ id: 'synthetic-deployment', functionId: functions[0].id, blockOnFailure: true }],
            ),
            validations: connection([
              {
                id: 'synthetic-validation-deployment',
                enabled: true,
                blockOnFailure: true,
                shopifyFunction: { id: functions[1].id, handle: functions[1].handle, appKey: functions[1].appKey },
              },
            ]),
          },
        };
        return createFunctionOwnershipReconciler({
          clock: () => new Date(f.ports.now()),
          transport: {
            async execute(input) {
              assert.equal(input.query, FUNCTION_OWNERSHIP_QUERY);
              assert.equal(input.operation, 'function_ownership');
              return { status: 200, body };
            },
          },
        }).read(
          {
            shopId: binding.tenantShopId,
            installationGeneration: binding.installationGeneration,
            appId: '429028933633',
            shopifyShopId: binding.shopId,
          },
          {
            appKey: f.functions.observation.appClientId,
            transformInputQuerySha256: f.functions.observation.transform.inputQuerySha256,
            validationInputQuerySha256: f.functions.observation.validation.inputQuerySha256,
          },
        );
      };
      const result = await collectFreshTrustedRelease(f.config, f.ports);
      assert.equal(
        result.classification,
        failure ? 'TRUSTED_RELEASE_COLLECT_STOPPED' : 'TRUSTED_RELEASE_COLLECT_APPEND_ACK',
      );
      assert.equal(f.appends, failure ? 0 : 1);
      if (failure) await assert.rejects(readFile(join(f.config.directory, 'observations.json')), { code: 'ENOENT' });
    } finally {
      await f.close();
    }
  }
});

test('module drift, incomplete versions, installation/generation drift and stale original time never append', async () => {
  for (const failure of ['module', 'versions', 'installation', 'generation', 'stale', 'same-function']) {
    const f = await fixture();
    try {
      if (failure === 'module' || failure === 'versions') {
        const original = f.ports.management.open;
        f.ports.management.open = async (reserve) => {
          const open = structuredClone(await original(reserve));
          if (failure === 'module') open.moduleObservation.modules[0].config.optional_scopes.push('read_orders');
          else open.totalResults = 8;
          return open;
        };
      }
      if (failure === 'installation')
        f.ports.readInstallation = async () => ({
          shop: f.binding.shop,
          shopId: f.binding.shopId,
          installationId: 'gid://shopify/AppInstallation/999',
          appId: '429028933633',
          appClientId: f.functions.observation.appClientId,
          grants: [],
        });
      if (failure === 'generation') {
        let reads = 0;
        f.ports.readTenant = async () => ({ ...f.binding, installationGeneration: ++reads > 1 ? '2' : '1' });
      }
      if (failure === 'stale') f.functions.observation.observedAt = '2026-10-11T11:59:30.000Z';
      if (failure === 'same-function')
        f.functions.observation.validation.functionId = f.functions.observation.transform.functionId;
      assert.equal(
        (await collectFreshTrustedRelease(f.config, f.ports)).classification,
        'TRUSTED_RELEASE_COLLECT_STOPPED',
      );
      assert.equal(f.appends, 0);
    } finally {
      await f.close();
    }
  }
});

test('an ambiguous append is durably stopped and a reserved phase cannot replay it', async () => {
  const f = await fixture();
  try {
    let attempts = 0;
    f.ports.append = async () => {
      attempts++;
      throw new Error('SYNTHETIC_PRIVATE_DATABASE_DETAIL');
    };
    const result = await collectFreshTrustedRelease(f.config, f.ports);
    assert.equal(result.ambiguousWrite, true);
    assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_DATABASE_DETAIL'));
    assert.equal(
      (await collectFreshTrustedRelease(f.config, f.ports)).classification,
      'TRUSTED_RELEASE_COLLECT_NOT_RESUMABLE',
    );
    assert.equal(attempts, 1);
  } finally {
    await f.close();
  }
});

test('an inactive candidate stops before acquiring an owner Admin token', async () => {
  const f = await fixture();
  try {
    const original = f.ports.management.open;
    f.ports.management.open = async (reserve) => {
      const opening = await original(reserve);
      return {
        ...opening,
        versions: opening.versions.map((v, i) => ({ ...v, status: i === 1 ? 'active' : 'inactive' })),
      };
    };
    assert.equal(
      (await collectFreshTrustedRelease(f.config, f.ports)).classification,
      'TRUSTED_RELEASE_COLLECT_STOPPED',
    );
    assert.equal(f.acquisitions, 0);
    assert.equal(f.appends, 0);
  } finally {
    await f.close();
  }
});

test('each settled owner intent has one UUID-bound budget and duplicate UUID or restart touches no ports', async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await collectFreshTrustedRelease(f.config, f.ports)).classification,
      'TRUSTED_RELEASE_COLLECT_APPEND_ACK',
    );
    const budget = JSON.parse(await readFile(join(f.config.directory, 'invocation.json'), 'utf8'));
    assert.deepEqual(budget, {
      version: 'm5-owner-collector-invocation-v1',
      recordId: f.config.recordId,
      sdkReadMethods: 4,
      ownerOAuthPosts: 1,
      ownerAdminSelectedReads: 3,
      appendCalls: 1,
      maximumDurationMs: 300000,
      sdkInternalHttpAttempts: 'NOT_ASSERTED',
      retryAuthorized: false,
    });
    let forbiddenCalls = 0;
    const forbidden = () => {
      forbiddenCalls++;
      throw new Error('RESTART_FORBIDDEN');
    };
    const noPorts = {
      now: forbidden,
      readTenant: forbidden,
      acquireToken: forbidden,
      readInstallation: forbidden,
      readFunctions: forbidden,
      append: forbidden,
      management: { authenticate: forbidden, open: forbidden, close: forbidden },
    };
    assert.equal(
      (await collectFreshTrustedRelease(f.config, noPorts)).classification,
      'TRUSTED_RELEASE_COLLECT_NOT_RESUMABLE',
    );
    assert.equal(forbiddenCalls, 0);
    const recordId = '33333333-3333-4333-8333-333333333333';
    const next = { ...f.config, recordId, directory: join(f.root, recordPhaseName(recordId)) };
    assert.equal(
      (await collectFreshTrustedRelease(next, f.ports)).classification,
      'TRUSTED_RELEASE_COLLECT_APPEND_ACK',
    );
    assert.equal(f.appends, 2);
    assert.equal(
      (await collectFreshTrustedRelease(next, noPorts)).classification,
      'TRUSTED_RELEASE_COLLECT_NOT_RESUMABLE',
    );
    assert.equal(forbiddenCalls, 0);
  } finally {
    await f.close();
  }
});

test('invalid UUID or directory escape stops before ports and does not reserve a phase', async () => {
  const f = await fixture();
  try {
    let forbiddenCalls = 0;
    const forbidden = () => {
      forbiddenCalls++;
      throw new Error('INVALID_INPUT_IO_FORBIDDEN');
    };
    const ports = { now: forbidden, readTenant: forbidden, management: { authenticate: forbidden } };
    for (const recordId of [
      '../escape',
      '11111111-1111-4111-8111-111111111111/escape',
      '11111111-1111-4111-8111-11111111111A',
      '00000000-0000-0000-0000-000000000000',
      null,
    ]) {
      assert.equal(
        (await collectFreshTrustedRelease({ ...f.config, recordId }, ports)).classification,
        'TRUSTED_RELEASE_COLLECT_STOPPED',
      );
    }
    assert.equal(
      (await collectFreshTrustedRelease({ ...f.config, directory: join(f.root, 'escape') }, ports)).classification,
      'TRUSTED_RELEASE_COLLECT_STOPPED',
    );
    assert.equal(forbiddenCalls, 0);
    await assert.rejects(readFile(join(f.config.directory, 'invocation.json')), { code: 'ENOENT' });
  } finally {
    await f.close();
  }
});
