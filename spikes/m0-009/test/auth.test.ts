import { describe, expect, it } from 'vitest';
import { AuthService } from '../src/server/auth.ts';
import type { AuthPort, InstallationRead, OnlineGrant, VerifiedIdentity } from '../src/server/auth.ts';

const alpha = 'alpha.myshopify.com';
const beta = 'beta.myshopify.com';
const now = 1_800_000_000_000;
const installationId = 'gid://shopify/AppInstallation/99';
function request(token: string, path = '/private/home'): Request {
  return new Request(`https://app.example.test${path}`, { headers: { Authorization: `Bearer ${token}` } });
}
function fixture() {
  const users = new Map<string, VerifiedIdentity>();
  let exchanges = 0;
  const reads: string[] = [];
  const port: AuthPort = {
    async verify(token) {
      const user = users.get(token);
      if (!user) throw new Error('bad token');
      return user;
    },
    async exchangeOnline(_token, identity) {
      exchanges++;
      const grant: OnlineGrant = {
        shop: identity.shop, staffId: identity.staffId,
        accessToken: `synthetic-${identity.shop}-${identity.staffId}`,
        expiresAtMs: now + 120_000,
        appScopes: ['write_products'],
        userScopes: identity.staffId === 'denied' ? ['read_products'] : ['write_products']
      };
      return grant;
    },
    async readInstallation(grant) {
      reads.push(grant.shop);
      const result: InstallationRead = {
        shop: grant.shop, shopId: `gid://shopify/Shop/${grant.shop === alpha ? '1' : '2'}`,
        installationId, grantedScopes: ['write_products']
      };
      return result;
    }
  };
  const service = new AuthService(port, {
    allowedShops: new Set([alpha, beta]), expectedInstallationId: installationId,
    appOrigin: 'https://app.example.test', now: () => now
  });
  function add(token: string, shop: string, staffId: string) {
    users.set(token, { shop, staffId, sessionId: `${shop}-${staffId}`, expiresAtMs: now + 30_000 });
  }
  return { service, port, add, get exchanges() { return exchanges; }, reads };
}

describe('verified online identity boundary', () => {
  it('allows owner and allowed staff but denies a user lacking online edit scope', async () => {
    const h = fixture();
    h.add('owner', alpha, 'owner'); h.add('allowed', alpha, 'allowed'); h.add('denied', alpha, 'denied');
    for (const token of ['owner', 'allowed']) {
      const result = await h.service.authenticate(request(token), true);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.context.canEdit).toBe(true);
    }
    const denied = await h.service.authenticate(request('denied'), true);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.response.status).toBe(403);
  });

  it('binds two tenants independently and rejects a mismatched route shop selection', async () => {
    const h = fixture();
    h.add('a', alpha, 'allowed'); h.add('b', beta, 'allowed');
    const a = await h.service.authenticate(request('a'));
    const b = await h.service.authenticate(request('b'));
    expect(a.ok && a.context.shop).toBe(alpha);
    expect(b.ok && b.context.shop).toBe(beta);
    expect(h.reads).toEqual([alpha, beta]);
    const cross = await h.service.authenticate(request('a', `/private/home?shop=${beta}`));
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.response.status).toBe(403);
  });

  it('rejects missing, invalid and expired identity without exchange or private content', async () => {
    const h = fixture();
    h.add('expired', alpha, 'allowed');
    const noToken = await h.service.authenticate(new Request('https://app.example.test/private/home'));
    const invalid = await h.service.authenticate(request('invalid'));
    const expiredIdentity = h.port.verify;
    h.port.verify = async token => token === 'expired'
      ? { shop: alpha, staffId: 'allowed', sessionId: 'expired', expiresAtMs: now - 1 }
      : expiredIdentity(token);
    const expired = await h.service.authenticate(request('expired'));
    for (const result of [noToken, invalid, expired]) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
        expect(result.response.headers.get('X-Shopify-Retry-Invalid-Session-Request')).toBe('1');
      }
    }
    expect(h.exchanges).toBe(0);
  });

  it('rejects a verified shop outside the installation allowlist before token exchange', async () => {
    const h = fixture();
    h.add('evil', 'evil.myshopify.com', 'allowed');
    const result = await h.service.authenticate(request('evil'));
    expect(result.ok).toBe(false);
    expect(h.exchanges).toBe(0);
  });

  it('single-flights exchange by shop, user and session while checking each ID token', async () => {
    const h = fixture();
    h.add('one', alpha, 'allowed'); h.add('two', alpha, 'allowed');
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      h.service.authenticate(request(i % 2 ? 'one' : 'two'))));
    expect(results.every(r => r.ok)).toBe(true);
    expect(h.exchanges).toBe(1);
    expect(h.reads).toEqual([alpha]);
  });
});
