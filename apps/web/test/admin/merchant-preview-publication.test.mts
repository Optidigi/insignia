import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MerchantDraft } from '@insignia/contracts';
import type { DurableCore } from '@insignia/database';
import { createMerchantConfigService } from '../../src/server/merchant-config.ts';
import { fixtureCore } from './support/durable-core.mts';
import {
  adminActor,
  configRecord,
  fixtureTransaction,
  record,
  required,
  revisionRecord,
  unexpected,
} from './support/fixtures.mts';

// Explicit durable/provider boundary doubles: these tests prove service ordering
// and captured-draft fencing. PostgreSQL lock/binding authority remains in CI.
const actor = adminActor({
  tenantShopId: 'shop-1',
  shop: 'synthetic.myshopify.com',
  shopId: 'gid://shopify/Shop/1',
  installationGeneration: '1',
  staffId: 'staff-1',
  expiresAtMs: Date.now() + 60000,
});
const productId = 'gid://shopify/Product/555';
function draft(): MerchantDraft & { labels?: MerchantDraft['labels'] } {
  return {
    version: 'm5-merchant-draft-v1',
    mode: 'optional',
    shopCurrency: 'USD',
    methods: [{ id: 'print' }],
    placements: [{ id: 'front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true }],
    productionOptions: [],
    pricingRules: [],
    geometry: {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front-view',
          image: { revisionId: 'product_555', width: 800, height: 900 },
          variantImages: [],
          placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.3 } }],
        },
      ],
      steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5 }],
    },
  };
}
function fixture(
  capture: (input: {
    staff: typeof actor;
    request: Parameters<
      NonNullable<Parameters<typeof createMerchantConfigService>[0]['capturePublicationPreviews']>
    >[1];
    row: ReturnType<typeof configRecord> & { draftValue: MerchantDraft };
    retire(): void;
  }) => Promise<{ imageRevisionId: string; assetId: string }[]>,
) {
  let locked = false;
  let generation = '1';
  let completed: Awaited<ReturnType<DurableCore['commands']['lookup']>> = null;
  let digest = '';
  const revisions: Parameters<DurableCore['configs']['createValidatedRevision']>[1][] = [];
  const row = { ...configRecord({ shopId: actor.tenantShopId }), draftValue: draft() };
  const scope = () =>
    generation === actor.installationGeneration
      ? {
          shopId: actor.tenantShopId,
          installationGeneration: '1',
          authorizationGeneration: '11111111-1111-4111-8111-111111111111',
          authorizationEpoch: 0,
          shopDomain: actor.shop,
          shopifyShopId: '1',
        }
      : null;
  const core = fixtureCore({
    tenants: { getActiveAuthorizationScope: async () => scope(), lockActiveAuthorizationScope: async () => scope() },
    transactions: {
      async run(work) {
        locked = true;
        try {
          return await work(fixtureTransaction);
        } finally {
          locked = false;
        }
      },
    },
    commands: {
      lookup: async () => completed,
      reserve: async (_tx, input) => {
        digest = input.requestDigest;
        return { kind: 'reserved' };
      },
      async complete(_tx, _identity, resultRef) {
        completed = { requestDigest: digest, status: 'completed', resultRef };
      },
    },
    configs: {
      getConfig: async () => row,
      getConfigForUpdate: async () => row,
      getCurrentPublication: async () => null,
      getCurrentPublicationInTransaction: async () => null,
      getAvailabilityRecovery: async () => null,
      getAvailabilityRecoveryInTransaction: async () => null,
      async createValidatedRevision(_tx, value) {
        revisions.push(value);
        return revisionRecord({
          shopId: value.shopId,
          configId: value.configId,
          revisionId: value.revisionId,
          publishedValue: value.publishedValue,
        });
      },
      setCurrentPublicationPointer: async () => {},
      getRevisionSourceScope: async () => ({ draftVersion: '2', installationGeneration: '1' }),
      getValidatedPublishedRevision: async () => {
        const revision = required(revisions[0]);
        return {
          ...revisionRecord({ shopId: row.shopId, configId: row.configId }),
          publishedValue: { ...record(revision.publishedValue), revisionContentHash: '0'.repeat(64) },
        };
      },
      getRevisionGeometry: async () => ({
        version: 'm5-geometry-v1',
        contentHash: 'a'.repeat(64),
        mode: 'optional',
        value: required(revisions[0]).geometry.value,
      }),
    },
    outbox: { add: async () => 'synthetic-outbox-id' },
  });
  const service = createMerchantConfigService({
    core,
    catalog: {
      get: async () => ({ id: productId, title: 'Synthetic', status: 'ACTIVE', imageUrl: null, variants: [] }),
      shopCurrency: async () => 'USD',
    },
    eligibility: async () => ({ allowed: true, reason: null }),
    capturePublicationPreviews: async (staff, request) => {
      assert.equal(locked, false, 'inspection/storage must run outside command transaction');
      return capture({
        staff,
        request,
        row,
        retire: () => {
          generation = '2';
        },
      });
    },
    publication: () => ({
      advance: unexpected,
      prepare: async () => {
        throw new Error('settled intent; provider deliberately unavailable');
      },
    }),
  });
  return { service, revisions, row };
}
const request = { configId: 'config-1', draftVersion: '2', idempotencyKey: 'publish-preview' };
test('publication atomically binds prepared previews and completed intent replay never recaptures', async () => {
  let captures = 0;
  const binding = [{ imageRevisionId: 'product_555', assetId: 'a53f9809-0ffe-4fd6-a23e-89111b1929a8' }];
  const { service, revisions } = fixture(async ({ staff, request: captured }) => {
    captures++;
    assert.equal(staff, actor);
    assert.equal(captured.productId, productId);
    assert.deepEqual({ ...captured, draft: undefined }, { ...request, productId, draft: undefined });
    assert.deepEqual(captured.draft, draft());
    return binding;
  });
  await assert.rejects(service.publish(actor, productId, request), /settled intent/);
  assert.equal(captures, 1);
  assert.deepEqual(required(revisions[0]).previewAssets, binding);
  await assert.rejects(service.publish(actor, productId, request), /settled intent/);
  assert.equal(captures, 1);
  assert.equal(revisions.length, 1);
  assert.equal((await service.publish(actor, productId, { ...request, draftVersion: '3' })).kind, 'conflict');
  assert.equal(captures, 1);
});

test('a draft changed during capture cannot bind even if the capture hook changes its received snapshot', async () => {
  const { service, revisions } = fixture(async ({ request: captured, row }) => {
    row.draftValue.labels = { methods: { print: 'Changed while inspecting' } };
    captured.draft.labels = structuredClone(row.draftValue.labels);
    return [{ imageRevisionId: 'product_555', assetId: 'a53f9809-0ffe-4fd6-a23e-89111b1929a8' }];
  });
  assert.equal((await service.publish(actor, productId, request)).kind, 'conflict');
  assert.equal(revisions.length, 0);
});

test('a new draft version or retired installation after capture prevents publication intent', async () => {
  for (const change of ['version', 'installation']) {
    const { service, revisions } = fixture(async ({ row, retire }) => {
      if (change === 'version') row.draftVersion = '3';
      else retire();
      return [];
    });
    if (change === 'version') assert.equal((await service.publish(actor, productId, request)).kind, 'conflict');
    else await assert.rejects(service.publish(actor, productId, request), /Current tenant installation required/);
    assert.equal(revisions.length, 0);
  }
});

test('failed capture leaves no durable intent and an already stale draft never captures', async () => {
  let captures = 0;
  const { service, revisions } = fixture(async () => {
    captures++;
    throw new Error('explicit unresolved capture');
  });
  assert.equal((await service.publish(actor, productId, { ...request, draftVersion: '1' })).kind, 'conflict');
  assert.equal(captures, 0);
  await assert.rejects(service.publish(actor, productId, request), /explicit unresolved capture/);
  assert.equal(revisions.length, 0);
});
