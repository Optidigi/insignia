import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAppProxyVerifier } from '../src/app-proxy.js';

const secret = 'synthetic-app-proxy-secret';
function signed(extra: Record<string, string> = {}) {
  const values = {
    shop: 'artwork-shop.myshopify.com',
    timestamp: String(Math.floor(Date.now() / 1000)),
    path_prefix: '/apps/insignia',
    ...extra,
  };
  const query = new URLSearchParams(values);
  const message = Object.entries(values)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('');
  query.set('signature', createHmac('sha256', secret).update(message).digest('hex'));
  return new URL(`https://app.invalid/api/artwork/guest/session?${query}`);
}
describe('Shopify signed App Proxy artwork admission', () => {
  const verify = createAppProxyVerifier({
    apiKey: 'synthetic-app-key',
    apiSecret: secret,
    hostName: 'app.invalid',
    pathPrefix: '/apps/insignia',
  });
  it('verifies a fresh signed shop and rejects forged, old and duplicate identity parameters', async () => {
    expect(await verify(signed())).toEqual({ shop: 'artwork-shop.myshopify.com' });
    const forged = signed();
    forged.searchParams.set('shop', 'other.myshopify.com');
    expect(await verify(forged)).toBeNull();
    expect(await verify(signed({ timestamp: String(Math.floor(Date.now() / 1000) - 91) }))).toBeNull();
    const duplicate = signed();
    duplicate.searchParams.append('shop', 'other.myshopify.com');
    expect(await verify(duplicate)).toBeNull();
    expect(await verify(signed({ path_prefix: '/apps/other' }))).toBeNull();
  });
});
