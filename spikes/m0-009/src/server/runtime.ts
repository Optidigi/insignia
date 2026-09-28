import { AuthService } from './auth.ts';
import { DraftStore } from './draft-api.ts';
import { createShopifyAdapter } from './shopify-adapter.ts';
import { PUBLIC_BOOTSTRAP_CLIENT_ID, PUBLIC_BOOTSTRAP_SHOP } from './public-bootstrap.ts';

const LIVE_SHOP = 'insignia-staging.myshopify.com';
const LIVE_CLIENT_ID = '942e6668fd1177524c0fc48b104b0ac3';
const LIVE_INSTALLATION = 'gid://shopify/AppInstallation/781307904158';
const SYNTHETIC_SECRET = 'm0-009-synthetic-test-secret-only';
const SYNTHETIC_INSTALLATION = 'gid://shopify/AppInstallation/99';

interface Runtime { auth: AuthService; drafts: DraftStore; mode: 'live' | 'synthetic' | 'public-bootstrap' }
let cached: Runtime | undefined;

export function getRuntime(): Runtime {
  if (cached) return cached;
  const mode = process.env.INSIGNIA_M0_009_MODE;
  if (mode !== 'live' && mode !== 'synthetic' && mode !== 'public-bootstrap') throw new Error('M0-009 mode unavailable');
  const originValue = process.env.INSIGNIA_APP_ORIGIN ?? process.env.SHOPIFY_APP_URL;
  if (!originValue) throw new Error('M0-009 app origin unavailable');
  const origin = new URL(originValue);
  if (origin.pathname !== '/' || origin.search || origin.hash) throw new Error('M0-009 app origin invalid');
  const synthetic = mode === 'synthetic';
  if (synthetic) {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) ||
        !['http:', 'https:'].includes(origin.protocol) ||
        !['localhost', '127.0.0.1', '::1'].includes(process.env.HOST ?? '127.0.0.1'))
      throw new Error('Synthetic mode requires loopback');
  } else if (origin.protocol !== 'https:') throw new Error('Live app origin must be HTTPS');

  const apiKey = synthetic ? 'synthetic-key' : process.env.SHOPIFY_API_KEY;
  const apiSecret = synthetic ? SYNTHETIC_SECRET : process.env.SHOPIFY_API_SECRET;
  const expectedClient = mode === 'public-bootstrap' ? PUBLIC_BOOTSTRAP_CLIENT_ID : LIVE_CLIENT_ID;
  if (!apiKey || !apiSecret || (!synthetic && apiKey !== expectedClient))
    throw new Error('M0-009 app credentials unavailable');
  const allowedShops = new Set(synthetic
    ? ['alpha.myshopify.com', 'beta.myshopify.com']
    : [mode === 'public-bootstrap' ? PUBLIC_BOOTSTRAP_SHOP : LIVE_SHOP]);
  const installation = synthetic ? SYNTHETIC_INSTALLATION
    : mode === 'public-bootstrap' ? process.env.INSIGNIA_PUBLIC_INSTALLATION_ID : LIVE_INSTALLATION;
  if (!installation || !/^gid:\/\/shopify\/AppInstallation\/[1-9][0-9]*$/.test(installation))
    throw new Error('M0-009 installation binding unavailable');
  const port = createShopifyAdapter({
    apiKey, apiSecret, hostName: origin.host, allowedShops,
    synthetic, expectedInstallationId: installation
  });
  cached = {
    auth: new AuthService(port, {
      allowedShops, expectedInstallationId: installation,
      appOrigin: origin.origin, now: () => Date.now(),
      observe: mode === 'public-bootstrap' && process.env.INSIGNIA_PUBLIC_AUTH_TRACE === '1'
        ? event => {
          if (['/private/home', '/private/draft', '/api/draft'].includes(event.route))
            console.info(JSON.stringify({ kind: 'insignia-public-auth', at: new Date().toISOString(), ...event }));
        }
        : undefined
    }),
    drafts: new DraftStore(), mode
  };
  return cached;
}
