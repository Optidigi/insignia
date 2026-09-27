import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HttpResponseError, InvalidJwtError } from '@shopify/shopify-api';
import { createShopifyAdapter, refreshableExchangeError } from '../src/server/shopify-adapter.ts';

const key = 'synthetic-key';
const secret = 'm0-009-synthetic-test-secret-only';
const shop = 'alpha.myshopify.com';
const otherShop = 'beta.myshopify.com';
const now = Math.floor(Date.now() / 1000);
const base = {
  iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: key,
  sub: '2', sid: 'synthetic-session-2', iat: now, nbf: now - 1, exp: now + 60,
  jti: 'synthetic-jti'
};
function token(changes: Record<string, unknown> = {}): string {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...base, ...changes })).toString('base64url');
  const unsigned = `${head}.${body}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}
function adapter() {
  return createShopifyAdapter({
    apiKey: key, apiSecret: secret, hostName: 'localhost',
    allowedShops: new Set([shop, otherShop]), synthetic: true,
    expectedInstallationId: 'gid://shopify/AppInstallation/99'
  });
}

describe('Shopify SDK ID-token boundary with synthetic keys', () => {
  it('classifies only invalid-JWT and exchange HTTP 400 for a one-time fresh-token retry', () => {
    expect(refreshableExchangeError(new InvalidJwtError('expired'))).toBe(true);
    expect(refreshableExchangeError(new HttpResponseError({ message: 'bad token', code: 400, statusText: 'Bad Request' }))).toBe(true);
    expect(refreshableExchangeError(new HttpResponseError({ message: 'denied', code: 403, statusText: 'Forbidden' }))).toBe(false);
    expect(refreshableExchangeError(new Error('network'))).toBe(false);
  });
  it('accepts exact signed audience, issuer, destination and installed shop', async () => {
    const port = adapter();
    const identity = await port.verify(token());
    expect(identity.shop).toBe(shop);
    expect(identity.staffId).toBe('2');
    const grant = await port.exchangeOnline(token(), identity);
    expect(grant.userScopes).toContain('write_products');
    const read = await port.readInstallation(grant);
    expect(read.installationId).toBe('gid://shopify/AppInstallation/99');
  });

  it('rejects invalid signature, audience, issuer, destination, expiry and not-before', async () => {
    const port = adapter();
    const invalid = [
      token().slice(0, -2) + 'xx',
      token({ aud: 'another-app' }),
      token({ iss: `https://${otherShop}/admin` }),
      token({ dest: `https://${otherShop}` }),
      token({ exp: now - 100 }),
      token({ nbf: now + 100 })
    ];
    for (const value of invalid) await expect(port.verify(value)).rejects.toThrow('Invalid Shopify identity');
  });

  it('rejects an uninstalled shop before constructing an exchange target', async () => {
    const port = adapter();
    await expect(port.verify(token({
      iss: 'https://evil.myshopify.com/admin', dest: 'https://evil.myshopify.com'
    }))).rejects.toThrow('Invalid Shopify identity');
  });
});
