import { createHmac } from 'node:crypto';
import { InvalidJwtError } from '@shopify/shopify-api';
import { abstractFetch, setAbstractFetchFunc } from '@shopify/shopify-api/runtime';
import { describe, expect, it } from 'vitest';
import { createAdminOnlineIdentity, deadlineAwareOnlineFetch } from '../src/admin-online-identity.js';

const key = 'synthetic-m5-client';
const secret = 'synthetic-m5-secret-only';
const shop = 'alpha.myshopify.com';
function token(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
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
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

describe('production Shopify online staff adapter with synthetic transport', () => {
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
          associated_user: { id: 23 },
        });
      }),
    );
    const signed = token();
    try {
      const provider = createAdminOnlineIdentity({ apiKey: key, apiSecret: secret, hostName: 'example.test' });
      const identity = await provider.verify(signed);
      const grant = await provider.exchangeOnline(signed, identity);
      expect(grant).toMatchObject({ shop, staffId: '23', accessToken: 'synthetic-real-sdk-grant' });
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
