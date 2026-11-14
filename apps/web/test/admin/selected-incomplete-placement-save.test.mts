import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MerchantDraftSchema, SelectedProductSetupSchema } from '@insignia/contracts';
import { createDurableCore, sha256CanonicalJson } from '@insignia/database';
import { Pool } from 'pg';
import { createMerchantConfigService } from '../../src/server/merchant-config.ts';
import { selectedPublicationProblems } from '../../src/server/selected-product.ts';
import { adminActor, required } from './support/fixtures.mts';

const database = process.env.DATABASE_URL;
const productId = 'gid://shopify/Product/111';
const front = 'https://cdn.shopify.com/s/files/1/0/files/shirt-white-front.jpg?v=1';
const back = 'https://cdn.shopify.com/s/files/1/0/files/shirt-navy-back.jpg?v=1';

// The QA products' shape (#438): Shopify media where the featured image repeats the first media
// image, two saved views, no methods yet, then one newly added default placement.
function setupWith(placements: unknown[]) {
  return SelectedProductSetupSchema.parse({
    version: 'selected-product-setup-v1',
    methodBindings: {},
    product: {
      id: productId,
      title: 'QA tee',
      images: [
        { id: 'product_111', url: front, width: 1200, height: 1200, alt: '' },
        { id: 'image_1', url: front, width: 1200, height: 1200, alt: '' },
        { id: 'image_2', url: back, width: 1200, height: 1200, alt: '' },
      ],
      methods: [{ id: 'print', name: 'Print', pricing: 'fixed', amount: '3.50' }],
      views: [
        { id: 'view-front', name: 'Front', imageUrl: front, imageWidth: 1200, imageHeight: 1200, placements },
        { id: 'view-back', name: 'View 2', imageUrl: back, imageWidth: 1200, imageHeight: 1200, placements: [] },
      ],
    },
  });
}
function newPlacement(id: string, change: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Chest',
    rect: { centerX: 0.5, centerY: 0.4, width: 0.24, height: 0.28 },
    widthCm: '',
    heightCm: '',
    methodIds: [],
    sizes: [{ id: `${id}:standard`, name: 'Standard', widthPercent: '100', prices: {} }],
    logoLaterAllowed: false,
    customPlacementAllowed: false,
    ...change,
  };
}

test('a draft with a newly added placement that has no method or size yet saves, but cannot publish (#438)', {
  skip: !database,
  timeout: 15000,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  const shopId = randomUUID();
  const actor = adminActor({
    tenantShopId: shopId,
    shop: `incomplete-${randomUUID().replaceAll('-', '')}.myshopify.com`,
    shopId: 'gid://shopify/Shop/123',
    installationGeneration: '1',
  });
  try {
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, {
        shopId,
        shopDomain: actor.shop,
        shopifyShopId: '123',
        externalInstallationId: actor.installationId,
      }),
    );
    const authority = sha256CanonicalJson(
      required(await core.tenants.getActiveAuthorizationScope({ shopId, installationGeneration: '1' })),
    );
    const service = createMerchantConfigService({
      core,
      catalog: {
        get: async () => ({ id: productId, title: 'QA tee', status: 'DRAFT', imageUrl: front, variants: [] }),
        shopCurrency: async () => 'USD',
      },
      eligibility: async () => ({ allowed: false, reason: 'Incomplete' }),
      publication: () => {
        throw new Error('Saving never publishes');
      },
    });
    const created = await service.create(actor, productId, `${randomUUID()}:create`, authority);
    assert.equal(created.kind, 'created');
    const configId = created.kind === 'created' ? created.configId : '';
    let view = await service.read(actor, productId);
    let draftVersion = required(view.config).draftVersion;
    const save = async (placements: unknown[]) => {
      const draft = MerchantDraftSchema.parse(required(view.config).draft);
      const result = await service.save(actor, productId, {
        configId,
        draftVersion,
        draft: { ...draft, selectedSetup: setupWith(placements) },
        idempotencyKey: `${randomUUID()}:save`,
        authority,
      });
      if (result.kind === 'saved') {
        draftVersion = result.draftVersion;
        view = await service.read(actor, productId);
      }
      return result;
    };

    // Two views without placements already saved fine before the fix.
    assert.equal((await save([])).kind, 'saved');
    // The reported failure: one new placement with only its default size and no method.
    const chest = randomUUID();
    assert.deepEqual(await save([newPlacement(chest)]), { kind: 'saved', draftVersion });
    // A placement with a method but every size removed is also unfinished authoring work.
    const sleeve = randomUUID();
    assert.equal(
      (await save([newPlacement(chest), newPlacement(sleeve, { methodIds: ['print'], sizes: [] })])).kind,
      'saved',
    );

    const saved = MerchantDraftSchema.parse(required(view.config).draft);
    assert.deepEqual(
      saved.selectedSetup?.product.views[0]?.placements.map((placement) => placement.id),
      [chest, sleeve],
      'the merchant keeps the unfinished placements',
    );
    assert.deepEqual(saved.placements, [], 'unfinished placements never enter the commerce projection');
    assert.ok(
      selectedPublicationProblems(saved).includes('Configure methods and decoration sizes.'),
      'publication still requires methods and sizes for every placement',
    );

    // Completing the placement projects it as before.
    const complete = await save([newPlacement(chest, { methodIds: ['print'] })]);
    assert.equal(complete.kind, 'saved');
    const completed = MerchantDraftSchema.parse(required(view.config).draft);
    assert.deepEqual(
      completed.placements.map((placement) => [placement.id, placement.allowedMethodIds]),
      [[chest, ['print']]],
    );
  } finally {
    await core.close();
  }
});
