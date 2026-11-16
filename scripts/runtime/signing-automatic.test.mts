import assert from 'node:assert/strict';
import test from 'node:test';
import type { AdminActor } from '../../apps/web/src/server/admin/contracts.ts';
import {
  createAutomaticSigningProvision,
  NON_EXPIRING_LAST_DAY,
} from '../../apps/web/src/server/admin/signing-automatic.ts';
import { fixture } from '../../apps/web/test/admin/support/signing-owner-fixture.mts';
import * as app from '../../packages/application/dist/index.js';

const shop = 'synthetic-second-store.myshopify.com';
const clockStart = Date.parse('2026-10-11T12:00:00.000Z');
const today = app.localDay(new Date(clockStart), 'Asia/Tokyo').ordinal;
function actor(overrides: Partial<AdminActor> = {}): AdminActor {
  return {
    shop,
    shopId: 'gid://shopify/Shop/123',
    installationId: 'gid://shopify/AppInstallation/321',
    tenantShopId: 'synthetic-shop',
    installationGeneration: '1',
    staffId: '1',
    sessionId: 'synthetic-session',
    canRead: true,
    canEdit: true,
    expiresAtMs: clockStart + 60000,
    ...overrides,
  } as AdminActor;
}
async function setup() {
  const f = await fixture({ shop });
  const { journal: _journal, ...ports } = f.ports;
  return { f, automatic: createAutomaticSigningProvision(ports) };
}

test('a store with no key gets one non-expiring key on its first publish, then needs nothing', async () => {
  const { f, automatic } = await setup();
  try {
    assert.equal(await automatic.ensure(actor(), 'SYNTHETIC_ID_TOKEN', 'Asia/Tokyo'), 'PROVISIONED');
    assert.equal(f.provisioned.length, 1);
    assert.deepEqual(
      { keyId: f.provisioned[0]?.keyId, firstDay: f.provisioned[0]?.firstDay, lastDay: f.provisioned[0]?.lastDay },
      { keyId: 1, firstDay: today - 1, lastDay: NON_EXPIRING_LAST_DAY },
    );
    assert.deepEqual(
      f.rows.map((row) => [row.id, row.state]),
      [[1, 'active']],
    );
    // The key's public half is published, so quotes can be issued.
    assert.equal(f.publicValue(), (await f.lifecycle.desiredPublicConfig(f.scope)).value);
    assert.equal(await automatic.ensure(actor(), 'SYNTHETIC_ID_TOKEN', 'Asia/Tokyo'), 'READY');
    assert.equal(f.provisioned.length, 1, 'An active key is never provisioned again');
  } finally {
    await f.close();
  }
});

test('concurrent publishes on one store share one provisioning run', async () => {
  const { f, automatic } = await setup();
  try {
    const states = await Promise.all([
      automatic.ensure(actor(), 'SYNTHETIC_ID_TOKEN', 'Asia/Tokyo'),
      automatic.ensure(actor(), 'SYNTHETIC_ID_TOKEN', 'Asia/Tokyo'),
    ]);
    assert.deepEqual(states, ['PROVISIONED', 'PROVISIONED']);
    assert.equal(f.provisioned.length, 1);
  } finally {
    await f.close();
  }
});

test('another staff session or store cannot provision a key for this publish', async () => {
  for (const other of [{ staffId: '2' }, { sessionId: 'other-session' }, { shop: 'other.myshopify.com' }]) {
    const { f, automatic } = await setup();
    try {
      assert.equal(await automatic.ensure(actor(other), 'SYNTHETIC_ID_TOKEN', 'Asia/Tokyo'), 'STOPPED');
      assert.equal(f.provisioned.length, 0);
      assert.equal(f.rows.length, 0);
      assert.equal(f.publicValue(), null);
    } finally {
      await f.close();
    }
  }
  const { f, automatic: readOnly } = await setup();
  try {
    assert.throws(() => readOnly.ensure(actor({ canEdit: false }), 'SYNTHETIC_ID_TOKEN', 'Asia/Tokyo'));
    assert.throws(() => readOnly.ensure(actor(), 'two words', 'Asia/Tokyo'));
  } finally {
    await f.close();
  }
});

test('an active key that no longer covers today is left to the owner', async () => {
  const { f, automatic } = await setup();
  try {
    assert.equal(await automatic.ensure(actor(), 'SYNTHETIC_ID_TOKEN', 'Asia/Tokyo'), 'PROVISIONED');
    const key = f.rows[0];
    assert.ok(key);
    key.lastDay = today + 1;
    assert.equal(await automatic.ensure(actor(), 'SYNTHETIC_ID_TOKEN', 'Asia/Tokyo'), 'OWNER_ACTION_REQUIRED');
    assert.equal(f.provisioned.length, 1);
  } finally {
    await f.close();
  }
});

test('without fresh release evidence nothing is created', async () => {
  const { f, automatic } = await setup();
  try {
    f.setReleaseReader(async () => null);
    assert.equal(await automatic.ensure(actor(), 'SYNTHETIC_ID_TOKEN', 'Asia/Tokyo'), 'STOPPED');
    assert.equal(f.provisioned.length, 0);
    assert.equal(f.rows.length, 0);
  } finally {
    await f.close();
  }
});

test('a stopped run is resumed with its pending key, never a second seed', async () => {
  const { f, automatic } = await setup();
  try {
    // An earlier run stopped after the signer created its pending key, on an earlier day.
    await f.ports.signer.provision({
      version: 1,
      scope: f.scope,
      keyId: 4,
      firstDay: today - 5,
      lastDay: NON_EXPIRING_LAST_DAY,
    });
    assert.deepEqual(
      f.rows.map((row) => [row.id, row.state]),
      [[4, 'pending']],
    );
    assert.equal(await automatic.ensure(actor(), 'SYNTHETIC_ID_TOKEN', 'Asia/Tokyo'), 'PROVISIONED');
    assert.equal(f.provisioned.length, 1, 'The pending key is activated, not replaced');
    assert.deepEqual(
      f.rows.map((row) => [row.id, row.state]),
      [[4, 'active']],
    );
  } finally {
    await f.close();
  }
});

test('a store whose keys the owner revoked or is rotating gets no automatic key', async () => {
  const { f, automatic } = await setup();
  try {
    assert.equal(await automatic.ensure(actor(), 'SYNTHETIC_ID_TOKEN', 'Asia/Tokyo'), 'PROVISIONED');
    const key = f.rows[0];
    assert.ok(key);
    key.state = 'revoked';
    assert.equal(await automatic.ensure(actor(), 'SYNTHETIC_ID_TOKEN', 'Asia/Tokyo'), 'OWNER_ACTION_REQUIRED');
    assert.equal(f.provisioned.length, 1);
  } finally {
    await f.close();
  }
  const owner = await setup();
  try {
    // An owner's rotation plan left a pending key with a bounded window: not this flow's to resume.
    await owner.f.ports.signer.provision({
      version: 1,
      scope: owner.f.scope,
      keyId: 2,
      firstDay: today - 1,
      lastDay: today + 30,
    });
    assert.equal(await owner.automatic.ensure(actor(), 'SYNTHETIC_ID_TOKEN', 'Asia/Tokyo'), 'OWNER_ACTION_REQUIRED');
    assert.equal(owner.f.provisioned.length, 1);
  } finally {
    await owner.f.close();
  }
});
