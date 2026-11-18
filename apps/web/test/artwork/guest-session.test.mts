import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleGuestArtworkSession } from '../../src/server/artwork/guest-session.ts';

const secret = 'password=SECRET-9f2c for alpha.myshopify.com gid://shopify/Product/10485042479387';
const sessionRequest = () =>
  new Request('https://app.example.test/api/artwork/guest/session?shop=alpha.myshopify.com&signature=synthetic', {
    headers: { Cookie: 'synthetic-cookie' },
  });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function snapshot(response: Response) {
  return { status: response.status, headers: [...response.headers], body: await response.text() };
}

test('an unexpected guest session failure records one buyer failure and keeps the same 503', async () => {
  const recorded: unknown[] = [];
  const failures: unknown[] = [
    new TypeError(secret),
    Object.assign(new RangeError(secret), { code: 'ERR_INJECTED_FAILURE' }),
  ];
  const expected = await snapshot(
    await handleGuestArtworkSession(sessionRequest(), { services: async () => undefined }),
  );
  for (const failure of failures) {
    const response = await handleGuestArtworkSession(sessionRequest(), {
      services: async () => ({
        issueGuest: async () => {
          throw failure;
        },
      }),
      recordBuyerFailure: (value) => recorded.push(value),
    });
    assert.deepEqual(await snapshot(response), expected);
  }
  // Composition itself failing is the same unexpected branch.
  const composed = await handleGuestArtworkSession(sessionRequest(), {
    services: async () => {
      throw new Error(secret);
    },
    recordBuyerFailure: (value) => recorded.push(value),
  });
  assert.deepEqual(await snapshot(composed), expected);
  assert.equal(recorded.length, 3);
  for (const value of recorded as Record<string, unknown>[]) {
    assert.deepEqual(Object.keys(value).sort(), ['buyerStage', 'correlationId', 'errorClass']);
    assert.equal(value.buyerStage, 'artwork-session');
    assert.match(String(value.correlationId), UUID);
  }
  assert.deepEqual(
    (recorded as Record<string, unknown>[]).map((value) => value.errorClass),
    ['TypeError', 'UnexpectedFailure', 'UnexpectedFailure'],
  );
  assert.doesNotMatch(JSON.stringify(recorded), /SECRET|myshopify|gid:|10485042479387|synthetic|ERR_INJECTED/i);

  const still = await handleGuestArtworkSession(sessionRequest(), {
    services: async () => ({
      issueGuest: async () => {
        throw new Error(secret);
      },
    }),
    recordBuyerFailure: () => {
      throw new Error('recorder down');
    },
  });
  assert.deepEqual(await snapshot(still), expected);
});

test('handled guest session outcomes are not recorded as unexpected failures', async () => {
  const recorded: unknown[] = [];
  const recordBuyerFailure = (value: unknown) => recorded.push(value);
  const unconfigured = await handleGuestArtworkSession(sessionRequest(), {
    services: async () => undefined,
    recordBuyerFailure,
  });
  assert.equal(unconfigured.status, 503);
  assert.deepEqual(await unconfigured.json(), { error: 'Artwork session unavailable' });
  const noGuest = await handleGuestArtworkSession(sessionRequest(), { services: async () => ({}), recordBuyerFailure });
  assert.equal(noGuest.status, 503);
  const denied = await handleGuestArtworkSession(sessionRequest(), {
    services: async () => ({ issueGuest: async () => null }),
    recordBuyerFailure,
  });
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { error: 'Artwork session denied' });
  const issued = await handleGuestArtworkSession(sessionRequest(), {
    services: async () => ({ issueGuest: async () => ({ token: 'a.b', expiresAt: '2026-11-17T00:00:00.000Z' }) }),
    recordBuyerFailure,
  });
  assert.equal(issued.status, 200);
  assert.deepEqual(await issued.json(), { token: 'a.b', expiresAt: '2026-11-17T00:00:00.000Z' });
  assert.match(issued.headers.get('Cache-Control') ?? '', /no-store/);
  assert.deepEqual(recorded, []);
});

test('an issued guest session returns only token and expiresAt, even when the issuer returns more', async () => {
  const minimal = await snapshot(
    await handleGuestArtworkSession(sessionRequest(), {
      services: async () => ({ issueGuest: async () => ({ token: 'a.b', expiresAt: '2026-11-17T00:00:00.000Z' }) }),
    }),
  );
  // Production's issuer also returns the derived artwork scope; it must never reach the browser.
  const issued = {
    token: 'a.b',
    expiresAt: '2026-11-17T00:00:00.000Z',
    scope: { kind: 'guest' as const, shopId: 'shop-1', installationGeneration: 7, ownerHash: 'f'.repeat(64) },
  };
  const response = await handleGuestArtworkSession(sessionRequest(), {
    services: async () => ({ issueGuest: async () => issued }),
  });
  const actual = await snapshot(response);
  assert.equal(actual.status, 200);
  assert.deepEqual(Object.keys(JSON.parse(actual.body)).sort(), ['expiresAt', 'token']);
  assert.deepEqual(actual, minimal);
});
