import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MerchantDraftSchema, type MethodDraftBinding, SelectedProductSetupSchema } from '@insignia/contracts';
import { CONFIG_DRAFT_STORAGE_VERSION, createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { createMethodLibrary } from '../../src/server/admin/methods.ts';
import { reconcileSelectedMethodSetup } from '../../src/server/selected-method-reconciliation.ts';
import { selectedProductDraft, selectedPublicationProblems } from '../../src/server/selected-product.ts';
import { adminActor } from './support/fixtures.mts';

const source = MerchantDraftSchema.parse({
  version: 'm5-merchant-draft-v1',
  mode: 'required',
  shopCurrency: 'USD',
  methods: [],
  placements: [],
  productionOptions: [],
  pricingRules: [],
  geometry: {},
});
const field = (value: string, source: 'catalog' | 'product' = 'catalog') => ({ value, source });
function setup(catalogId: string) {
  const binding: MethodDraftBinding = {
    catalogMethodId: catalogId,
    observedVersion: '1',
    name: field('Print'),
    explanation: field('Product-specific instructions', 'product'),
    translations: {},
    prices: {
      default: field('3.50'),
      '["chest","small"]': field('3.50', 'product'),
      '["chest","large"]': field('3.50'),
    },
    review: null,
  };
  return SelectedProductSetupSchema.parse({
    version: 'selected-product-setup-v1',
    methodBindings: { print: binding },
    product: {
      id: 'gid://shopify/Product/111',
      title: 'Shirt',
      images: [{ id: 'product_111', url: 'https://cdn.shopify.com/front.jpg', width: 1000, height: 1200, alt: '' }],
      methods: [
        { id: 'print', name: 'Print', explanation: 'Product-specific instructions', pricing: 'product', amount: '' },
      ],
      views: [
        {
          id: 'front',
          name: 'Front',
          imageUrl: 'https://cdn.shopify.com/front.jpg',
          imageWidth: 1000,
          imageHeight: 1200,
          placements: [
            {
              id: 'chest',
              name: 'Chest',
              rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 },
              widthCm: '10',
              heightCm: '12',
              methodIds: ['print'],
              logoLaterAllowed: true,
              sizes: [
                { id: 'small', name: 'Small', widthPercent: '50', prices: { print: '3.50' } },
                { id: 'large', name: 'Large', widthPercent: '100', prices: { print: '3.50' } },
              ],
            },
          ],
        },
      ],
    },
  });
}
test('selected propagation preserves per-cell and text overrides without flattening them into a global fixed price', () => {
  const id = randomUUID();
  const next = reconcileSelectedMethodSetup(
    setup(id),
    id,
    {
      configuration: {
        id,
        name: 'Printing',
        explanation: 'Global instructions',
        pricing: 'fixed',
        amount: '4.00',
        assignment: 'manual',
        productIds: ['111'],
        tags: [],
        tagMatch: 'any',
      },
      version: '2',
      currency: 'USD',
    },
    true,
    'USD',
  );
  assert.equal(next.product.methods[0]?.pricing, 'product');
  assert.equal(next.product.methods[0]?.name, 'Printing');
  assert.equal(next.product.methods[0]?.explanation, 'Product-specific instructions');
  assert.deepEqual(
    next.product.views[0]?.placements[0]?.sizes.map((size) => size.prices.print),
    ['3.50', '4.00'],
  );
});

test('a global Method save updates durable inherited drafts once, gates removed assignments, and leaves published history unchanged', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
  const tenant = randomUUID();
  const actor = adminActor({
    tenantShopId: tenant,
    shop: `inherit-${tenant}.myshopify.com`,
    shopId: `gid://shopify/Shop/${BigInt(`0x${tenant.replaceAll('-', '').slice(0, 12)}`)}`,
    installationGeneration: '1',
    canRead: true,
    canEdit: true,
  });
  const methodId = randomUUID();
  const configId = randomUUID();
  const revisionId = randomUUID();
  const value = {
    id: methodId,
    name: 'Print',
    explanation: 'Global',
    pricing: 'fixed' as const,
    amount: '3.50',
    assignment: 'manual' as const,
    productIds: ['111'],
    tags: [],
    tagMatch: 'any' as const,
  };
  try {
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, {
        shopId: tenant,
        shopDomain: actor.shop,
        shopifyShopId: actor.shopId.split('/').at(-1),
      }),
    );
    let tagReads = 0;
    const methods = createMethodLibrary(core, {
      currency: async () => 'USD',
      productTags: async (current, productIds) => {
        assert.equal(current.tenantShopId, tenant);
        assert.deepEqual(productIds, ['111']);
        tagReads++;
        return { '111': ['shirts'] };
      },
    });
    assert.ok(methods.saveConfiguration);
    assert.equal((await methods.saveConfiguration(actor, value, null, 'inherit-create')).kind, 'created');
    const draft = selectedProductDraft(setup(methodId), source);
    await core.transactions.run(async (tx) => {
      await core.configs.createConfig(tx, {
        shopId: tenant,
        configId,
        externalProductId: '111',
        draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
        draftValue: draft,
      });
      await core.configs.createValidatedRevision(tx, {
        shopId: tenant,
        configId,
        revisionId,
        publishedValue: {
          version: 'm2-published-config-v1',
          shopId: tenant,
          productId: '111',
          revisionId,
          shopCurrency: 'USD',
          methods: draft.methods,
          placements: draft.placements,
          pricingRules: draft.pricingRules,
          productionOptions: [],
        },
        geometry: { version: 'm5-geometry-v1', value: draft.geometry },
        presentation: { version: 'm5-presentation-v1', labels: draft.labels ?? {}, selectedSetup: draft.selectedSetup },
        sourceDraftVersion: '1',
        sourceInstallationGeneration: '1',
        mode: 'required',
        createdByRef: actor.staffId,
      });
    });
    const frozen = await core.configs.getRevision(tenant, revisionId);
    const change = { ...value, name: 'Printing', amount: '4.00' };
    await assert.rejects(
      methods.saveConfiguration(actor, change, '1', 'inherit-wrong-authority', '0'.repeat(64)),
      /authorization changed/,
    );
    assert.equal((await core.configs.getConfig(tenant, configId))?.draftVersion, '1');
    assert.equal((await methods.saveConfiguration(actor, change, '1', 'inherit-update')).kind, 'saved');
    let record = await core.configs.getConfig(tenant, configId);
    assert.ok(record);
    assert.equal(record.draftVersion, '2');
    let updated = MerchantDraftSchema.parse(record.draftValue);
    assert.deepEqual(
      updated.selectedSetup?.product.views[0]?.placements[0]?.sizes.map((size) => size.prices.print),
      ['3.50', '4.00'],
    );
    assert.equal(updated.selectedSetup?.product.methods[0]?.explanation, 'Product-specific instructions');
    assert.deepEqual(await core.configs.getRevision(tenant, revisionId), frozen);
    await methods.saveConfiguration(actor, change, '1', 'inherit-update');
    assert.equal((await core.configs.getConfig(tenant, configId))?.draftVersion, '2');
    assert.equal(
      (await methods.saveConfiguration(actor, { ...change, productIds: [] }, '2', 'inherit-unassign')).kind,
      'saved',
    );
    record = await core.configs.getConfig(tenant, configId);
    assert.ok(record);
    updated = MerchantDraftSchema.parse(record.draftValue);
    assert.equal(updated.selectedSetup?.methodBindings.print?.review?.decision, 'pending');
    assert.ok(selectedPublicationProblems(updated).some((problem) => problem.includes('Review the unassigned')));
    const matched = { ...change, assignment: 'tags' as const, productIds: [], tags: ['shirts'] };
    assert.equal((await methods.saveConfiguration(actor, matched, '3', 'inherit-tag-match')).kind, 'saved');
    record = await core.configs.getConfig(tenant, configId);
    assert.ok(record);
    assert.equal(MerchantDraftSchema.parse(record.draftValue).selectedSetup?.methodBindings.print?.review, null);
    const mismatched = { ...matched, tags: ['hoodie'] };
    assert.equal((await methods.saveConfiguration(actor, mismatched, '4', 'inherit-tag-mismatch')).kind, 'saved');
    assert.equal((await methods.saveConfiguration(actor, mismatched, '4', 'inherit-tag-mismatch')).kind, 'saved');
    assert.equal(tagReads, 2, 'An exact replay does not depend on another provider read');
    record = await core.configs.getConfig(tenant, configId);
    assert.ok(record);
    assert.equal(
      MerchantDraftSchema.parse(record.draftValue).selectedSetup?.methodBindings.print?.review?.reason,
      'unassigned',
    );
    assert.equal((await methods.delete(actor, methodId, '5', 'inherit-delete')).kind, 'deleted');
    record = await core.configs.getConfig(tenant, configId);
    assert.ok(record);
    updated = MerchantDraftSchema.parse(record.draftValue);
    assert.equal(updated.selectedSetup?.product.methods[0]?.name, 'Printing');
    assert.equal(updated.selectedSetup?.methodBindings.print?.review?.reason, 'deleted');
    const retained = record.draftValue;
    const retainedVersion = record.draftVersion;
    assert.equal(
      (
        await methods.saveConfiguration(
          actor,
          { ...value, name: 'Reused ID', amount: '9.00' },
          null,
          'inherit-recreate-deleted',
        )
      ).kind,
      'conflict',
    );
    const afterRecreate = await core.configs.getConfig(tenant, configId);
    assert.deepEqual(afterRecreate?.draftValue, retained);
    assert.equal(afterRecreate?.draftVersion, retainedVersion);
    await assert.rejects(
      (async () => {
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        try {
          await pool.query('UPDATE method_catalog SET deleted_at=NULL WHERE shop_id=$1 AND method_id=$2', [
            tenant,
            methodId,
          ]);
        } finally {
          await pool.end();
        }
      })(),
      { code: '23514' },
    );
    assert.deepEqual(await core.configs.getRevision(tenant, revisionId), frozen);
  } finally {
    await core.close();
  }
});

test('catalogue prices in a different currency never reinterpret existing draft amounts', () => {
  const id = randomUUID();
  const original = setup(id);
  const next = reconcileSelectedMethodSetup(
    original,
    id,
    {
      configuration: {
        id,
        name: 'Printing',
        explanation: 'Global instructions',
        pricing: 'fixed',
        amount: '4.00',
        assignment: 'manual',
        productIds: ['111'],
        tags: [],
        tagMatch: 'any',
      },
      version: '2',
      currency: 'EUR',
    },
    true,
    'USD',
  );
  assert.equal(next.product.methods[0]?.name, 'Printing');
  assert.deepEqual(
    next.product.views[0]?.placements[0]?.sizes.map((size) => size.prices.print),
    ['3.50', '3.50'],
  );
  assert.equal(next.methodBindings.print?.prices.default?.value, '3.50');
});

test('an incoming imported binding is refreshed from the current catalogue before its first save', async () => {
  const id = randomUUID();
  const incoming = setup(id);
  const current = {
    configuration: {
      id,
      name: 'Latest name',
      explanation: 'Latest instructions',
      pricing: 'fixed' as const,
      amount: '5.00',
      assignment: 'manual' as const,
      productIds: ['111'],
      tags: [],
      tagMatch: 'any' as const,
    },
    version: '9',
    currency: 'USD' as const,
  };
  const { reconcileIncomingSelectedSetup } = await import('../../src/server/selected-method-reconciliation.ts');
  const { fixtureCore } = await import('./support/durable-core.mts');
  const { fixtureTransaction } = await import('./support/fixtures.mts');
  const core = fixtureCore({
    methodCatalog: {
      listConfigurations: async () => [current],
      saveConfiguration: async () => null,
      list: async () => [],
      create: async () => null,
      rename: async () => null,
      delete: async () => false,
    },
  });
  const result = await reconcileIncomingSelectedSetup(
    core,
    fixtureTransaction,
    { tenantShopId: 'tenant' },
    incoming,
    'USD',
  );
  assert.equal(result.product.methods[0]?.name, 'Latest name');
  assert.equal(result.methodBindings.print?.observedVersion, '9');
  assert.deepEqual(
    result.product.views[0]?.placements[0]?.sizes.map((size) => size.prices.print),
    ['3.50', '5.00'],
  );
  await assert.rejects(
    reconcileIncomingSelectedSetup(core, fixtureTransaction, { tenantShopId: 'tenant' }, incoming, 'EUR'),
    /current shop currency/,
  );
});
