/** Admin GraphQL 2026-07, requiring read_products. Contextual prices resolve active Markets only. */
export const CONTEXTUAL_PRICING_API_VERSION = '2026-07' as const;
export const CONTEXTUAL_PRICING_BATCH_SIZE = 25;
export const CONTEXTUAL_PRICING_MAX_VARIANTS = 100;
export const CONTEXTUAL_PRICING_FRESHNESS_MS = 5 * 60 * 1000;

const QUERY = `query InsigniaVariantContext($ids: [ID!]!, $country: CountryCode!) {
  nodes(ids: $ids) {
    __typename
    id
    ... on ProductVariant {
      product { id }
      contextualPricing(context: {country: $country}) {
        price { amount currencyCode }
      }
    }
  }
}`;

export type VariantContextRequest = {
  shopId: string;
  installationGeneration: string;
  productId: string;
  variantIds: readonly string[];
  context: { country: string };
};

export type VariantContextSnapshot = {
  shopId: string;
  installationGeneration: string;
  productId: string;
  variantId: string;
  productIdVerified: true;
  context: { country: string };
  amount: string;
  currencyCode: string;
  sourceApiVersion: typeof CONTEXTUAL_PRICING_API_VERSION;
  observedAt: string;
  freshUntil: string;
  correlation: { requestId: string | null };
};

export type ContextualPricingFailureKind =
  | 'invalid_request'
  | 'credential_missing'
  | 'credential_inactive'
  | 'reauth_required'
  | 'unauthorized'
  | 'forbidden'
  | 'throttled'
  | 'network_or_timeout'
  | 'provider_unavailable'
  | 'graphql_error'
  | 'missing_variant'
  | 'product_mismatch'
  | 'invalid_provider_shape'
  | 'invalid_money'
  | 'stale_snapshot';

export class ContextualPricingError extends Error {
  readonly kind: ContextualPricingFailureKind;
  readonly correlation: { requestId: string | null };

  constructor(kind: ContextualPricingFailureKind, requestId: string | null = null) {
    super(`Shopify contextual pricing failed: ${kind}`);
    this.name = 'ContextualPricingError';
    this.kind = kind;
    this.correlation = { requestId: safeRequestId(requestId) };
  }
}

export type AdminGraphqlRead = {
  shopId: string;
  installationGeneration: string;
  apiVersion: typeof CONTEXTUAL_PRICING_API_VERSION;
  query: string;
  variables: { ids: readonly string[]; country: string };
};

export interface AdminGraphqlReadTransport {
  /**
   * Read-only transport resolves credentials for the exact tenant/install and returns parsed JSON.
   * Credential states must throw ContextualPricingError with the corresponding credential kind;
   * raw network failures are sanitized by this adapter.
   */
  execute(request: AdminGraphqlRead): Promise<{ status: number; body: unknown; requestId?: string | null }>;
}

export type AdminCredentialAcquire =
  | { kind: 'usable'; shopDomain: string; accessToken: string; accessExpiresAt: Date }
  | { kind: 'missing' | 'inactive' | 'reauth_required' };

export interface AdminCredentialSource {
  acquire(input: { shopId: string; installationGeneration: string }): Promise<AdminCredentialAcquire>;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** HTTP implementation; injected credential source must fence the active installation generation. */
export function createShopifyAdminGraphqlReadTransport(config: {
  credentials: AdminCredentialSource;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}): AdminGraphqlReadTransport {
  if (
    !config?.credentials ||
    typeof config.credentials.acquire !== 'function' ||
    (config.timeoutMs !== undefined &&
      (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 30_000))
  ) {
    throw new ContextualPricingError('invalid_request');
  }
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? (() => new Date());
  return {
    async execute(request) {
      if (request.apiVersion !== CONTEXTUAL_PRICING_API_VERSION || request.query !== QUERY) {
        throw new ContextualPricingError('invalid_request');
      }
      let credential: AdminCredentialAcquire;
      try {
        credential = await config.credentials.acquire({
          shopId: request.shopId,
          installationGeneration: request.installationGeneration,
        });
      } catch {
        throw new ContextualPricingError('network_or_timeout');
      }
      if (credential.kind !== 'usable') {
        if (credential.kind === 'missing') throw new ContextualPricingError('credential_missing');
        if (credential.kind === 'inactive') throw new ContextualPricingError('credential_inactive');
        throw new ContextualPricingError('reauth_required');
      }
      if (
        !/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/.test(credential.shopDomain) ||
        !credential.accessToken ||
        credential.accessToken.length > 8192 ||
        hasControlCharacters(credential.accessToken) ||
        !(credential.accessExpiresAt instanceof Date) ||
        !Number.isFinite(credential.accessExpiresAt.getTime())
      ) {
        throw new ContextualPricingError('credential_inactive');
      }
      const currentMs = now().getTime();
      if (!Number.isFinite(currentMs) || credential.accessExpiresAt.getTime() <= currentMs + 30_000)
        throw new ContextualPricingError('reauth_required');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 8_000);
      try {
        const response = await fetchImpl(
          `https://${credential.shopDomain}/admin/api/${CONTEXTUAL_PRICING_API_VERSION}/graphql.json`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-shopify-access-token': credential.accessToken,
            },
            body: JSON.stringify({ query: request.query, variables: request.variables }),
            signal: controller.signal,
            redirect: 'error',
          },
        );
        const requestId = safeRequestId(response.headers.get('x-request-id'));
        if (response.status !== 200) return { status: response.status, body: null, requestId };
        if (!response.body) throw new ContextualPricingError('invalid_provider_shape', requestId);
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            length += next.value.byteLength;
            if (length > 128 * 1024) {
              await reader.cancel().catch(() => {});
              throw new ContextualPricingError('invalid_provider_shape', requestId);
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
          throw new ContextualPricingError('invalid_provider_shape', requestId);
        }
        return { status: response.status, body, requestId };
      } catch (error) {
        if (error instanceof ContextualPricingError) throw error;
        throw new ContextualPricingError('network_or_timeout');
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export type ContextualPricingDependencies = {
  transport: AdminGraphqlReadTransport;
  now?: () => Date;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeRequestId(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

function assertRequest(input: VariantContextRequest): void {
  const gid = (kind: string, value: unknown) =>
    typeof value === 'string' && new RegExp(`^gid://shopify/${kind}/[1-9][0-9]*$`).test(value);
  if (
    !input ||
    typeof input.shopId !== 'string' ||
    input.shopId.length < 1 ||
    input.shopId.length > 128 ||
    hasControlCharacters(input.shopId) ||
    typeof input.installationGeneration !== 'string' ||
    !/^[1-9][0-9]*$/.test(input.installationGeneration) ||
    !gid('Product', input.productId) ||
    !Array.isArray(input.variantIds) ||
    input.variantIds.length < 1 ||
    input.variantIds.length > CONTEXTUAL_PRICING_MAX_VARIANTS ||
    !input.variantIds.every((id) => gid('ProductVariant', id)) ||
    new Set(input.variantIds).size !== input.variantIds.length ||
    !input.context ||
    !/^[A-Z]{2}$/.test(input.context.country)
  ) {
    throw new ContextualPricingError('invalid_request');
  }
}

function classifyGraphqlErrors(body: Record<string, unknown>): ContextualPricingFailureKind | null {
  if (body.errors === undefined) return null;
  if (!Array.isArray(body.errors) || body.errors.length === 0) return 'invalid_provider_shape';
  const codes = body.errors.map((error) => record(record(error)?.extensions)?.code);
  if (codes.some((code) => code === 'THROTTLED' || code === 'MAX_COST_EXCEEDED')) return 'throttled';
  if (codes.some((code) => code === 'ACCESS_DENIED')) return 'forbidden';
  return 'graphql_error';
}

function parseNode(
  value: unknown,
  expectedVariantId: string,
  productId: string,
  requestId: string | null,
): {
  amount: string;
  currencyCode: string;
} {
  if (value === null) throw new ContextualPricingError('missing_variant', requestId);
  const node = record(value);
  if (node?.__typename !== 'ProductVariant' || node.id !== expectedVariantId) {
    throw new ContextualPricingError('invalid_provider_shape', requestId);
  }
  const product = record(node.product);
  if (typeof product?.id !== 'string') throw new ContextualPricingError('invalid_provider_shape', requestId);
  if (product.id !== productId) throw new ContextualPricingError('product_mismatch', requestId);
  const price = record(record(node.contextualPricing)?.price);
  if (!price) throw new ContextualPricingError('invalid_provider_shape', requestId);
  const amount = price.amount;
  const currencyCode = price.currencyCode;
  if (
    typeof amount !== 'string' ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(amount) ||
    amount.length > 64 ||
    typeof currencyCode !== 'string' ||
    !/^[A-Z]{3}$/.test(currencyCode)
  ) {
    throw new ContextualPricingError('invalid_money', requestId);
  }
  return { amount, currencyCode };
}

/** Resolves one country at a time; no result is usable across shops, installs, products or contexts. */
export async function resolveVariantContext(
  input: VariantContextRequest,
  dependencies: ContextualPricingDependencies,
): Promise<VariantContextSnapshot[]> {
  assertRequest(input);
  if (!dependencies?.transport || typeof dependencies.transport.execute !== 'function') {
    throw new ContextualPricingError('invalid_request');
  }
  const now = dependencies.now ?? (() => new Date());
  const results: VariantContextSnapshot[] = [];
  for (let offset = 0; offset < input.variantIds.length; offset += CONTEXTUAL_PRICING_BATCH_SIZE) {
    const ids = input.variantIds.slice(offset, offset + CONTEXTUAL_PRICING_BATCH_SIZE);
    let response: Awaited<ReturnType<AdminGraphqlReadTransport['execute']>>;
    try {
      response = await dependencies.transport.execute({
        shopId: input.shopId,
        installationGeneration: input.installationGeneration,
        apiVersion: CONTEXTUAL_PRICING_API_VERSION,
        query: QUERY,
        variables: { ids, country: input.context.country },
      });
    } catch (error) {
      if (error instanceof ContextualPricingError) throw error;
      throw new ContextualPricingError('network_or_timeout');
    }
    const requestId = safeRequestId(response?.requestId);
    if (!response || !Number.isInteger(response.status))
      throw new ContextualPricingError('invalid_provider_shape', requestId);
    if (response.status === 401) throw new ContextualPricingError('unauthorized', requestId);
    if (response.status === 403) throw new ContextualPricingError('forbidden', requestId);
    if (response.status === 429) throw new ContextualPricingError('throttled', requestId);
    if (response.status >= 500) throw new ContextualPricingError('provider_unavailable', requestId);
    if (response.status !== 200) throw new ContextualPricingError('graphql_error', requestId);
    const body = record(response.body);
    if (!body) throw new ContextualPricingError('invalid_provider_shape', requestId);
    const failure = classifyGraphqlErrors(body);
    if (failure) throw new ContextualPricingError(failure, requestId);
    const nodes = record(body.data)?.nodes;
    if (!Array.isArray(nodes) || nodes.length !== ids.length) {
      throw new ContextualPricingError('invalid_provider_shape', requestId);
    }
    const observedDate = now();
    const observedMs = observedDate instanceof Date ? observedDate.getTime() : NaN;
    if (!Number.isFinite(observedMs) || !Number.isFinite(observedMs + CONTEXTUAL_PRICING_FRESHNESS_MS)) {
      throw new ContextualPricingError('invalid_request');
    }
    const observedAt = observedDate.toISOString();
    const freshUntil = new Date(observedMs + CONTEXTUAL_PRICING_FRESHNESS_MS).toISOString();
    for (let index = 0; index < ids.length; index++) {
      const variantId = ids[index];
      if (variantId === undefined) throw new ContextualPricingError('invalid_provider_shape', requestId);
      const price = parseNode(nodes[index], variantId, input.productId, requestId);
      results.push({
        shopId: input.shopId,
        installationGeneration: input.installationGeneration,
        productId: input.productId,
        variantId,
        productIdVerified: true,
        context: { country: input.context.country },
        ...price,
        sourceApiVersion: CONTEXTUAL_PRICING_API_VERSION,
        observedAt,
        freshUntil,
        correlation: { requestId },
      });
    }
  }
  const completedAt = now();
  for (const snapshot of results) {
    assertFreshVariantContext(snapshot, { ...input, variantId: snapshot.variantId }, completedAt);
  }
  return results;
}

/** Application must revalidate a stored snapshot at the point of quote use. */
export function assertFreshVariantContext(
  snapshot: VariantContextSnapshot,
  target: Omit<VariantContextRequest, 'variantIds'> & { variantId: string },
  now: Date,
): void {
  const currentMs = now instanceof Date ? now.getTime() : NaN;
  const observedMs = Date.parse(snapshot?.observedAt ?? '');
  const freshMs = Date.parse(snapshot?.freshUntil ?? '');
  if (
    !Number.isFinite(currentMs) ||
    !Number.isFinite(observedMs) ||
    !Number.isFinite(freshMs) ||
    snapshot?.shopId !== target.shopId ||
    snapshot.installationGeneration !== target.installationGeneration ||
    snapshot.productId !== target.productId ||
    snapshot.variantId !== target.variantId ||
    snapshot.context?.country !== target.context.country ||
    snapshot.productIdVerified !== true ||
    snapshot.sourceApiVersion !== CONTEXTUAL_PRICING_API_VERSION ||
    observedMs > currentMs ||
    currentMs >= freshMs ||
    freshMs - observedMs !== CONTEXTUAL_PRICING_FRESHNESS_MS
  ) {
    throw new ContextualPricingError('stale_snapshot');
  }
}
