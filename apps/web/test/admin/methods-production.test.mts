import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CONFIG_DRAFT_STORAGE_VERSION, createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { createMethodLibrary } from '../../src/server/admin/methods.ts';
import { adminActor, required } from './support/fixtures.mts';

const connectionString = process.env.DATABASE_URL;
test('durable method templates isolate tenants, replay commands, CAS edits, preserve copied drafts and reject stale installations', {
  skip: !connectionString,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString }));
  function actor() {
    const id = randomUUID();
    return adminActor({
      tenantShopId: id,
      shop: `method-${id}.myshopify.com`,
      shopId: `gid://shopify/Shop/${BigInt(`0x${id.replaceAll('-', '').slice(0, 12)}`)}`,
      installationGeneration: '1',
      canRead: true,
      canEdit: true,
    });
  }
  const a = actor(),
    b = actor();
  const service = createMethodLibrary(core);
  try {
    for (const current of [a, b])
      await core.transactions.run((tx) =>
        core.tenants.createShop(tx, {
          shopId: current.tenantShopId,
          shopDomain: current.shop,
          shopifyShopId: current.shopId.split('/').at(-1),
        }),
      );
    const [first, replay] = await Promise.all([
      service.create(a, 'Embroidery', 'create-method-1'),
      service.create(a, 'Embroidery', 'create-method-1'),
    ]);
    assert.equal(first.kind, 'created');
    assert.deepEqual(first, replay);
    assert.equal(first.method.version, '1');
    const authorization = await core.tenants.getActiveAuthorizationScope({
      shopId: a.tenantShopId,
      installationGeneration: '1',
    });
    const recorded = await core.commands.lookup({
      shopId: a.tenantShopId,
      namespace: `merchant-method-create:1:${required(authorization).authorizationGeneration}`,
      key: 'create-method-1',
    });
    assert.ok(recorded);
    assert.equal(required(recorded.resultRef).includes('Embroidery'), false);
    assert.equal(required(recorded.resultRef).includes(first.method.id), true);

    await assert.rejects(() => service.create(a, 'Print', 'create-method-1'), /digest|request/i);
    assert.deepEqual(await service.list(b), { methods: [] });
    // Tenant locking also bounds concurrent distinct-key additions, not just replays.
    const filled = await Promise.all(
      Array.from({ length: 100 }, (_, index) => service.create(b, `Method ${index}`, `fill-method-${index}`)),
    );
    assert.equal(filled.filter((result) => result.kind === 'created').length, 100);
    assert.equal((await service.create(b, 'Over capacity', 'method-over-capacity')).kind, 'conflict');
    assert.equal((await service.list(b)).methods.length, 100);

    assert.equal((await service.rename(b, first.method.id, '1', 'Foreign', 'foreign-rename')).kind, 'conflict');
    const configId = randomUUID();
    const draft = { methods: [{ id: 'product-method-1' }], labels: { methods: { 'product-method-1': 'Embroidery' } } };
    await core.transactions.run((tx) =>
      core.configs.createConfig(tx, {
        shopId: a.tenantShopId,
        configId,
        externalProductId: '111',
        draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
        draftValue: draft,
      }),
    );
    const renamed = await service.rename(a, first.method.id, '1', 'Thread embroidery', 'rename-method-1');
    assert.equal(renamed.kind, 'saved');
    assert.equal(renamed.method.version, '2');
    assert.equal((await service.create(a, 'Embroidery', 'create-method-1')).kind, 'conflict');

    assert.equal((await service.rename(a, first.method.id, '1', 'Stale', 'rename-stale')).kind, 'conflict');
    assert.equal((await service.delete(a, first.method.id, '1', 'delete-stale')).kind, 'conflict');
    assert.deepEqual(await service.delete(a, first.method.id, '2', 'delete-method-1'), { kind: 'deleted' });
    assert.deepEqual(await service.delete(a, first.method.id, '2', 'delete-method-1'), { kind: 'deleted' });
    assert.deepEqual(await service.list(a), { methods: [] });
    assert.deepEqual(required(await core.configs.getConfig(a.tenantShopId, configId)).draftValue, draft);
    await core.transactions.run((tx) => core.tenants.deactivateCurrent(tx, a.tenantShopId, '1'));
    await assert.rejects(() => service.list(a), /Current tenant/);
    await assert.rejects(() => service.create(a, 'Embroidery', 'create-method-1'), /Current tenant/);
    const generation = await core.transactions.run((tx) => core.tenants.startInstallation(tx, a.tenantShopId));
    const reinstalled = { ...a, installationGeneration: generation };
    const fresh = await service.create(reinstalled, 'New install method', 'create-method-1');
    assert.equal(fresh.kind, 'created');
    assert.notEqual(fresh.method.id, first.method.id);
    assert.equal(fresh.method.name, 'New install method');
    assert.deepEqual((await service.list(reinstalled)).methods, [fresh.method]);

    await assert.rejects(() => service.create(b, 'x'.repeat(81), 'long-method'), /Invalid/);
  } finally {
    await core.close();
  }
});
