import { normalizeShopifyDomain } from './webhook.js';

export const OFFLINE_CREDENTIAL_SCHEMA_VERSION = 'm3-offline-credential-v1' as const;

export type ShopifyOfflineTokenPair = {
  schemaVersion: typeof OFFLINE_CREDENTIAL_SCHEMA_VERSION;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  scopes: string | null;
};

export type ShopifyRefreshFailureKind =
  | 'invalid_request'
  | 'network_or_timeout'
  | 'rate_limited'
  | 'server_failure'
  | 'terminal_invalid_refresh'
  | 'malformed_response'
  | 'unexpected_status';

export class ShopifyRefreshError extends Error {
  readonly kind: ShopifyRefreshFailureKind;

  constructor(kind: ShopifyRefreshFailureKind) {
    super(`Shopify offline refresh failed: ${kind}`);
    this.name = 'ShopifyRefreshError';
    this.kind = kind;
  }
}

export interface ShopifyOfflineRefreshTransport {
  refresh(input: { shopDomain: string; refreshToken: string }): Promise<ShopifyOfflineTokenPair>;
}

type Fetch = typeof fetch;

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function nonemptyCredential(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 8192 && !hasControlCharacters(value);
}

function positiveSeconds(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 315_360_000;
}

function parsePair(value: unknown, observedAt: Date): ShopifyOfflineTokenPair {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ShopifyRefreshError('malformed_response');
  }
  const record = value as Record<string, unknown>;
  if (
    !nonemptyCredential(record.access_token) ||
    !nonemptyCredential(record.refresh_token) ||
    !positiveSeconds(record.expires_in) ||
    !positiveSeconds(record.refresh_token_expires_in) ||
    (record.token_type !== undefined && record.token_type !== 'Bearer') ||
    (record.scope !== undefined &&
      (typeof record.scope !== 'string' || record.scope.length > 4096 || hasControlCharacters(record.scope)))
  ) {
    throw new ShopifyRefreshError('malformed_response');
  }
  const observedMs = observedAt.getTime();
  const accessExpiresAt = new Date(observedMs + record.expires_in * 1000);
  const refreshExpiresAt = new Date(observedMs + record.refresh_token_expires_in * 1000);
  if (
    !Number.isFinite(observedMs) ||
    !Number.isFinite(accessExpiresAt.getTime()) ||
    !Number.isFinite(refreshExpiresAt.getTime())
  ) {
    throw new ShopifyRefreshError('malformed_response');
  }
  return {
    schemaVersion: OFFLINE_CREDENTIAL_SCHEMA_VERSION,
    accessToken: record.access_token,
    refreshToken: record.refresh_token,
    accessExpiresAt,
    refreshExpiresAt,
    scopes: record.scope ?? null,
  } as ShopifyOfflineTokenPair;
}

/** Bounded parsing also applies to error responses, whose content is never logged. */
async function readJson(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > 16 * 1024) {
        await reader.cancel().catch(() => {});
        throw new ShopifyRefreshError('malformed_response');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8')) as unknown;
  } catch {
    throw new ShopifyRefreshError('malformed_response');
  }
}

/** The client secret is injected by server composition; this module never reads process environment. */
export function createShopifyOfflineRefreshTransport(config: {
  clientId: string;
  clientSecret: string;
  fetchImpl?: Fetch;
  timeoutMs?: number;
  now?: () => Date;
}): ShopifyOfflineRefreshTransport {
  if (
    !nonemptyCredential(config.clientId) ||
    !nonemptyCredential(config.clientSecret) ||
    (config.timeoutMs !== undefined &&
      (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 30_000))
  ) {
    throw new ShopifyRefreshError('invalid_request');
  }
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? (() => new Date());
  return {
    async refresh(input) {
      let shopDomain: string;
      try {
        shopDomain = normalizeShopifyDomain(input.shopDomain);
      } catch {
        throw new ShopifyRefreshError('invalid_request');
      }
      if (!nonemptyCredential(input.refreshToken)) throw new ShopifyRefreshError('invalid_request');
      const observedAt = now();
      if (!Number.isFinite(observedAt.getTime())) throw new ShopifyRefreshError('invalid_request');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 8_000);
      let response: Response;
      try {
        response = await fetchImpl(`https://${shopDomain}/admin/oauth/access_token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: 'refresh_token',
            refresh_token: input.refreshToken,
          }).toString(),
          signal: controller.signal,
          redirect: 'error',
        });
        if (response.status === 429) throw new ShopifyRefreshError('rate_limited');
        if (response.status >= 500) throw new ShopifyRefreshError('server_failure');
        if (response.status === 401) {
          const error = await readJson(response).catch(() => null);
          if (error && typeof error === 'object' && 'error' in error && error.error === 'invalid_request') {
            throw new ShopifyRefreshError('terminal_invalid_refresh');
          }
          throw new ShopifyRefreshError('unexpected_status');
        }
        if (!response.ok) throw new ShopifyRefreshError('unexpected_status');
        return parsePair(await readJson(response), observedAt);
      } catch (error) {
        if (error instanceof ShopifyRefreshError) throw error;
        throw new ShopifyRefreshError('network_or_timeout');
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
