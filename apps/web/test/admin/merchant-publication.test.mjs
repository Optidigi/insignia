import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { createMerchantConfigService } from '../../src/server/merchant-config.ts';
import { createSyntheticActivation } from './support/synthetic-activation.mjs';

const database = process.env.DATABASE_URL;
const productId = 'gid://shopify/Product/555';
const appId = '123456789';
function observed(target, value) {
  return {
    ownerId: target.field === 'public_config' ? target.shopifyShopId : target.productId,
    namespace: 'app--' + appId,
    key:
      target.field === 'public_config'
        ? 'insignia_public_config_v2'
        : target.field === 'registration'
          ? 'insignia_registration_v2'
          : 'insignia_policy_v2',
    type: target.field === 'public_config' ? 'json' : 'single_line_text_field',
    value,
    compareDigest: createHash('sha256').update(value).digest('hex'),
  };
}
function draft() {
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
async function run(mode) {
  const core = createDurableCore(new Pool({ connectionString: database }));
  const shopId = randomUUID();
  const shop = 'm' + randomUUID().replaceAll('-', '') + '.myshopify.com';
  const shopifyShopId = String(BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12)) + 1n);
  const actor = {
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
  const fields = new Map();
  let readPublic = 0;
  let remoteWrites = 0;
  let eligible = true;
  const remote = {
    async read(target) {
      if (target.field === 'public_config') readPublic++;
      if (mode === 'conflict' && target.field === 'public_config' && readPublic > 1)
        return observed(target, '{"foreign":"value"}');
      return fields.get(target.field) ?? null;
    },
    async set(target) {
      remoteWrites++;
      if (mode === 'hold') throw { kind: 'ambiguous_write' };
      const current = fields.get(target.field);
      assert.equal(current?.compareDigest ?? null, target.compareDigest);
      const result = observed(target, target.value);
      fields.set(target.field, result);
      return { observed: result };
    },
  };
  const activation = createSyntheticActivation({ core, appId, remote, shopId, shopifyShopId, productId });
  const publication =
    mode === 'pending' ? core.productionPublications.create({ appId, remote }) : activation.publications;
  const service = createMerchantConfigService({
    core,
    catalog: {
      async get(_actor, id) {
        return id === productId
          ? { id, title: 'Synthetic shirt', status: 'ACTIVE', imageUrl: null, variants: [] }
          : null;
      },
      async shopCurrency() {
        return 'USD';
      },
    },
    async eligibility() {
      return { allowed: eligible, reason: eligible ? null : 'Synthetic feature revoked' };
    },
    publication() {
      return publication;
    },
  });
  try {
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, {
        shopId,
        shopDomain: shop,
        shopifyShopId,
        externalInstallationId: actor.installationId,
      }),
    );
    const keys = new Pool({ connectionString: database });
    try {
      const identity = await keys.query(
        'SELECT authorization_generation FROM installation_generations WHERE shop_id=$1 AND generation=1',
        [shopId],
      );
      const pair = generateKeyPairSync('ed25519');
      const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
      await keys.query(
        'INSERT INTO signing_keys (shop_id,installation_generation,authorization_generation,key_id,public_key,public_key_fingerprint,private_envelope,wrapping_key_id,state,first_valid_day,last_valid_day) VALUES ($1,1,$2,7,$3,$4,$5,$6,$7,20000,21000)',
        [
          shopId,
          identity.rows[0].authorization_generation,
          publicKey,
          createHash('sha256').update(publicKey).digest('hex'),
          { v: 1 },
          'synthetic',
          'pending',
        ],
      );
    } finally {
      await keys.end();
    }
    const created = await service.create(actor, productId, 'create-' + mode);
    assert.equal(created.kind, 'created');
    const saved = await service.save(actor, productId, {
      configId: created.configId,
      draftVersion: '1',
      draft: draft(),
      idempotencyKey: 'save-' + mode,
    });
    assert.equal(saved.kind, 'saved');
    const published = await service.publish(actor, productId, {
      configId: created.configId,
      draftVersion: saved.draftVersion,
      idempotencyKey: 'publish-' + mode,
    });
    assert.equal(published.kind, 'accepted');
    assert.ok(await core.configs.getRevisionGeometry(shopId, published.revisionId));
    if (mode !== 'pending') {
      const identity = { shopId, configId: created.configId, operationId: published.revisionId };
      assert.equal(remoteWrites, 0, 'First publication must wait for its owned hold');
      assert.equal((await activation.advance(identity)).kind, 'WAITING_HOLD');
      assert.equal((await activation.advance(identity)).kind, 'HELD');
      const held = await activation.read(identity);
      assert.equal(held.state.hold.operationId, published.revisionId);
      assert.equal(held.state.hold.held.productId, productId);
      assert.equal(held.state.hold.held.state, 'unavailable');
      const resumed = await service.publish(actor, productId, {
        configId: created.configId,
        draftVersion: saved.draftVersion,
        idempotencyKey: `publish-${mode}`,
      });
      assert.equal(resumed.kind, 'accepted');
      assert.equal(resumed.revisionId, published.revisionId);
    }
    if (mode === 'ready') {
      let phase;
      for (let attempt = 0; attempt < 6; attempt++) {
        const progress = await publication.advance(shopId, created.configId, published.revisionId);
        phase = progress.phase;
        if (phase === 'activation-pending') break;
      }
      assert.equal(phase, 'activation-pending');
      const view = await service.read(actor, productId);
      assert.equal(view.config.publication.state, 'HELD_ACTIVATION_PENDING');
      assert.equal(view.config.publication.functionReadiness, 'ACTIVATION_PENDING');
      assert.equal(view.config.publication.activeRevisionId, null);
    } else if (mode === 'conflict') {
      assert.equal((await publication.advance(shopId, created.configId, published.revisionId)).kind, 'CONFLICT');
      assert.equal((await service.read(actor, productId)).config.publication.state, 'CONFLICT');
    } else if (mode === 'pending') {
      assert.equal((await service.read(actor, productId)).config.publication.state, 'PUBLISH_REQUESTED');
      assert.equal(remoteWrites, 0, 'Missing admission must block every remote mutation');
    } else {
      await publication.advance(shopId, created.configId, published.revisionId);
      await publication.advance(shopId, created.configId, published.revisionId);
      assert.equal((await service.read(actor, productId)).config.publication.state, 'OPERATOR_HOLD');
    }
    const beforeReplayWrites = remoteWrites;
    eligible = false;
    const replay = await service.publish(actor, productId, {
      configId: created.configId,
      draftVersion: saved.draftVersion,
      idempotencyKey: 'publish-' + mode,
    });
    assert.equal(replay.kind, mode === 'pending' ? 'forbidden' : 'accepted');
    assert.equal(remoteWrites, beforeReplayWrites, 'Revoked entitlement replay must not write remotely');
  } finally {
    await core.close();
  }
}
test('actual M4 prepare/advance over immutable M5 revision reports ready, conflict and hold truthfully', {
  skip: !database,
  timeout: 30000,
}, async () => {
  for (const mode of ['ready', 'conflict', 'hold', 'pending']) await run(mode);
});
