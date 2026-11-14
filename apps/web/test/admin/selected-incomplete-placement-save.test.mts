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
  const pool = new Pool({ connectionString: database });
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
    const published = await service.publish(actor, productId, {
      configId,
      draftVersion,
      idempotencyKey: `${randomUUID()}:publish`,
      authority,
    });
    assert.equal(published.kind, 'invalid');
    assert.equal(published.kind === 'invalid' && published.code, 'PUBLICATION_INCOMPLETE');
    const durable = await pool.query<{ revisions: string; operations: string }>(
      `SELECT (SELECT count(*) FROM config_revisions WHERE shop_id = $1) AS revisions,
              (SELECT count(*) FROM publication_operations WHERE shop_id = $1) AS operations`,
      [shopId],
    );
    assert.deepEqual(durable.rows[0], { revisions: '0', operations: '0' }, 'a refused publish writes nothing');
    const config = required(await core.configs.getConfig(shopId, configId));
    assert.equal(config.effectiveRevisionId, null);
    assert.equal(config.publicationSequence, '0');

    // Only completeness is deferred: values of an unfinished placement are still validated.
    const rejected = async (placements: unknown[], code: string) => {
      const result = await save(placements);
      assert.equal(result.kind, 'invalid');
      assert.equal(result.kind === 'invalid' && result.code, code);
    };
    await rejected(
      [newPlacement(chest, { sizes: [{ id: 'zero', name: 'Zero', widthPercent: '0', prices: {} }] })],
      'SETUP_SIZE_INVALID',
    );
    await rejected(
      [
        newPlacement(chest, {
          sizes: [{ id: 'tall', name: 'Tall', widthPercent: '50', heightPercent: '101', prices: {} }],
        }),
      ],
      'SETUP_SIZE_INVALID',
    );
    await rejected([newPlacement(chest, { methodIds: ['embroidery'], sizes: [] })], 'SETUP_METHOD_UNKNOWN');
    const precise = setupWith([newPlacement(chest, { methodIds: ['print'], sizes: [] })]);
    precise.product.methods[0]!.amount = '3.501';
    const preciseResult = await service.save(actor, productId, {
      configId,
      draftVersion,
      draft: { ...MerchantDraftSchema.parse(required(view.config).draft), selectedSetup: precise },
      idempotencyKey: `${randomUUID()}:save`,
      authority,
    });
    assert.equal(preciseResult.kind === 'invalid' && preciseResult.code, 'PRICE_AMOUNT_INVALID');
    assert.equal(required((await service.read(actor, productId)).config).draftVersion, draftVersion);

    // Completing the placement projects it as before.
    const complete = await save([newPlacement(chest, { methodIds: ['print'] })]);
    assert.equal(complete.kind, 'saved');
    const completed = MerchantDraftSchema.parse(required(view.config).draft);
    assert.deepEqual(
      completed.placements.map((placement) => [placement.id, placement.allowedMethodIds]),
      [[chest, ['print']]],
    );
  } finally {
    await pool.end();
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

async function tenant(core: ReturnType<typeof createDurableCore>, prefix: string) {
  const shopId = randomUUID();
  const shopifyShopId = uniqueShopifyShopId();
  const actor = adminActor({
    tenantShopId: shopId,
    shop: `${prefix}-${randomUUID().replaceAll('-', '')}.myshopify.com`,
    shopId: `gid://shopify/Shop/${shopifyShopId}`,
    installationGeneration: '1',
  });
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
  return { actor, authority };
}
const catalogItem = (id: string) => ({ id, title: 'QA tee', status: 'DRAFT', imageUrl: front, variants: [] });

test('a draft that becomes invalid after Method reconciliation is a coded 422 and rolls back its command', {
  skip: !database,
  timeout: 15000,
}, async () => {
  const base = createDurableCore(new Pool({ connectionString: database }));
  const catalogMethodId = randomUUID();
  let inheritedAmount = '5.001';
  // The library price is applied only inside the save transaction, after the pre-transaction check.
  const core = {
    ...base,
    methodCatalog: {
      ...base.methodCatalog,
      listConfigurations: async () => [
        {
          configuration: {
            id: catalogMethodId,
            name: 'Print',
            explanation: '',
            pricing: 'fixed' as const,
            amount: inheritedAmount,
            assignment: 'manual' as const,
            productIds: ['111'],
            tags: [],
            tagMatch: 'any' as const,
          },
          version: '2',
          currency: 'USD' as const,
        },
      ],
    },
  } as typeof base;
  try {
    const { actor, authority } = await tenant(base, 'reconciled');
    const service = createMerchantConfigService({
      core,
      catalog: { get: async () => catalogItem(productId), shopCurrency: async () => 'USD' },
      eligibility: async () => ({ allowed: false, reason: 'Incomplete' }),
      publication: () => {
        throw new Error('Saving never publishes');
      },
    });
    const created = await service.create(actor, productId, `${randomUUID()}:create`, authority);
    const configId = created.kind === 'created' ? created.configId : '';
    const draft = MerchantDraftSchema.parse(required((await service.read(actor, productId)).config).draft);
    const base_ = setupWith([
      newPlacement('chest', {
        methodIds: ['print'],
        sizes: [
          { id: 'small', name: 'Small', widthPercent: '50', prices: { print: '3.50' } },
          { id: 'large', name: 'Large', widthPercent: '100', prices: { print: '3.50' } },
        ],
      }),
    ]);
    const selectedSetup = SelectedProductSetupSchema.parse({
      ...base_,
      methodBindings: {
        print: {
          catalogMethodId,
          observedVersion: '1',
          name: { value: 'Print', source: 'catalog' },
          explanation: { value: '', source: 'catalog' },
          translations: {},
          prices: {
            default: { value: '3.50', source: 'catalog' },
            '["chest","small"]': { value: '3.50', source: 'product' },
            '["chest","large"]': { value: '3.50', source: 'catalog' },
          },
          review: null,
        },
      },
      product: {
        ...base_.product,
        methods: [{ id: 'print', name: 'Print', explanation: '', pricing: 'product', amount: '' }],
      },
    });
    const idempotencyKey = `${randomUUID()}:save`;
    const recorded: unknown[] = [];
    const origin = 'https://synthetic-admin.example.test';
    const services = adminServices({
      appOrigin: origin,
      authenticate: async () => actor,
      catalog: { get: async () => catalogItem(productId) },
      configs: service,
      recordConfigRejection: (rejection) => recorded.push(rejection),
    });
    const put = () =>
      handleAdminRequest(
        new Request(`${origin}/api/admin/products/111/config`, {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer synthetic',
            Origin: origin,
            'Content-Type': 'application/json',
            'X-Insignia-Setup-Authority': authority,
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({ action: 'save', configId, draftVersion: '1', draft: { ...draft, selectedSetup } }),
        }),
        services,
        { kind: 'config', productId },
      );
    const rejected = await put();
    assert.equal(rejected.status, 422, 'not the 503 an escaped validation error produced');
    const body = await rejected.json();
    assert.equal(body.code, 'PRICE_AMOUNT_INVALID');
    assert.equal(body.noEffect, true);
    assert.deepEqual(recorded, [{ action: 'save', code: 'PRICE_AMOUNT_INVALID' }]);
    assert.equal(required((await service.read(actor, productId)).config).draftVersion, '1');
    // Nothing durable kept the key: once the library price is valid the same request saves.
    inheritedAmount = '5.00';
    const saved = await put();
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { kind: 'saved', draftVersion: '2' });
  } finally {
    await base.close();
  }
});

test('copy reports the target rule that failed instead of a Lean price review', {
  skip: !database,
  timeout: 15000,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  const target = 'gid://shopify/Product/222';
  try {
    const { actor, authority } = await tenant(core, 'copy');
    const service = createMerchantConfigService({
      core,
      catalog: { get: async (_actor, id) => catalogItem(id), shopCurrency: async () => 'USD' },
      eligibility: async () => ({ allowed: false, reason: 'Incomplete' }),
      publication: () => {
        throw new Error('Copy never publishes');
      },
    });
    const created = await service.create(actor, productId, `${randomUUID()}:create`, authority);
    const configId = created.kind === 'created' ? created.configId : '';
    const draft = MerchantDraftSchema.parse(required((await service.read(actor, productId)).config).draft);
    const saved = await service.save(actor, productId, {
      configId,
      draftVersion: '1',
      draft: { ...draft, selectedSetup: setupWith([newPlacement('chest', { methodIds: ['print'] })]) },
      idempotencyKey: `${randomUUID()}:save`,
      authority,
    });
    assert.equal(saved.kind, 'saved');
    // The copied draft still names the source product in its selected setup.
    const copied = await service.copy(actor, productId, target, `${randomUUID()}:copy`);
    assert.equal(copied.kind, 'invalid');
    assert.equal(copied.kind === 'invalid' && copied.code, 'PRODUCT_IDENTITY_CHANGED');
    assert.equal((await service.read(actor, target)).config, null, 'no target configuration is created');
  } finally {
    await core.close();
  }
});
