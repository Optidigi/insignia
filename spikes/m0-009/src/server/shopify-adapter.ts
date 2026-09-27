/** Server-only Shopify boundary. Never import this from an island or public shell. */
import { nodeAdapterInitialized } from '@shopify/shopify-api/adapters/node';
import { ApiVersion, HttpResponseError, InvalidJwtError, RequestedTokenType, shopifyApi } from '@shopify/shopify-api';
import { IdentityRefreshRequired } from './auth.ts';
import type { AuthPort, InstallationRead, OnlineGrant, VerifiedIdentity } from './auth.ts';

const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const INSTALLATION_QUERY = `query M0009Identity {
  shop { id myshopifyDomain }
  currentAppInstallation { id accessScopes { handle } }
}`;

export interface ShopifyAdapterConfig {
  apiKey: string;
  apiSecret: string;
  hostName: string;
  allowedShops: ReadonlySet<string>;
  synthetic: boolean;
  expectedInstallationId: string;
  fetchImpl?: typeof fetch;
}
function scopes(value: string | undefined): string[] {
  return (value ?? '').split(',').map(v => v.trim()).filter(Boolean);
}
function allowedShop(value: string, allowed: ReadonlySet<string>): boolean {
  return SHOP.test(value) && allowed.has(value);
}

export function createShopifyAdapter(config: ShopifyAdapterConfig): AuthPort {
  if (!nodeAdapterInitialized) throw new Error('Shopify Node adapter unavailable');
  const shopify = shopifyApi({
    apiKey: config.apiKey,
    apiSecretKey: config.apiSecret,
    scopes: ['write_products'],
    hostName: config.hostName,
    apiVersion: ApiVersion.July26,
    isEmbeddedApp: true
  });
  const call = config.fetchImpl ?? fetch;

  return {
    async verify(token): Promise<VerifiedIdentity> {
      let payload;
      try { payload = await shopify.session.decodeSessionToken(token); }
      catch { throw new Error('Invalid Shopify identity'); } // SDK exception can contain the raw token
      if (typeof payload.dest !== 'string' || typeof payload.iss !== 'string' ||
          !payload.dest.startsWith('https://')) throw new Error('Invalid Shopify identity');
      const shop = payload.dest.slice('https://'.length);
      if (!allowedShop(shop, config.allowedShops) ||
          payload.dest !== `https://${shop}` || payload.iss !== `https://${shop}/admin` ||
          typeof payload.sub !== 'string' || !/^[1-9][0-9]*$/.test(payload.sub) ||
          typeof payload.sid !== 'string' || payload.sid.length < 8 ||
          !Number.isFinite(payload.exp)) throw new Error('Invalid Shopify identity');
      return { shop, staffId: payload.sub, sessionId: payload.sid, expiresAtMs: payload.exp * 1000 };
    },

    async exchangeOnline(token, identity): Promise<OnlineGrant> {
      // The exchange URL uses this verified, allowlisted shop; no route/body value reaches it.
      if (!allowedShop(identity.shop, config.allowedShops)) throw new Error('Invalid Shopify identity');
      if (config.synthetic) {
        const edit = identity.staffId !== '3';
        return {
          shop: identity.shop, staffId: identity.staffId,
          accessToken: `synthetic-online-${identity.shop}-${identity.staffId}`,
          expiresAtMs: Date.now() + 60_000,
          appScopes: ['write_products'], userScopes: edit ? ['write_products'] : ['read_products']
        };
      }
      let session;
      try {
        ({ session } = await shopify.auth.tokenExchange({
          shop: identity.shop, sessionToken: token,
          requestedTokenType: RequestedTokenType.OnlineAccessToken
        }));
      } catch (error) {
        // The SDK verifies the ID token again immediately before exchange.
        // Shopify can also reject a token that expires between local verification
        // and exchange. App Bridge gets one fresh-token retry only for these cases.
        if (refreshableExchangeError(error)) throw new IdentityRefreshRequired();
        throw new Error('Online token exchange failed');
      }
      const associated = session.onlineAccessInfo?.associated_user;
      if (!session.isOnline || session.shop !== identity.shop || !session.accessToken ||
          !session.expires || !associated || String(associated.id) !== identity.staffId)
        throw new Error('Online staff grant mismatch');
      return {
        shop: session.shop, staffId: identity.staffId,
        accessToken: session.accessToken, expiresAtMs: session.expires.getTime(),
        appScopes: scopes(session.scope),
        userScopes: scopes(session.onlineAccessInfo?.associated_user_scope)
      };
    },

    async readInstallation(grant): Promise<InstallationRead> {
      if (!allowedShop(grant.shop, config.allowedShops)) throw new Error('Invalid Shopify shop');
      if (config.synthetic) return {
        shop: grant.shop,
        shopId: grant.shop.startsWith('alpha') ? 'gid://shopify/Shop/1' : 'gid://shopify/Shop/2',
        installationId: config.expectedInstallationId,
        grantedScopes: ['write_products']
      };
      let response: Response;
      try {
        response = await call(`https://${grant.shop}/admin/api/2026-07/graphql.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': grant.accessToken
          },
          body: JSON.stringify({ query: INSTALLATION_QUERY }),
          signal: AbortSignal.timeout(10_000)
        });
      } catch { throw new Error('Installation read unavailable'); }
      if (!response.ok) throw new Error('Installation read denied');
      let body: unknown;
      try { body = await response.json(); }
      catch { throw new Error('Installation response invalid'); }
      if (!isInstallationResponse(body, grant.shop, config.expectedInstallationId))
        throw new Error('Installation response mismatch');
      return {
        shop: body.data.shop.myshopifyDomain, shopId: body.data.shop.id,
        installationId: body.data.currentAppInstallation.id,
        grantedScopes: body.data.currentAppInstallation.accessScopes.map(s => s.handle)
      };
    }
  };
}

export function refreshableExchangeError(error: unknown): boolean {
  return error instanceof InvalidJwtError ||
    (error instanceof HttpResponseError && error.response.code === 400);
}

interface InstallationResponse {
  data: {
    shop: { id: string; myshopifyDomain: string };
    currentAppInstallation: { id: string; accessScopes: { handle: string }[] };
  };
}
function isInstallationResponse(value: unknown, shop: string, installation: string): value is InstallationResponse {
  if (!value || typeof value !== 'object') return false;
  const root = value as Record<string, unknown>;
  if (Array.isArray(root.errors) && root.errors.length) return false;
  const data = root.data;
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  const s = d.shop as Record<string, unknown> | undefined;
  const i = d.currentAppInstallation as Record<string, unknown> | undefined;
  return typeof s?.id === 'string' && /^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(s.id) &&
    s.myshopifyDomain === shop && i?.id === installation && Array.isArray(i.accessScopes) &&
    i.accessScopes.every(x => x && typeof x === 'object' && typeof x.handle === 'string');
}
