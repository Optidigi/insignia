import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AdminActor } from '../../src/server/admin/contracts.ts';
import { NON_EXPIRING_LAST_DAY } from '../../src/server/admin/signing-automatic.ts';
import { activeSigningKey, automaticSigning, SIGNING_DAY } from './support/automatic-signing.mts';

const actor: AdminActor = {
  shop: 'alpha.myshopify.com',
  shopId: 'gid://shopify/Shop/1',
  installationId: 'current',
  tenantShopId: 'tenant-1',
  installationGeneration: '1',
  staffId: '123',
  sessionId: 'session-123',
  expiresAtMs: Date.now() + 60_000,
  canRead: true,
  canEdit: true,
};

test('owner decision 25 Nov 2026: without a usable session token a store with its key is READY', async () => {
  const h = automaticSigning([activeSigningKey]);
  assert.equal(await h.signing.ensure(actor, null, 'Europe/Amsterdam'), 'READY');
  assert.deepEqual(h.identityCalls, []);
});

test('owner decision 25 Nov 2026: without a usable session token a store that needs its key is asked to resend', async () => {
  for (const rows of [[], [{ id: 1, state: 'pending', firstDay: SIGNING_DAY - 1, lastDay: NON_EXPIRING_LAST_DAY }]]) {
    const h = automaticSigning(rows);
    assert.equal(await h.signing.ensure(actor, null, 'Europe/Amsterdam'), 'SESSION_REQUIRED');
    assert.deepEqual(h.identityCalls, [], 'nothing was provisioned or exchanged');
  }
  // Owner-held keys stay an owner action, with or without a token.
  const owned = automaticSigning([{ id: 4, state: 'retired', firstDay: 1, lastDay: 2 }]);
  assert.equal(await owned.signing.ensure(actor, null, 'Europe/Amsterdam'), 'OWNER_ACTION_REQUIRED');
});
