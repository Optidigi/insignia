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

test('rich method configuration survives reload, isolates tenants and detects version conflicts without changing copied drafts', {
  skip: !connectionString,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString }));
  const tenantShopId = randomUUID();
  const actor = adminActor({
    tenantShopId,
    shop: `rich-${tenantShopId}.myshopify.com`,
    shopId: `gid://shopify/Shop/${BigInt(`0x${tenantShopId.replaceAll('-', '').slice(0, 12)}`)}`,
    installationGeneration: '1',
    canRead: true,
    canEdit: true,
  });
  try {
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, {
        shopId: tenantShopId,
        shopDomain: actor.shop,
        shopifyShopId: actor.shopId.split('/').at(-1),
      }),
    );
    const service = createMethodLibrary(core, { currency: async () => 'USD' });
    assert.ok(service.saveConfiguration);
    assert.ok(service.catalog);
    const configuration = {
      id: randomUUID(),
      name: 'Print',
      explanation: 'Full colour',
      pricing: 'fixed' as const,
      amount: '3.50',
      assignment: 'tags' as const,
      productIds: [],
      tags: ['shirts'],
      tagMatch: 'all' as const,
      translations: { nl: { name: 'Bedrukking', explanation: 'In kleur' } },
    };
    const created = await service.saveConfiguration(actor, configuration, null, 'rich-method-create');
    assert.equal(created.kind, 'created');
    assert.deepEqual(await service.saveConfiguration(actor, configuration, null, 'rich-method-create'), created);
    const reloaded = createMethodLibrary(core, { currency: async () => 'USD' });
    assert.ok(reloaded.catalog);
    const catalog = await reloaded.catalog(actor);
    assert.deepEqual(catalog.methods, [{ configuration, version: '1', currency: 'USD' }]);
    assert.equal(catalog.shop, actor.shop);
    assert.match(catalog.authority ?? '', /^[a-f0-9]{64}$/);
    const updated = { ...configuration, amount: '4.00' };
    const saved = await service.saveConfiguration(actor, updated, '1', 'rich-method-update');
    assert.equal(saved.kind, 'saved');
    assert.equal((await service.saveConfiguration(actor, configuration, '1', 'rich-method-stale')).kind, 'conflict');
    assert.equal((await service.saveConfiguration(actor, configuration, null, 'rich-method-create')).kind, 'conflict');
    assert.equal((await service.rename(actor, configuration.id, '2', 'Printing', 'rich-rename')).kind, 'saved');
    assert.deepEqual((await service.catalog(actor)).methods[0]?.configuration, { ...updated, name: 'Printing' });
    assert.equal((await service.delete(actor, configuration.id, '3', 'rich-delete')).kind, 'deleted');
    assert.deepEqual((await service.catalog(actor)).methods, []);
  } finally {
    await core.close();
  }
});

test('rich Method price currency remains frozen until an explicit current-currency save', {
  skip: !connectionString,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString }));
  const tenantShopId = randomUUID();
  const actor = adminActor({
    tenantShopId,
    shop: `currency-${tenantShopId}.myshopify.com`,
    shopId: `gid://shopify/Shop/${BigInt(`0x${tenantShopId.replaceAll('-', '').slice(0, 12)}`)}`,
    installationGeneration: '1',
    canRead: true,
    canEdit: true,
  });
  let currency = 'USD';
  try {
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, {
        shopId: tenantShopId,
        shopDomain: actor.shop,
        shopifyShopId: actor.shopId.split('/').at(-1),
      }),
    );
    const methods = createMethodLibrary(core, { currency: async () => currency });
    assert.ok(methods.saveConfiguration);
    assert.ok(methods.catalog);
    const configuration = {
      id: randomUUID(),
      name: 'Print',
      explanation: '',
      pricing: 'fixed' as const,
      amount: '3.50',
      assignment: 'manual' as const,
      productIds: [],
      tags: [],
      tagMatch: 'any' as const,
    };
    await methods.saveConfiguration(actor, configuration, null, 'price-currency-create', undefined, 'USD');
    currency = 'EUR';
    const observed = await methods.catalog(actor);
    assert.equal(observed.currency, 'EUR');
    assert.equal(observed.methods[0]?.currency, 'USD');
    await assert.rejects(
      methods.saveConfiguration(actor, configuration, '1', 'price-currency-stale', undefined, 'USD'),
      /currency changed/,
    );
    assert.equal((await methods.catalog(actor)).methods[0]?.version, '1');
    const saved = await methods.saveConfiguration(
      actor,
      { ...configuration, amount: '4.00' },
      '1',
      'price-currency-reviewed',
      undefined,
      'EUR',
    );
    assert.equal(saved.kind, 'saved');
    if (saved.kind === 'saved') assert.equal(saved.method.currency, 'EUR');
  } finally {
    await core.close();
  }
});

test('Methods and preferences expose one frozen authoring authority and both reject its stale generation', {
  skip: !connectionString,
}, async () => {
  const { createMerchantPreferences } = await import('../../src/server/admin/preferences.ts');
  const core = createDurableCore(new Pool({ connectionString }));
  const tenant = randomUUID();
  const actor = adminActor({
    tenantShopId: tenant,
    shop: `authority-${tenant}.myshopify.com`,
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
    const methods = createMethodLibrary(core, { currency: async () => 'USD' });
    assert.ok(methods.catalog);
    assert.ok(methods.saveConfiguration);
    const prefs = createMerchantPreferences(core);
    const before = await prefs.read(actor);
    assert.equal((await methods.catalog(actor)).authority, before.authority);
    assert.equal((await methods.catalog(actor)).canEdit, true);
    assert.equal((await methods.catalog({ ...actor, canEdit: false })).canEdit, false);
    await core.transactions.run((tx) => core.tenants.deactivateCurrent(tx, tenant, '1'));
    const generation = await core.transactions.run((tx) => core.tenants.startInstallation(tx, tenant));
    const next = { ...actor, installationGeneration: generation };
    const after = await prefs.read(next);
    assert.equal((await methods.catalog(next)).authority, after.authority);
    assert.notEqual(after.authority, before.authority);
    const configuration = {
      id: randomUUID(),
      name: 'Print',
      explanation: '',
      pricing: 'fixed' as const,
      amount: '3.50',
      assignment: 'manual' as const,
      productIds: [],
      tags: [],
      tagMatch: 'any' as const,
    };
    await assert.rejects(
      methods.saveConfiguration(next, configuration, null, 'stale-method-authority', before.authority, 'USD'),
      /authorization changed/,
    );
    await assert.rejects(
      prefs.save(
        next,
        {
          action: 'guidance',
          authority: before.authority,
          expectedVersion: before.guidanceVersion,
          guidance: before.guidance,
        },
        'stale-pref-authority',
      ),
      /preferences authority/,
    );
  } finally {
    await core.close();
  }
});
