import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createArtworkGuestAuthority } from '../../src/server/artwork/guest.ts';

test('guest resource capability requires current signed routing, publication, generation and session ownership', async () => {
  let now = 1000000,
    generation = '1',
    published = true,
    signedShop = 'alpha.myshopify.com';
  const authority = createArtworkGuestAuthority({
    clock: () => now,
    secret: 'synthetic-guest-session-key',
    verifyProxy: async () => ({ shop: signedShop }),
    core: {
      tenants: {
        getShopByDomain: async (shop) =>
          shop === 'alpha.myshopify.com'
            ? { shopId: 'tenant-1', shopDomain: shop, currentGeneration: generation }
            : null,
        getCurrentAdminInstallation: async () => ({ active: true, generation }),
      },
      acceptedQuotes: { getEffective: async (_shop, product) => (published && product === '123' ? {} : null) },
    },
  });
  const url = 'https://app.invalid/api/artwork/guest/session?productId=123';
  const grant = await authority.issue(new Request(url));
  assert.ok(grant);
  const request = () =>
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://alpha.myshopify.com' },
      body: JSON.stringify({ capability: grant.token }),
    });
  const scope = await authority.verify(request());
  assert.equal(scope.shopId, 'tenant-1');
  assert.equal(scope.installationGeneration, '1');
  assert.match(scope.ownerHash, /^[a-f0-9]{64}$/);
  const another = await authority.issue(new Request(url));
  assert.notEqual(
    (
      await authority.verify(
        new Request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ capability: another.token }),
        }),
      )
    ).ownerHash,
    scope.ownerHash,
  );
  assert.equal(
    await authority.verify(
      new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability: grant.token.slice(0, -2) + 'aa' }),
      }),
    ),
    null,
  );
  assert.equal(
    await authority.verify(
      new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://foreign.invalid' },
        body: JSON.stringify({ capability: grant.token }),
      }),
    ),
    null,
  );
  generation = '2';
  assert.equal(await authority.verify(request()), null);
  generation = '1';
  published = false;
  assert.equal(await authority.verify(request()), null);
  published = true;
  signedShop = 'foreign.myshopify.com';
  assert.equal(await authority.verify(request()), null);
  signedShop = 'alpha.myshopify.com';
  assert.equal(await authority.issue(new Request(url + '&productId=456')), null);
  now += 4 * 60 * 60 * 1000;
  assert.equal(await authority.verify(request()), null);
});
