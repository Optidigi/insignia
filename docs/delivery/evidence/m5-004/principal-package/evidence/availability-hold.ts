import { createHash } from 'node:crypto';
import type {
  AvailabilityHold,
  AvailabilityHoldObservation,
  AvailabilityRestoreResult,
  AvailabilityScope,
  ProductAvailabilityHoldPort,
  ProductAvailabilitySnapshot,
} from '@insignia/application';
import type { AdminCredentialSource } from './contextual-pricing.js';

/**
 * Admin GraphQL 2026-07 contract references (documentation, not store evidence):
 * https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Product
 * https://shopify.dev/docs/api/admin-graphql/2026-07/objects/ResourcePublication
 * https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/productUpdate
 * https://shopify.dev/docs/api/admin-graphql/2026-07/enums/ProductStatus
 * resourcePublications(onlyPublished:false) includes scheduled publications; both
 * connections must be complete. The digest retains every selected visibility field.
 */
export const AVAILABILITY_ADMIN_API_VERSION = '2026-07' as const;
const PRODUCT_FIELDS = `__typename id status updatedAt publishedAt onlineStoreUrl
  resourcePublications(first: 250, onlyPublished: false) {
    nodes { isPublished publishDate publication { id } }
    pageInfo { hasNextPage hasPreviousPage }
  }
  unpublishedPublications(first: 250) {
    nodes { id }
    pageInfo { hasNextPage hasPreviousPage }
  }`;
const READ = `query InsigniaProductAvailability($productId: ID!) {
  shop { id }
  currentAppInstallation { app { apiKey } accessScopes { handle } }
  node(id: $productId) { ... on Product { ${PRODUCT_FIELDS} } }
}`;
const UPDATE = `mutation InsigniaProductAvailabilityStatus($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product { ${PRODUCT_FIELDS} }
    userErrors { field message }
  }
}`;
export type AvailabilityHoldFailureKind =
  | 'invalid_request'
  | 'credential_missing'
  | 'credential_inactive'
  | 'reauth_required'
  | 'unauthorized'
  | 'forbidden'
  | 'throttled'
  | 'not_dispatched'
  | 'network_or_timeout'
  | 'provider_unavailable'
  | 'graphql_error'
  | 'user_error'
  | 'provider_shape'
  | 'owner_mismatch'
  | 'readback_mismatch'
  | 'ambiguous_write';
/** No remote messages, token, response body or merchant metadata in errors. */
export class ShopifyAvailabilityHoldError extends Error {
  constructor(readonly kind: AvailabilityHoldFailureKind) {
    super(`Shopify availability hold failed: ${kind}`);
    this.name = 'ShopifyAvailabilityHoldError';
  }
}
const fail = (kind: AvailabilityHoldFailureKind): never => {
  throw new ShopifyAvailabilityHoldError(kind);
};
const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const gid = (kind: string, v: unknown) =>
  typeof v === 'string' && new RegExp(`^gid://shopify/${kind}/[1-9][0-9]{0,30}$`).test(v);
function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return fail('provider_shape');
  const normalized = new Date(value).toISOString();
  if (normalized.slice(0, 19) !== value.slice(0, 19)) return fail('provider_shape');
  return normalized;
}
function assertScope(scope: AvailabilityScope, productId: string): void {
  if (
    !scope ||
    typeof scope.shopId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(scope.shopId) ||
    typeof scope.installationGeneration !== 'string' ||
    !/^[1-9][0-9]{0,19}$/.test(scope.installationGeneration) ||
    !gid('Shop', scope.shopifyShopId) ||
    typeof scope.appClientId !== 'string' ||
    !/^[a-f0-9]{32}$/.test(scope.appClientId) ||
    !gid('Product', productId)
  )
    fail('invalid_request');
}
function sameScope(a: AvailabilityScope, b: AvailabilityScope): boolean {
  return (
    a.shopId === b.shopId &&
    a.installationGeneration === b.installationGeneration &&
    a.shopifyShopId === b.shopifyShopId &&
    a.appClientId === b.appClientId
  );
}
function assertSnapshot(scope: AvailabilityScope, value: ProductAvailabilitySnapshot, productId: string): void {
  if (
    !value?.scope ||
    !sameScope(scope, value.scope) ||
    value.productId !== productId ||
    !['available', 'unavailable', 'archived', 'unlisted'].includes(value.state) ||
    typeof value.visibilityDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.visibilityDigest)
  )
    fail('invalid_request');
  try {
    if (
      timestamp(value.providerVersion) !== value.providerVersion ||
      timestamp(value.observedAt) !== value.observedAt ||
      timestamp(value.receivedAt ?? value.observedAt) !== (value.receivedAt ?? value.observedAt) ||
      (value.receivedAt ?? value.observedAt) < value.observedAt ||
      value.providerVersion > (value.receivedAt ?? value.observedAt)
    )
      fail('invalid_request');
  } catch {
    fail('invalid_request');
  }
}
function assertHold(scope: AvailabilityScope, hold: AvailabilityHold): void {
  if (
    hold?.version !== 'm5-availability-hold-v1' ||
    typeof hold.operationId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(hold.operationId) ||
    !hold.before
  )
    fail('invalid_request');
  assertScope(scope, hold.before.productId);
  assertSnapshot(scope, hold.before, hold.before.productId);
  if (hold.held !== null) {
    assertSnapshot(scope, hold.held, hold.before.productId);
    if (
      hold.held.state !== 'unavailable' ||
      hold.held.providerVersion < hold.before.providerVersion ||
      hold.held.observedAt < hold.before.observedAt
    )
      fail('invalid_request');
    if (hold.before.state === 'unavailable' && !sameState(hold.before, hold.held)) fail('invalid_request');
    if (hold.before.state !== 'unavailable' && hold.held.providerVersion <= hold.before.providerVersion)
      fail('invalid_request');
  }
}
function sameState(a: ProductAvailabilitySnapshot, b: ProductAvailabilitySnapshot): boolean {
  return (
    sameScope(a.scope, b.scope) &&
    a.productId === b.productId &&
    a.state === b.state &&
    a.providerVersion === b.providerVersion &&
    a.visibilityDigest === b.visibilityDigest
  );
}
function connection(raw: unknown): Record<string, unknown>[] {
  const value = record(raw),
    page = record(value?.pageInfo);
  if (
    !value ||
    !Array.isArray(value.nodes) ||
    value.nodes.length > 250 ||
    page?.hasNextPage !== false ||
    page.hasPreviousPage !== false
  )
    return fail('provider_shape');
  return value.nodes.map((node: unknown) => record(node) ?? fail('provider_shape'));
}
function parseProduct(
  raw: unknown,
  scope: AvailabilityScope,
  productId: string,
  observedAt: string,
  receivedAt: string,
) {
  const product = record(raw);
  if (!product) return fail('provider_shape');
  if (product.__typename !== 'Product' || product.id !== productId) return fail('owner_mismatch');
  const states = { ACTIVE: 'available', DRAFT: 'unavailable', ARCHIVED: 'archived', UNLISTED: 'unlisted' } as const;
  if (typeof product.status !== 'string' || !Object.hasOwn(states, product.status)) return fail('provider_shape');
  const publications = connection(product.resourcePublications)
    .map((node) => {
      const id = record(node.publication)?.id;
      if (!gid('Publication', id) || typeof node.isPublished !== 'boolean') return fail('provider_shape');
      return { id: id as string, isPublished: node.isPublished, publishDate: timestamp(node.publishDate) };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const unpublished = connection(product.unpublishedPublications)
    .map((node) => {
      if (!gid('Publication', node.id)) return fail('provider_shape');
      return node.id as string;
    })
    .sort();
  if (
    new Set(publications.map((p) => p.id)).size !== publications.length ||
    new Set(unpublished).size !== unpublished.length
  )
    return fail('provider_shape');
  const publishedAt = product.publishedAt === null ? null : timestamp(product.publishedAt);
  const onlineStoreUrl = product.onlineStoreUrl;
  if (onlineStoreUrl !== null) {
    if (typeof onlineStoreUrl !== 'string' || onlineStoreUrl.length > 2048) return fail('provider_shape');
    try {
      const url = new URL(onlineStoreUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail('provider_shape');
    } catch {
      fail('provider_shape');
    }
  }
  const snapshot: ProductAvailabilitySnapshot = {
    scope: Object.freeze({
      shopId: scope.shopId,
      installationGeneration: scope.installationGeneration,
      shopifyShopId: scope.shopifyShopId,
      appClientId: scope.appClientId,
    }),
    productId,
    state: states[product.status as keyof typeof states],
    providerVersion: timestamp(product.updatedAt),
    visibilityDigest: hash({ publications, unpublished, publishedAt, onlineStoreUrl }),
    observedAt,
    receivedAt,
  };
  return { snapshot: Object.freeze(snapshot), membershipDigest: hash({ publications, unpublished }) };
}
function unwrap(status: number, raw: unknown): Record<string, unknown> {
  if (status === 401) return fail('unauthorized');
  if (status === 403) return fail('forbidden');
  if (status === 429) return fail('throttled');
  if (status >= 500) return fail('provider_unavailable');
  if (status !== 200) return fail('graphql_error');
  const body = record(raw);
  if (!body) return fail('provider_shape');
  if (body.errors !== undefined) {
    if (!Array.isArray(body.errors) || !body.errors.length) return fail('provider_shape');
    if (!body.errors.every((e: unknown) => typeof record(e)?.message === 'string')) return fail('provider_shape');
    const codes = body.errors.map((e: unknown) => record(record(e)?.extensions)?.code);
    if (codes.includes('THROTTLED') || codes.includes('MAX_COST_EXCEEDED')) return fail('throttled');
    if (codes.includes('ACCESS_DENIED')) return fail('forbidden');
    return fail('graphql_error');
  }
  return record(body.data) ?? fail('provider_shape');
}
const ambiguous = (error: unknown): boolean =>
  error instanceof ShopifyAvailabilityHoldError && ['network_or_timeout', 'provider_unavailable'].includes(error.kind);

/**
 * isCurrent is server-owned and must bind all four scope fields to the active M3
 * installation. Credentials acquire must independently fence shop/generation.
 * The journal owns holds; persist the intent before acquire and returned hold
 * before activation. A held:null restart cannot attribute arbitrary DRAFT to us.
 *
 * Shopify status update has NO atomic version/CAS precondition. There is a real
 * pre-read/write gap, including merchant changes and revocation after the final
 * fence. Exact checks detect observed drift; they cannot prevent all races or
 * prove drainage/propagation. Qualification must accept or close this limitation.
 */
export function createShopifyAvailabilityHoldPort(config: {
  credentials: AdminCredentialSource;
  isCurrent: (scope: AvailabilityScope) => Promise<boolean>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}): ProductAvailabilityHoldPort {
  if (
    !config?.credentials ||
    typeof config.credentials.acquire !== 'function' ||
    typeof config.isCurrent !== 'function' ||
    (config.timeoutMs !== undefined &&
      (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 30_000))
  )
    fail('invalid_request');
  const now = config.now ?? (() => new Date());
  const time = () => {
    const date = now();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return fail('invalid_request');
    return date.toISOString();
  };
  const assertCurrent = async (scope: AvailabilityScope) => {
    if ((await config.isCurrent(scope)) !== true) fail('credential_inactive');
  };
  const validateHold = (scope: AvailabilityScope, hold: AvailabilityHold) => {
    assertHold(scope, hold);
    const currentTime = time();
    if (
      (hold.before.receivedAt ?? hold.before.observedAt) > currentTime ||
      (hold.held && (hold.held.receivedAt ?? hold.held.observedAt) > currentTime)
    )
      fail('invalid_request');
  };
  const credential = async (scope: AvailabilityScope) => {
    await assertCurrent(scope);
    const result = await config.credentials.acquire({
      shopId: scope.shopId,
      installationGeneration: scope.installationGeneration,
    });
    if (result.kind !== 'usable') {
      if (result.kind === 'missing') return fail('credential_missing');
      if (result.kind === 'inactive') return fail('credential_inactive');
      if (result.kind === 'reauth_required') return fail('reauth_required');
      return fail('provider_unavailable');
    }
    if (
      typeof result.shopDomain !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/.test(result.shopDomain) ||
      typeof result.accessToken !== 'string' ||
      !result.accessToken ||
      result.accessToken.length > 8192 ||
      hasControlCharacters(result.accessToken) ||
      !(result.accessExpiresAt instanceof Date) ||
      !Number.isFinite(result.accessExpiresAt.getTime()) ||
      result.accessExpiresAt.getTime() <= Date.parse(time()) + 30_000
    )
      return fail('credential_inactive');
    await assertCurrent(scope);
    return result;
  };
  const execute = async (
    scope: AvailabilityScope,
    query: string,
    variables: Record<string, unknown>,
    beforeSend?: () => boolean,
  ) => {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    let sent = false;
    const failureBeforeSend = () =>
      query === UPDATE && !sent ? ('not_dispatched' as const) : ('network_or_timeout' as const);
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        expired = true;
        controller.abort();
        void reader?.cancel().catch(() => {});
        reject(new ShopifyAvailabilityHoldError(failureBeforeSend()));
      }, config.timeoutMs ?? 8_000);
    });
    try {
      const request = async () => {
        const token = await credential(scope);
        // An ignored deadline during credential/current resolution must not dispatch later.
        if (expired) return fail(failureBeforeSend());
        const requestBody = JSON.stringify({ query, variables });
        if (query === UPDATE && beforeSend) {
          let approved = false;
          try {
            approved = beforeSend() === true;
          } catch {
            /* Known pre-dispatch refusal. */
          }
          if (!approved) return fail('not_dispatched');
        }
        sent = true;
        const response = await (config.fetchImpl ?? fetch)(
          `https://${token.shopDomain}/admin/api/${AVAILABILITY_ADMIN_API_VERSION}/graphql.json`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-shopify-access-token': token.accessToken },
            body: requestBody,
            redirect: 'error',
            signal: controller.signal,
          },
        );
        if (expired) {
          void response.body?.cancel().catch(() => {});
          return fail('network_or_timeout');
        }
        let body: unknown = null;
        if (response.status === 200) {
          if (!response.body) return fail('provider_shape');
          reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let length = 0;
          try {
            while (true) {
              const next = await reader.read();
              if (expired) return fail('network_or_timeout');
              if (next.done) break;
              length += next.value.byteLength;
              if (length > 128 * 1024) {
                void reader.cancel().catch(() => {});
                return fail('provider_shape');
              }
              chunks.push(next.value);
            }
          } finally {
            reader.releaseLock();
            reader = null;
          }
          try {
            body = JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
          } catch {
            return fail('provider_shape');
          }
        }
        const currentToken = await credential(scope);
        if (currentToken.shopDomain !== token.shopDomain || currentToken.accessToken !== token.accessToken)
          return fail('credential_inactive');
        return unwrap(response.status, body);
      };
      return await Promise.race([request(), deadline]);
    } catch (error) {
      if (error instanceof ShopifyAvailabilityHoldError) {
        if (!sent && query === UPDATE && error.kind === 'provider_unavailable') return fail('not_dispatched');
        throw error;
      }
      return fail(failureBeforeSend());
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const observation = async (
    scope: AvailabilityScope,
    query: string,
    variables: Record<string, unknown>,
    beforeSend?: () => boolean,
  ) => {
    // Credentials, transport, body consumption and post-response fencing all count
    // toward observation age. Receipt bounds updatedAt, never freshness.
    const observedAt = time();
    const data = await execute(scope, query, variables, beforeSend);
    const receivedAt = time();
    if (receivedAt < observedAt) return fail('invalid_request');
    return { data, observedAt, receivedAt };
  };
  const read = async (scope: AvailabilityScope, productId: string) => {
    assertScope(scope, productId);
    const { data, observedAt, receivedAt } = await observation(scope, READ, { productId });
    if (
      record(data.shop)?.id !== scope.shopifyShopId ||
      record(record(data.currentAppInstallation)?.app)?.apiKey !== scope.appClientId
    )
      return fail('owner_mismatch');
    const scopes = record(data.currentAppInstallation)?.accessScopes;
    if (!Array.isArray(scopes) || !scopes.every((s: unknown) => typeof record(s)?.handle === 'string'))
      return fail('provider_shape');
    if (
      !scopes.some((s: unknown) => record(s)?.handle === 'read_products') ||
      !scopes.some((s: unknown) => record(s)?.handle === 'write_products')
    )
      return fail('forbidden');
    const parsed = parseProduct(data.node, scope, productId, observedAt, receivedAt);
    if (parsed.snapshot.providerVersion > receivedAt) return fail('provider_shape');
    return parsed;
  };
  const mutate = async (
    scope: AvailabilityScope,
    productId: string,
    state: ProductAvailabilitySnapshot['state'],
    beforeSend?: () => boolean,
  ) => {
    const status = { available: 'ACTIVE', unavailable: 'DRAFT', archived: 'ARCHIVED', unlisted: 'UNLISTED' }[state];
    const { data, observedAt, receivedAt } = await observation(
      scope,
      UPDATE,
      { product: { id: productId, status } },
      beforeSend,
    );
    const result = record(data.productUpdate);
    if (!result || !Array.isArray(result.userErrors)) return fail('provider_shape');
    if (result.userErrors.length) {
      if (
        !result.userErrors.every((e: unknown) => {
          const error = record(e);
          return (
            error &&
            typeof error.message === 'string' &&
            (error.field === null ||
              (Array.isArray(error.field) && error.field.every((f: unknown) => typeof f === 'string')))
          );
        })
      )
        return fail('provider_shape');
      return fail('user_error');
    }
    const parsed = parseProduct(result.product, scope, productId, observedAt, receivedAt);
    if (parsed.snapshot.state !== state || parsed.snapshot.providerVersion > receivedAt)
      return fail('readback_mismatch');
    return parsed;
  };
  const observe = async (scope: AvailabilityScope, hold: AvailabilityHold): Promise<AvailabilityHoldObservation> => {
    validateHold(scope, hold);
    const current = (await read(scope, hold.before.productId)).snapshot;
    const owned = hold.held ?? (hold.before.state === 'unavailable' ? hold.before : null);
    if (owned && sameState(owned, current)) return { kind: 'HELD', hold: { ...hold, held: current }, current };
    return { kind: !owned && sameState(hold.before, current) ? 'NOT_HELD' : 'CONFLICT', current };
  };
  return {
    async snapshot(scope, productId) {
      return (await read(scope, productId)).snapshot;
    },
    observe,
    async acquire(scope, hold) {
      validateHold(scope, hold);
      if (hold.held) return observe(scope, hold);
      const before = await read(scope, hold.before.productId);
      if (!sameState(before.snapshot, hold.before)) return { kind: 'CONFLICT', current: before.snapshot };
      if (before.snapshot.state === 'unavailable')
        return { kind: 'HELD', hold: { ...hold, held: before.snapshot }, current: before.snapshot };
      let acknowledged: Awaited<ReturnType<typeof mutate>>;
      try {
        acknowledged = await mutate(scope, hold.before.productId, 'unavailable');
      } catch (error) {
        if (!ambiguous(error)) throw error;
        // Read once. Status/version alone cannot attribute an unacknowledged write.
        try {
          return await observe(scope, hold);
        } catch (readError) {
          if (
            readError instanceof ShopifyAvailabilityHoldError &&
            !ambiguous(readError) &&
            readError.kind !== 'throttled'
          )
            throw readError;
          return fail('ambiguous_write');
        }
      }
      let after: ProductAvailabilitySnapshot;
      try {
        after = (await read(scope, hold.before.productId)).snapshot;
      } catch (error) {
        if (ambiguous(error) || (error instanceof ShopifyAvailabilityHoldError && error.kind === 'throttled'))
          return fail('ambiguous_write');
        throw error;
      }
      if (
        !sameState(acknowledged.snapshot, after) ||
        acknowledged.membershipDigest !== before.membershipDigest ||
        after.providerVersion <= before.snapshot.providerVersion
      )
        return { kind: 'CONFLICT', current: after };
      return { kind: 'HELD', hold: { ...hold, held: after }, current: after };
    },
    async restore(scope, hold, expectedCurrent, beforeSend): Promise<AvailabilityRestoreResult> {
      validateHold(scope, hold);
      assertSnapshot(scope, expectedCurrent, hold.before.productId);
      const current = (await read(scope, hold.before.productId)).snapshot;
      const owned = hold.held ?? (hold.before.state === 'unavailable' ? hold.before : null);
      if (!owned || !sameState(owned, expectedCurrent) || !sameState(current, owned))
        return { kind: 'CONFLICT', current };
      if (hold.before.state === 'unavailable') return { kind: 'RESTORED', current };
      let acknowledged: Awaited<ReturnType<typeof mutate>> | null = null;
      try {
        acknowledged = await mutate(scope, hold.before.productId, hold.before.state, beforeSend);
      } catch (error) {
        if (error instanceof ShopifyAvailabilityHoldError && error.kind === 'not_dispatched')
          return { kind: 'NOT_DISPATCHED', current };
        if (!ambiguous(error)) throw error;
      }
      let after: ProductAvailabilitySnapshot;
      try {
        after = (await read(scope, hold.before.productId)).snapshot;
      } catch (error) {
        if (ambiguous(error) || (error instanceof ShopifyAvailabilityHoldError && error.kind === 'throttled'))
          return { kind: 'RESTORATION_PENDING', current: null };
        throw error;
      }
      if (
        acknowledged &&
        after.state === hold.before.state &&
        after.visibilityDigest === hold.before.visibilityDigest &&
        after.providerVersion > current.providerVersion &&
        sameState(acknowledged.snapshot, after)
      )
        return { kind: 'RESTORED', current: after };
      if (
        !acknowledged &&
        (sameState(after, current) ||
          (after.state === hold.before.state && after.visibilityDigest === hold.before.visibilityDigest))
      )
        return { kind: 'RESTORATION_PENDING', current: after };
      return { kind: 'CONFLICT', current: after };
    },
  };
}
