import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MerchantDraftSchema, SelectedProductSetupSchema } from '@insignia/contracts';
import { CONFIG_DRAFT_STORAGE_VERSION, createDurableCore, sha256CanonicalJson } from '@insignia/database';
import { Pool } from 'pg';
import { createMerchantConfigService } from '../../src/server/merchant-config.ts';
import {
  reconcileIncomingSelectedSetup,
  selectedMethodPublicationIsCurrent,
} from '../../src/server/selected-method-reconciliation.ts';
import { selectedProductDraft, selectedPublicationProblems } from '../../src/server/selected-product.ts';
import { fixtureCore } from './support/durable-core.mts';
import { adminActor, fixtureTransaction, required, unexpected } from './support/fixtures.mts';

const methodId = '1f71601e-a80b-42cd-b278-d8c135c2ad10';
const original = MerchantDraftSchema.parse({
  version: 'm5-merchant-draft-v1',
  mode: 'required',
  shopCurrency: 'USD',
  methods: [],
  placements: [],
  productionOptions: [],
  pricingRules: [],
  geometry: {},
});
function selected() {
  return SelectedProductSetupSchema.parse({
    version: 'selected-product-setup-v1',
    methodBindings: {
      print: {
        catalogMethodId: methodId,
        observedVersion: '1',
        name: { source: 'catalog', value: 'Print' },
        explanation: { source: 'catalog', value: 'Colour' },
        translations: {},
        prices: {
          default: { source: 'catalog', value: '3.50' },
          '["chest","small"]': { source: 'catalog', value: '3.50' },
        },
        review: {
          reason: 'deleted',
          catalogVersion: '1',
          decision: 'pending',
          assignmentKey: sha256CanonicalJson({ deleted: true }),
        },
      },
    },
    product: {
      id: 'gid://shopify/Product/111',
      title: 'Shirt',
      images: [
        { id: 'product_111', url: 'https://cdn.shopify.com/front.jpg', width: 1000, height: 1000, alt: 'Front' },
      ],
      methods: [{ id: 'print', name: 'Print', explanation: 'Colour', pricing: 'fixed', amount: '3.50' }],
      views: [
        {
          id: 'front',
          name: 'Front',
          imageUrl: 'https://cdn.shopify.com/front.jpg',
          imageWidth: 1000,
          imageHeight: 1000,
          calibration: {
            imageUrl: 'https://cdn.shopify.com/front.jpg',
            imageWidth: 1000,
            imageHeight: 1000,
            a: { x: 0, y: 0 },
            b: { x: 0.5, y: 0 },
            distanceCm: 50,
          },
          placements: [
            {
              id: 'chest',
              name: 'Chest',
              rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 },
              widthCm: '20',
              heightCm: '20',
              methodIds: ['print'],
              logoLaterAllowed: true,
              sizes: [{ id: 'small', name: 'Small', widthPercent: '50', prices: {} }],
            },
          ],
        },
      ],
    },
  });
}
const emptyCatalog = () => fixtureCore({ methodCatalog: { listConfigurations: async () => [] } });

test('unused retained Method snapshots cannot create an unresolvable publication review while configured copies still require confirmation', () => {
  const value = selected();
  assert.ok(
    selectedPublicationProblems(selectedProductDraft(value, original)).some((problem) =>
      problem.includes('Review the unassigned'),
    ),
  );
  value.product.methods.push({ id: 'stitch', name: 'Stitch', pricing: 'fixed', amount: '2.50' });
  required(required(value.product.views[0]).placements[0]).methodIds = ['stitch'];
  assert.deepEqual(selectedPublicationProblems(selectedProductDraft(value, original)), []);
  assert.equal(
    value.methodBindings.print?.review?.decision,
    'pending',
    'Unused independent snapshot remains available for later review',
  );
});

test('fresh publication admission ignores unused retained bindings without consulting mutable catalogue defaults', async () => {
  const value = selected();
  value.product.methods.push({ id: 'stitch', name: 'Stitch', pricing: 'fixed', amount: '2.50' });
  required(required(value.product.views[0]).placements[0]).methodIds = ['stitch'];
  assert.equal(
    await selectedMethodPublicationIsCurrent(fixtureCore(), fixtureTransaction, { tenantShopId: 'shop' }, value, 'USD'),
    true,
  );
});

for (const kind of ['missing', 'rebound'] as const)
  test(`incoming ${kind} binding cannot erase a previously configured Method review or its provenance`, async () => {
    const prior = selected(),
      incoming = structuredClone(prior);
    if (kind === 'missing') incoming.methodBindings = {};
    else required(incoming.methodBindings.print).catalogMethodId = randomUUID();
    await assert.rejects(
      reconcileIncomingSelectedSetup(
        emptyCatalog(),
        fixtureTransaction,
        { tenantShopId: 'shop' },
        incoming,
        'USD',
        [],
        prior,
      ),
      /inheritance metadata/,
    );
  });

test('an explicit keep or removal resolves the same retained Method review without inferring ownership from equal prices', async () => {
  const prior = selected(),
    kept = structuredClone(prior);
  required(required(kept.methodBindings.print).review).decision = 'keep';
  const accepted = await reconcileIncomingSelectedSetup(
    emptyCatalog(),
    fixtureTransaction,
    { tenantShopId: 'shop' },
    kept,
    'USD',
    [],
    prior,
  );
  assert.deepEqual(selectedPublicationProblems(selectedProductDraft(accepted, original)), []);
  assert.equal(accepted.product.methods[0]?.amount, '3.50');
  const removed = structuredClone(prior);
  removed.product.methods = [];
  removed.methodBindings = {};
  required(required(removed.product.views[0]).placements[0]).methodIds = [];
  await assert.doesNotReject(
    reconcileIncomingSelectedSetup(
      emptyCatalog(),
      fixtureTransaction,
      { tenantShopId: 'shop' },
      removed,
      'USD',
      [],
      prior,
    ),
  );
});

test('the authoritative draft save rejects dropped/rebound review links and selected-envelope downgrade before any durable update', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
  const tenant = randomUUID(),
    configId = randomUUID();
  const actor = adminActor({
    tenantShopId: tenant,
    shop: `review-${tenant}.myshopify.com`,
    shopId: `gid://shopify/Shop/${BigInt(`0x${tenant.replaceAll('-', '').slice(0, 12)}`)}`,
    installationGeneration: '1',
    canRead: true,
    canEdit: true,
  });
  try {
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, {
        shopId: tenant,
        shopDomain: actor.shop,
        shopifyShopId: actor.shopId.split('/').at(-1),
      }),
    );
    const previous = selectedProductDraft(selected(), original);
    await core.transactions.run((tx) =>
      core.configs.createConfig(tx, {
        shopId: tenant,
        configId,
        externalProductId: '111',
        draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
        draftValue: previous,
      }),
    );
    const scope = required(
      await core.transactions.run((tx) =>
        core.tenants.lockActiveAuthorizationScope(tx, { shopId: tenant, installationGeneration: '1' }),
      ),
    );
    const service = createMerchantConfigService({
      core,
      catalog: {
        get: async () => ({
          id: 'gid://shopify/Product/111',
          title: 'Shirt',
          status: 'ACTIVE',
          imageUrl: 'https://cdn.shopify.com/front.jpg',
          images: required(previous.selectedSetup).product.images,
          variants: [],
          tags: [],
        }),
        shopCurrency: async () => 'USD',
      },
      eligibility: async () => ({ allowed: true, reason: null }),
      publication: unexpected,
    });
    for (const kind of ['missing', 'rebound', 'legacy'] as const) {
      const proposed = structuredClone(previous);
      if (kind === 'legacy') delete proposed.selectedSetup;
      else if (kind === 'missing') required(proposed.selectedSetup).methodBindings = {};
      else required(required(proposed.selectedSetup).methodBindings.print).catalogMethodId = randomUUID();
      const result = await service.save(actor, 'gid://shopify/Product/111', {
        configId,
        draftVersion: '1',
        draft: proposed,
        idempotencyKey: `review-${kind}`,
        authority: sha256CanonicalJson(scope),
      });
      assert.equal(result.kind, 'invalid');
      assert.ok('noEffect' in result && result.noEffect);
      const stored = required(await core.configs.getConfig(tenant, configId));
      assert.equal(stored.draftVersion, '1');
      assert.deepEqual(stored.draftValue, previous);
    }
    const kept = structuredClone(previous);
    required(required(required(kept.selectedSetup).methodBindings.print).review).decision = 'keep';
    const saved = await service.save(actor, 'gid://shopify/Product/111', {
      configId,
      draftVersion: '1',
      draft: kept,
      idempotencyKey: 'review-explicit-keep',
      authority: sha256CanonicalJson(scope),
    });
    assert.deepEqual(saved, { kind: 'saved', draftVersion: '2' });
    assert.deepEqual(
      selectedPublicationProblems(
        MerchantDraftSchema.parse(required(await core.configs.getConfig(tenant, configId)).draftValue),
      ),
      [],
    );
  } finally {
    await core.close();
  }
});

test('a fabricated deleted review cannot detach a live unassigned Method from future inherited defaults', async () => {
  const prior = selected();
  required(required(prior.methodBindings.print).review).reason = 'unassigned';
  required(required(prior.methodBindings.print).review).assignmentKey = sha256CanonicalJson({
    assignment: 'manual',
    assigned: false,
  });
  const proposed = structuredClone(prior);
  required(required(proposed.methodBindings.print).review).reason = 'deleted';
  required(required(proposed.methodBindings.print).review).decision = 'keep';
  const core = fixtureCore({
    methodCatalog: {
      listConfigurations: async () => [
        {
          version: '2',
          currency: 'USD',
          configuration: {
            id: methodId,
            name: 'Print',
            explanation: 'Colour',
            pricing: 'fixed',
            amount: '4.50',
            assignment: 'manual',
            productIds: [],
            tags: [],
            tagMatch: 'any',
          },
        },
      ],
    },
  });
  await assert.rejects(
    reconcileIncomingSelectedSetup(core, fixtureTransaction, { tenantShopId: 'shop' }, proposed, 'USD', [], prior),
    /inheritance metadata/,
  );
});

test('direct publication rechecks current product tags before capture or provider preparation and requires an explicit saved review', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
  const tenant = randomUUID(),
    configId = randomUUID();
  const actor = adminActor({
    tenantShopId: tenant,
    shop: `tags-${tenant}.myshopify.com`,
    shopId: `gid://shopify/Shop/${BigInt(`0x${tenant.replaceAll('-', '').slice(0, 12)}`)}`,
    installationGeneration: '1',
    canRead: true,
    canEdit: true,
  });
  try {
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, {
        shopId: tenant,
        shopDomain: actor.shop,
        shopifyShopId: actor.shopId.split('/').at(-1),
      }),
    );
    const { createMethodLibrary } = await import('../../src/server/admin/methods.ts');
    const methods = createMethodLibrary(core, { currency: async () => 'USD' });
    assert.ok(methods.saveConfiguration);
    const configuration = {
      id: methodId,
      name: 'Print',
      explanation: 'Colour',
      pricing: 'fixed' as const,
      amount: '3.50',
      assignment: 'tags' as const,
      productIds: [],
      tags: ['shirts'],
      tagMatch: 'any' as const,
    };
    assert.equal((await methods.saveConfiguration(actor, configuration, null, 'tag-create')).kind, 'created');
    const before = selected();
    required(before.methodBindings.print).review = null;
    const admitted = await core.transactions.run((tx) =>
      reconcileIncomingSelectedSetup(core, tx, actor, before, 'USD', ['shirts']),
    );
    const draft = selectedProductDraft(admitted, original);
    await core.transactions.run((tx) =>
      core.configs.createConfig(tx, {
        shopId: tenant,
        configId,
        externalProductId: '111',
        draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
        draftValue: draft,
      }),
    );
    const scope = required(
      await core.transactions.run((tx) =>
        core.tenants.lockActiveAuthorizationScope(tx, { shopId: tenant, installationGeneration: '1' }),
      ),
    );
    let captures = 0,
      preparations = 0;
    const service = createMerchantConfigService({
      core,
      catalog: {
        get: async () => ({
          id: 'gid://shopify/Product/111',
          title: 'Shirt',
          status: 'ACTIVE',
          imageUrl: 'https://cdn.shopify.com/front.jpg',
          images: admitted.product.images,
          variants: [],
          tags: [],
        }),
        shopCurrency: async () => 'USD',
      },
      eligibility: async () => ({ allowed: true, reason: null }),
      preparePublication: async () => {
        preparations++;
        return { ready: true, reason: null };
      },
      capturePublicationPreviews: async () => {
        captures++;
        return [];
      },
      publication: unexpected,
    });
    const rejected = await service.publish(actor, 'gid://shopify/Product/111', {
      configId,
      draftVersion: '1',
      idempotencyKey: 'publish-after-tag-removal',
      authority: sha256CanonicalJson(scope),
    });
    assert.equal(rejected.kind, 'invalid');
    assert.ok('noEffect' in rejected && rejected.noEffect);
    assert.equal(captures, 0);
    assert.equal(preparations, 0);
    assert.equal(required(await core.configs.getConfig(tenant, configId)).draftVersion, '1');
    assert.equal(
      (
        await service.save(actor, 'gid://shopify/Product/111', {
          configId,
          draftVersion: '1',
          draft,
          idempotencyKey: 'save-tag-review',
          authority: sha256CanonicalJson(scope),
        })
      ).kind,
      'saved',
    );
    const reviewed = MerchantDraftSchema.parse(required(await core.configs.getConfig(tenant, configId)).draftValue);
    assert.equal(reviewed.selectedSetup?.methodBindings.print?.review?.decision, 'pending');
    assert.ok(selectedPublicationProblems(reviewed).some((problem) => problem.includes('Review the unassigned')));
    required(required(required(reviewed.selectedSetup).methodBindings.print).review).decision = 'keep';
    assert.deepEqual(
      await service.save(actor, 'gid://shopify/Product/111', {
        configId,
        draftVersion: '2',
        draft: reviewed,
        idempotencyKey: 'keep-tagged-method',
        authority: sha256CanonicalJson(scope),
      }),
      { kind: 'saved', draftVersion: '3' },
    );
    // The confirmed method may now enter capture; this fixture deliberately supplies
    // no captured assets, so the independent complete-preview boundary still stops it.
    await assert.rejects(
      service.publish(actor, 'gid://shopify/Product/111', {
        configId,
        draftVersion: '3',
        idempotencyKey: 'publish-confirmed-tagged-method',
        authority: sha256CanonicalJson(scope),
      }),
      /Complete customer previews are unavailable/,
    );
    assert.equal(captures, 1);
    assert.equal(preparations, 0);
  } finally {
    await core.close();
  }
});
