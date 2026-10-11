import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import binding from '../../../../../deployment/m5-runtime/native-module-binding.json' with { type: 'json' };
import { reserveSigningProvisionRun } from '../../../../../scripts/m5-runtime/signing-provision.mjs';

export const acceptedRuntimeIdentity = {
  appClientId: binding.appClientId,
  appId: binding.appId,
  appOrigin: 'https://insignia-app.optidigi.nl',
};

const require = createRequire(new URL('../../../package.json', import.meta.url));
const app = await import(pathToFileURL(require.resolve('@insignia/application')));
const { createPublicationAdminAdapter } = await import(pathToFileURL(require.resolve('@insignia/shopify')));
const clockStart = Date.parse('2026-10-11T12:00:00.000Z');
export async function fixture({ initial = clockStart } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-signing-control-'));
  const scope = {
    shopId: 'synthetic-shop',
    installationGeneration: '1',
    authorizationGeneration: '11111111-1111-4111-8111-111111111111',
    authorizationEpoch: 0,
  };
  let current = initial,
    publicValue = null;
  const rows = [];
  const store = {
    async getActiveScope() {
      return scope;
    },
    async list() {
      return rows;
    },
    async createPending(x) {
      rows.push({ ...x, ...x.scope, id: x.keyId, state: 'pending' });
    },
    async activate(_, keyId) {
      for (const row of rows)
        if (row.id === keyId) row.state = 'active';
        else if (row.state === 'active') row.state = 'retiring';
    },
  };
  const identity = {
    async verify() {
      return {
        shop: 'insignia-rewrite-dev.myshopify.com',
        staffId: '1',
        sessionId: 'synthetic-session',
        expiresAtMs: initial + 60000,
      };
    },
    async exchangeOnline() {
      return {
        shop: 'insignia-rewrite-dev.myshopify.com',
        staffId: '1',
        accessToken: 'SYNTHETIC_ONLINE_SECRET',
        expiresAtMs: initial + 120000,
        appScopes: ['write_products', 'read_cart_transforms', 'read_validations'],
        userScopes: ['write_products'],
      };
    },
    async readInstallation() {
      return {
        shop: 'insignia-rewrite-dev.myshopify.com',
        shopId: 'gid://shopify/Shop/123',
        installationId: 'gid://shopify/AppInstallation/321',
        ianaTimezone: 'Asia/Tokyo',
        grantedScopes: ['write_products', 'read_cart_transforms', 'read_validations'],
      };
    },
  };
  const observed = {
    shopId: scope.shopId,
    installationGeneration: '1',
    appClientId: binding.appClientId,
    observedAt: new Date(initial).toISOString(),
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
  };
  const expected = {
    schemaVersion: 1,
    shopId: scope.shopId,
    installationGeneration: '1',
    appClientId: observed.appClientId,
    appVersionRef: '1162611916801',
    devPreviewRef: null,
    sourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
    transform: {
      ...observed.transform,
      wasmSha256: '49248769ae4ce578af7c5e7fa77f8c230c8fd4f45b2d673c22cfed87ff946576',
    },
    validation: {
      ...observed.validation,
      wasmSha256: '3193f60bbb29cdc473ce7ae73e88d1064ca7be2f03da2aade4e17ae1390366c6',
    },
  };
  const record = {
    record: {
      attestation: {
        ...expected,
        evidenceKind: 'RELEASE_BOUND',
        observedAt: observed.observedAt,
        expiresAt: new Date(initial + 30000).toISOString(),
      },
    },
    expectedBuild: expected,
  };
  const core = {
    signingKeys: store,
    tenants: {
      async getManagedInstallationState() {
        return {
          active: true,
          shopId: scope.shopId,
          currentGeneration: scope.installationGeneration,
          shopifyShopId: '123',
          externalInstallationId: 'gid://shopify/AppInstallation/321',
        };
      },
      async getActiveAuthorizationScope() {
        return { ...scope, shopDomain: 'insignia-rewrite-dev.myshopify.com', shopifyShopId: '123' };
      },
    },
    trustedReleaseRecords: {
      async read() {
        return record;
      },
    },
  };
  const requests = [];
  const transport = {
    async execute(x) {
      requests.push(x.operation);
      const value = () => ({
        owner: { id: 'gid://shopify/Shop/123' },
        namespace: `app--${binding.appId}`,
        key: 'insignia_public_config_v2',
        type: 'json',
        value: publicValue,
        compareDigest: 'a'.repeat(64),
      });
      if (x.operation === 'read_shop')
        return {
          status: 200,
          body: { data: { shop: { id: 'gid://shopify/Shop/123', field: publicValue === null ? null : value() } } },
        };
      publicValue = x.variables.metafields[0].value;
      return { status: 200, body: { data: { metafieldsSet: { userErrors: [], metafields: [value()] } } } };
    },
  };
  const ring = { currentKeyId: 'synthetic-wrap', keys: { 'synthetic-wrap': randomBytes(32) } };
  const plan = {
    keyId: 7,
    firstDay: app.localDay(new Date(initial), 'Asia/Tokyo').ordinal,
    lastDay: app.localDay(new Date(initial), 'Asia/Tokyo').ordinal + 2,
  };
  const journal = await reserveSigningProvisionRun(join(directory, 'run'), plan);
  const lifecycle = new app.SigningKeyLifecycle(store, ring);
  const ports = {
    app,
    core,
    identity,
    runtimeIdentity: acceptedRuntimeIdentity,
    ring,
    bindProvider: () => ({
      admin: createPublicationAdminAdapter({ transport }),
      observeFunctions: async () => ({ observation: observed }),
    }),
    journal,
    now: () => new Date(current),
  };
  return {
    plan,
    ports,
    rows,
    scope,
    requests,
    transport,
    identity,
    record,
    directory,
    lifecycle,
    observed,
    clock: (value) => {
      current = value;
    },
    publicValue: () => publicValue,
    setPublicValue: (value) => {
      publicValue = value;
    },
    async close() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}
