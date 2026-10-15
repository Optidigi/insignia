import { withAdminDeadline } from './admin-deadline.js';
import type { AdminCredentialSource } from './contextual-pricing.js';

export const PRIMARY_MARKET_API_VERSION = '2026-07' as const;
export const PRIMARY_MARKET_FRESHNESS_MS = 5 * 60 * 1000;
const QUERY = `query LeanPrimaryMarket($after: String) {
  shop { id currencyCode }
  primaryMarket {
    id status
    conditions { regionsCondition { regions(first: 250, after: $after) {
      nodes { __typename ... on MarketRegionCountry { code } }
      pageInfo { hasNextPage endCursor }
    } } }
  }
}`;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
export type PrimaryMarketSnapshot = {
  shopId: string;
  installationGeneration: string;
  shopifyShopId: string;
  shopCurrency: string;
  primaryMarketId: string;
  countryCodes: string[];
  sourceApiVersion: typeof PRIMARY_MARKET_API_VERSION;
  observedAt: string;
  freshUntil: string;
};
export class PrimaryMarketError extends Error {
  constructor(
    readonly kind:
      | 'invalid_request'
      | 'credential_unavailable'
      | 'network'
      | 'provider_error'
      | 'invalid_shape'
      | 'wrong_shop'
      | 'inactive_market'
      | 'incomplete_membership',
  ) {
    super(`Primary Market unavailable: ${kind}`);
    this.name = 'PrimaryMarketError';
  }
}
function fail(kind: PrimaryMarketError['kind']): never {
  throw new PrimaryMarketError(kind);
}

/** Requires read_markets. Credentials must fence the exact active tenant/installation.
 * Observed membership is not native pricing/Function qualification or permission to enable a currency.
 */
export async function readPrimaryMarketContext(
  target: { shopId: string; installationGeneration: string; shopifyShopId: string },
  dependencies: { credentials: AdminCredentialSource; fetchImpl?: typeof fetch; now?: () => Date },
): Promise<PrimaryMarketSnapshot> {
  const scope = {
    shopId: target?.shopId,
    installationGeneration: target?.installationGeneration,
    shopifyShopId: target?.shopifyShopId,
  };
  if (
    !target ||
    typeof scope.shopId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(scope.shopId) ||
    !/^[1-9][0-9]*$/.test(scope.installationGeneration) ||
    !/^[1-9][0-9]*$/.test(scope.shopifyShopId) ||
    typeof dependencies?.credentials?.acquire !== 'function'
  )
    fail('invalid_request');
  const now = dependencies.now ?? (() => new Date());
  const started = now().getTime();
  if (!Number.isFinite(started)) fail('invalid_request');
  let credential: Awaited<ReturnType<AdminCredentialSource['acquire']>>;
  try {
    credential = await dependencies.credentials.acquire({
      shopId: scope.shopId,
      installationGeneration: scope.installationGeneration,
    });
  } catch {
    return fail('credential_unavailable');
  }
  if (
    !credential ||
    credential.kind !== 'usable' ||
    !/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/.test(credential.shopDomain) ||
    typeof credential.accessToken !== 'string' ||
    !credential.accessToken ||
    credential.accessToken.length > 8192 ||
    Array.from(credential.accessToken).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    !(credential.accessExpiresAt instanceof Date) ||
    !Number.isFinite(credential.accessExpiresAt.getTime()) ||
    credential.accessExpiresAt.getTime() <= started + 30_000
  )
    fail('credential_unavailable');
  const usable = {
    shopDomain: credential.shopDomain,
    accessToken: credential.accessToken,
    expiresAt: credential.accessExpiresAt.getTime(),
  };
  let lastClock = started;
  function currentClock(): number {
    const current = now().getTime();
    if (!Number.isFinite(current) || current < lastClock) fail('invalid_request');
    lastClock = current;
    return current;
  }
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    return await withAdminDeadline(
      async (signal) => {
        const countryCodes: string[] = [];
        const seenCursors = new Set<string>();
        let after: string | null = null;
        let identity: { shopCurrency: string; primaryMarketId: string } | null = null;
        for (let index = 0; index < 4; index++) {
          if (signal.aborted) fail('network');
          if (usable.expiresAt <= currentClock() + 30_000) fail('credential_unavailable');
          const response = await (dependencies.fetchImpl ?? fetch)(
            `https://${usable.shopDomain}/admin/api/${PRIMARY_MARKET_API_VERSION}/graphql.json`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-shopify-access-token': usable.accessToken },
              body: JSON.stringify({ query: QUERY, variables: { after } }),
              redirect: 'error',
              signal,
            },
          );
          if (signal.aborted) fail('network');
          if (response.status !== 200 || response.headers.get('x-shopify-api-version') !== PRIMARY_MARKET_API_VERSION)
            fail('provider_error');
          reader = response.body?.getReader();
          if (!reader) fail('invalid_shape');
          const chunks: Uint8Array[] = [];
          let bytes = 0;
          try {
            for (;;) {
              const part = await reader.read();
              if (part.done) break;
              bytes += part.value.byteLength;
              if (bytes > 128 * 1024) fail('invalid_shape');
              chunks.push(part.value);
            }
          } catch (error) {
            await reader.cancel().catch(() => {});
            throw error;
          } finally {
            reader.releaseLock();
            reader = undefined;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
          } catch {
            return fail('invalid_shape');
          }
          const body = record(parsed);
          if (!body || body.errors !== undefined) fail('provider_error');
          const data = record(body.data);
          const shop = record(data?.shop);
          const market = record(data?.primaryMarket);
          if (!shop || shop.id !== `gid://shopify/Shop/${scope.shopifyShopId}`) fail('wrong_shop');
          if (
            typeof shop.currencyCode !== 'string' ||
            !/^[A-Z]{3}$/.test(shop.currencyCode) ||
            !market ||
            typeof market.id !== 'string' ||
            !/^gid:\/\/shopify\/Market\/[1-9][0-9]*$/.test(market.id)
          )
            fail('invalid_shape');
          if (market.status !== 'ACTIVE') fail('inactive_market');
          if (identity && (identity.shopCurrency !== shop.currencyCode || identity.primaryMarketId !== market.id))
            fail('invalid_shape');
          identity = { shopCurrency: shop.currencyCode, primaryMarketId: market.id };
          const regions = record(record(record(market.conditions)?.regionsCondition)?.regions);
          const info = record(regions?.pageInfo);
          if (
            !regions ||
            !Array.isArray(regions.nodes) ||
            regions.nodes.length > 250 ||
            !info ||
            typeof info.hasNextPage !== 'boolean'
          )
            fail('incomplete_membership');
          for (const value of regions.nodes) {
            const node = record(value);
            if (
              !node ||
              node.__typename !== 'MarketRegionCountry' ||
              typeof node.code !== 'string' ||
              !/^[A-Z]{2}$/.test(node.code) ||
              countryCodes.includes(node.code)
            )
              fail('incomplete_membership');
            countryCodes.push(node.code);
          }
          if (!info.hasNextPage) {
            if (countryCodes.length === 0 || (info.endCursor !== null && typeof info.endCursor !== 'string'))
              fail('incomplete_membership');
            const observed = currentClock();
            if (observed >= Math.min(started + PRIMARY_MARKET_FRESHNESS_MS, usable.expiresAt))
              fail('credential_unavailable');
            return {
              ...scope,
              ...identity,
              countryCodes,
              sourceApiVersion: PRIMARY_MARKET_API_VERSION,
              observedAt: new Date(observed).toISOString(),
              freshUntil: new Date(Math.min(started + PRIMARY_MARKET_FRESHNESS_MS, usable.expiresAt)).toISOString(),
            };
          }
          if (
            regions.nodes.length === 0 ||
            typeof info.endCursor !== 'string' ||
            !info.endCursor ||
            info.endCursor.length > 512 ||
            seenCursors.has(info.endCursor)
          )
            fail('incomplete_membership');
          seenCursors.add(info.endCursor);
          after = info.endCursor;
        }
        return fail('incomplete_membership');
      },
      'Primary Market read',
      () => {
        void reader?.cancel().catch(() => {});
      },
    );
  } catch (error) {
    if (error instanceof PrimaryMarketError) throw error;
    return fail('network');
  }
}
