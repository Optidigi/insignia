import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { parseReleaseVerificationRequest, resolveRuntimeReleaseProfile } from '@insignia/shopify';
import { APP_CLIENT_ID } from '../../../scripts/release/tenant-binding.mts';
import * as admission from '../dist/purchase-admission.js';
import { createPurchaseReleasePreparation } from '../dist/purchase-release.js';
import { durableCoreFixture } from './support/durable-core-fixture.mts';
import { orderFixture } from './support/order-fixture.mts';

const input = { appId: '123', appClientId: 'synthetic-client', releaseProfile: 'm8-cookie-91b35ab' as const };
const resolve = (changes: Partial<Parameters<typeof admission.resolveNativePurchaseQualification>[0]> = {}) =>
  admission.resolveNativePurchaseQualification({ ...input, ...changes });

test('each cart-line v3 theme binding resolves in the runtime and authorizes the exact release protocol target', () => {
  const directory = new URL('../../../deployment/m5-runtime/', import.meta.url);
  const supportedSource = resolveRuntimeReleaseProfile('native-cart-line-v3-aa3b6166').functionsSourceCommit;
  const bindingFiles = readdirSync(directory).filter((file) => /^native-.*-release-binding\.json$/.test(file));
  assert(bindingFiles.length > 0);
  for (const file of bindingFiles) {
    const binding = JSON.parse(readFileSync(new URL(file, directory), 'utf8'));
    if (binding.functionsSourceCommit !== supportedSource) continue;
    const profile = resolveRuntimeReleaseProfile(binding.versionTag);
    assert.equal(profile.activeVersionRef, binding.versionId, file);
    assert.equal(profile.functionsSourceCommit, binding.functionsSourceCommit, file);
    assert.equal(resolve({ releaseProfile: profile.name })?.activeVersionRef, binding.versionId, file);
    const request = {
      requestId: '11111111-1111-4111-8111-111111111111',
      deadlineMs: 1_795_520_000_000,
      expectedActiveAppVersionRef: binding.versionId,
      binding: {
        appClientId: APP_CLIENT_ID,
        shopId: 'synthetic-shop',
        installationGeneration: '1',
        authorizationGeneration: '11111111-1111-4111-8111-111111111111',
        authorizationEpoch: 0,
        externalInstallationId: 'gid://shopify/AppInstallation/1',
      },
    };
    assert.deepEqual(parseReleaseVerificationRequest(request, profile.activeVersionRef), request, file);
  }
});
function required<T>(value: T | undefined): T {
  assert(value !== undefined);
  return value;
}
const now = new Date('2026-10-14T20:20:00Z');
const untouched = new Proxy(
  {
    async acquire() {
      throw new Error('Unexpected credential acquisition');
    },
    async collect() {
      throw new Error('Unexpected release collection');
    },
  },
  {
    get() {
      throw new Error('Unqualified authority access');
    },
  },
);

test('observed native origin binds only the closed release profile and validated server identity', () => {
  const qualified = resolve();
  assert(qualified);
  assert.equal(qualified.activeVersionRef, '1166710865921');
  // The checkout channel and first supported order time; no store is pinned.
  assert.deepEqual(qualified.origin, {
    creatorAppId: 'gid://shopify/App/580111',
    supportedFrom: '2026-10-14T20:03:04Z',
  });
  assert.equal(qualified.appId, '123');
  assert.equal(qualified.appClientId, 'synthetic-client');
  assert.ok(Object.isFrozen(qualified));
  assert.ok(Object.isFrozen(qualified.origin));
  for (const releaseProfile of [
    'm5-functions-9c2e56b42fbf',
    'm8-read-orders-617057f',
    'm8-app-proxy-3d2a02e',
    'm8-theme-c8d8713',
  ] as const)
    assert.equal(resolve({ releaseProfile }), null);
  for (const appId of ['', '0', 'gid://shopify/App/123']) assert.equal(resolve({ appId }), null);
  for (const appClientId of ['', 'bad client', 'x'.repeat(129)]) assert.equal(resolve({ appClientId }), null);
});

for (const [releaseProfile, expectedVersion] of [
  ['native-escape-once-bcb6cd16', '1265289363457'],
  ['native-cart-repair-2ed66ade', '1265206460417'],
  ['native-sticky-keyboard-1127c3e2', '1264667197441'],
  ['native-market-dialog-fdd262ea', '1264361504769'],
  ['native-network-access-f57facc8', '1263405170689'],
  ['native-review-market-6967baed', '1263125463041'],
  ['native-scope60-9b677033', '1257303638017'],
  ['native-noallorders-fc8f9e08', '1248762724353'],
  ['native-batch-9b677033', '1234668191745'],
  ['native-names-b8616d2a', '1234277105665'],
  ['native-reinstall-eb2ce476', '1232902225921'],
  ['native-cartfix-3075eac9', '1227332452353'],
  ['native-uifix-565679f7', '1226879205377'],
  ['native-allorders-c0bb261a', '1225110192129'],
  ['native-scopes-e896db0a', '1222703742977'],
  ['native-designer-d2002a28', '1222232834049'],
  ['native-merchant-batch-a03b41ba', '1211378860033'],
  ['native-a11y-quantity-9b5dbdee', '1207622696961'],
  ['native-session-drafts-c78a8179', '1206211837953'],
  ['native-repair-messages-bf512171', '1205994881025'],
  ['native-buyer-fixes-fb436e16', '1205760688129'],
  ['native-canonical-host-aa3b6166', '1203782746113'],
  ['native-cart-line-v3-aa3b6166', '1202999689217'],
  ['native-functions-renew-8fffc9de', '1202733449217'],
  ['native-cart-repair-eb386d22', '1202503778305'],
  ['native-canonical-313b12ad', '1201385144321'],
  ['native-review-nav-8a7ee446', '1201192632321'],
  ['native-loading-defd05b0', '1201128341505'],
  ['native-review-cart-1f4595f', '1200729554945'],
  ['native-startup-771bb8f', '1200333160449'],
  ['native-recovery-e2c3dc5', '1199953805313'],
  ['native-speed-e52be93', '1199807692801'],
  ['native-performance-b2729a6', '1199754706945'],
  ['native-parity-466a687', '1199503441921'],
  ['native-behavior-6b6c15e', '1199244476417'],
  ['native-selected-fixed-81830c6', '1199166783489'],
  ['native-cart-fd9cc61', '1199122513921'],
  ['native-fixed-5c04fa8', '1198986199041'],
  ['native-theme-ced0143', '1198938357761'],
  ['m8-preview-28443bd', '1168157736961'],
  ['selected-ui-f48efa2', '1196974997505'],
  ['selected-ui-aab4a4b', '1197668466689'],
] as const)
  test(`${releaseProfile}: UI version transition keeps qualified origin but still requires independent release evidence`, async () => {
    const qualification = resolve({ releaseProfile });
    assert(qualification);
    assert.equal(qualification.activeVersionRef, expectedVersion);
    const previous = resolve();
    assert(previous);
    assert.deepEqual(qualification.origin, previous.origin);
    const port = admission.createProductionPurchaseAdmission({
      core: durableCoreFixture({
        tenants: {
          getActiveProviderScope: async (scope) => ({
            ...scope,
            shopDomain: 'synthetic.myshopify.com',
            shopifyShopId: '101',
          }),
        },
        trustedReleaseRecords: { read: async () => null },
      }),
      credentials: untouched,
      qualification,
      releaseProfile,
      clock: () => now,
    });
    assert.ok(port);
    const order = orderFixture({
      ...qualification.origin,
      createdAt: qualification.origin.supportedFrom,
      observedAt: now.toISOString(),
      checkoutOrigin: {
        creatorAppId: qualification.origin.creatorAppId,
        sourceName: 'web',
        checkoutTokenDigest: 'a'.repeat(64),
      },
    });
    assert.equal(await port.admit({ order }), null);
  });

test('native origin qualification never supplies missing independent release authority', async () => {
  const qualification = resolve();
  assert(qualification);
  const reads: Parameters<ReturnType<typeof durableCoreFixture>['trustedReleaseRecords']['read']>[0][] = [];
  const core = durableCoreFixture({
    tenants: {
      getActiveProviderScope: async (scope) => ({
        ...scope,
        shopDomain: 'synthetic.myshopify.com',
        shopifyShopId: '101',
      }),
    },
    trustedReleaseRecords: {
      read: async (request) => {
        reads.push(request);
        return null;
      },
    },
  });
  const port = admission.createProductionPurchaseAdmission({
    core,
    credentials: untouched,
    qualification,
    releaseProfile: input.releaseProfile,
    clock: () => now,
  });
  assert.ok(port);
  assert.ok(
    createPurchaseReleasePreparation({
      core,
      collector: untouched,
      qualification,
      releaseProfile: input.releaseProfile,
    }),
  );
  const order = orderFixture({
    ...qualification.origin,
    createdAt: '2026-10-14T20:03:04Z',
    observedAt: now.toISOString(),
    checkoutOrigin: {
      creatorAppId: qualification.origin.creatorAppId,
      sourceName: 'web',
      checkoutTokenDigest: 'a'.repeat(64),
    },
  });
  assert.equal(await port.admit({ order }), null);
  assert.equal(reads.length, 1);
  assert.equal(required(reads[0]).expectedActiveAppVersionRef, qualification.activeVersionRef);
  assert.equal(required(reads[0]).scope.appClientId, input.appClientId);
});

test('other installations, creator, ingress and pre-qualification history cannot use the observed origin', async () => {
  const qualification = resolve();
  assert(qualification);
  const baseline = durableCoreFixture({});
  const forbidden = {
    get() {
      throw new Error('Unqualified authority access');
    },
  };
  const core = {
    ...baseline,
    tenants: new Proxy(baseline.tenants, forbidden),
    trustedReleaseRecords: new Proxy(baseline.trustedReleaseRecords, forbidden),
  };
  const port = admission.createProductionPurchaseAdmission({
    core,
    credentials: untouched,
    qualification,
    releaseProfile: input.releaseProfile,
    clock: () => now,
  });
  const order = orderFixture({
    ...qualification.origin,
    createdAt: qualification.origin.supportedFrom,
    observedAt: now.toISOString(),
    checkoutOrigin: {
      creatorAppId: qualification.origin.creatorAppId,
      sourceName: 'web',
      checkoutTokenDigest: 'a'.repeat(64),
    },
  });
  assert(port);
  const origin = order.checkoutOrigin;
  assert(origin);
  for (const change of [
    { shopId: 'another-tenant' },
    { installationGeneration: '2' },
    { createdAt: '2026-10-14T20:03:03Z' },
    { checkoutOrigin: { ...origin, creatorAppId: 'gid://shopify/App/580112' } },
    { checkoutOrigin: { ...origin, sourceName: 'api' } },
    { checkoutOrigin: { ...origin, checkoutTokenDigest: null } },
  ])
    assert.equal(await port.admit({ order: orderFixture({ ...order, ...change }) }), null);
});
