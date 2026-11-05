import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { createMerchantPreferences } from '../../src/server/admin/preferences.ts';
import { adminActor } from './support/fixtures.mts';

const connectionString = process.env.DATABASE_URL;
test('store preferences share guidance and live wording across staff while CAS, replay and tenants remain isolated', {
  skip: !connectionString,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString }));
  const makeActor = () => {
    const id = randomUUID();
    return adminActor({
      tenantShopId: id,
      shop: `preferences-${id}.myshopify.com`,
      shopId: `gid://shopify/Shop/${BigInt(`0x${id.replaceAll('-', '').slice(0, 12)}`)}`,
      installationGeneration: '1',
      canRead: true,
      canEdit: true,
    });
  };
  const a = makeActor(),
    b = makeActor();
  const service = createMerchantPreferences(core);
  try {
    for (const actor of [a, b])
      await core.transactions.run((tx) =>
        core.tenants.createShop(tx, {
          shopId: actor.tenantShopId,
          shopDomain: actor.shop,
          shopifyShopId: actor.shopId.split('/').at(-1),
        }),
      );
    const initial = await service.read(a);
    assert.equal(initial.guidanceVersion, '0');
    assert.equal(initial.canEdit, true);
    assert.equal(initial.canReadPrivacy, false, 'Product editing is not privacy authority');
    assert.equal((await service.read({ ...a, canReadOrders: true, canReadArtwork: false })).canReadPrivacy, false);
    assert.equal((await service.read({ ...a, canReadOrders: false, canReadArtwork: true })).canReadPrivacy, false);
    assert.equal(
      (await service.read({ ...a, canEdit: false, canReadOrders: true, canReadArtwork: true })).canReadPrivacy,
      true,
      'An authorized owner may view privacy even without product edit permission',
    );
    assert.equal((await service.read({ ...a, canEdit: false })).canEdit, false);
    const guidance = { dismissed: true, completedSteps: ['product', 'test'] as ('product' | 'test')[] };
    const first = await service.save(
      a,
      { action: 'guidance', authority: initial.authority, expectedVersion: '0', guidance },
      'guidance-write-1',
    );
    assert.equal(first.kind, 'saved');
    assert.deepEqual(
      await service.save(
        a,
        { action: 'guidance', authority: initial.authority, expectedVersion: '0', guidance },
        'guidance-write-1',
      ),
      first,
    );
    assert.deepEqual((await service.read({ ...a, staffId: 'other-staff' })).guidance, guidance);
    assert.deepEqual((await service.read(b)).guidance.completedSteps, []);
    assert.equal(
      (
        await service.save(
          a,
          {
            action: 'guidance',
            authority: initial.authority,
            expectedVersion: '0',
            guidance: { ...guidance, dismissed: false },
          },
          'guidance-stale-1',
        )
      ).kind,
      'conflict',
    );
    const overlays = {
      en: { locale: 'en', messages: {} },
      nl: { locale: 'nl', messages: { 'customer:steps.done': { message: 'Gereed' } } },
    };
    const wording = await service.save(
      a,
      { action: 'wording', authority: initial.authority, expectedVersion: '0', overlays },
      'wording-write-1',
    );
    assert.equal(
      wording.kind,
      'saved',
      'guidance updates must not conflict with a separately versioned wording section',
    );
    assert.equal((await service.read(a)).overlays.nl?.messages['customer:steps.done']?.message, 'Gereed');
    const publicWording = await core.transactions.run((tx) =>
      core.preferences.readWording(tx, { shopId: a.tenantShopId, installationGeneration: '1' }),
    );
    assert.deepEqual(Object.keys(publicWording ?? {}).sort(), ['overlays', 'wordingVersion']);
    assert.equal(publicWording?.overlays.nl?.messages['customer:steps.done']?.message, 'Gereed');
    assert.equal(
      await core.transactions.run((tx) =>
        core.preferences.readWording(tx, { shopId: a.tenantShopId, installationGeneration: '2' }),
      ),
      null,
    );
    await assert.rejects(
      () =>
        service.save(
          a,
          {
            action: 'wording',
            authority: initial.authority,
            expectedVersion: '1',
            overlays: { en: { locale: 'en', messages: { 'customer:steps.done': { message: '<b>Bad</b>' } } } },
          },
          'wording-invalid-1',
        ),
      /invalid|wording/i,
    );
    await assert.rejects(
      () =>
        service.save(
          { ...a, canEdit: false },
          { action: 'guidance', authority: initial.authority, expectedVersion: '1', guidance },
          'guidance-denied-1',
        ),
      /permission/i,
    );
    await assert.rejects(() => service.read({ ...a, tenantShopId: b.tenantShopId }), /installation|tenant/i);
    await assert.rejects(
      () =>
        service.save(
          a,
          { action: 'guidance', authority: '0'.repeat(64), expectedVersion: '1', guidance },
          'guidance-stale-authority',
        ),
      /authority/i,
    );
    await assert.rejects(
      () =>
        service.save(
          a,
          {
            action: 'guidance',
            authority: initial.authority,
            expectedVersion: '0',
            guidance: { ...guidance, dismissed: false },
          },
          'guidance-write-1',
        ),
      /digest|request/i,
    );
    const concurrent = await Promise.all(
      [false, true].map((dismissed, index) =>
        service.save(
          a,
          {
            action: 'guidance',
            authority: initial.authority,
            expectedVersion: '1',
            guidance: { dismissed, completedSteps: [] },
          },
          `guidance-concurrent-${index}`,
        ),
      ),
    );
    assert.equal(concurrent.filter((outcome) => outcome.kind === 'saved').length, 1);
    assert.equal(concurrent.filter((outcome) => outcome.kind === 'conflict').length, 1);
  } finally {
    await core.close();
  }
});
