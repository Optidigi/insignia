import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AdminActor } from '../../src/server/admin/contracts.ts';
import { prepareSigningForPublication } from '../../src/server/admin/publication-signing.ts';
import type { SigningOwnerStatus } from '../../src/server/admin/signing-owner-action.ts';
import { PUBLICATION_STEP_MARGIN_MS } from '../../src/server/merchant-config.ts';
import { activeSigningKey, automaticSigning } from './support/automatic-signing.mts';

const now = Date.parse('2026-11-25T12:00:00Z');
const actor = (tokenLeftMs: number): AdminActor => ({
  shop: 'alpha.myshopify.com',
  shopId: 'gid://shopify/Shop/1',
  installationId: 'current',
  tenantShopId: 'tenant-1',
  installationGeneration: '1',
  staffId: '123',
  sessionId: 'session-123',
  // The publish's own deadline is far off; only the session token is short.
  expiresAtMs: now + 55_000,
  sessionTokenExpiresAtMs: now + tokenLeftMs,
  canRead: true,
  canEdit: true,
});
const SHORT = PUBLICATION_STEP_MARGIN_MS - 1;
const USABLE = PUBLICATION_STEP_MARGIN_MS;
const automatic = (signing: ReturnType<typeof automaticSigning>['signing']) =>
  ({ kind: 'automatic', automatic: signing, token: 'synthetic-token', timezone: 'Europe/Amsterdam' }) as const;
const UNAVAILABLE = { ready: false, reason: 'Publication preparation is unavailable. Contact support.' };
const NEW_SESSION = { ready: false, reason: 'Publication needs a new session.', resend: true };

test('owner decision 25 Nov 2026: a store that still needs its key is resent when the token is too short to provision it', async () => {
  const h = automaticSigning([]);
  assert.deepEqual(await prepareSigningForPublication(actor(SHORT), automatic(h.signing), now), NEW_SESSION);
  assert.deepEqual(h.identityCalls, [], 'the short token was never used');
  // With the token's margin the same store provisions with that token, as before.
  const usable = automaticSigning([]);
  assert.deepEqual(await prepareSigningForPublication(actor(USABLE), automatic(usable.signing), now), UNAVAILABLE);
  assert.deepEqual(usable.identityCalls, ['verify'], 'provisioning started with the usable token');
});

test('owner decision 25 Nov 2026: a store that already has its key continues on a short or expired token', async () => {
  for (const tokenLeftMs of [SHORT, 0, -5_000]) {
    const h = automaticSigning([activeSigningKey]);
    assert.deepEqual(await prepareSigningForPublication(actor(tokenLeftMs), automatic(h.signing), now), {
      ready: true,
      reason: null,
    });
    assert.deepEqual(h.identityCalls, []);
  }
});

test('owner decision 25 Nov 2026: an owner plan is resent only while a usable token could still advance it', async () => {
  const owner = (state: SigningOwnerStatus['state']) => {
    const calls: string[] = [];
    const status = {
      version: 'm5-signing-owner-action-v1',
      state,
      actionAvailable: false,
      retryAuthorized: false,
      quoteIssuanceAuthorized: false,
    } as const;
    return {
      calls,
      signing: {
        kind: 'owner',
        token: 'synthetic-token',
        owner: {
          status: async () => {
            calls.push('status');
            return status;
          },
          prepare: async () => {
            calls.push('prepare');
            return status;
          },
        },
      } as const,
    };
  };
  const expected: [SigningOwnerStatus['state'], object][] = [
    ['READY', NEW_SESSION],
    ['PENDING', NEW_SESSION],
    ['PROVISIONED', { ready: true, reason: null }],
    ['STOPPED', UNAVAILABLE],
    ['UNCERTAIN', UNAVAILABLE],
    ['WAITING_FOR_VERIFICATION', UNAVAILABLE],
  ];
  for (const [state, outcome] of expected) {
    const h = owner(state);
    assert.deepEqual(await prepareSigningForPublication(actor(SHORT), h.signing, now), outcome, state);
    assert.deepEqual(h.calls, ['status'], `${state}: the short token was never used`);
  }
  // A usable token prepares (and may provision) as before.
  const usable = owner('PROVISIONED');
  assert.deepEqual(await prepareSigningForPublication(actor(USABLE), usable.signing, now), {
    ready: true,
    reason: null,
  });
  assert.deepEqual(usable.calls, ['prepare']);
  const stopped = owner('STOPPED');
  assert.deepEqual(await prepareSigningForPublication(actor(USABLE), stopped.signing, now), UNAVAILABLE);
});
