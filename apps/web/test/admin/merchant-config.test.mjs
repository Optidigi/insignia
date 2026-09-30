import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { createMerchantConfigService } from '../../src/server/merchant-config.ts';

const database = process.env.DATABASE_URL;
const productA = 'gid://shopify/Product/111';
const productB = 'gid://shopify/Product/222';
const productC = 'gid://shopify/Product/333';
const sharedId = 's'.repeat(128);
function baseDraft() {
  return {
    version: 'm5-merchant-draft-v1',
    mode: 'optional',
    shopCurrency: 'USD',
    methods: [{ id: sharedId }],
    placements: [{ id: sharedId, allowedMethodIds: [sharedId], allowedStepIds: [sharedId], logoLaterAllowed: true }],
    productionOptions: [{ id: sharedId, allowedValueIds: [sharedId] }],
    pricingRules: [],
    labels: {
      methods: { [sharedId]: 'Screen print' },
      placements: { [sharedId]: 'Front chest' },
      steps: { [sharedId]: 'Small' },
      views: { 'front-view': 'Front image' },
      options: { [sharedId]: 'Thread color' },
      values: { [sharedId]: 'Navy' },
    },
    geometry: {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front-view',
          image: { revisionId: 'product_111', width: 800, height: 1000 },
          variantImages: [{ variantId: 'variant_11', image: { revisionId: 'variant_11', width: 700, height: 900 } }],
          placements: [
            {
              id: sharedId,
              rect: { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.3 },
              variantOverrides: [
                { variantId: 'variant_11', rect: { centerX: 0.4, centerY: 0.4, width: 0.2, height: 0.2 } },
              ],
            },
          ],
        },
      ],
      steps: [{ id: sharedId, widthFraction: 0.5, heightFraction: 0.5 }],
    },
  };
}
function item(id) {
  return { id, title: 'Synthetic garment', status: 'ACTIVE', imageUrl: null, variants: [] };
}
function actor(shopId, shop, shopifyShopId) {
  return {
    shop,
    shopId: 'gid://shopify/Shop/' + shopifyShopId,
    tenantShopId: shopId,
    installationGeneration: '1',
    installationId: 'gid://shopify/AppInstallation/123',
    staffId: 'staff-1',
    sessionId: 'session-1',
    expiresAtMs: Date.now() + 60000,
    canRead: true,
    canEdit: true,
  };
}
test('durable editor CAS, exact-key replay, independent copy, immutable geometry, and reinstall fence', {
  skip: !database,
  timeout: 30000,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  const shopId = randomUUID();
  const shop = 'm' + randomUUID().replaceAll('-', '') + '.myshopify.com';
  const shopifyShopId = String(BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12)) + 1n);
  const staff = actor(shopId, shop, shopifyShopId);
  await core.transactions.run((tx) =>
    core.tenants.createShop(tx, {
      shopId,
      shopDomain: shop,
      shopifyShopId,
      externalInstallationId: staff.installationId,
    }),
  );
  let paused = false;
  let release;
  let entered;
  const enteredPromise = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const service = createMerchantConfigService({
    core,
    catalog: {
      async get(_actor, id) {
        if (paused) {
          entered();
          await gate;
        }
        return [productA, productB, productC].includes(id) ? item(id) : null;
      },
      async shopCurrency() {
        return 'USD';
      },
    },
    async eligibility() {
      return { allowed: true, reason: null };
    },
    publication() {
      return {
        async prepare(input) {
          return { operationId: input.operationId, phase: 'prepared' };
        },
        async advance() {
          return { phase: 'activation-pending' };
        },
      };
    },
  });
  try {
    const created = await service.create(staff, productA, 'create-key-01');
    assert.equal(created.kind, 'created');
    assert.deepEqual(await service.create(staff, productA, 'create-key-01'), created);
    const draft = baseDraft();
    const saved = await service.save(staff, productA, {
      configId: created.configId,
      draftVersion: '1',
      draft,
      idempotencyKey: 'save-key-01',
    });
    assert.deepEqual(saved, { kind: 'saved', draftVersion: '2' });
    assert.deepEqual(
      await service.save(staff, productA, {
        configId: created.configId,
        draftVersion: '1',
        draft,
        idempotencyKey: 'save-key-01',
      }),
      saved,
    );
    assert.equal(
      (
        await service.save(staff, productA, {
          configId: created.configId,
          draftVersion: '1',
          draft,
          idempotencyKey: 'save-stale-01',
        })
      ).kind,
      'conflict',
    );
    const invalid = structuredClone(draft);
    invalid.geometry.views[0].placements[0].rect.centerX = 0.99;
    assert.equal(
      (
        await service.save(staff, productA, {
          configId: created.configId,
          draftVersion: '2',
          draft: invalid,
          idempotencyKey: 'save-invalid-01',
        })
      ).kind,
      'invalid',
    );
    const copy = await service.copy(staff, productA, productB, 'copy-key-01');
    assert.equal(copy.kind, 'created');
    const copied = (await service.read(staff, productB)).config;
    assert.notEqual(copied.configId, created.configId);
    assert.notEqual(copied.draft.placements[0].id, draft.placements[0].id);
    assert.deepEqual(copied.draft.geometry.views[0].variantImages, []);
    assert.equal(copied.draft.labels.methods[copied.draft.methods[0].id], 'Screen print');
    assert.equal(copied.draft.labels.placements[copied.draft.placements[0].id], 'Front chest');
    assert.equal(copied.draft.labels.steps[copied.draft.geometry.steps[0].id], 'Small');
    assert.equal(copied.draft.labels.options[copied.draft.productionOptions[0].id], 'Thread color');
    assert.equal(copied.draft.labels.values[copied.draft.productionOptions[0].allowedValueIds[0]], 'Navy');
    assert.equal(copied.draft.labels.methods[sharedId], undefined);
    assert.deepEqual(copied.draft.geometry.views[0].placements[0].variantOverrides, []);
    assert.equal(copied.draft.geometry.views[0].image, undefined);
    const changed = { ...draft, mode: 'required' };
    assert.equal(
      (
        await service.save(staff, productA, {
          configId: created.configId,
          draftVersion: '2',
          draft: changed,
          idempotencyKey: 'save-key-02',
        })
      ).kind,
      'saved',
    );
    assert.deepEqual(await service.copy(staff, productA, productB, 'copy-key-01'), copy);
    assert.equal((await service.read(staff, productB)).config.draft.mode, 'optional');
    const published = await service.publish(staff, productA, {
      configId: created.configId,
      draftVersion: '3',
      idempotencyKey: 'publish-key-01',
    });
    assert.equal(published.kind, 'accepted');
    assert.equal(published.state, 'REMOTE_READY_ACTIVATION_PENDING');
    const geometry = await core.configs.getRevisionGeometry(shopId, published.revisionId);
    assert.equal(geometry.mode, 'required');
    assert.equal(geometry.value.views[0].image.revisionId, 'product_111');
    assert.equal(
      (await core.configs.getRevision(shopId, published.revisionId)).publishedValue.version,
      'm2-published-config-v1',
    );
    const revision = await core.configs.getRevision(shopId, published.revisionId);
    await assert.rejects(
      core.transactions.run((tx) =>
        core.configs.createValidatedRevision(tx, {
          shopId,
          configId: created.configId,
          revisionId: randomUUID(),
          publishedValue: { ...revision.publishedValue, revisionId: randomUUID() },
          geometry: { version: 'm5-geometry-v1', value: invalid.geometry },
          mode: 'required',
          createdByRef: 'staff-1',
        }),
      ),
    );
    const newerDraft = { ...changed, mode: 'optional' };
    assert.equal(
      (
        await service.save(staff, productA, {
          configId: created.configId,
          draftVersion: '3',
          draft: newerDraft,
          idempotencyKey: 'save-key-03',
        })
      ).kind,
      'saved',
    );
    const newer = await service.publish(staff, productA, {
      configId: created.configId,
      draftVersion: '4',
      idempotencyKey: 'publish-key-02',
    });
    const sql = new Pool({ connectionString: database });
    try {
      const digest = '0'.repeat(64);
      await sql.query(
        'INSERT INTO publication_operations (shop_id,config_id,operation_id,revision_id,installation_generation,operation_sequence,expected_projection,expected_projection_digest,status,acknowledged_at,observed_at,observed_projection,observed_projection_digest,activated_at) VALUES ($1,$2,$3,$4,1,1,$5,$6,$7,now(),now(),$5,$6,now())',
        [shopId, created.configId, published.revisionId, published.revisionId, {}, digest, 'activated'],
      );
      await sql.query(
        'INSERT INTO m4_publication_progress (shop_id,config_id,operation_id,phase,mode,activation_evidence) VALUES ($1,$2,$3,$4,$5,$6)',
        [shopId, created.configId, published.revisionId, 'active', 'required', 'synthetic-reviewed-test'],
      );
      await sql.query(
        'UPDATE product_configs SET effective_revision_id=$1,effective_operation_id=$2,publication_sequence=1 WHERE shop_id=$3 AND config_id=$4',
        [published.revisionId, published.revisionId, shopId, created.configId],
      );
      await sql.query(
        'INSERT INTO publication_operations (shop_id,config_id,operation_id,revision_id,installation_generation,operation_sequence,expected_projection,expected_projection_digest) VALUES ($1,$2,$3,$4,1,2,$5,$6)',
        [shopId, created.configId, newer.revisionId, newer.revisionId, {}, digest],
      );
      await sql.query(
        'INSERT INTO m4_publication_progress (shop_id,config_id,operation_id,phase,mode) VALUES ($1,$2,$3,$4,$5)',
        [shopId, created.configId, newer.revisionId, 'prepared', 'optional'],
      );
      await sql.query('UPDATE product_configs SET publication_sequence=2 WHERE shop_id=$1 AND config_id=$2', [
        shopId,
        created.configId,
      ]);
      const observed = (await service.read(staff, productA)).config.publication;
      assert.equal(observed.state, 'PUBLISH_REQUESTED');
      assert.equal(observed.revisionId, newer.revisionId);
      assert.equal(observed.activeRevisionId, published.revisionId);
    } finally {
      await sql.end();
    }
    paused = true;
    const racing = service.copy(staff, productA, productC, 'copy-key-race');
    await enteredPromise;
    await core.transactions.run((tx) =>
      core.tenants.startInstallation(tx, shopId, 'gid://shopify/AppInstallation/456'),
    );
    release();
    await assert.rejects(racing, /Current tenant installation required/);
    assert.equal(await core.configs.getByProduct(shopId, '333'), null);
  } finally {
    await core.close();
  }
});
