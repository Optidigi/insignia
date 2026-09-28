import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_BOOTSTRAP_SHOP } from '../src/server/public-bootstrap.ts';
import { createShopifyAdapter } from '../src/server/shopify-adapter.ts';

const client = '1443cf6d03d39edae7c101a943c5c684';
const secret = 'local-test-key-only';
const installation = 'gid://shopify/AppInstallation/987654321';

function token(shop: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: client,
    sub: '1', sid: 'public-bootstrap-test', iat: now, nbf: now - 1,
    exp: now + 60, jti: 'public-bootstrap-test'
  })).toString('base64url');
  const signed = `${header}.${body}`;
  return `${signed}.${createHmac('sha256', secret).update(signed).digest('base64url')}`;
}

describe('new public app bootstrap boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('INSIGNIA_M0_009_MODE', 'public-bootstrap');
    vi.stubEnv('INSIGNIA_APP_ORIGIN', 'https://bootstrap-tunnel.example');
    vi.stubEnv('SHOPIFY_API_KEY', client);
    vi.stubEnv('SHOPIFY_API_SECRET', secret);
    vi.stubEnv('INSIGNIA_PUBLIC_INSTALLATION_ID', installation);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('requires the actual new installation binding before authenticating', async () => {
    vi.stubEnv('INSIGNIA_PUBLIC_INSTALLATION_ID', '');
    const { getRuntime } = await import('../src/server/runtime.ts');
    expect(() => getRuntime()).toThrow('installation binding unavailable');
  });

  it('rejects the old app client even when the new bootstrap mode is selected', async () => {
    vi.stubEnv('SHOPIFY_API_KEY', '942e6668fd1177524c0fc48b104b0ac3');
    const { getRuntime } = await import('../src/server/runtime.ts');
    expect(() => getRuntime()).toThrow('app credentials unavailable');
  });

  it('requires HTTPS and rejects the historical staging shop before exchange', async () => {
    vi.stubEnv('INSIGNIA_APP_ORIGIN', 'http://bootstrap-tunnel.example');
    let runtimeModule = await import('../src/server/runtime.ts');
    expect(() => runtimeModule.getRuntime()).toThrow('Live app origin must be HTTPS');
    vi.resetModules();
    vi.stubEnv('INSIGNIA_APP_ORIGIN', 'https://bootstrap-tunnel.example');
    runtimeModule = await import('../src/server/runtime.ts');
    const runtime = runtimeModule.getRuntime();
    const result = await runtime.auth.authenticate(new Request('https://bootstrap-tunnel.example/private/home', {
      headers: { Authorization: `Bearer ${token('insignia-staging.myshopify.com')}` }
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it('allows the verified dedicated shop and rejects the old shop in the adapter', async () => {
    const port = createShopifyAdapter({
      apiKey: client, apiSecret: secret, hostName: 'bootstrap-tunnel.example',
      allowedShops: new Set([PUBLIC_BOOTSTRAP_SHOP]), expectedInstallationId: installation,
      synthetic: true
    });
    const identity = await port.verify(token(PUBLIC_BOOTSTRAP_SHOP));
    expect(identity.shop).toBe('insignia-rewrite-dev.myshopify.com');
    const grant = await port.exchangeOnline(token(PUBLIC_BOOTSTRAP_SHOP), identity);
    expect((await port.readInstallation(grant)).installationId).toBe(installation);
    await expect(port.verify(token('insignia-staging.myshopify.com')))
      .rejects.toThrow('Invalid Shopify identity');
  });
});
