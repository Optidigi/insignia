/** Shopify SDK boundary for an embedded staff session. Tokens stay server side. */
import '@shopify/shopify-api/adapters/node';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  type ExpiringOfflineTokenPair,
  OfflineAcquisitionRejectedError,
  validateExpiringOfflineTokenPair,
} from '@insignia/application';
import {
  ApiVersion,
  AuthScopes,
  HttpResponseError,
  InvalidJwtError,
  RequestedTokenType,
  shopifyApi,
} from '@shopify/shopify-api';
import { abstractFetch, setAbstractFetchFunc } from '@shopify/shopify-api/runtime';
import { withAdminDeadline } from './admin-deadline.js';

export type AdminOnlineIdentityStage =
  | 'SESSION_TOKEN_SIGNATURE_REJECTED'
  | 'SESSION_TOKEN_AUDIENCE_REJECTED'
  | 'SESSION_TOKEN_TIME_REJECTED'
  | 'SESSION_TOKEN_FORMAT_REJECTED'
  | 'SESSION_TOKEN_REJECTED'
  | 'SESSION_IDENTITY_REJECTED'
  | 'ONLINE_EXCHANGE_REFRESH_REQUIRED'
  | 'ONLINE_EXCHANGE_FAILED'
  | 'ONLINE_GRANT_MISMATCH'
  | 'INSTALLATION_PROVIDER_READ_FAILED'
  | 'INSTALLATION_PROVIDER_SHAPE_OR_IDENTITY_MISMATCH';

const stageMessages: Record<AdminOnlineIdentityStage, string> = {
  SESSION_TOKEN_SIGNATURE_REJECTED: 'Session signature rejected',
  SESSION_TOKEN_AUDIENCE_REJECTED: 'Session audience rejected',
  SESSION_TOKEN_TIME_REJECTED: 'Session time rejected',
  SESSION_TOKEN_FORMAT_REJECTED: 'Session format rejected',
  SESSION_TOKEN_REJECTED: 'Session token rejected',
  SESSION_IDENTITY_REJECTED: 'Session identity rejected',
  ONLINE_EXCHANGE_REFRESH_REQUIRED: 'Identity refresh required',
  ONLINE_EXCHANGE_FAILED: 'Online token exchange failed',
  ONLINE_GRANT_MISMATCH: 'Online staff grant mismatch',
  INSTALLATION_PROVIDER_READ_FAILED: 'Installation read failed',
  INSTALLATION_PROVIDER_SHAPE_OR_IDENTITY_MISMATCH: 'Installation response mismatch',
};
/** Only bounded classification survives the SDK/provider boundary; no cause/body/token. */
export class AdminOnlineIdentityError extends Error {
  constructor(readonly stage: AdminOnlineIdentityStage) {
    super(stageMessages[stage]);
    if (!Object.hasOwn(stageMessages, stage)) throw new Error('Invalid authentication classification');
    this.name = 'AdminOnlineIdentityError';
  }
}

export type VerifiedStaffIdentity = {
  shop: string;
  staffId: string;
  sessionId: string;
  expiresAtMs: number;
};
export type OnlineStaffGrant = {
  accountOwner?: boolean;
  shop: string;
  staffId: string;
  accessToken: string;
  expiresAtMs: number;
  appScopes: string[];
  userScopes: string[];
};
export type AdminInstallationRead = {
  shop: string;
  ianaTimezone: string;
  shopId: string;
  installationId: string;
  grantedScopes: string[];
};
const shopDomain = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const onlineExchangeSignal = new AsyncLocalStorage<AbortSignal>();
const onlineExchangeTransport = new AsyncLocalStorage<typeof fetch>();
/** Preserve the SDK's fetch implementation, adding the request's abort signal only inside token exchange. */
export function deadlineAwareOnlineFetch(baseFetch: typeof fetch): typeof fetch {
  return (url, options) =>
    (onlineExchangeTransport.getStore() ?? baseFetch)(url, {
      ...options,
      signal: onlineExchangeSignal.getStore() ?? options?.signal,
    });
}
const nodeSdkFetch = abstractFetch;
setAbstractFetchFunc(deadlineAwareOnlineFetch(nodeSdkFetch));
export const ADMIN_STAFF_INSTALLATION_QUERY = `query M5001StaffInstallation {
  shop { id myshopifyDomain ianaTimezone }
  currentAppInstallation { id accessScopes { handle } }
}`;
function scopes(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}
/** Shopify's SDK canonicalizes redundant read scopes without adding write authority. */
export function canonicalAdminAccessScopes(values: readonly string[]): string[] {
  return new AuthScopes([...values]).toArray().sort();
}

export function hasAdminAccessScope(values: readonly string[], required: string): boolean {
  return new AuthScopes([...values]).has(required);
}
function refreshableExchangeError(error: unknown): boolean {
  if (error instanceof InvalidJwtError) return true;
  if (!(error instanceof HttpResponseError) || error.response.code !== 400) return false;
  const body = error.response.body;
  return (
    !!body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    (body as Record<string, unknown>).error === 'invalid_subject_token'
  );
}

/** SDK15/jose5 erase structured JWT causes. Compare only exact pinned messages locally;
 * never emit the SDK message (which contains the token), or attach its cause. Unknown
 * failures keep the aggregate stage. This classifies rejection and grants no authority. */
function rejectedSessionStage(error: unknown, token: string): AdminOnlineIdentityStage {
  if (!(error instanceof InvalidJwtError)) return 'SESSION_TOKEN_REJECTED';
  if (error.message === 'Session token had invalid API key') return 'SESSION_TOKEN_AUDIENCE_REJECTED';
  const wrapped = (message: string) => error.message === `Failed to parse session token '${token}': ${message}`;
  if (wrapped('signature verification failed')) return 'SESSION_TOKEN_SIGNATURE_REJECTED';
  if (wrapped('"exp" claim timestamp check failed') || wrapped('"nbf" claim timestamp check failed'))
    return 'SESSION_TOKEN_TIME_REJECTED';
  if (wrapped('Invalid Compact JWS')) return 'SESSION_TOKEN_FORMAT_REJECTED';
  return 'SESSION_TOKEN_REJECTED';
}

export class OfflineExchangeError extends Error {
  constructor() {
    super('Offline exchange unresolved');
    this.name = 'OfflineExchangeError';
  }
}

type OnlineSession = {
  isOnline: boolean;
  shop: string;
  accessToken?: string;
  expires?: Date;
  scope?: string;
  onlineAccessInfo?: {
    associated_user?: { id: number | string; account_owner?: boolean };
    associated_user_scope?: string;
  };
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
    // Dedicated bounded diagnostics own logging; SDK messages/bodies are never logged.
    logger: { log: () => {} },
  });
  const verify = async (token: string): Promise<VerifiedStaffIdentity> => {
    if (!token || token.length > 8192) throw new AdminOnlineIdentityError('SESSION_TOKEN_REJECTED');
    let payload: Awaited<ReturnType<typeof api.session.decodeSessionToken>>;
    try {
      payload = await api.session.decodeSessionToken(token);
    } catch (error) {
      throw new AdminOnlineIdentityError(rejectedSessionStage(error, token));
    }
    if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now())
      throw new AdminOnlineIdentityError('SESSION_TOKEN_TIME_REJECTED');
    if (typeof payload.dest !== 'string' || !payload.dest.startsWith('https://'))
      throw new AdminOnlineIdentityError('SESSION_IDENTITY_REJECTED');
    const shop = payload.dest.slice(8);
    if (
      !shopDomain.test(shop) ||
      payload.dest !== `https://${shop}` ||
      payload.iss !== `https://${shop}/admin` ||
      typeof payload.sub !== 'string' ||
      !/^[1-9][0-9]*$/.test(payload.sub) ||
      typeof payload.sid !== 'string' ||
      payload.sid.length < 8
    )
      throw new AdminOnlineIdentityError('SESSION_IDENTITY_REJECTED');
    return { shop, staffId: payload.sub, sessionId: payload.sid, expiresAtMs: payload.exp * 1000 };
  };
  return {
    verify,
    async exchangeOnline(token: string, identity: VerifiedStaffIdentity): Promise<OnlineStaffGrant> {
      if (!shopDomain.test(identity.shop)) throw new Error('Invalid Shopify shop');
      let session: OnlineSession;
      try {
        session = await withAdminDeadline(
          async (signal) =>
            onlineExchangeSignal.run(signal, async () => {
              const exchange = async () =>
                input.exchangeOnlineImpl
                  ? input.exchangeOnlineImpl(token, identity)
                  : (
                      await api.auth.tokenExchange({
                        shop: identity.shop,
                        sessionToken: token,
                        requestedTokenType: RequestedTokenType.OnlineAccessToken,
                      })
                    ).session;
              return input.fetchImpl ? onlineExchangeTransport.run(input.fetchImpl, exchange) : exchange();
            }),
          'Online token exchange',
        );
      } catch (error) {
        if (refreshableExchangeError(error)) throw new AdminOnlineIdentityError('ONLINE_EXCHANGE_REFRESH_REQUIRED');
        throw new AdminOnlineIdentityError('ONLINE_EXCHANGE_FAILED');
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
        throw new AdminOnlineIdentityError('ONLINE_GRANT_MISMATCH');
      return {
        shop: identity.shop,
        staffId: identity.staffId,
        accountOwner: associated.account_owner === true,
        accessToken: session.accessToken,
        expiresAtMs: session.expires.getTime(),
        appScopes: scopes(session.scope),
        userScopes: scopes(session.onlineAccessInfo?.associated_user_scope),
      };
    },
    async exchangeOffline(token: string, identity: VerifiedStaffIdentity): Promise<ExpiringOfflineTokenPair> {
      try {
        const current = await verify(token);
        if (
          current.shop !== identity.shop ||
          current.staffId !== identity.staffId ||
          current.sessionId !== identity.sessionId ||
          current.expiresAtMs !== identity.expiresAtMs
        )
          throw new Error('Identity mismatch');
      } catch {
        throw new OfflineAcquisitionRejectedError();
      }
      const startedAt = Date.now();
      let offlineReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const session = await withAdminDeadline(
          (signal) =>
            onlineExchangeSignal.run(signal, () =>
              onlineExchangeTransport.run(
                async (url, init) => {
                  const response = await (input.fetchImpl ?? nodeSdkFetch)(url, { ...init, redirect: 'error' });
                  const reader = response.body?.getReader();
                  if (!reader) throw new Error('Offline body unavailable');
                  offlineReader = reader;
                  if (init?.signal?.aborted) {
                    await reader.cancel().catch(() => {});
                    throw new Error('Offline exchange aborted');
                  }
                  init?.signal?.addEventListener(
                    'abort',
                    () => {
                      void reader.cancel().catch(() => {});
                    },
                    { once: true },
                  );
                  const chunks: Uint8Array[] = [];
                  let length = 0;
                  try {
                    for (;;) {
                      const next = await reader.read();
                      if (next.done) break;
                      length += next.value.byteLength;
                      if (length > 16384) {
                        await reader.cancel().catch(() => {});
                        throw new Error('Offline response too large');
                      }
                      chunks.push(next.value);
                    }
                  } finally {
                    reader.releaseLock();
                  }
                  return new Response(Buffer.concat(chunks, length), {
                    status: response.status,
                    headers: response.headers,
                  });
                },
                () =>
                  api.auth.tokenExchange({
                    shop: identity.shop,
                    sessionToken: token,
                    requestedTokenType: RequestedTokenType.OfflineAccessToken,
                    expiring: true,
                  }),
              ),
            ),
          'Offline token exchange',
          () => {
            void offlineReader?.cancel().catch(() => {});
          },
        );
        const elapsed = Math.max(0, Date.now() - startedAt);
        if (session.session.isOnline || session.session.shop !== identity.shop)
          throw new Error('Offline identity mismatch');
        const acquired = session.session;
        const pair: ExpiringOfflineTokenPair = {
          schemaVersion: 'm3-offline-credential-v1',
          accessToken: acquired.accessToken ?? '',
          refreshToken: acquired.refreshToken ?? '',
          accessExpiresAt: new Date((acquired.expires?.getTime() ?? NaN) - elapsed),
          refreshExpiresAt: new Date((acquired.refreshTokenExpires?.getTime() ?? NaN) - elapsed),
          scopes: acquired.scope ?? null,
        };
        validateExpiringOfflineTokenPair(pair, new Date());
        return pair;
      } catch (error) {
        if (refreshableExchangeError(error)) throw new OfflineAcquisitionRejectedError();
        throw new OfflineExchangeError();
      }
    },
    async readInstallation(grant: Pick<OnlineStaffGrant, 'shop' | 'accessToken'>): Promise<AdminInstallationRead> {
      if (!shopDomain.test(grant.shop) || !grant.accessToken) throw new Error('Invalid online grant');
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      return withAdminDeadline(
        async (signal) => {
          const response = await (input.fetchImpl ?? fetch)(`https://${grant.shop}/admin/api/2026-07/graphql.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': grant.accessToken },
            body: JSON.stringify({ query: ADMIN_STAFF_INSTALLATION_QUERY }),
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
            throw new AdminOnlineIdentityError('INSTALLATION_PROVIDER_SHAPE_OR_IDENTITY_MISMATCH');
          }
          if (!body || typeof body !== 'object' || Array.isArray(body))
            throw new AdminOnlineIdentityError('INSTALLATION_PROVIDER_SHAPE_OR_IDENTITY_MISMATCH');
          if ('errors' in body) throw new AdminOnlineIdentityError('INSTALLATION_PROVIDER_READ_FAILED');
          const data = (body as { data?: unknown }).data;
          if (!data || typeof data !== 'object')
            throw new AdminOnlineIdentityError('INSTALLATION_PROVIDER_SHAPE_OR_IDENTITY_MISMATCH');
          const shop = (data as { shop?: unknown }).shop as
            | { id?: unknown; myshopifyDomain?: unknown; ianaTimezone?: unknown }
            | undefined;
          const install = (data as { currentAppInstallation?: unknown }).currentAppInstallation as
            | { id?: unknown; accessScopes?: unknown }
            | undefined;
          if (
            !shop ||
            !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(String(shop.id)) ||
            shop.myshopifyDomain !== grant.shop ||
            typeof shop.ianaTimezone !== 'string' ||
            shop.ianaTimezone.length > 128 ||
            !/^[A-Za-z_][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+){0,3}$/.test(shop.ianaTimezone) ||
            !install ||
            !/^gid:\/\/shopify\/AppInstallation\/[1-9][0-9]*$/.test(String(install.id)) ||
            !Array.isArray(install.accessScopes) ||
            !install.accessScopes.every(
              (scope) => scope && typeof scope === 'object' && typeof scope.handle === 'string',
            )
          )
            throw new AdminOnlineIdentityError('INSTALLATION_PROVIDER_SHAPE_OR_IDENTITY_MISMATCH');
          try {
            new Intl.DateTimeFormat('en-US', { timeZone: shop.ianaTimezone as string });
          } catch {
            throw new AdminOnlineIdentityError('INSTALLATION_PROVIDER_SHAPE_OR_IDENTITY_MISMATCH');
          }
          return {
            shop: grant.shop,
            ianaTimezone: shop.ianaTimezone as string,
            shopId: shop.id as string,
            installationId: install.id as string,
            grantedScopes: install.accessScopes.map((scope) => scope.handle),
          };
        },
        'Installation read',
        () => {
          void reader?.cancel().catch(() => {});
        },
      ).catch((error: unknown) => {
        if (error instanceof AdminOnlineIdentityError) throw error;
        throw new AdminOnlineIdentityError('INSTALLATION_PROVIDER_READ_FAILED');
      });
    },
  };
}
