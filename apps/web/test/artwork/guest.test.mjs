import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createArtworkGuestAuthority } from '../../src/server/artwork/guest.ts';
import { handleArtworkRequest } from '../../src/server/artwork/http.ts';

test('oversized unauthenticated bodies are denied promptly without consuming another stream branch', async () => {
  let routingCalls = 0;
  const authority = createArtworkGuestAuthority({
    secret: 'synthetic-body-bound',
    verifyProxy: async () => {
      routingCalls++;
      return null;
    },
    core: {},
  });
  const request = new Request('https://app.invalid/api/artwork/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'x'.repeat(4096),
  });
  const verification = authority.verify(request);
  let timer;
  try {
    assert.equal(
      await Promise.race([
        verification,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve('blocked'), 200);
        }),
      ]),
      null,
    );
    assert.equal(routingCalls, 0);
  } finally {
    clearTimeout(timer);
    if (!request.bodyUsed) void request.body.cancel();
  }
});

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
  const admission = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capability: grant.token, contentType: 'image/png', byteLength: 3 }),
  });
  let admitted;
  const response = await handleArtworkRequest(
    admission,
    {
      appOrigin: 'https://app.invalid',
      authenticate: async () => null,
      verifyGuest: authority.verify,
      ensureInspectionReady: async () => {},
      artwork: {
        begin: async (scope, declaration) => {
          admitted = { scope, declaration };
          return { state: 'UPLOADING' };
        },
      },
    },
    { audience: 'guest', kind: 'begin' },
  );
  assert.equal(response.status, 201);
  assert.equal(admitted.scope.ownerHash, scope.ownerHash);
  assert.deepEqual(admitted.declaration, { contentType: 'image/png', byteLength: 3 });
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
  const [tokenBody, tokenSignature] = grant.token.split('.');
  const alteredSignature = Buffer.from(tokenSignature, 'base64url');
  // Change authenticated bytes, not unused base64url padding bits.
  alteredSignature[0] ^= 1;
  assert.equal(
    await authority.verify(
      new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability: `${tokenBody}.${alteredSignature.toString('base64url')}` }),
      }),
    ),
    null,
  );
  assert.equal(
    (
      await authority.verify(
        new Request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'https://storefront.example.test' },
          body: JSON.stringify({ capability: grant.token }),
        }),
      )
    )?.ownerHash,
    scope.ownerHash,
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

test('stalled body readers have a finite authentication deadline even if cancellation stalls', async () => {
  const authority = createArtworkGuestAuthority({
    secret: 'synthetic-body-bound',
    verifyProxy: async () => null,
    core: {},
  });
  const stream = new ReadableStream({ pull: () => new Promise(() => {}), cancel: () => new Promise(() => {}) });
  const request = new Request('https://app.invalid/api/artwork/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: stream,
    duplex: 'half',
  });
  const started = Date.now();
  assert.equal(await authority.verify(request), null);
  assert.ok(Date.now() - started < 4000);
});
