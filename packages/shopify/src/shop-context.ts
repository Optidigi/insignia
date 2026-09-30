import type { AdminCredentialSource } from './contextual-pricing.js';

export const SHOP_CONTEXT_API_VERSION = '2026-07' as const;
export const SHOP_CONTEXT_FRESHNESS_MS = 5 * 60 * 1000;
const QUERY = 'query InsigniaShopContext { shop { id currencyCode ianaTimezone } }';
const MAX_BODY_BYTES = 32 * 1024;

export type ShopContextSnapshot = {
  shopId: string;
  installationGeneration: string;
  shopifyShopId: string;
  shopCurrency: string;
  ianaTimezone: string;
  sourceApiVersion: typeof SHOP_CONTEXT_API_VERSION;
  observedAt: string;
  freshUntil: string;
};

export class ShopContextError extends Error {
  constructor(
    readonly kind:
      | 'invalid_request'
      | 'credential_unavailable'
      | 'network'
      | 'provider_error'
      | 'invalid_shape'
      | 'wrong_shop',
  ) {
    super(`Shop context unavailable: ${kind}`);
    this.name = 'ShopContextError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** Credential acquisition must already fence the exact M3 active installation. */
export async function readShopContext(
  target: { shopId: string; installationGeneration: string; shopifyShopId: string },
  dependencies: { credentials: AdminCredentialSource; fetchImpl?: typeof fetch; now?: () => Date; timeoutMs?: number },
): Promise<ShopContextSnapshot> {
  if (
    !target?.shopId ||
    !/^[1-9][0-9]*$/.test(target.installationGeneration) ||
    !/^[1-9][0-9]*$/.test(target.shopifyShopId) ||
    !dependencies?.credentials ||
    typeof dependencies.credentials.acquire !== 'function' ||
    (dependencies.timeoutMs !== undefined &&
      (!Number.isInteger(dependencies.timeoutMs) || dependencies.timeoutMs < 100 || dependencies.timeoutMs > 30_000))
  )
    throw new ShopContextError('invalid_request');
  let credential: Awaited<ReturnType<AdminCredentialSource['acquire']>>;
  try {
    credential = await dependencies.credentials.acquire({
      shopId: target.shopId,
      installationGeneration: target.installationGeneration,
    });
  } catch {
    throw new ShopContextError('credential_unavailable');
  }
  const now = dependencies.now ?? (() => new Date());
  const current = now().getTime();
  if (
    credential.kind !== 'usable' ||
    !/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/.test(credential.shopDomain) ||
    !credential.accessToken ||
    credential.accessToken.length > 8192 ||
    hasControlCharacters(credential.accessToken) ||
    !Number.isFinite(current) ||
    !Number.isFinite(credential.accessExpiresAt.getTime()) ||
    credential.accessExpiresAt.getTime() <= current + 30_000
  )
    throw new ShopContextError('credential_unavailable');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 8_000);
  try {
    const response = await (dependencies.fetchImpl ?? fetch)(
      `https://${credential.shopDomain}/admin/api/${SHOP_CONTEXT_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shopify-access-token': credential.accessToken },
        body: JSON.stringify({ query: QUERY }),
        signal: controller.signal,
        redirect: 'error',
      },
    );
    if (response.status !== 200) throw new ShopContextError('provider_error');
    if (!response.body) throw new ShopContextError('invalid_shape');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {});
          throw new ShopContextError('invalid_shape');
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks, length).toString('utf8')) as unknown;
    } catch {
      throw new ShopContextError('invalid_shape');
    }
    const result = record(body);
    if (!result || result.errors !== undefined) throw new ShopContextError('provider_error');
    const shop = record(record(result.data)?.shop);
    if (!shop || typeof shop.id !== 'string' || !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(shop.id))
      throw new ShopContextError('invalid_shape');
    if (shop.id !== `gid://shopify/Shop/${target.shopifyShopId}`) throw new ShopContextError('wrong_shop');
    if (
      typeof shop.currencyCode !== 'string' ||
      !/^[A-Z]{3}$/.test(shop.currencyCode) ||
      typeof shop.ianaTimezone !== 'string' ||
      shop.ianaTimezone.length > 128
    )
      throw new ShopContextError('invalid_shape');
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: shop.ianaTimezone }).format(new Date(0));
    } catch {
      throw new ShopContextError('invalid_shape');
    }
    const observed = now().getTime();
    if (!Number.isFinite(observed)) throw new ShopContextError('invalid_request');
    return {
      shopId: target.shopId,
      installationGeneration: target.installationGeneration,
      shopifyShopId: target.shopifyShopId,
      shopCurrency: shop.currencyCode,
      ianaTimezone: shop.ianaTimezone,
      sourceApiVersion: SHOP_CONTEXT_API_VERSION,
      observedAt: new Date(observed).toISOString(),
      freshUntil: new Date(observed + SHOP_CONTEXT_FRESHNESS_MS).toISOString(),
    };
  } catch (error) {
    if (error instanceof ShopContextError) throw error;
    throw new ShopContextError('network');
  } finally {
    clearTimeout(timeout);
  }
}
