import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MerchantPreviewRecord } from '@insignia/application';
import {
  getVariantPhotoGroups,
  MerchantDraftSchema,
  MerchantPresentationSchema,
  type SelectedProductSetup,
} from '@insignia/contracts';
import { type DurableCore, sha256CanonicalJson } from '@insignia/database';
import { type GeometryV1, validateGeometry } from '@insignia/visualizer/geometry';
import { createMerchantConfigService } from '../../src/server/merchant-config.ts';
import { selectedProductDraft } from '../../src/server/selected-product.ts';
import { fixtureCore } from './support/durable-core.mts';
import { adminActor, configRecord, fixtureTransaction, required, revisionRecord } from './support/fixtures.mts';

const actor = adminActor({
  tenantShopId: 'shop-1',
  shop: 'synthetic.myshopify.com',
  shopId: 'gid://shopify/Shop/1',
  installationGeneration: '1',
});
const productId = 'gid://shopify/Product/555';
const source = { id: 'product_555', url: 'https://cdn.shopify.com/front.jpg', width: 800, height: 900, alt: 'Front' };
const alternate = { id: 'image_5552', url: 'https://cdn.shopify.com/black.jpg', width: 800, height: 900, alt: 'Black' };
const sourceAsset = 'a53f9809-0ffe-4fd6-a23e-89111b1929a8',
  alternateAsset = 'b53f9809-0ffe-4fd6-a23e-89111b1929a8';
const bindings = [
  { imageRevisionId: source.id, assetId: sourceAsset },
  { imageRevisionId: alternate.id, assetId: alternateAsset },
];
function setup(): SelectedProductSetup {
  const value: SelectedProductSetup = {
    version: 'selected-product-setup-v1',
    methodBindings: {},
    product: {
      id: productId,
      title: 'Shirt',
      images: [source, alternate],
      methods: [{ id: 'print', name: 'Print', pricing: 'fixed', amount: '3.50' }],
      views: [
        {
          id: 'front-view',
          name: 'Front',
          imageUrl: source.url,
          imageWidth: 800,
          imageHeight: 900,
          calibration: {
            imageUrl: source.url,
            imageWidth: 800,
            imageHeight: 900,
            a: { x: 0.2, y: 0.5 },
            b: { x: 0.8, y: 0.5 },
            distanceCm: 30,
          },
          placements: [
            {
              id: 'front',
              name: 'Chest',
              rect: { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.3 },
              widthCm: '',
              heightCm: '',
              methodIds: ['print'],
              sizes: [{ id: 'small', name: 'Small', widthPercent: '100', prices: {} }],
              logoLaterAllowed: true,
              customPlacementAllowed: false,
            },
          ],
        },
      ],
      variantPhotos: {
        options: [{ id: 'color-option', name: 'Color', values: [{ id: 'Black', label: 'Black' }] }],
        variants: [
          { id: 'gid://shopify/ProductVariant/5551', label: 'Black', optionValues: { 'color-option': 'Black' } },
        ],
        groupingOptionIds: ['color-option'],
        assignments: [],
      },
    },
  };
  const group = required(getVariantPhotoGroups(value.product)[0]);
  value.product.variantPhotos!.assignments = [{ groupKey: group.key, viewId: 'front-view', imageId: alternate.id }];
  return value;
}
function fixture(
  options: {
    capture?: boolean;
    returned?: typeof bindings;
    row?: (row: MerchantPreviewRecord) => MerchantPreviewRecord;
    legacy?: boolean;
  } = {},
) {
  const sequence: string[] = [];
  let epoch = 0;
  let captureCalls = 0;
  let providerCalls = 0;
  let preparationCalls = 0;
  let completed: Awaited<ReturnType<DurableCore['commands']['lookup']>> = null;
  let digest = '';
  let frozenAvailable = true;
  let captureHook: (() => void) | undefined;
  let prepareHook: (() => void) | undefined;
  const scope = () => ({
    shopId: actor.tenantShopId,
    installationGeneration: '1',
    authorizationGeneration: '11111111-1111-4111-8111-111111111111',
    authorizationEpoch: epoch,
    shopDomain: actor.shop,
    shopifyShopId: '1',
  });
  const draft = selectedProductDraft(
    setup(),
    MerchantDraftSchema.parse({
      version: 'm5-merchant-draft-v1',
      mode: 'required',
      shopCurrency: 'USD',
      methods: [],
      placements: [],
      productionOptions: [],
      pricingRules: [],
      geometry: { version: 'm5-geometry-v1', views: [{ id: 'empty', placements: [], variantImages: [] }], steps: [] },
    }),
  );
  if (options.legacy) delete draft.selectedSetup;
  const row = configRecord({ draftValue: draft });
  const revisions: Parameters<DurableCore['configs']['createValidatedRevision']>[1][] = [];
  function asset(binding: (typeof bindings)[number]): MerchantPreviewRecord {
    const now = new Date();
    const value: MerchantPreviewRecord = {
      ...binding,
      shopId: actor.tenantShopId,
      installationGeneration: '1',
      productId: '555',
      originalKey: `originals/merchant-previews/${actor.tenantShopId}/1/${binding.assetId}`,
      previewKey: `previews/merchant-previews/${actor.tenantShopId}/1/${binding.assetId}.png`,
      manifest: {
        version: 'm6-inspection-v1',
        mimeType: 'image/png',
        sha256: 'a'.repeat(64),
        previewSha256: 'b'.repeat(64),
        byteLength: 10,
        previewByteLength: 10,
        width: 800,
        height: 900,
      },
      collectedAt: now,
      abandonAt: new Date(+now + 7 * 86400000),
      state: 'USABLE',
      claimId: null,
    };
    return options.row ? options.row(value) : value;
  }
  const core = fixtureCore({
    tenants: { getActiveAuthorizationScope: async () => scope(), lockActiveAuthorizationScope: async () => scope() },
    transactions: { run: async (work) => work(fixtureTransaction) },
    commands: {
      lookup: async () => completed,
      reserve: async (_tx, value) => {
        digest = value.requestDigest;
        return { kind: 'reserved' };
      },
      complete: async (_tx, _command, resultRef) => {
        completed = { status: 'completed', requestDigest: digest, resultRef };
      },
    },
    merchantPreviews: {
      get: async (_scope, id) => {
        sequence.push(`read:${id}`);
        const binding = bindings.find((binding) => binding.assetId === id);
        return binding ? asset(binding) : null;
      },
      getForRevision: async () => (frozenAvailable ? bindings.map(asset) : []),
    },
    configs: {
      getConfig: async () => row,
      getConfigForUpdate: async () => row,
      getCurrentPublication: async () => null,
      getCurrentPublicationInTransaction: async () => null,
      getAvailabilityRecovery: async () => null,
      getAvailabilityRecoveryInTransaction: async () => null,
      createValidatedRevision: async (_tx, value) => {
        sequence.push('revision');
        revisions.push(value);
        return revisionRecord({ revisionId: value.revisionId, publishedValue: value.publishedValue });
      },
      setCurrentPublicationPointer: async () => {},
      getRevisionSourceScope: async () => ({ draftVersion: '2', installationGeneration: '1' }),
      getValidatedPublishedRevision: async () => {
        const value = required(revisions[0]);
        return revisionRecord({
          publishedValue: { ...(value.publishedValue as object), revisionContentHash: '0'.repeat(64) },
        });
      },
      getRevisionPresentation: async () => MerchantPresentationSchema.parse(required(revisions[0]).presentation),
      getRevisionGeometry: async () => ({
        version: 'm5-geometry-v1',
        contentHash: 'a'.repeat(64),
        mode: 'required',
        value: required(revisions[0]).geometry.value,
      }),
    },
    outbox: { add: async () => 'outbox' },
  });
  const service = createMerchantConfigService({
    core,
    catalog: {
      get: async () => ({
        id: productId,
        title: 'Shirt',
        status: 'ACTIVE',
        imageUrl: source.url,
        images: [source, alternate],
        options: [{ id: 'color-option', name: 'Color', values: ['Black'] }],
        variants: [
          {
            id: 'gid://shopify/ProductVariant/5551',
            title: 'Black',
            imageUrl: alternate.url,
            selectedOptions: [{ name: 'Color', value: 'Black' }],
          },
        ],
      }),
      shopCurrency: async () => 'USD',
    },
    eligibility: async () => ({ allowed: true, reason: null }),
    preparePublication: async () => {
      sequence.push('prepare');
      preparationCalls++;
      prepareHook?.();
      return { ready: true, reason: null };
    },
    ...(options.capture === false
      ? {}
      : {
          capturePublicationPreviews: async () => {
            sequence.push('capture');
            captureCalls++;
            captureHook?.();
            return options.returned ?? bindings;
          },
        }),
    publication: () => ({
      advance: async () => {
        throw new Error('Unexpected advance');
      },
      prepare: async () => {
        providerCalls++;
        throw new Error('Provider boundary deliberately unavailable');
      },
    }),
  });
  return {
    service,
    row,
    revisions,
    sequence,
    request: {
      configId: 'config-1',
      draftVersion: '2',
      idempotencyKey: 'selected-publication',
      authority: sha256CanonicalJson(scope()),
    },
    stats: () => ({ captureCalls, providerCalls, preparationCalls }),
    onCapture: (hook: () => void) => {
      captureHook = hook;
    },
    onPrepare: (hook: () => void) => {
      prepareHook = hook;
    },
    changeEpoch: () => {
      epoch++;
    },
    loseFrozen: () => {
      frozenAvailable = false;
    },
  };
}
test('selected publication without qualified capture never prepares provider resources or creates an intent', async () => {
  const f = fixture({ capture: false });
  await assert.rejects(f.service.publish(actor, productId, f.request), /customer previews/);
  assert.deepEqual(f.stats(), { captureCalls: 0, providerCalls: 0, preparationCalls: 0 });
  assert.equal(f.revisions.length, 0);
});
test('partial, duplicate, extra or misbound capture cannot publish selected image and variant-image references', async () => {
  for (const returned of [
    [],
    bindings.slice(0, 1),
    [bindings[0]!, bindings[0]!],
    [...bindings, { imageRevisionId: 'unused', assetId: 'c53f9809-0ffe-4fd6-a23e-89111b1929a8' }],
  ]) {
    const f = fixture({ returned });
    await assert.rejects(f.service.publish(actor, productId, f.request), /customer previews/);
    assert.equal(f.stats().preparationCalls, 0);
    assert.equal(f.stats().providerCalls, 0);
    assert.equal(f.revisions.length, 0);
  }
  for (const row of [
    (value: MerchantPreviewRecord) => ({ ...value, shopId: 'foreign' }),
    (value: MerchantPreviewRecord) => ({ ...value, state: 'WRITING' as const }),
    (value: MerchantPreviewRecord) => ({
      ...value,
      manifest: value.manifest ? { ...value.manifest, width: 799 } : null,
    }),
  ]) {
    const f = fixture({ row });
    await assert.rejects(f.service.publish(actor, productId, f.request), /customer previews/);
    assert.equal(f.stats().preparationCalls, 0);
    assert.equal(f.revisions.length, 0);
  }
});
test('complete selected capture precedes provider preparation and replay uses frozen coverage without recapture', async () => {
  const f = fixture();
  await assert.rejects(f.service.publish(actor, productId, f.request), /Provider boundary/);
  assert.equal(f.revisions.length, 1);
  assert.deepEqual(f.revisions[0]?.previewAssets, bindings);
  assert(f.sequence.indexOf('capture') < f.sequence.indexOf('prepare'));
  assert(f.sequence.indexOf(`read:${alternateAsset}`) < f.sequence.indexOf('prepare'));
  await assert.rejects(f.service.publish(actor, productId, f.request), /Provider boundary/);
  assert.deepEqual(f.stats(), { captureCalls: 1, providerCalls: 2, preparationCalls: 1 });
  f.loseFrozen();
  await assert.rejects(f.service.publish(actor, productId, f.request), /customer previews/);
  assert.equal(f.stats().providerCalls, 2);
});
test('a new publication of an older draft cannot bypass complete customer preview capture', async () => {
  const f = fixture({ legacy: true, capture: false });
  await assert.rejects(f.service.publish(actor, productId, f.request), /customer previews/);
  assert.equal(f.revisions.length, 0);
  assert.deepEqual(f.stats(), { captureCalls: 0, providerCalls: 0, preparationCalls: 0 });
});

test('an older draft needs actual production dimensions before a new publication can prepare any effects', async () => {
  const f = fixture({ legacy: true });
  const draft = MerchantDraftSchema.parse(f.row.draftValue);
  const geometry = validateGeometry(draft.geometry as GeometryV1);
  for (const step of geometry.steps) delete step.physicalMm;
  draft.geometry = geometry;
  f.row.draftValue = draft;
  const result = await f.service.publish(actor, productId, f.request);
  assert.equal(result.kind, 'invalid');
  assert.equal(result.noEffect, true);
  assert.match(result.message ?? '', /production dimensions/i);
  assert.equal(f.revisions.length, 0);
  assert.deepEqual(f.stats(), { captureCalls: 0, providerCalls: 0, preparationCalls: 0 });
});

test('selected capture and technical preparation cannot bypass changed authorization or draft fences', async () => {
  for (const stage of ['capture', 'prepare'] as const) {
    const f = fixture();
    if (stage === 'capture') f.onCapture(f.changeEpoch);
    else f.onPrepare(f.changeEpoch);
    await assert.rejects(f.service.publish(actor, productId, f.request), /authority changed/);
    assert.equal(f.revisions.length, 0);
    assert.equal(f.stats().providerCalls, 0);
    if (stage === 'capture') assert.equal(f.stats().preparationCalls, 0);
  }
  const changed = fixture();
  changed.onCapture(() => {
    changed.row.draftVersion = '3';
  });
  assert.equal((await changed.service.publish(actor, productId, changed.request)).kind, 'conflict');
  assert.equal(changed.stats().preparationCalls, 0);
  assert.equal(changed.revisions.length, 0);
});

test('completed publication replay ignores a newer editable Method review and preserves its original immutable revision', async () => {
  const f = fixture();
  await assert.rejects(f.service.publish(actor, productId, f.request), /Provider boundary/);
  const frozen = structuredClone(f.revisions);
  const newer = MerchantDraftSchema.parse(f.row.draftValue);
  required(newer.selectedSetup).methodBindings.print = {
    catalogMethodId: '1f71601e-a80b-42cd-b278-d8c135c2ad10',
    observedVersion: '9',
    name: { source: 'catalog', value: 'Print' },
    explanation: { source: 'catalog', value: '' },
    translations: {},
    prices: { default: { source: 'catalog', value: '9.00' } },
    review: { reason: 'unassigned', catalogVersion: '9', decision: 'pending' },
  };
  f.row.draftValue = newer;
  f.row.draftVersion = '3';
  // The fixture intentionally has no mutable Method-catalogue port. Consulting
  // the new editable review rather than the original receipt fails this replay.
  await assert.rejects(f.service.publish(actor, productId, f.request), /Provider boundary/);
  assert.deepEqual(f.revisions, frozen);
  assert.equal(f.row.draftVersion, '3');
  assert.deepEqual(f.row.draftValue, newer);
  assert.deepEqual(f.stats(), { captureCalls: 1, providerCalls: 2, preparationCalls: 1 });
});
