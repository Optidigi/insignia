/** Shopify SDK boundary for an embedded staff session. Tokens stay server side. */
import '@shopify/shopify-api/adapters/node';
import { ApiVersion, HttpResponseError, InvalidJwtError, RequestedTokenType, shopifyApi } from '@shopify/shopify-api';
import { withAdminDeadline } from './admin-deadline.js';

export type VerifiedStaffIdentity = {
  shop: string;
  staffId: string;
  sessionId: string;
  expiresAtMs: number;
};
export type OnlineStaffGrant = {
  shop: string;
  staffId: string;
  accessToken: string;
  expiresAtMs: number;
  appScopes: string[];
  userScopes: string[];
};
export type AdminInstallationRead = {
  shop: string;
  shopId: string;
  installationId: string;
  grantedScopes: string[];
};
const shopDomain = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const installationQuery = `query M5001StaffInstallation {
  shop { id myshopifyDomain }
  currentAppInstallation { id accessScopes { handle } }
}`;
function scopes(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}
function refreshableExchangeError(error: unknown): boolean {
  return error instanceof InvalidJwtError || (error instanceof HttpResponseError && error.response.code === 400);
}

type OnlineSession = {
  isOnline: boolean;
  shop: string;
  accessToken?: string;
  expires?: Date;
  scope?: string;
  onlineAccessInfo?: { associated_user?: { id: number | string }; associated_user_scope?: string };
};
export function createAdminOnlineIdentity(input: {
  apiKey: string;
  apiSecret: string;
  hostName: string;
  fetchImpl?: typeof fetch;
  /** Test transport only; production leaves this unset and uses the Shopify SDK. */
  exchangeOnlineImpl?: (token: string, identity: VerifiedStaffIdentity) => Promise<OnlineSession>;
}) {
  if (!input.apiKey || !input.apiSecret || !input.hostName)
    throw new Error('Embedded Admin auth configuration incomplete');
  const api = shopifyApi({
    apiKey: input.apiKey,
    apiSecretKey: input.apiSecret,
    scopes: ['read_products', 'write_products'],
    hostName: input.hostName,
    apiVersion: ApiVersion.July26,
    isEmbeddedApp: true,
  });
  return {
    async verify(token: string): Promise<VerifiedStaffIdentity> {
      if (!token || token.length > 8192) throw new Error('Invalid Shopify identity');
      let payload: Awaited<ReturnType<typeof api.session.decodeSessionToken>>;
      try {
        payload = await api.session.decodeSessionToken(token);
      } catch {
        throw new Error('Invalid Shopify identity');
      }
      if (typeof payload.dest !== 'string' || !payload.dest.startsWith('https://'))
        throw new Error('Invalid Shopify identity');
      const shop = payload.dest.slice(8);
      if (
        !shopDomain.test(shop) ||
        payload.dest !== `https://${shop}` ||
        payload.iss !== `https://${shop}/admin` ||
        typeof payload.sub !== 'string' ||
        !/^[1-9][0-9]*$/.test(payload.sub) ||
        typeof payload.sid !== 'string' ||
        payload.sid.length < 8 ||
        !Number.isFinite(payload.exp) ||
        payload.exp * 1000 <= Date.now()
      )
        throw new Error('Invalid Shopify identity');
      return { shop, staffId: payload.sub, sessionId: payload.sid, expiresAtMs: payload.exp * 1000 };
    },
    async exchangeOnline(token: string, identity: VerifiedStaffIdentity): Promise<OnlineStaffGrant> {
      if (!shopDomain.test(identity.shop)) throw new Error('Invalid Shopify shop');
      let session: OnlineSession;
      try {
        session = await withAdminDeadline(
          async () =>
            input.exchangeOnlineImpl
              ? input.exchangeOnlineImpl(token, identity)
              : (
                  await api.auth.tokenExchange({
                    shop: identity.shop,
                    sessionToken: token,
                    requestedTokenType: RequestedTokenType.OnlineAccessToken,
                  })
                ).session,
          'Online token exchange',
        );
      } catch (error) {
        if (refreshableExchangeError(error)) throw new Error('Identity refresh required');
        throw new Error('Online token exchange failed');
      }
      const associated = session.onlineAccessInfo?.associated_user;
      if (
        !session.isOnline ||
        session.shop !== identity.shop ||
        !session.accessToken ||
        !session.expires ||
        !Number.isFinite(session.expires.getTime()) ||
        session.expires.getTime() <= Date.now() ||
        !associated ||
        String(associated.id) !== identity.staffId
      )
        throw new Error('Online staff grant mismatch');
      return {
        shop: identity.shop,
        staffId: identity.staffId,
        accessToken: session.accessToken,
        expiresAtMs: session.expires.getTime(),
        appScopes: scopes(session.scope),
        userScopes: scopes(session.onlineAccessInfo?.associated_user_scope),
      };
    },
    async readInstallation(grant: OnlineStaffGrant): Promise<AdminInstallationRead> {
      if (!shopDomain.test(grant.shop) || !grant.accessToken) throw new Error('Invalid online grant');
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      return withAdminDeadline(
        async (signal) => {
          const response = await (input.fetchImpl ?? fetch)(`https://${grant.shop}/admin/api/2026-07/graphql.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': grant.accessToken },
            body: JSON.stringify({ query: installationQuery }),
            signal,
          });
          if (!response.ok) throw new Error('Installation read denied');
          const length = response.headers.get('content-length');
          if (length && Number(length) > 32_000) throw new Error('Installation response too large');
          reader = response.body?.getReader();
          if (!reader) throw new Error('Installation response body missing');
          const chunks: Uint8Array[] = [];
          let bytes = 0;
          try {
            for (;;) {
              const part = await reader.read();
              if (part.done) break;
              bytes += part.value.byteLength;
              if (bytes > 32_000) throw new Error('Installation response too large');
              chunks.push(part.value);
            }
          } catch (error) {
            await reader.cancel().catch(() => {});
            throw error;
          } finally {
            reader.releaseLock();
          }
          const buffer = new Uint8Array(bytes);
          let offset = 0;
          for (const chunk of chunks) {
            buffer.set(chunk, offset);
            offset += chunk.byteLength;
          }
          let body: unknown;
          try {
            body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
          } catch {
            throw new Error('Installation response invalid');
          }
          if (!body || typeof body !== 'object' || 'errors' in body) throw new Error('Installation response invalid');
          const data = (body as { data?: unknown }).data;
          if (!data || typeof data !== 'object') throw new Error('Installation response invalid');
          const shop = (data as { shop?: unknown }).shop as { id?: unknown; myshopifyDomain?: unknown } | undefined;
          const install = (data as { currentAppInstallation?: unknown }).currentAppInstallation as
            | { id?: unknown; accessScopes?: unknown }
            | undefined;
          if (
            !shop ||
            !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(String(shop.id)) ||
            shop.myshopifyDomain !== grant.shop ||
            !install ||
            !/^gid:\/\/shopify\/AppInstallation\/[1-9][0-9]*$/.test(String(install.id)) ||
            !Array.isArray(install.accessScopes) ||
            !install.accessScopes.every(
              (scope) => scope && typeof scope === 'object' && typeof scope.handle === 'string',
            )
          )
            throw new Error('Installation response mismatch');
          return {
            shop: grant.shop,
            shopId: shop.id as string,
            installationId: install.id as string,
            grantedScopes: install.accessScopes.map((scope) => scope.handle),
          };
        },
        'Installation read',
        () => {
          void reader?.cancel().catch(() => {});
        },
      );
    },
  };
}
