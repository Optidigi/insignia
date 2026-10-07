import {
  AVAILABILITY_V3_ANCHOR_LIMIT,
  type AvailabilityCompensationReceiptV3,
  type AvailabilityHoldV3,
  type AvailabilityMutationAcknowledgementV3,
  type AvailabilityObservationV3,
  type AvailabilityRestoreResultV3,
  type AvailabilityScope,
  activationDigest,
  availabilityV3AcknowledgementQualified,
  availabilityV3HeldSafe,
  availabilityV3Qualified,
  canonicalPublicationIdsV3,
  effectiveSemanticsV3,
  isAvailabilityV3,
  type ProductAvailabilityHoldV3Port,
  type ProductAvailabilitySnapshotV3,
  sameAvailabilityV3,
  validAvailabilityAcknowledgementV3,
  validAvailabilityV3,
  visibleSchedulesV3,
} from '@insignia/application';
import {
  AVAILABILITY_ADMIN_API_VERSION,
  type createShopifyAvailabilityHoldPort,
  ShopifyAvailabilityHoldError,
} from './availability-hold.js';
import { createShopifyAvailabilityHoldV2Port } from './availability-hold-v2.js';

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
// Stable exact-ID documents; no generic Publication/Catalog discovery is authority.
// nodes(ids:) was not qualified from pinned schema documentation, so use bounded serial exact resolution.
const IDENTITY = `shop { id } currentAppInstallation { app { apiKey } accessScopes { handle } }`;
const PRODUCT_FIELDS = `__typename id status updatedAt publishedAt onlineStoreUrl
 resourcePublications(first:250, onlyPublished:false) { nodes { isPublished publishDate publication { id } } pageInfo { hasNextPage hasPreviousPage } }`;
const READ = `query InsigniaAvailabilityV3Product($productId:ID!) { ${IDENTITY} node(id:$productId) { ... on Product { ${PRODUCT_FIELDS} } } }`;
const ANCHOR = `query InsigniaAvailabilityV3Anchor($publicationId:ID!, $productQuery:String!) { ${IDENTITY}
 publication(id:$publicationId) { __typename id autoPublish supportsFuturePublishing
 includedProducts(first:2, query:$productQuery) { nodes { id } pageInfo { hasNextPage hasPreviousPage } } } }`;
const UPDATE = `mutation InsigniaAvailabilityV3Status($product:ProductUpdateInput!) { productUpdate(product:$product) { product { ${PRODUCT_FIELDS} } userErrors { field message } } }`;
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
export function createShopifyAvailabilityHoldV3Port(
  config: Parameters<typeof createShopifyAvailabilityHoldPort>[0],
): ProductAvailabilityHoldV3Port {
  const legacy = createShopifyAvailabilityHoldV2Port(config);
  const now = config.now ?? (() => new Date());
  const time = () => {
    const date = now();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return fail('invalid_request');
    return date.toISOString();
  };
  let busy = false,
    quarantined = false;
  const acquisitionAttempts = new Set<string>(),
    restorationAttempts = new Set<string>(),
    compensationAttempts = new Set<string>();
  const attemptKey = (scope: AvailabilityScope, hold: AvailabilityHoldV3) =>
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
    const ms = config.timeoutMs ?? 8000;
    if (!Number.isFinite(ms) || ms <= 0 || ms > 30000) return fail('invalid_request');
    busy = true;
    const budget = { expires: performance.now() + ms, clockExpires: Date.parse(time()) + ms, expired: false };
    try {
      return await action(budget);
    } finally {
      if (budget.expired) quarantined = true;
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

  function identity(data: Record<string, unknown>, scope: AvailabilityScope) {
    if (
      record(data.shop)?.id !== scope.shopifyShopId ||
      record(record(data.currentAppInstallation)?.app)?.apiKey !== scope.appClientId
    )
      return fail('owner_mismatch');
    const scopes = record(data.currentAppInstallation)?.accessScopes;
    if (
      !Array.isArray(scopes) ||
      scopes.length > 256 ||
      !scopes.every(
        (s) => typeof record(s)?.handle === 'string' && /^[a-z][a-z0-9_]{0,127}$/.test(record(s)!.handle as string),
      ) ||
      new Set(scopes.map((s) => record(s)!.handle)).size !== scopes.length
    )
      return fail('provider_shape');
    if (
      !['read_products', 'write_products', 'read_publications'].every((h) =>
        scopes.some((s) => record(s)?.handle === h),
      )
    )
      return fail('forbidden');
  }
  const frame = (p: ReturnType<typeof productProjection>, at: string) => ({
    state: p.state,
    effective: effectiveSemanticsV3(p.effectiveVisibility),
    staged: visibleSchedulesV3(p.effectiveVisibility, at).map((s) => ({
      publicationId: s.publicationId,
      isPublished: s.isPublished,
    })),
  });
  async function read(
    scope: AvailabilityScope,
    productId: string,
    budget: Budget,
    required: readonly string[] = [],
  ): Promise<ProductAvailabilitySnapshotV3> {
    assertScope(scope, productId);
    if (!canonicalPublicationIdsV3(required)) return fail('invalid_request');
    const observedAt = time();
    const first = await execute(scope, budget, READ, { productId });
    identity(first, scope);
    let projection = productProjection(first.node, productId);
    const ids = [...new Set([...required, ...projection.effectiveVisibility.publishedPublicationIds])].sort();
    if (ids.length > AVAILABILITY_V3_ANCHOR_LIMIT) return fail('provider_shape');
    const anchors: ProductAvailabilitySnapshotV3['effectiveAnchors'][number][] = [];
    for (const publicationId of ids) {
      const data = await execute(scope, budget, ANCHOR, {
        publicationId,
        productQuery: `id:${productId.split('/').at(-1)}`,
      });
      identity(data, scope);
      const pub = record(data.publication);
      if (!pub || pub.__typename !== 'Publication' || pub.id !== publicationId) return fail('owner_mismatch');
      if (typeof pub.autoPublish !== 'boolean' || typeof pub.supportsFuturePublishing !== 'boolean')
        return fail('provider_shape');
      const included = connection(pub.includedProducts);
      if (included.length !== 1 || included[0]!.id !== productId) return fail('owner_mismatch');
      anchors.push({
        publicationId,
        resolved: true,
        productIncluded: true,
        autoPublish: pub.autoPublish,
        supportsFuturePublishing: pub.supportsFuturePublishing,
      });
    }
    if (ids.length) {
      const final = await execute(scope, budget, READ, { productId });
      identity(final, scope);
      const after = productProjection(final.node, productId);
      if (activationDigest(frame(projection, observedAt)) !== activationDigest(frame(after, observedAt)))
        return fail('readback_mismatch');
      projection = after;
    }
    const snapshot: ProductAvailabilitySnapshotV3 = {
      version: 'm5-product-availability-snapshot-v3',
      scope: { ...scope },
      productId,
      ...projection,
      effectiveAnchors: anchors,
      visibleScheduledOrStaged: visibleSchedulesV3(projection.effectiveVisibility, observedAt),
      effectiveDigest: activationDigest(effectiveSemanticsV3(projection.effectiveVisibility)),
      anchorDigest: activationDigest(anchors),
      observedAt,
      receivedAt: time(),
    };
    if (!validAvailabilityV3(snapshot)) return fail('provider_shape');
    return snapshot;
  }
  function validate(scope: AvailabilityScope, hold: AvailabilityHoldV3) {
    assertScope(scope, hold?.before?.productId);
    if (
      hold.version !== 'm5-availability-hold-v3' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(hold.operationId) ||
      !validAvailabilityV3(hold.before) ||
      !sameScope(scope, hold.before.scope) ||
      hold.before.receivedAt > time()
    )
      return fail('invalid_request');
    if (
      hold.held &&
      (!availabilityV3HeldSafe(hold.held, hold.before) ||
        hold.held.observedAt < hold.before.observedAt ||
        hold.held.receivedAt > time())
    )
      return fail('invalid_request');
    if (
      hold.held &&
      hold.before.state !== 'unavailable' &&
      !availabilityV3AcknowledgementQualified(hold.acquisitionAcknowledgement)
    )
      return fail('invalid_request');
    const ack = hold.acquisitionAcknowledgement;
    if (
      ack &&
      (!validAvailabilityAcknowledgementV3(ack) ||
        !sameScope(scope, ack.scope) ||
        ack.productId !== hold.before.productId ||
        ack.state !== 'unavailable')
    )
      return fail('invalid_request');
  }
  const originalAnchors = (hold: AvailabilityHoldV3) => hold.before.effectiveAnchors.map((a) => a.publicationId);
  async function observe(
    scope: AvailabilityScope,
    hold: AvailabilityHoldV3,
    budget: Budget,
  ): Promise<AvailabilityObservationV3> {
    validate(scope, hold);
    let current: ProductAvailabilitySnapshotV3;
    try {
      current = await read(scope, hold.before.productId, budget, originalAnchors(hold));
    } catch (error) {
      if (error instanceof ShopifyAvailabilityHoldError) return { kind: 'CONFLICT', current: null };
      throw error;
    }
    const owned = hold.held ?? (hold.before.state === 'unavailable' ? hold.before : null);
    if (owned && sameAvailabilityV3(owned, current) && availabilityV3HeldSafe(current, hold.before))
      return { kind: 'HELD', hold: { ...hold, held: hold.held ?? current }, current };
    return { kind: !owned && sameAvailabilityV3(hold.before, current) ? 'NOT_HELD' : 'CONFLICT', current };
  }
  async function mutate(
    scope: AvailabilityScope,
    hold: AvailabilityHoldV3,
    budget: Budget,
    state: ProductAvailabilitySnapshotV3['state'],
    beforeSend?: () => boolean,
  ): Promise<AvailabilityMutationAcknowledgementV3> {
    const status = { available: 'ACTIVE', unavailable: 'DRAFT', archived: 'ARCHIVED', unlisted: 'UNLISTED' }[state];
    const observedAt = time();
    const data = await execute(scope, budget, UPDATE, { product: { id: hold.before.productId, status } }, beforeSend);
    const reply = record(data.productUpdate);
    if (!reply || !Array.isArray(reply.userErrors)) return fail('provider_shape');
    if (reply.userErrors.length) {
      if (
        !reply.userErrors.every(
          (e) =>
            typeof record(e)?.message === 'string' &&
            (record(e)?.field === null ||
              (Array.isArray(record(e)?.field) && (record(e)!.field as unknown[]).every((f) => typeof f === 'string'))),
        )
      )
        return fail('provider_shape');
      return fail('user_error');
    }
    const ack: AvailabilityMutationAcknowledgementV3 = {
      version: 'm5-availability-mutation-ack-v3',
      scope: { ...scope },
      productId: hold.before.productId,
      ...productProjection(reply.product, hold.before.productId),
      observedAt,
      receivedAt: time(),
    };
    if (ack.state !== state || !validAvailabilityAcknowledgementV3(ack)) return fail('readback_mismatch');
    return ack;
  }
  async function acquire(
    scope: AvailabilityScope,
    hold: AvailabilityHoldV3,
    budget: Budget,
  ): Promise<AvailabilityObservationV3> {
    validate(scope, hold);
    if (hold.held) return observe(scope, hold, budget);
    const key = attemptKey(scope, hold);
    if (acquisitionAttempts.has(key)) return fail('ambiguous_write');
    const before = await read(scope, hold.before.productId, budget, originalAnchors(hold));
    if (!sameAvailabilityV3(before, hold.before) || !availabilityV3Qualified(before))
      return { kind: 'CONFLICT', current: before };
    if (before.state === 'unavailable')
      return availabilityV3HeldSafe(before, hold.before)
        ? { kind: 'HELD', hold: { ...hold, held: before }, current: before }
        : { kind: 'CONFLICT', current: before };
    let ack: AvailabilityMutationAcknowledgementV3;
    acquisitionAttempts.add(key);
    try {
      ack = await mutate(scope, hold, budget, 'unavailable');
    } catch (error) {
      if (error instanceof ShopifyAvailabilityHoldError && error.kind === 'not_dispatched') throw error;
      // An ACK that cannot be qualified cannot be attributed by a later status read.
      quarantined = true;
      return fail('ambiguous_write');
    }
    if (!availabilityV3AcknowledgementQualified(ack)) return { kind: 'CONFLICT', current: null, acknowledgement: ack };
    let current: ProductAvailabilitySnapshotV3;
    try {
      current = await read(scope, hold.before.productId, budget, originalAnchors(hold));
    } catch (error) {
      if (error instanceof ShopifyAvailabilityHoldError)
        return { kind: 'CONFLICT', current: null, acknowledgement: ack };
      throw error;
    }
    if (!availabilityV3HeldSafe(current, hold.before)) return { kind: 'CONFLICT', current, acknowledgement: ack };
    return { kind: 'HELD', hold: { ...hold, held: current, acquisitionAcknowledgement: ack }, current };
  }
  async function restore(
    scope: AvailabilityScope,
    hold: AvailabilityHoldV3,
    expected: unknown,
    beforeSend: (() => boolean) | undefined,
    budget: Budget,
  ): Promise<AvailabilityRestoreResultV3> {
    validate(scope, hold);
    const key = attemptKey(scope, hold);
    if (restorationAttempts.has(key)) return fail('ambiguous_write');
    if (!isAvailabilityV3(expected) || !validAvailabilityV3(expected)) return fail('invalid_request');
    const owned = hold.held ?? (hold.before.state === 'unavailable' ? hold.before : null);
    const current = await read(scope, hold.before.productId, budget, originalAnchors(hold));
    if (
      !owned ||
      !sameAvailabilityV3(owned, expected) ||
      !sameAvailabilityV3(owned, current) ||
      !availabilityV3HeldSafe(current, hold.before)
    )
      return { kind: 'CONFLICT', current };
    if (hold.before.state === 'unavailable') return { kind: 'RESTORED', current };
    const claim = hold.restorationClaim;
    if (
      !claim ||
      claim.version !== 'm5-availability-restoration-claim-v3' ||
      claim.operationId !== hold.operationId ||
      claim.productId !== hold.before.productId ||
      !sameScope(scope, claim.scope) ||
      claim.restoreReserved !== true ||
      claim.compensationReserved !== true ||
      !beforeSend
    )
      return fail('invalid_request');
    restorationAttempts.add(key);
    let acknowledgement: AvailabilityMutationAcknowledgementV3;
    try {
      acknowledgement = await mutate(scope, hold, budget, hold.before.state, beforeSend);
    } catch (error) {
      if (error instanceof ShopifyAvailabilityHoldError && error.kind === 'not_dispatched')
        return { kind: 'NOT_DISPATCHED', current };
      quarantined = true;
      return { kind: 'RESTORATION_PENDING', current: null };
    }
    let after: ProductAvailabilitySnapshotV3;
    try {
      after = await read(scope, hold.before.productId, budget, originalAnchors(hold));
    } catch (error) {
      if (error instanceof ShopifyAvailabilityHoldError)
        return { kind: 'RESTORATION_PENDING', current: null, acknowledgement };
      throw error;
    }
    if (sameAvailabilityV3(after, hold.before) && availabilityV3Qualified(after))
      return {
        kind: availabilityV3AcknowledgementQualified(acknowledgement) ? 'RESTORED' : 'CONFLICT',
        current: after,
        acknowledgement,
      };
    // Only a settled ACK plus exact requested status authorizes conditional rehold.
    if (after.state !== hold.before.state || !['available', 'unlisted'].includes(after.state))
      return { kind: 'CONFLICT', current: after, acknowledgement };
    const mismatch: string[] = [];
    if (
      activationDigest(after.effectiveVisibility.publishedPublicationIds) !==
      activationDigest(hold.before.effectiveVisibility.publishedPublicationIds)
    )
      mismatch.push('effective_publication_ids');
    if (
      activationDigest(after.effectiveVisibility.onlineStore) !==
      activationDigest(hold.before.effectiveVisibility.onlineStore)
    )
      mismatch.push('online_store_presence');
    if (after.anchorDigest !== hold.before.anchorDigest) mismatch.push('effective_anchors');
    if (after.visibleScheduledOrStaged.length) mismatch.push('visible_scheduled_or_staged');
    if (!mismatch.length || compensationAttempts.has(key)) return { kind: 'CONFLICT', current: after, acknowledgement };
    // The caller committed the conditional compensation reservation with the restore claim.
    // Neither reservation can be recreated after a crash; both are consumed by this invocation.
    compensationAttempts.add(key);
    let receipt: AvailabilityCompensationReceiptV3 = {
      version: 'm5-availability-compensation-receipt-v3',
      restoreAcknowledgement: acknowledgement,
      restored: after,
      mismatch,
      acknowledgement: null,
      current: null,
    };
    let compensationAck: AvailabilityMutationAcknowledgementV3;
    try {
      compensationAck = await mutate(scope, hold, budget, 'unavailable');
    } catch (error) {
      quarantined = true;
      return { kind: 'RESTORATION_PENDING', current: null, acknowledgement, compensation: receipt };
    }
    receipt = { ...receipt, acknowledgement: compensationAck };
    let reheld: ProductAvailabilitySnapshotV3;
    try {
      reheld = await read(scope, hold.before.productId, budget, originalAnchors(hold));
    } catch (error) {
      if (error instanceof ShopifyAvailabilityHoldError)
        return { kind: 'RESTORATION_PENDING', current: null, acknowledgement, compensation: receipt };
      throw error;
    }
    receipt = { ...receipt, current: reheld };
    return {
      kind:
        availabilityV3HeldSafe(reheld, hold.before) && availabilityV3AcknowledgementQualified(compensationAck)
          ? 'REHELD_CONFLICT'
          : 'RESTORATION_PENDING',
      current: reheld,
      acknowledgement,
      compensation: receipt,
    };
  }
  return {
    snapshot: (scope, productId, version = 'v3', anchors = []) =>
      version === 'v3'
        ? operation((b) => read(scope, productId, b, anchors))
        : historical(() => legacy.snapshot(scope, productId, version)),
    acquire: (scope, hold) =>
      hold.version === 'm5-availability-hold-v3'
        ? operation((b) => acquire(scope, hold, b))
        : historical(() => legacy.acquire(scope, hold)),
    observe: (scope, hold) =>
      hold.version === 'm5-availability-hold-v3'
        ? operation((b) => observe(scope, hold, b))
        : historical(() => legacy.observe(scope, hold)),
    restore: (scope, hold, expected, beforeSend) =>
      hold.version === 'm5-availability-hold-v3'
        ? operation((b) => restore(scope, hold, expected, beforeSend, b))
        : historical(() => legacy.restore(scope, hold, expected as Parameters<typeof legacy.restore>[2], beforeSend)),
  };
}
