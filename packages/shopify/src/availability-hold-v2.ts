import {
  type AvailabilityHoldV2,
  type AvailabilityScope,
  activationDigest,
  availabilityV2HeldSafe,
  availabilityV2IntentQualified,
  effectiveVisibilitySemantics,
  isAvailabilityV2,
  type ProductAvailabilitySnapshotV2,
  sameAvailabilityV2,
  type VersionedAvailabilityObservation,
  type VersionedProductAvailabilityHoldPort,
  validAvailabilityAcknowledgementV2,
  validAvailabilityV2,
} from '@insignia/application';
import {
  AVAILABILITY_ADMIN_API_VERSION,
  createShopifyAvailabilityHoldPort,
  ShopifyAvailabilityHoldError,
} from './availability-hold.js';

const fail = (kind: ConstructorParameters<typeof ShopifyAvailabilityHoldError>[0]): never => {
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

// Engineering admission guards, not merchant capacity: 100 pages / 5,000 Publications;
// each legacy effective projection is complete and bounded at 250 nodes. Bodies:128KiB.
export const AVAILABILITY_V2_PUBLICATION_PAGE_LIMIT = 100;
export const AVAILABILITY_V2_PUBLICATION_ITEM_LIMIT = 5000;
const PRODUCT_FIELDS = `__typename id status updatedAt publishedAt onlineStoreUrl
 resourcePublications(first:250, onlyPublished:false) { nodes { isPublished publishDate publication { id } } pageInfo { hasNextPage hasPreviousPage } }`;
const READ = `query InsigniaAvailabilityV2($productId:ID!, $productQuery:String!, $after:String) {
 shop { id } currentAppInstallation { app { apiKey } accessScopes { handle } }
 node(id:$productId) { ... on Product { ${PRODUCT_FIELDS} } }
 publications(first:50, after:$after) { nodes { id autoPublish supportsFuturePublishing
  includedProducts(first:2, query:$productQuery) { nodes { id } pageInfo { hasNextPage hasPreviousPage } }
 } pageInfo { hasNextPage hasPreviousPage endCursor } }
}`;
const UPDATE = `mutation InsigniaAvailabilityV2Status($product:ProductUpdateInput!) {
 productUpdate(product:$product) { product { ${PRODUCT_FIELDS} } userErrors { field message } }
}`;
function productProjection(raw: unknown, productId: string) {
  const p = record(raw);
  if (!p) return fail('provider_shape');
  if (p.__typename !== 'Product' || p.id !== productId) return fail('owner_mismatch');
  const states = { ACTIVE: 'available', DRAFT: 'unavailable', ARCHIVED: 'archived', UNLISTED: 'unlisted' } as const;
  if (typeof p.status !== 'string' || !Object.hasOwn(states, p.status)) return fail('provider_shape');
  const nodes = connection(p.resourcePublications)
    .map((n) => {
      const id = record(n.publication)?.id;
      if (!gid('Publication', id) || typeof n.isPublished !== 'boolean') return fail('provider_shape');
      return { publicationId: id as string, isPublished: n.isPublished, publishDate: timestamp(n.publishDate) };
    })
    .sort((a, b) => (a.publicationId < b.publicationId ? -1 : a.publicationId > b.publicationId ? 1 : 0));
  if (new Set(nodes.map((p) => p.publicationId)).size !== nodes.length) return fail('provider_shape');
  const publishedAt = p.publishedAt === null ? null : timestamp(p.publishedAt);
  const url = p.onlineStoreUrl;
  if (url !== null) {
    if (typeof url !== 'string' || url.length > 2048) return fail('provider_shape');
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash)
        return fail('provider_shape');
    } catch {
      return fail('provider_shape');
    }
  }
  const effectiveVisibility = {
    publishedPublicationIds: nodes.filter((n) => n.isPublished).map((n) => n.publicationId),
    onlineStore: { publishedAtPresent: publishedAt !== null, urlPresent: url !== null },
    publicationEvidence: nodes,
    publishedAt,
    onlineStoreUrl: url as string | null,
  };
  return {
    state: states[p.status as keyof typeof states],
    providerUpdatedAt: timestamp(p.updatedAt),
    effectiveVisibility,
  };
}
export function createShopifyAvailabilityHoldV2Port(
  config: Parameters<typeof createShopifyAvailabilityHoldPort>[0],
): VersionedProductAvailabilityHoldPort {
  const legacy = createShopifyAvailabilityHoldPort(config); // historical parser/transport/behavior untouched
  const now = config.now ?? (() => new Date());
  const time = () => {
    const date = now();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return fail('invalid_request');
    return date.toISOString();
  };
  let busy = false,
    quarantined = false;
  const acquisitionAttempts = new Set<string>(),
    restorationAttempts = new Set<string>();
  const attemptKey = (scope: AvailabilityScope, hold: AvailabilityHoldV2) =>
    activationDigest({ scope, operationId: hold.operationId, productId: hold.before.productId });
  type Budget = { expires: number; clockExpires: number; expired: boolean };
  const check = (budget: Budget) => {
    if (budget.expired || performance.now() >= budget.expires || Date.parse(time()) >= budget.clockExpires) {
      budget.expired = true;
      return fail('network_or_timeout');
    }
  };
  async function operation<T>(action: (budget: Budget) => Promise<T>): Promise<T> {
    if (busy || quarantined) return fail('ambiguous_write');
    busy = true;
    const ms = config.timeoutMs ?? 8000;
    const budget = { expires: performance.now() + ms, clockExpires: Date.parse(time()) + ms, expired: false };
    try {
      return await action(budget);
    } finally {
      busy = false;
    }
  }
  async function historical<T>(action: () => Promise<T>): Promise<T> {
    if (busy || quarantined) return fail('ambiguous_write');
    busy = true;
    try {
      return await action();
    } finally {
      busy = false;
    }
  }
  const credential = async (scope: AvailabilityScope, budget: Budget) => {
    check(budget);
    if ((await config.isCurrent(scope)) !== true) return fail('credential_inactive');
    check(budget);
    const token = await config.credentials.acquire({
      shopId: scope.shopId,
      installationGeneration: scope.installationGeneration,
    });
    check(budget);
    if (token.kind !== 'usable')
      return fail(
        token.kind === 'missing'
          ? 'credential_missing'
          : token.kind === 'reauth_required'
            ? 'reauth_required'
            : token.kind === 'inactive'
              ? 'credential_inactive'
              : 'provider_unavailable',
      );
    if (
      typeof token.shopDomain !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/.test(token.shopDomain) ||
      typeof token.accessToken !== 'string' ||
      !token.accessToken ||
      token.accessToken.length > 8192 ||
      hasControlCharacters(token.accessToken) ||
      !(token.accessExpiresAt instanceof Date) ||
      !Number.isFinite(token.accessExpiresAt.getTime()) ||
      token.accessExpiresAt.getTime() <= Date.parse(time()) + 30000
    )
      return fail('credential_inactive');
    if ((await config.isCurrent(scope)) !== true) return fail('credential_inactive');
    check(budget);
    return token;
  };
  async function execute(
    scope: AvailabilityScope,
    budget: Budget,
    query: string,
    variables: Record<string, unknown>,
    beforeSend?: () => boolean,
  ) {
    check(budget);
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let sent = false,
      settled = false;
    const preFailure = () =>
      query === UPDATE && !sent ? ('not_dispatched' as const) : ('network_or_timeout' as const);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          budget.expired = true;
          controller.abort();
          void reader?.cancel().catch(() => {});
          reject(new ShopifyAvailabilityHoldError(preFailure()));
        },
        Math.max(1, Math.min(budget.expires - performance.now(), budget.clockExpires - Date.parse(time()))),
      );
    });
    const request = (async () => {
      const token = await credential(scope, budget);
      check(budget);
      const body = JSON.stringify({ query, variables });
      if (query === UPDATE && beforeSend) {
        let approved = false;
        try {
          approved = beforeSend() === true;
        } catch {}
        if (!approved) return fail('not_dispatched');
      }
      check(budget);
      sent = true;
      const response = await (config.fetchImpl ?? fetch)(
        `https://${token.shopDomain}/admin/api/${AVAILABILITY_ADMIN_API_VERSION}/graphql.json`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-shopify-access-token': token.accessToken },
          body,
          redirect: 'error',
          signal: controller.signal,
        },
      );
      if (budget.expired) {
        await response.body?.cancel();
        return fail('network_or_timeout');
      }
      let raw: unknown = null;
      if (response.status === 200) {
        if (!response.body) return fail('provider_shape');
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            const next = await reader.read();
            check(budget);
            if (next.done) break;
            length += next.value.byteLength;
            if (length > 128 * 1024) {
              await reader.cancel();
              return fail('provider_shape');
            }
            chunks.push(next.value);
          }
        } finally {
          reader.releaseLock();
          reader = null;
        }
        try {
          raw = JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
        } catch {
          return fail('provider_shape');
        }
      } else await response.body?.cancel();
      const current = await credential(scope, budget);
      if (current.shopDomain !== token.shopDomain || current.accessToken !== token.accessToken)
        return fail('credential_inactive');
      check(budget);
      return unwrap(response.status, raw);
    })().finally(() => {
      settled = true;
    });
    try {
      return await Promise.race([request, deadline]);
    } catch (error) {
      if (error instanceof ShopifyAvailabilityHoldError) throw error;
      return fail(preFailure());
    } finally {
      if (timer) clearTimeout(timer);
      if (!settled) quarantined = true;
    }
  }
  async function read(
    scope: AvailabilityScope,
    productId: string,
    budget: Budget,
  ): Promise<ProductAvailabilitySnapshotV2> {
    assertScope(scope, productId);
    const observedAt = time();
    let after: string | null = null;
    let prior: ReturnType<typeof productProjection> | null = null;
    const settings: { publicationId: string; autoPublish: boolean; supportsFuturePublishing: boolean }[] = [];
    const seen = new Set<string>(),
      cursors = new Set<string>();
    let projection: ReturnType<typeof productProjection> | null = null;
    for (let pageNumber = 0; pageNumber < AVAILABILITY_V2_PUBLICATION_PAGE_LIMIT; pageNumber++) {
      check(budget);
      const data = await execute(scope, budget, READ, {
        productId,
        productQuery: `id:${productId.split('/').at(-1)}`,
        after,
      });
      if (
        record(data.shop)?.id !== scope.shopifyShopId ||
        record(record(data.currentAppInstallation)?.app)?.apiKey !== scope.appClientId
      )
        return fail('owner_mismatch');
      const scopes = record(data.currentAppInstallation)?.accessScopes;
      if (!Array.isArray(scopes) || !scopes.every((s) => typeof record(s)?.handle === 'string'))
        return fail('provider_shape');
      if (
        !['read_products', 'write_products', 'read_publications'].every((h) =>
          scopes.some((s) => record(s)?.handle === h),
        )
      )
        return fail('forbidden');
      projection = productProjection(data.node, productId);
      if (
        prior &&
        (prior.state !== projection.state ||
          activationDigest(effectiveVisibilitySemantics(prior.effectiveVisibility)) !==
            activationDigest(effectiveVisibilitySemantics(projection.effectiveVisibility)))
      )
        return fail('readback_mismatch');
      prior = projection;
      const pubs = record(data.publications),
        page = record(pubs?.pageInfo);
      if (
        !pubs ||
        !Array.isArray(pubs.nodes) ||
        pubs.nodes.length > 50 ||
        !page ||
        typeof page.hasNextPage !== 'boolean' ||
        typeof page.hasPreviousPage !== 'boolean' ||
        (pageNumber === 0 && page.hasPreviousPage !== false)
      )
        return fail('provider_shape');
      for (const raw of pubs.nodes) {
        const pub = record(raw);
        if (
          !pub ||
          !gid('Publication', pub.id) ||
          typeof pub.autoPublish !== 'boolean' ||
          typeof pub.supportsFuturePublishing !== 'boolean' ||
          seen.has(pub.id as string)
        )
          return fail('provider_shape');
        seen.add(pub.id as string);
        if (seen.size > AVAILABILITY_V2_PUBLICATION_ITEM_LIMIT) return fail('provider_shape');
        const included = connection(pub.includedProducts);
        if (included.length > 1 || included.some((p) => p.id !== productId)) return fail('owner_mismatch');
        if (included.length)
          settings.push({
            publicationId: pub.id as string,
            autoPublish: pub.autoPublish,
            supportsFuturePublishing: pub.supportsFuturePublishing,
          });
      }
      if (!page.hasNextPage) {
        settings.sort((a, b) => (a.publicationId < b.publicationId ? -1 : a.publicationId > b.publicationId ? 1 : 0));
        const configuredIntent = {
          includedPublicationIds: settings.map((p) => p.publicationId),
          publicationSettings: settings,
          scheduled: projection.effectiveVisibility.publicationEvidence
            .filter((p) => !p.isPublished)
            .map((p) => ({ publicationId: p.publicationId, publishDate: p.publishDate })),
        };
        const snapshot: ProductAvailabilitySnapshotV2 = {
          version: 'm5-product-availability-snapshot-v2',
          scope: { ...scope },
          productId,
          ...projection,
          configuredIntent,
          intentDigest: activationDigest(configuredIntent),
          effectiveDigest: activationDigest(effectiveVisibilitySemantics(projection.effectiveVisibility)),
          observedAt,
          receivedAt: time(),
        };
        if (!validAvailabilityV2(snapshot)) return fail('provider_shape');
        return snapshot;
      }
      if (
        pubs.nodes.length === 0 ||
        typeof page.endCursor !== 'string' ||
        !page.endCursor ||
        page.endCursor.length > 2048 ||
        cursors.has(page.endCursor)
      )
        return fail('provider_shape');
      cursors.add(page.endCursor);
      after = page.endCursor;
    }
    return fail('provider_shape');
  }
  function validate(scope: AvailabilityScope, hold: AvailabilityHoldV2) {
    assertScope(scope, hold?.before?.productId);
    if (
      hold?.version !== 'm5-availability-hold-v2' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(hold.operationId) ||
      !validAvailabilityV2(hold.before) ||
      !sameScope(scope, hold.before.scope) ||
      hold.before.receivedAt > time()
    )
      return fail('invalid_request');
    if (
      hold.acquisitionAcknowledgement &&
      (!validAvailabilityAcknowledgementV2(hold.acquisitionAcknowledgement) ||
        !sameScope(scope, hold.acquisitionAcknowledgement.scope) ||
        hold.acquisitionAcknowledgement.productId !== hold.before.productId ||
        hold.acquisitionAcknowledgement.state !== 'unavailable')
    )
      return fail('invalid_request');
    if (
      hold.held &&
      (!validAvailabilityV2(hold.held) ||
        !sameScope(scope, hold.held.scope) ||
        hold.held.productId !== hold.before.productId ||
        !availabilityV2HeldSafe(hold.held) ||
        hold.held.intentDigest !== hold.before.intentDigest ||
        hold.held.observedAt < hold.before.observedAt ||
        hold.held.receivedAt > time())
    )
      return fail('invalid_request');
  }
  async function observe(
    scope: AvailabilityScope,
    hold: AvailabilityHoldV2,
    budget: Budget,
  ): Promise<VersionedAvailabilityObservation> {
    validate(scope, hold);
    const current = await read(scope, hold.before.productId, budget);
    const owned = hold.held ?? (hold.before.state === 'unavailable' ? hold.before : null);
    if (owned && sameAvailabilityV2(owned, current) && availabilityV2HeldSafe(current))
      return { kind: 'HELD', hold: { ...hold, held: hold.held ?? current }, current };
    return { kind: !owned && sameAvailabilityV2(hold.before, current) ? 'NOT_HELD' : 'CONFLICT', current };
  }
  async function mutate(
    scope: AvailabilityScope,
    hold: AvailabilityHoldV2,
    budget: Budget,
    state: ProductAvailabilitySnapshotV2['state'],
    beforeSend?: () => boolean,
  ) {
    const status = { available: 'ACTIVE', unavailable: 'DRAFT', archived: 'ARCHIVED', unlisted: 'UNLISTED' }[state];
    const observedAt = time();
    const data = await execute(scope, budget, UPDATE, { product: { id: hold.before.productId, status } }, beforeSend);
    const reply = record(data.productUpdate);
    if (!reply || !Array.isArray(reply.userErrors)) return fail('provider_shape');
    if (reply.userErrors.length) {
      if (
        !reply.userErrors.every((error) => {
          const item = record(error);
          return (
            item &&
            typeof item.message === 'string' &&
            (item.field === null ||
              (Array.isArray(item.field) && item.field.every((field) => typeof field === 'string')))
          );
        })
      )
        return fail('provider_shape');
      return fail('user_error');
    }
    const ack = productProjection(reply.product, hold.before.productId);
    if (ack.state !== state || ack.providerUpdatedAt > time()) return fail('readback_mismatch');
    return {
      version: 'm5-availability-mutation-ack-v2' as const,
      scope: { ...scope },
      productId: hold.before.productId,
      ...ack,
      observedAt,
      receivedAt: time(),
    };
  }
  return {
    snapshot: (scope, productId, version) =>
      version === 'v1'
        ? historical(() => legacy.snapshot(scope, productId))
        : operation((b) => read(scope, productId, b)),
    observe: (scope, hold) =>
      hold.version === 'm5-availability-hold-v1'
        ? historical(() => legacy.observe(scope, hold))
        : operation((b) => observe(scope, hold, b)),
    acquire: (scope, hold) =>
      hold.version === 'm5-availability-hold-v1'
        ? historical(() => legacy.acquire(scope, hold))
        : operation(async (budget) => {
            validate(scope, hold);
            if (hold.held) return observe(scope, hold, budget);
            const key = attemptKey(scope, hold);
            if (acquisitionAttempts.has(key)) return fail('ambiguous_write');
            const before = await read(scope, hold.before.productId, budget);
            if (!sameAvailabilityV2(before, hold.before) || !availabilityV2IntentQualified(before))
              return { kind: 'CONFLICT', current: before };
            if (before.state === 'unavailable')
              return availabilityV2HeldSafe(before)
                ? { kind: 'HELD', hold: { ...hold, held: before }, current: before }
                : { kind: 'CONFLICT', current: before };
            let ack: Awaited<ReturnType<typeof mutate>>;
            try {
              acquisitionAttempts.add(key);
              ack = await mutate(scope, hold, budget, 'unavailable');
            } catch (error) {
              if (!ambiguous(error)) throw error;
              if (quarantined || budget.expired) return fail('ambiguous_write');
              // A quiescent lost response permits observation only, never attribution/replay.
              return observe(scope, hold, budget);
            }
            let after: ProductAvailabilitySnapshotV2;
            try {
              after = await read(scope, hold.before.productId, budget);
            } catch (error) {
              if (error instanceof ShopifyAvailabilityHoldError)
                return { kind: 'CONFLICT', current: null, acknowledgement: ack };
              throw error;
            }

            if (
              ack.effectiveVisibility.publicationEvidence.some((p) => !p.isPublished) ||
              after.intentDigest !== before.intentDigest ||
              !availabilityV2HeldSafe(after) ||
              activationDigest(effectiveVisibilitySemantics(ack.effectiveVisibility)) !== after.effectiveDigest
            )
              return { kind: 'CONFLICT', current: after, acknowledgement: ack };
            return { kind: 'HELD', hold: { ...hold, held: after, acquisitionAcknowledgement: ack }, current: after };
          }),
    restore: (scope, hold, expected, beforeSend) =>
      hold.version === 'm5-availability-hold-v1'
        ? historical(() => legacy.restore(scope, hold, expected as Parameters<typeof legacy.restore>[2], beforeSend))
        : operation(async (budget) => {
            validate(scope, hold);
            const key = attemptKey(scope, hold);
            if (restorationAttempts.has(key)) return fail('ambiguous_write');
            if (!isAvailabilityV2(expected) || !validAvailabilityV2(expected)) return fail('invalid_request');
            const owned = hold.held ?? (hold.before.state === 'unavailable' ? hold.before : null);
            const current = await read(scope, hold.before.productId, budget);
            if (
              !owned ||
              !sameAvailabilityV2(owned, expected) ||
              !sameAvailabilityV2(owned, current) ||
              !availabilityV2HeldSafe(current)
            )
              return { kind: 'CONFLICT', current };
            if (hold.before.state === 'unavailable') return { kind: 'RESTORED', current };
            let ack: Awaited<ReturnType<typeof mutate>> | null = null;
            try {
              restorationAttempts.add(key);
              ack = await mutate(scope, hold, budget, hold.before.state, beforeSend);
            } catch (error) {
              if (error instanceof ShopifyAvailabilityHoldError && error.kind === 'not_dispatched')
                return { kind: 'NOT_DISPATCHED', current };
              if (!ambiguous(error)) throw error;
              if (quarantined || budget.expired) return { kind: 'RESTORATION_PENDING', current: null };
            }
            let after: ProductAvailabilitySnapshotV2;
            try {
              after = await read(scope, hold.before.productId, budget);
            } catch (error) {
              if (ambiguous(error) || (error instanceof ShopifyAvailabilityHoldError && error.kind === 'throttled'))
                return { kind: 'RESTORATION_PENDING', current: null, ...(ack ? { acknowledgement: ack } : {}) };
              if (error instanceof ShopifyAvailabilityHoldError)
                return { kind: 'CONFLICT', current: null, ...(ack ? { acknowledgement: ack } : {}) };
              throw error;
            }
            if (!ack) return { kind: 'RESTORATION_PENDING', current: after };
            if (
              !ack.effectiveVisibility.publicationEvidence.some((p) => !p.isPublished) &&
              sameAvailabilityV2(after, hold.before) &&
              availabilityV2IntentQualified(after) &&
              activationDigest(effectiveVisibilitySemantics(ack.effectiveVisibility)) === after.effectiveDigest
            )
              return { kind: 'RESTORED', current: after, acknowledgement: ack };
            return { kind: 'CONFLICT', current: after, acknowledgement: ack };
          }),
  };
}
