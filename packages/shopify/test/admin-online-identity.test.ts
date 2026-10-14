import { createHmac } from 'node:crypto';
import { InvalidJwtError } from '@shopify/shopify-api';
import { abstractFetch, setAbstractFetchFunc } from '@shopify/shopify-api/runtime';
import { describe, expect, it, vi } from 'vitest';
import {
  canonicalAdminAccessScopes,
  createAdminOnlineIdentity,
  deadlineAwareOnlineFetch,
  hasAdminAccessScope,
} from '../src/admin-online-identity.js';

const key = 'synthetic-m5-client';
const secret = 'synthetic-m5-secret-only';
const shop = 'alpha.myshopify.com';
function token(overrides: Record<string, unknown> = {}, signingSecret = secret, algorithm = 'HS256'): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: algorithm, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: `https://${shop}/admin`,
      dest: `https://${shop}`,
      aud: key,
      sub: '23',
      sid: 'synthetic-session-23',
      iat: now,
      nbf: now - 1,
      exp: now + 60,
      jti: 'synthetic-jti',
      ...overrides,
    }),
  ).toString('base64url');
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${createHmac('sha256', signingSecret).update(unsigned).digest('base64url')}`;
}

describe('production Shopify online staff adapter with synthetic transport', () => {
  it('matches canonical and redundant Shopify capabilities without granting writes from reads', () => {
    const observed = [
      'read_product_listings',
      'read_publications',
      'write_cart_transforms',
      'write_products',
      'write_validations',
    ];
    expect(
      canonicalAdminAccessScopes([...observed, 'read_products', 'read_cart_transforms', 'read_validations']),
    ).toEqual(observed);
    expect(hasAdminAccessScope(['write_cart_transforms'], 'read_cart_transforms')).toBe(true);
    expect(hasAdminAccessScope(['read_cart_transforms'], 'write_cart_transforms')).toBe(false);
    expect(hasAdminAccessScope(['write_validations'], 'read_cart_transforms')).toBe(false);
    expect(canonicalAdminAccessScopes([...observed, 'write_orders'])).not.toEqual(observed);
  });
  it('classifies actual SDK token rejection without exposing SDK token messages or causes', async () => {
    const provider = createAdminOnlineIdentity({ apiKey: key, apiSecret: secret, hostName: 'example.test' });
    for (const [signed, stage] of [
      [token({}, 'synthetic-other-secret'), 'SESSION_TOKEN_SIGNATURE_REJECTED'],
      [token({ aud: 'another-client' }), 'SESSION_TOKEN_AUDIENCE_REJECTED'],
      [token({ exp: Math.floor(Date.now() / 1000) - 60 }), 'SESSION_TOKEN_TIME_REJECTED'],
      [token({ nbf: Math.floor(Date.now() / 1000) + 60 }), 'SESSION_TOKEN_TIME_REJECTED'],
      // SDK clock tolerance must not disguise strict application expiry as an identity mismatch.
      [token({ exp: Math.floor(Date.now() / 1000) - 1 }), 'SESSION_TOKEN_TIME_REJECTED'],
      [token({ exp: Math.floor(Date.now() / 1000) }), 'SESSION_TOKEN_TIME_REJECTED'],
      ['synthetic-private-malformed-token', 'SESSION_TOKEN_FORMAT_REJECTED'],
      [token({}, secret, 'HS384'), 'SESSION_TOKEN_REJECTED'],
      [token({ exp: 'invalid-number' }), 'SESSION_TOKEN_REJECTED'],
    ]) {
      const failure = await provider.verify(signed).catch((error: unknown) => error);
      expect(failure).toMatchObject({ name: 'AdminOnlineIdentityError', stage });
      expect(String(failure)).not.toContain(signed);
      expect(failure).not.toHaveProperty('cause');
    }
  });

  it('uses only the current verification secret; rotation mismatch is a hypothetical local control', async () => {
    const signed = token();
    const current = createAdminOnlineIdentity({ apiKey: key, apiSecret: secret, hostName: 'example.test' });
    expect((await current.verify(signed)).shop).toBe(shop);
    const rotated = createAdminOnlineIdentity({
      apiKey: key,
      apiSecret: 'synthetic-rotated-secret',
      hostName: 'example.test',
    });
    await expect(rotated.verify(signed)).rejects.toMatchObject({ stage: 'SESSION_TOKEN_SIGNATURE_REJECTED' });
  });

  it('distinguishes application identity rejection after successful SDK signature verification', async () => {
    const provider = createAdminOnlineIdentity({ apiKey: key, apiSecret: secret, hostName: 'example.test' });
    for (const claims of [
      { dest: 'https://outside.test' },
      { iss: 'https://other.myshopify.com/admin' },
      { sub: '0' },
      { sid: 'short' },
    ]) {
      const signed = token(claims);
      const failure = await provider.verify(signed).catch((error: unknown) => error);
      expect(failure).toMatchObject({ name: 'AdminOnlineIdentityError', stage: 'SESSION_IDENTITY_REJECTED' });
      expect(String(failure)).not.toContain(signed);
      expect(failure).not.toHaveProperty('cause');
    }
  });

  it.each([
    [403, { error: 'synthetic-private-provider-body' }, 'INSTALLATION_PROVIDER_READ_FAILED'],
    [200, { errors: [{ message: 'synthetic-private-provider-body' }] }, 'INSTALLATION_PROVIDER_READ_FAILED'],
    [
      200,
      {
        data: {
          shop: { id: 'gid://shopify/Shop/7', myshopifyDomain: 'other.myshopify.com' },
          currentAppInstallation: null,
        },
      },
      'INSTALLATION_PROVIDER_SHAPE_OR_IDENTITY_MISMATCH',
    ],
  ])('classifies installation status %s without exposing raw provider evidence', async (status, body, stage) => {
    const provider = createAdminOnlineIdentity({
      apiKey: key,
      apiSecret: secret,
      hostName: 'example.test',
      fetchImpl: async () => Response.json(body, { status }),
    });
    const failure = await provider
      .readInstallation({
        shop,
        staffId: '23',
        accessToken: 'synthetic-private-grant',
        expiresAtMs: Date.now() + 60_000,
        appScopes: [],
        userScopes: [],
      })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ stage });
    expect(String(failure)).not.toContain('synthetic-private');
  });

  it.each([
    [400, 'invalid_client'],
    [400, 'invalid_requested_token_type'],
    [401, 'invalid_subject_token'],
    [500, 'unavailable'],
  ])('keeps unrelated exchange status %s / %s unavailable without provider body leakage', async (status, error) => {
    const original = abstractFetch;
    setAbstractFetchFunc(
      deadlineAwareOnlineFetch(async () =>
        Response.json({ error, error_description: 'synthetic-private-body' }, { status }),
      ),
    );
    try {
      const provider = createAdminOnlineIdentity({ apiKey: key, apiSecret: secret, hostName: 'example.test' });
      const signed = token();
      const identity = await provider.verify(signed);
      const failure = await provider.exchangeOnline(signed, identity).catch((value: unknown) => value);
      expect(failure).toMatchObject({ stage: 'ONLINE_EXCHANGE_FAILED' });
      expect(String(failure)).not.toContain('synthetic-private-body');
    } finally {
      setAbstractFetchFunc(original);
    }
  });
  it('preserves pinned SDK InvalidJwtError as refresh required, but network failures remain unavailable', async () => {
    for (const [error, stage] of [
      [new InvalidJwtError('synthetic-private-token'), 'ONLINE_EXCHANGE_REFRESH_REQUIRED'],
      [new Error('synthetic-private-token network loss'), 'ONLINE_EXCHANGE_FAILED'],
    ] as const) {
      const provider = createAdminOnlineIdentity({
        apiKey: key,
        apiSecret: secret,
        hostName: 'example.test',
        exchangeOnlineImpl: async () => {
          throw error;
        },
      });
      const signed = token();
      const identity = await provider.verify(signed);
      const failure = await provider.exchangeOnline(signed, identity).catch((value: unknown) => value);
      expect(failure).toMatchObject({ stage });
      expect(String(failure)).not.toContain('synthetic-private-token');
    }
  });

  it('preserves actual SDK invalid-subject-token rejection as a safe refresh-required outcome', async () => {
    const original = abstractFetch;
    setAbstractFetchFunc(
      deadlineAwareOnlineFetch(async () =>
        Response.json(
          {
            error: 'invalid_subject_token',
            error_description: 'synthetic-secret-token-must-not-leak',
          },
          { status: 400 },
        ),
      ),
    );
    try {
      const provider = createAdminOnlineIdentity({ apiKey: key, apiSecret: secret, hostName: 'example.test' });
      const signed = token();
      const identity = await provider.verify(signed);
      const failure = await provider.exchangeOnline(signed, identity).catch((error: unknown) => error);
      expect(failure).toMatchObject({ stage: 'ONLINE_EXCHANGE_REFRESH_REQUIRED' });
      expect(String(failure)).not.toContain('synthetic-secret-token-must-not-leak');
    } finally {
      setAbstractFetchFunc(original);
    }
  });

  it('uses the actual pinned SDK token exchange with a synthetic HTTP response', async () => {
    const original = abstractFetch;
    let calls = 0;
    setAbstractFetchFunc(
      deadlineAwareOnlineFetch(async (url, init) => {
        calls++;
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        expect(String(url)).toBe(`https://${shop}/admin/oauth/access_token`);
        const body = JSON.parse(String(init?.body));
        expect(body.client_id).toBe(key);
        expect(body.requested_token_type).toBe('urn:shopify:params:oauth:token-type:online-access-token');
        expect(body.subject_token).toBe(signed);
        return Response.json({
          access_token: 'synthetic-real-sdk-grant',
          scope: 'read_products,write_products',
          expires_in: 3600,
          associated_user_scope: 'read_products,write_products',
          associated_user: { id: 23, account_owner: true },
        });
      }),
    );
    const signed = token();
    try {
      const provider = createAdminOnlineIdentity({ apiKey: key, apiSecret: secret, hostName: 'example.test' });
      const identity = await provider.verify(signed);
      const grant = await provider.exchangeOnline(signed, identity);
      expect(grant).toMatchObject({ shop, staffId: '23', accountOwner: true, accessToken: 'synthetic-real-sdk-grant' });
      expect(grant.expiresAtMs).toBeGreaterThan(Date.now() + 30_000);
      expect(calls).toBe(1);
    } finally {
      setAbstractFetchFunc(original);
    }
  });
  it('checks the signed ID token, online staff and exact installation read', async () => {
    let calls = 0;
    const provider = createAdminOnlineIdentity({
      apiKey: key,
      apiSecret: secret,
      hostName: 'example.test',
      async exchangeOnlineImpl(_token, identity) {
        calls++;
        return {
          isOnline: true,
          shop: identity.shop,
          accessToken: 'synthetic-grant',
          expires: new Date(Date.now() + 60_000),
          scope: 'read_products,write_products',
          onlineAccessInfo: { associated_user: { id: 23 }, associated_user_scope: 'read_products,write_products' },
        };
      },
      async fetchImpl(_url, init) {
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('X-Shopify-Access-Token')).toBe('synthetic-grant');
        return Response.json({
          data: {
            shop: { id: 'gid://shopify/Shop/7', myshopifyDomain: shop, ianaTimezone: 'America/New_York' },
            currentAppInstallation: {
              id: 'gid://shopify/AppInstallation/9',
              accessScopes: [{ handle: 'read_products' }, { handle: 'write_products' }],
            },
          },
        });
      },
    });
    const signed = token();
    const identity = await provider.verify(signed);
    const grant = await provider.exchangeOnline(signed, identity);
    const installation = await provider.readInstallation(grant);
    expect(identity.staffId).toBe('23');
    expect(installation).toMatchObject({
      shopId: 'gid://shopify/Shop/7',
      installationId: 'gid://shopify/AppInstallation/9',
      ianaTimezone: 'America/New_York',
    });
    expect(calls).toBe(1);
  });

  it('rejects expired identity and grant, malformed installation and large bodies', async () => {
    const provider = createAdminOnlineIdentity({
      apiKey: key,
      apiSecret: secret,
      hostName: 'example.test',
      async exchangeOnlineImpl(_token, identity) {
        return {
          isOnline: true,
          shop: identity.shop,
          accessToken: 'synthetic',
          expires: new Date(Date.now() - 1),
          scope: 'read_products',
          onlineAccessInfo: { associated_user: { id: 23 }, associated_user_scope: 'read_products' },
        };
      },
    });
    await expect(provider.verify(token({ exp: Math.floor(Date.now() / 1000) - 100 }))).rejects.toThrow();
    const identity = await provider.verify(token());
    await expect(provider.exchangeOnline(token(), identity)).rejects.toThrow('mismatch');
    const large = createAdminOnlineIdentity({
      apiKey: key,
      apiSecret: secret,
      hostName: 'example.test',
      async fetchImpl() {
        return new Response('x'.repeat(33_000));
      },
    });
    await expect(
      large.readInstallation({
        shop,
        staffId: '23',
        accessToken: 'synthetic',
        expiresAtMs: Date.now() + 60_000,
        appScopes: [],
        userScopes: [],
      }),
    ).rejects.toMatchObject({ stage: 'INSTALLATION_PROVIDER_READ_FAILED' });
  });
});

describe('expiring offline acquisition on a verified embedded identity', () => {
  it('uses the actual SDK exchange once, expiring=1, and preserves provider expiration', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
    try {
      const signed = token();
      let calls = 0;
      const provider = createAdminOnlineIdentity({
        apiKey: key,
        apiSecret: secret,
        hostName: 'example.test',
        fetchImpl: async (_url, init) => {
          calls++;
          const body = JSON.parse(String(init?.body));
          expect(body.requested_token_type).toBe('urn:shopify:params:oauth:token-type:offline-access-token');
          expect(body.expiring).toBe('1');
          expect(body.subject_token).toBe(signed);
          expect(init?.signal).toBeInstanceOf(AbortSignal);
          await vi.advanceTimersByTimeAsync(100);
          return Response.json({
            access_token: 'synthetic-offline-access',
            refresh_token: 'synthetic-offline-refresh',
            expires_in: 3600,
            refresh_token_expires_in: 86400,
            scope: 'write_products',
          });
        },
      });
      const identity = await provider.verify(signed);
      const pair = await provider.exchangeOffline(signed, identity);
      expect(calls).toBe(1);
      expect(pair.schemaVersion).toBe('m3-offline-credential-v1');
      expect(pair.accessToken).toBe('synthetic-offline-access');
      expect(pair.refreshToken).toBe('synthetic-offline-refresh');
      expect(pair.accessExpiresAt).toEqual(new Date('2026-10-14T13:00:00Z'));
      expect(pair.refreshExpiresAt).toEqual(new Date('2026-10-15T12:00:00Z'));
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects a mismatched verified identity before HTTP', async () => {
    let calls = 0;
    const provider = createAdminOnlineIdentity({
      apiKey: key,
      apiSecret: secret,
      hostName: 'example.test',
      fetchImpl: async () => {
        calls++;
        throw Error('not expected');
      },
    });
    const signed = token();
    const identity = await provider.verify(signed);
    await expect(provider.exchangeOffline(signed, { ...identity, shop: 'other.myshopify.com' })).rejects.toMatchObject({
      name: 'OfflineAcquisitionRejectedError',
    });
    expect(calls).toBe(0);
  });
  it('does not retry, leak, or call a lost response a definite rejection', async () => {
    let calls = 0;
    const provider = createAdminOnlineIdentity({
      apiKey: key,
      apiSecret: secret,
      hostName: 'example.test',
      fetchImpl: async () => {
        calls++;
        throw Error('private body and token');
      },
    });
    const signed = token();
    const error = await provider.exchangeOffline(signed, await provider.verify(signed)).catch((e) => e);
    expect(calls).toBe(1);
    expect(String(error)).not.toContain('private');
    expect(error.name).toBe('OfflineExchangeError');
    expect(error).not.toHaveProperty('cause');
  });
  it('classifies only invalid_subject_token400 as definite provider rejection', async () => {
    for (const [status, body, name] of [
      [400, { error: 'invalid_subject_token' }, 'OfflineAcquisitionRejectedError'],
      [500, { error: 'private' }, 'OfflineExchangeError'],
      [200, { access_token: 'private' }, 'OfflineExchangeError'],
    ] as const) {
      let calls = 0;
      const provider = createAdminOnlineIdentity({
        apiKey: key,
        apiSecret: secret,
        hostName: 'example.test',
        fetchImpl: async () => {
          calls++;
          return Response.json(body, { status });
        },
      });
      const signed = token();
      const error = await provider.exchangeOffline(signed, await provider.verify(signed)).catch((e) => e);
      expect(error.name).toBe(name);
      expect(calls).toBe(1);
      expect(String(error)).not.toContain('private');
    }
  });
});

it('bounds offline parsing and cancels a stalled response without redispatch', async () => {
  const signed = token();
  let calls = 0,
    cancelled = 0;
  const provider = createAdminOnlineIdentity({
    apiKey: key,
    apiSecret: secret,
    hostName: 'example.test',
    fetchImpl: async () => {
      calls++;
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('{'));
          },
          cancel() {
            cancelled++;
          },
        }),
        { status: 200 },
      );
    },
  });
  const identity = await provider.verify(signed);
  vi.useFakeTimers();
  try {
    const pending = provider.exchangeOffline(signed, identity).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10001);
    const error = await pending;
    expect(error.name).toBe('OfflineExchangeError');
    expect(calls).toBe(1);
    expect(cancelled).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});
it('rejects an oversized offline success without exposing or installing its payload', async () => {
  let calls = 0;
  const provider = createAdminOnlineIdentity({
    apiKey: key,
    apiSecret: secret,
    hostName: 'example.test',
    fetchImpl: async () => {
      calls++;
      return new Response('private'.repeat(3000), { status: 200 });
    },
  });
  const signed = token();
  const error = await provider.exchangeOffline(signed, await provider.verify(signed)).catch((e) => e);
  expect(error.name).toBe('OfflineExchangeError');
  expect(String(error)).not.toContain('private');
  expect(calls).toBe(1);
});

it('never forwards the offline access header when installation verification redirects', async () => {
  const { createServer } = await import('node:http');
  let received = 0;
  const sink = createServer((_req, res) => {
    received++;
    res.end('{}');
  });
  const bind = (s) => new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  await bind(sink);
  const sinkUrl = `http://127.0.0.1:${sink.address().port}/forbidden`;
  const source = createServer((_req, res) => {
    res.writeHead(302, { Location: sinkUrl });
    res.end();
  });
  await bind(source);
  try {
    const url = `http://127.0.0.1:${source.address().port}/installation`;
    const provider = createAdminOnlineIdentity({
      apiKey: key,
      apiSecret: secret,
      hostName: 'example.test',
      fetchImpl: async (target, init) => {
        expect(new URL(String(target)).hostname).toBe(shop);
        return fetch(url, init);
      },
    });
    await expect(provider.readInstallation({ shop, accessToken: 'synthetic-offline-header' })).rejects.toMatchObject({
      name: 'AdminOnlineIdentityError',
    });
    expect(received).toBe(0);
  } finally {
    await Promise.all([new Promise((resolve) => source.close(resolve)), new Promise((resolve) => sink.close(resolve))]);
  }
});
