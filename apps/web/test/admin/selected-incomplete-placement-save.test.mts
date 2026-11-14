import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MerchantDraftSchema, SelectedProductSetupSchema } from '@insignia/contracts';
import { createDurableCore, sha256CanonicalJson } from '@insignia/database';
import { Pool } from 'pg';
import { handleAdminRequest } from '../../src/server/admin/http.ts';
import { createMerchantConfigService } from '../../src/server/merchant-config.ts';
import { selectedPublicationProblems } from '../../src/server/selected-product.ts';
import { adminActor, adminServices, required } from './support/fixtures.mts';

const database = process.env.DATABASE_URL;
const productId = 'gid://shopify/Product/111';
const front = 'https://cdn.shopify.com/s/files/1/0/files/shirt-white-front.jpg?v=1';
const back = 'https://cdn.shopify.com/s/files/1/0/files/shirt-navy-back.jpg?v=1';
// Shopify shop IDs are unique across the shared test database.
const uniqueShopifyShopId = () => String(BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`) + 1n);

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
  const shopifyShopId = uniqueShopifyShopId();
  const actor = adminActor({
    tenantShopId: shopId,
    shop: `incomplete-${randomUUID().replaceAll('-', '')}.myshopify.com`,
    shopId: `gid://shopify/Shop/${shopifyShopId}`,
    installationGeneration: '1',
  });
  try {
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, {
        shopId,
        shopDomain: actor.shop,
        shopifyShopId,
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

test('config validation rejections carry a stable reason code and are recorded without merchant content', {
  skip: !database,
  timeout: 15000,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  const shopId = randomUUID();
  const shopifyShopId = uniqueShopifyShopId();
  const actor = adminActor({
    tenantShopId: shopId,
    shop: `rejection-${randomUUID().replaceAll('-', '')}.myshopify.com`,
    shopId: `gid://shopify/Shop/${shopifyShopId}`,
    installationGeneration: '1',
  });
  try {
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, {
        shopId,
        shopDomain: actor.shop,
        shopifyShopId,
        externalInstallationId: actor.installationId,
      }),
    );
    const authority = sha256CanonicalJson(
      required(await core.tenants.getActiveAuthorizationScope({ shopId, installationGeneration: '1' })),
    );
    const catalog = {
      get: async () => ({ id: productId, title: 'QA tee', status: 'DRAFT', imageUrl: front, variants: [] }),
      shopCurrency: async () => 'USD',
    };
    const service = createMerchantConfigService({
      core,
      catalog,
      eligibility: async () => ({ allowed: false, reason: 'Incomplete' }),
      publication: () => {
        throw new Error('Saving never publishes');
      },
    });
    const created = await service.create(actor, productId, `${randomUUID()}:create`, authority);
    const configId = created.kind === 'created' ? created.configId : '';
    const draft = MerchantDraftSchema.parse(required((await service.read(actor, productId)).config).draft);
    const recorded: unknown[] = [];
    const origin = 'https://synthetic-admin.example.test';
    const services = adminServices({
      appOrigin: origin,
      authenticate: async () => actor,
      catalog: { get: catalog.get },
      configs: service,
      recordConfigRejection: (rejection) => recorded.push(rejection),
    });
    const put = (body: unknown, key: string | null = `${randomUUID()}:save`) =>
      handleAdminRequest(
        new Request(`${origin}/api/admin/products/111/config`, {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer synthetic',
            Origin: origin,
            'Content-Type': 'application/json',
            'X-Insignia-Setup-Authority': authority,
            ...(key ? { 'Idempotency-Key': key } : {}),
          },
          body: JSON.stringify(body),
        }),
        services,
        { kind: 'config', productId },
      );
    const saveSetup = (selectedSetup: unknown, key?: string | null) =>
      put({ action: 'save', configId, draftVersion: '1', draft: { ...draft, selectedSetup } }, key);

    const unknownMethod = await saveSetup(setupWith([newPlacement(randomUUID(), { methodIds: ['embroidery'] })]));
    assert.equal(unknownMethod.status, 422);
    const unknownBody = await unknownMethod.json();
    assert.equal(unknownBody.kind, 'invalid');
    assert.equal(unknownBody.code, 'SETUP_METHOD_UNKNOWN');
    assert.equal(unknownBody.noEffect, true);

    const precise = setupWith([newPlacement(randomUUID(), { methodIds: ['print'] })]);
    precise.product.methods[0]!.amount = '3.501';
    const precision = await saveSetup(precise);
    assert.equal(precision.status, 422);
    assert.equal((await precision.json()).code, 'PRICE_AMOUNT_INVALID');

    const keyless = await saveSetup(setupWith([]), null);
    assert.equal(keyless.status, 422);
    assert.equal((await keyless.json()).code, 'IDEMPOTENCY_KEY_REQUIRED');

    assert.deepEqual(recorded, [
      { action: 'save', code: 'SETUP_METHOD_UNKNOWN' },
      { action: 'save', code: 'PRICE_AMOUNT_INVALID' },
      { action: 'command', code: 'IDEMPOTENCY_KEY_REQUIRED' },
    ]);
    assert.equal(required((await service.read(actor, productId)).config).draftVersion, '1', 'rejections write nothing');
  } finally {
    await core.close();
  }
});
