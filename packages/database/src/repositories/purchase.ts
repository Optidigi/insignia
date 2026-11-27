import { createHash, randomUUID } from 'node:crypto';
import {
  type AcceptedQuote,
  type HistoricalPurchaseOffer,
  orderedGroups,
  type PurchaseObservation,
  type QuoteAuthorizationSet,
  type QuoteRequest,
} from '@insignia/application';
import type { PurchaseListQuery } from '@insignia/contracts';
import { normalizeCustomizationGroups, type PublishedConfig } from '@insignia/domain';
import { type Kysely, sql } from 'kysely';
import type { Database } from '../client/database.js';
import { sha256CanonicalJson } from '../hash/canonical.js';
import { createPurchaseCursorRepository } from './purchase-cursors.js';
import { createPurchaseListRepository } from './purchase-list.js';

export type PurchaseReconciliationHint = {
  inboxId: string;
  shopId: string;
  installationGeneration: string;
  orderId: string;
  apiVersion: string;
  topic: string;
  status: string;
  attempts: number;
  /** When a failed receipt is next due (ISO); null when due now. */
  nextAttemptAt: string | null;
};
/**
 * Spec §11 default transient policy for an order receipt: 12 automated attempts, waiting 5 s after the
 * first failure and doubling to a 15-minute cap. Then the receipt stays failed; recurring discovery
 * reconciles the order independently and the retention alert (#488) covers it after payload erasure.
 * No jitter: the 30-second recovery pass processes due receipts serially and quantizes short delays.
 */
const RECEIPT_ATTEMPTS = 12;
const due = sql`(m.next_attempt_at IS NULL OR m.next_attempt_at<=clock_timestamp())`;
const ORDER_TOPICS = sql`d.api_version='2026-07' AND d.topic IN ('orders/create','orders/paid','orders/updated','refunds/create')`;
/** Receipts a reconciliation hint may come from: retained order receipts of an active, current installation. */
const RECOVERY_PAGES = 5;
const hintable = sql`inbox_messages m JOIN shopify_webhook_deliveries d ON d.inbox_id=m.id JOIN shops s ON s.shop_id=m.shop_id AND s.current_generation=m.installation_generation JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE m.source='shopify' AND m.retention_class='shopify-webhook' AND m.erasure_state='retained' AND m.purge_after>clock_timestamp() AND isfinite(m.purge_after) AND i.deactivated_at IS NULL AND m.state<>'processed' AND d.queue_handoff_state<>'exhausted' AND m.last_error_class IS DISTINCT FROM 'RECEIPT_BODY_UNUSABLE' AND ${ORDER_TOPICS}`;
/** Not processed under a live lease, budget left, due, and its queue handoff confirmed. */
const recoverable = sql`(m.state IN ('pending','failed') OR (m.state='leased' AND m.lease_until<=clock_timestamp())) AND m.attempts<${RECEIPT_ATTEMPTS} AND ${due} AND d.queue_handoff_state='confirmed'`;
export type PurchaseScope = { shopId: string; installationGeneration: string; kind: 'merchant' };
export class PurchaseStateError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID' | 'LOCKED' | 'EXPIRED' | 'NOT_READY') {
    super(code);
  }
}
const fail = (code: PurchaseStateError['code']): never => {
  throw new PurchaseStateError(code);
};
type Scope = { shopId: string; installationGeneration: string };
export type PurchaseDesignPayload = {
  version: 'm8-purchase-design-v1';
  request: QuoteRequest;
  collectedAt: string;
  revisions: readonly { revisionId: string; published: unknown; geometry: unknown; presentation: unknown }[];
};
export type PurchaseArtworkEvent = {
  eventId: string;
  version: number;
  kind: 'ATTACH' | 'LOCK';
  groupIndex: number | null;
  placementId: string | null;
  assetId: string | null;
  expiresAt: string | null;
  erasedAt: string | null;
};
export type PurchaseRecord = {
  purchaseId: string;
  shopId: string;
  installationGeneration: string;
  orderId: string;
  orderCreatedAt: string;
  currency: string;
  originalTotalMinor: string;
  isTest: boolean | null;
  bindings: readonly {
    quoteId: string;
    authorizationSetId: string;
    economics: unknown;
    lines: readonly {
      orderLineId: string;
      lineIndex: number;
      productId: string;
      variantId: string;
      quantity: number;
      unitPriceMinor: string;
    }[];
    designPayload: PurchaseDesignPayload | null;
    payloadExpiresAt: string;
    erasedAt: string | null;
  }[];
  observations: readonly {
    sourceUpdatedAt: string;
    observedAt: string;
    financialStatus: string;
    cancelledAt: string | null;
    exception: string | null;
  }[];
  firstPaidAt: string | null;
  refunds: PurchaseObservation['order']['refunds'];
  artworkEvents: readonly PurchaseArtworkEvent[];
  artworkVersion: number;
  artworkState: 'PENDING_ARTWORK' | 'READY' | 'ARTWORK_LOCKED' | 'ERASED';
};
function scopeValid(scope: Scope) {
  if (!scope.shopId || !/^\d+$/.test(scope.installationGeneration)) fail('INVALID');
}
async function active(db: Kysely<Database>, scope: Scope, lock = false) {
  scopeValid(scope);
  const found =
    await sql`SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=${scope.shopId} AND i.generation=${scope.installationGeneration}::bigint AND i.deactivated_at IS NULL ${lock ? sql`FOR SHARE OF s,i` : sql``}`.execute(
      db,
    );
  if (!found.rows.length) fail('NOT_FOUND');
}
function bounded(value: unknown, max = 1048576) {
  const text = JSON.stringify(value);
  if (!text || Buffer.byteLength(text) > max) fail('INVALID');
  return text;
}
function economics(quote: AcceptedQuote, evidence?: PurchaseObservation['bindings'][number]['evidence']) {
  const strip = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(strip)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .filter(
                ([key]) =>
                  ![
                    'canonicalIdentitySha256',
                    'revisionContentHash',
                    'contentHash',
                    'choiceSha256',
                    'artworkChecks',
                    'fxSnapshot',
                    'catalogSnapshots',
                  ].includes(key),
              )
              .map(([key, v]) => [key, strip(v)]),
          )
        : value;
  return {
    version: evidence ? 'm8-purchase-economics-v2' : 'm8-purchase-economics-v1',
    ...(evidence ? { contextSource: 'authorized_quote', purchaseEvidence: evidence } : {}),
    quoteId: quote.quoteId,
    country: quote.country,
    marketId: quote.marketId,
    currency: quote.presentmentCurrency,
    exponent: quote.presentmentExponent,
    shopCurrency: quote.shopCurrency,
    shopTimezone: quote.shopTimezone,
    policyVersion: quote.policyVersion,
    recognizedPolicyId: quote.recognizedPolicyId,
    trial: quote.trial,
    qualifyingUsageDisposition: quote.qualifyingUsageDisposition,
    economics: strip(quote.economics),
    physicalGroups: quote.physicalGroups.map(({ productId, configRevisionId, variants }) => ({
      productId,
      configRevisionId,
      variants,
    })),
  };
}
/**
 * Signed designs in artwork-event order (set, then request position), each marked whether the order contains it.
 * Indices stay the signed positions; designs that were not ordered need no artwork and are not production work.
 */
export function purchaseDesigns(record: Pick<PurchaseRecord, 'bindings'>) {
  return record.bindings.flatMap((binding) => {
    const ordered = orderedGroups(binding);
    return (binding.designPayload?.request.groups ?? []).map((item, position) => ({
      group: item.group,
      ordered: ordered[position] ?? true,
    }));
  });
}
function canonicalWebhookId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n;
}
const WEBHOOK_ID_SOURCE_UNAVAILABLE = 'WEBHOOK_ID_SOURCE_UNAVAILABLE';
function parseWebhookBody(text: string) {
  return JSON.parse(text, (key: string, value: unknown, context?: { source?: string }) => {
    // Node 24 preserves the numeric lexeme here, before any rounded Number is consumed.
    // Object-valued/string identifiers bypass this primitive-only extraction and are checked by the caller.
    if ((key === 'id' || key === 'order_id') && typeof value === 'number') {
      const source = context?.source;
      if (source === undefined) throw new Error(WEBHOOK_ID_SOURCE_UNAVAILABLE);
      if (!canonicalWebhookId(source)) throw new Error('INVALID_WEBHOOK_ID_LITERAL');
      return source;
    }
    return value;
  });
}
/**
 * Whether this runtime's JSON parser exposes numeric source text, which reading a webhook's 64-bit ids exactly
 * requires. Without it no order receipt can yield a hint; a purchase runner must refuse to start.
 */
export function webhookIdParsingSupported() {
  try {
    const body = parseWebhookBody('{"id":18446744073709551615,"order_id":9007199254740993}');
    return body.id === '18446744073709551615' && body.order_id === '9007199254740993';
  } catch {
    return false;
  }
}
function groupPurchaseRows<T extends { purchase_id: string }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.purchase_id);
    if (group) group.push(row);
    else groups.set(row.purchase_id, [row]);
  }
  return groups;
}

export function createPurchaseRepository(db: Kysely<Database>) {
  /** null: the receipt is not (or no longer) hintable; 'unusable': it is, but its stored body can never yield a hint. */
  async function readHint(
    executor: Kysely<Database>,
    id: string,
    lock = false,
  ): Promise<PurchaseReconciliationHint | 'unusable' | null> {
    const row = (
      await sql<{
        id: string;
        shop_id: string;
        installation_generation: string;
        payload: Buffer;
        payload_sha256: string;
        topic: string;
        api_version: string;
        state: string;
        attempts: number;
        next_attempt_at: Date | null;
        queue_handoff_state: string;
      }>`SELECT m.id::text,m.shop_id,m.installation_generation::text,m.payload,m.payload_sha256,d.topic,d.api_version,m.state,m.attempts,m.next_attempt_at,d.queue_handoff_state FROM ${hintable} AND m.id=${id}::uuid AND m.attempts<${lock ? RECEIPT_ATTEMPTS + 1 : RECEIPT_ATTEMPTS} ${lock ? sql`FOR UPDATE OF m` : sql``}`.execute(
        executor,
      )
    ).rows[0];
    if (!row) return null;
    if (
      row.payload.length > 8 * 1024 * 1024 ||
      createHash('sha256').update(row.payload).digest('hex') !== row.payload_sha256
    )
      return 'unusable';
    let body: Record<string, unknown>;
    try {
      body = parseWebhookBody(row.payload.toString('utf8'));
    } catch (error) {
      // Without the parser's source text no id can be read exactly; that says nothing about this body.
      if (error instanceof Error && error.message === WEBHOOK_ID_SOURCE_UNAVAILABLE) return null;
      return 'unusable';
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return 'unusable';
    const raw = row.topic === 'refunds/create' ? body.order_id : body.id;
    const numeric = raw;
    if (!canonicalWebhookId(numeric)) return 'unusable';
    // A routing header cannot turn a signed Shop/privacy body into an order processing purpose.
    const resourceId = body.admin_graphql_api_id;
    if (row.topic === 'refunds/create') {
      const refundId = body.id;
      if (!canonicalWebhookId(refundId) || resourceId !== `gid://shopify/Refund/${refundId}`) return 'unusable';
    } else if (resourceId !== `gid://shopify/Order/${numeric}`) return 'unusable';
    return {
      inboxId: row.id,
      shopId: row.shop_id,
      installationGeneration: row.installation_generation,
      orderId: `gid://shopify/Order/${numeric}`,
      apiVersion: row.api_version,
      topic: row.topic,
      status: row.state,
      attempts: row.attempts,
      nextAttemptAt: row.next_attempt_at?.toISOString() ?? null,
    };
  }

  async function hint(executor: Kysely<Database>, id: string, lock = false) {
    const found = await readHint(executor, id, lock);
    return found === 'unusable' ? null : found;
  }

  async function readOrders(scope: Scope, ids: readonly string[], executor: Kysely<Database>) {
    if (!ids.length) return [];
    await active(executor, scope);
    const orders = await sql<{
      purchase_id: string;
      shop_id: string;
      installation_generation: string;
      order_id: string;
      order_created_at: Date;
      currency: string;
      original_total_minor: string;
      is_test: boolean | null;
    }>`SELECT purchase_id::text,shop_id,installation_generation::text,order_id,order_created_at,currency,original_total_minor::text,is_test FROM purchase_orders WHERE shop_id=${scope.shopId} AND purchase_id=ANY(${ids}::uuid[])`.execute(
      executor,
    );
    return orders.rows;
  }

  async function readArtworkSources(purchaseIds: readonly string[], executor: Kysely<Database>) {
    const bindings = await sql<{
      purchase_id: string;
      set_id: string;
      quote_id: string;
      economics: unknown;
      payload: PurchaseDesignPayload | null;
      expires_at: Date;
      erased_at: Date | null;
    }>`SELECT b.purchase_id::text,b.set_id::text,b.quote_id::text,b.economics,CASE WHEN p.expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=p.shop_id AND s.current_generation=p.installation_generation AND i.deactivated_at IS NULL) THEN p.payload ELSE NULL END AS payload,p.expires_at,p.erased_at FROM purchase_bindings b JOIN purchase_design_payloads p USING(purchase_id,set_id) WHERE b.purchase_id=ANY(${purchaseIds}::uuid[]) ORDER BY b.set_id`.execute(
      executor,
    );
    const lines = await sql<{
      purchase_id: string;
      set_id: string;
      line_id: string;
      line_index: number;
      product_id: string;
      variant_id: string;
      quantity: number;
      unit_price_minor: string;
    }>`SELECT purchase_id::text,set_id::text,line_id,line_index,product_id,variant_id,quantity,unit_price_minor::text FROM purchase_lines WHERE purchase_id=ANY(${purchaseIds}::uuid[]) ORDER BY line_index`.execute(
      executor,
    );
    const events = await sql<{
      purchase_id: string;
      event_id: string;
      version: number;
      kind: 'ATTACH' | 'LOCK';
      group_index: number | null;
      placement_id: string | null;
      asset_id: string | null;
      expires_at: Date | null;
      erased_at: Date | null;
    }>`SELECT purchase_id::text,event_id::text,version,kind,CASE WHEN expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=purchase_artwork_events.shop_id AND s.current_generation=purchase_artwork_events.installation_generation AND i.deactivated_at IS NULL) THEN group_index END AS group_index,CASE WHEN expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=purchase_artwork_events.shop_id AND s.current_generation=purchase_artwork_events.installation_generation AND i.deactivated_at IS NULL) THEN placement_id END AS placement_id,CASE WHEN expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=purchase_artwork_events.shop_id AND s.current_generation=purchase_artwork_events.installation_generation AND i.deactivated_at IS NULL) THEN asset_id::text END AS asset_id,expires_at,erased_at FROM purchase_artwork_events WHERE purchase_id=ANY(${purchaseIds}::uuid[]) ORDER BY version`.execute(
      executor,
    );
    const bindingsById = groupPurchaseRows(bindings.rows);
    const linesById = groupPurchaseRows(lines.rows);
    const eventsById = groupPurchaseRows(events.rows);
    const sources = new Map<string, Pick<PurchaseRecord, 'bindings' | 'artworkEvents'>>();
    for (const id of purchaseIds) {
      const artworkEvents = (eventsById.get(id) ?? []).map((e) => ({
        eventId: e.event_id,
        version: e.version,
        kind: e.kind,
        groupIndex: e.group_index,
        placementId: e.placement_id,
        assetId: e.asset_id,
        expiresAt: e.expires_at?.toISOString() ?? null,
        erasedAt: e.erased_at?.toISOString() ?? null,
      }));
      sources.set(id, {
        artworkEvents,
        bindings: (bindingsById.get(id) ?? []).map((b) => ({
          quoteId: b.quote_id,
          authorizationSetId: b.set_id,
          economics: b.economics,
          designPayload: b.payload,
          payloadExpiresAt: b.expires_at.toISOString(),
          erasedAt: b.erased_at?.toISOString() ?? null,
          lines: (linesById.get(id) ?? [])
            .filter((l) => l.set_id === b.set_id)
            .map((l) => ({
              orderLineId: l.line_id,
              lineIndex: l.line_index,
              productId: l.product_id,
              variantId: l.variant_id,
              quantity: l.quantity,
              unitPriceMinor: l.unit_price_minor,
            })),
        })),
      });
    }
    return sources;
  }

  async function getMany(
    scope: Scope,
    ids: readonly string[],
    executor: Kysely<Database> = db,
    options?: { latestObservationOnly: true },
  ): Promise<Map<string, PurchaseRecord>> {
    const orders = await readOrders(scope, ids, executor);
    if (!orders.length) return new Map();
    const purchaseIds = orders.map((order) => order.purchase_id);
    const observations = await sql<{
      purchase_id: string;
      source_updated_at: Date;
      observed_at: Date;
      financial_status: string;
      cancelled_at: Date | null;
      exception: string | null;
    }>`SELECT ${options?.latestObservationOnly ? sql`DISTINCT ON (o.purchase_id)` : sql``} o.purchase_id::text,source_updated_at,observed_at,financial_status,cancelled_at,exception FROM purchase_observations o WHERE o.purchase_id=ANY(${purchaseIds}::uuid[]) ORDER BY o.purchase_id,source_updated_at DESC,observed_at DESC,observation_id DESC`.execute(
      executor,
    );
    const paid = await sql<{
      purchase_id: string;
      occurred_at: Date;
    }>`SELECT purchase_id::text,occurred_at FROM purchase_paid_facts WHERE purchase_id=ANY(${purchaseIds}::uuid[])`.execute(
      executor,
    );
    const refunds = await sql<{
      purchase_id: string;
      refund_id: string;
      occurred_at: Date;
      currency: string;
      amount_minor: string;
      lines: PurchaseObservation['order']['refunds'][number]['lines'];
    }>`SELECT purchase_id::text,refund_id,occurred_at,currency,amount_minor::text,lines FROM purchase_refund_facts WHERE purchase_id=ANY(${purchaseIds}::uuid[]) ORDER BY occurred_at,refund_id`.execute(
      executor,
    );
    const sourcesById = await readArtworkSources(purchaseIds, executor);
    const records = new Map<string, PurchaseRecord>();
    const readiness = new Map<PurchaseRecord, Set<string>>();
    const observationsById = groupPurchaseRows(observations.rows);
    const refundsById = groupPurchaseRows(refunds.rows);
    const paidById = new Map(paid.rows.map((payment) => [payment.purchase_id, payment.occurred_at]));
    for (const order of orders) {
      const id = order.purchase_id;
      const sources = sourcesById.get(id) ?? { bindings: [], artworkEvents: [] };
      const { artworkEvents } = sources;
      const result: PurchaseRecord = {
        purchaseId: order.purchase_id,
        shopId: order.shop_id,
        installationGeneration: order.installation_generation,
        orderId: order.order_id,
        orderCreatedAt: order.order_created_at.toISOString(),
        currency: order.currency,
        originalTotalMinor: order.original_total_minor,
        isTest: order.is_test,
        observations: (observationsById.get(id) ?? []).map((o) => ({
          sourceUpdatedAt: o.source_updated_at.toISOString(),
          observedAt: o.observed_at.toISOString(),
          financialStatus: o.financial_status,
          cancelledAt: o.cancelled_at?.toISOString() ?? null,
          exception: o.exception,
        })),
        firstPaidAt: paidById.get(id)?.toISOString() ?? null,
        refunds: (refundsById.get(id) ?? []).map((r) => ({
          refundId: r.refund_id,
          occurredAt: r.occurred_at.toISOString(),
          currency: r.currency,
          amountMinor: r.amount_minor,
          lines: r.lines,
        })),
        ...sources,
        artworkVersion: artworkEvents.at(-1)?.version ?? 0,
        artworkState: 'PENDING_ARTWORK',
      };
      if (artworkEvents.some((event) => event.kind === 'LOCK')) result.artworkState = 'ARTWORK_LOCKED';
      else if (result.bindings.some((binding) => !binding.designPayload)) result.artworkState = 'ERASED';
      else {
        if (artworkEvents.some((event) => event.kind === 'ATTACH' && event.assetId === null))
          result.artworkState = 'ERASED';
        const ids = requiredArtworkIds(result);
        if (ids) readiness.set(result, ids);
      }
      records.set(id, result);
    }
    const usable = await usableArtworkIds(
      scope.shopId,
      [...readiness.values()].flatMap((ids) => [...ids]),
      executor,
    );
    for (const [record, ids] of readiness) {
      if ([...ids].every((id) => usable.has(id))) record.artworkState = 'READY';
    }
    return records;
  }

  async function get(scope: Scope, id: string, executor: Kysely<Database> = db) {
    return (await getMany(scope, [id], executor)).values().next().value ?? null;
  }
  function requiredArtworkIds(record: PurchaseRecord): Set<string> | null {
    if (!record.bindings.length || record.bindings.some((binding) => !binding.designPayload)) return null;
    const ids = new Set<string>();
    // After attachment linkage erasure we cannot safely infer which old source should resume.
    // A merchant must explicitly recollect the working slots; never restore an earlier choice silently.
    const erasedVersion = Math.max(
      0,
      ...record.artworkEvents.filter((e) => e.kind === 'ATTACH' && e.assetId === null).map((e) => e.version),
    );
    for (const [index, item] of purchaseDesigns(record).entries()) {
      if (!item.ordered) continue;
      for (const placement of item.group.design.placements) {
        const replacement = record.artworkEvents
          .filter((e) => e.kind === 'ATTACH' && e.groupIndex === index && e.placementId === placement.placementId)
          .at(-1);
        if (erasedVersion > 0 && (!replacement || replacement.version <= erasedVersion)) return null;
        const assetId =
          replacement?.assetId ?? (placement.artwork.kind === 'revision' ? placement.artwork.revisionId : null);
        if (!assetId) return null;
        ids.add(assetId.toLowerCase());
      }
    }
    return ids;
  }
  async function usableArtworkIds(shopId: string, ids: readonly string[], executor: Kysely<Database>) {
    if (!ids.length) return new Set<string>();
    const result = await sql<{ asset_id: string }>`SELECT asset_id::text FROM artwork_assets
      WHERE asset_id=ANY(${[...new Set(ids)]}::uuid[]) AND shop_id=${shopId} AND state='USABLE' AND expires_at>clock_timestamp()`.execute(
      executor,
    );
    return new Set(result.rows.map((row) => row.asset_id));
  }
  function referencedArtworkIds(record: Pick<PurchaseRecord, 'bindings' | 'artworkEvents'>, now: Date) {
    const ids = new Set<string>();
    for (const { group, ordered } of purchaseDesigns(record))
      if (ordered)
        for (const { artwork } of group.design.placements) if (artwork.kind === 'revision') ids.add(artwork.revisionId);
    for (const event of record.artworkEvents)
      if (event.kind === 'ATTACH' && event.assetId && event.expiresAt && new Date(event.expiresAt) > now)
        ids.add(event.assetId);
    return ids;
  }
  async function listPurchaseIds(scope: PurchaseScope, input: Partial<PurchaseListQuery>, includeSentinel = false) {
    await active(db, scope);
    const limit = input.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('INVALID');
    return createPurchaseListRepository(db).listIds(scope.shopId, {
      ...input,
      before: input.before ?? null,
      limit: limit + Number(includeSentinel),
    });
  }
  return {
    ...createPurchaseCursorRepository(db),
    /** Merchant requests advance only the existing current-installation schedule.
     * Worker claims, windows and economic facts remain untouched. */
    async requestReconciliation(scope: PurchaseScope, purchaseId: string): Promise<void> {
      if (scope.kind !== 'merchant') fail('INVALID');
      await db.transaction().execute(async (tx) => {
        await active(tx, scope, true);
        const result = await sql`UPDATE purchase_reconciliation_cursors p
          SET next_attempt_at=LEAST(p.next_attempt_at,clock_timestamp())
          WHERE p.shop_id=${scope.shopId} AND p.installation_generation=${scope.installationGeneration}::bigint
          AND EXISTS(SELECT 1 FROM purchase_orders o WHERE o.shop_id=p.shop_id AND o.purchase_id=${purchaseId}::uuid)
          RETURNING p.shop_id`.execute(tx);
        if (!result.rows.length) fail('NOT_FOUND');
      });
    },
    async reconcile(input: PurchaseObservation & { inboxId?: string; claimToken?: string }) {
      const order = input.order;
      bounded(input);
      scopeValid(order);
      if (
        !order.complete ||
        typeof order.test !== 'boolean' ||
        !/^gid:\/\/shopify\/Order\/[1-9][0-9]*$/.test(order.orderId) ||
        !/^[0-9]+$/.test(order.totalPriceMinor)
      )
        fail('INVALID');
      const id = await db.transaction().execute(async (tx) => {
        await active(tx, order, true);
        const delivery = input.inboxId ? await hint(tx, input.inboxId, true) : null;
        if (
          input.inboxId &&
          (!delivery ||
            delivery.shopId !== order.shopId ||
            delivery.installationGeneration !== order.installationGeneration ||
            delivery.orderId !== order.orderId)
        )
          fail('CONFLICT');
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${order.shopId}:${order.orderId}`},0))`.execute(tx);
        const previous = (
          await sql<{
            purchase_id: string;
            installation_generation: string;
            currency: string;
            original_total_minor: string;
            is_test: boolean | null;
          }>`SELECT purchase_id::text,installation_generation::text,currency,original_total_minor::text,is_test FROM purchase_orders WHERE shop_id=${order.shopId} AND order_id=${order.orderId} FOR UPDATE`.execute(
            tx,
          )
        ).rows[0];
        const completeDelivery = async () => {
          if (!input.inboxId) return;
          if (input.claimToken) {
            const claim = (
              await sql`SELECT 1 FROM inbox_messages WHERE id=${input.inboxId}::uuid AND lease_owner=${input.claimToken} AND lease_until>clock_timestamp()`.execute(
                tx,
              )
            ).rows.length;
            if (!claim) fail('CONFLICT');
          }
          await sql`UPDATE inbox_messages SET state='processed',last_error_class=NULL,lease_owner=NULL,lease_until=NULL WHERE id=${input.inboxId}::uuid`.execute(
            tx,
          );
        };
        const hasMarkers = order.lines.some((line) =>
          line.attributes.some((attribute) => attribute.key.startsWith('_insignia_')),
        );
        if (!previous && input.bindings.length === 0 && input.exception === null && !hasMarkers) {
          await completeDelivery();
          return null;
        }
        const origin = (
          await sql<{
            generation: string;
          }>`SELECT generation::text FROM installation_generations WHERE shop_id=${order.shopId} AND activated_at<=${new Date(order.createdAt)} AND (deactivated_at IS NULL OR deactivated_at>${new Date(order.createdAt)}) ORDER BY generation DESC LIMIT 1`.execute(
            tx,
          )
        ).rows[0]?.generation;
        const purchaseGeneration =
          previous?.installation_generation ??
          input.bindings[0]?.quote.installationGeneration ??
          origin ??
          order.installationGeneration;
        // Falling back to the active installation would reimport pre-install or
        // between-install orders after their former shop data was erased.
        const originUnverified = !previous && input.bindings.length === 0 && !origin;
        const erasedGeneration = await sql`SELECT 1 FROM public.shop_privacy_fences
          WHERE shop_id=${order.shopId} AND
            (${originUnverified} OR installation_generation IN (${purchaseGeneration}::bigint,${origin ?? null}::bigint))
          LIMIT 1`.execute(tx);
        if (erasedGeneration.rows.length) {
          await completeDelivery();
          return null;
        }
        const purchaseId = previous?.purchase_id ?? randomUUID();
        const changedOrder =
          !!previous &&
          (previous.currency !== order.currency ||
            previous.original_total_minor !== order.totalPriceMinor ||
            (previous.is_test !== null && previous.is_test !== order.test));
        if (!previous)
          await sql`INSERT INTO purchase_orders(purchase_id,shop_id,installation_generation,order_id,order_created_at,currency,original_total_minor,is_test) VALUES(${purchaseId}::uuid,${order.shopId},${purchaseGeneration}::bigint,${order.orderId},${new Date(order.createdAt)},${order.currency},${order.totalPriceMinor}::numeric,${order.test})`.execute(
            tx,
          );
        const originalGeneration = purchaseGeneration;
        let exception = changedOrder ? 'UNSUPPORTED_ORDER_EDIT' : input.exception;
        const existing = (
          await sql<{
            set_id: string;
          }>`SELECT set_id::text FROM purchase_bindings WHERE purchase_id=${purchaseId}::uuid`.execute(tx)
        ).rows;
        if (existing.length) {
          if (!hasMarkers) exception = 'CUSTOMIZATION_MARKERS_MISSING';
          const expected = await sql<{
            line_id: string;
            line_index: number;
            variant_id: string;
            quantity: number;
            unit_price_minor: string;
          }>`SELECT line_id,line_index,variant_id,quantity,unit_price_minor::text FROM purchase_lines WHERE purchase_id=${purchaseId}::uuid`.execute(
            tx,
          );
          if (
            expected.rows.some((l) => {
              const line = order.lines.find((x) => x.lineId === l.line_id);
              return (
                !line ||
                line.variantId?.split('/').at(-1) !== l.variant_id.split('/').at(-1) ||
                line.quantity !== l.quantity ||
                line.originalUnitPriceMinor !== l.unit_price_minor ||
                line.sellingPlanId !== null
              );
            })
          )
            exception = 'UNSUPPORTED_ORDER_EDIT';
          if (
            input.bindings.length &&
            (existing.length !== input.bindings.length ||
              existing.some((e) => !input.bindings.some((b) => b.authorizationSetId === e.set_id)) ||
              expected.rows.some(
                (l) =>
                  !input.bindings.some((b) =>
                    b.lines.some(
                      (x) =>
                        x.orderLineId === l.line_id &&
                        x.lineIndex === l.line_index &&
                        x.variantId === l.variant_id &&
                        x.quantity === l.quantity &&
                        x.unitPriceMinor === l.unit_price_minor,
                    ),
                  ),
              ))
          )
            exception = 'UNSUPPORTED_ORDER_EDIT';
        } else if (input.bindings.length) {
          for (const binding of input.bindings) {
            const quote = (
              await sql<{
                quote_value: AcceptedQuote;
              }>`SELECT quote_value FROM public.read_purchase_offer_history(${order.shopId},${order.installationGeneration}::bigint,${binding.quoteId}::uuid,${binding.authorizationSetId}::uuid) WHERE original_generation=${originalGeneration}`.execute(
                tx,
              )
            ).rows[0];
            if (!quote || sha256CanonicalJson(quote.quote_value) !== sha256CanonicalJson(binding.quote))
              fail('CONFLICT');
            if (
              binding.lines.some((line) => {
                const actual = order.lines.find((item) => item.lineId === line.orderLineId);
                return (
                  !actual ||
                  actual.productId?.split('/').at(-1) !== line.productId.split('/').at(-1) ||
                  actual.variantId?.split('/').at(-1) !== line.variantId.split('/').at(-1) ||
                  actual.quantity !== line.quantity ||
                  actual.originalUnitPriceMinor !== line.unitPriceMinor ||
                  actual.sellingPlanId !== null
                );
              })
            )
              fail('CONFLICT');
            const source = (
              await sql<{
                collected_at: Date;
                expires_at: Date;
              }>`SELECT collected_at,expires_at FROM purchase_offer_payloads WHERE shop_id=${order.shopId} AND installation_generation=${originalGeneration}::bigint AND quote_id=${binding.quoteId}::uuid`.execute(
                tx,
              )
            ).rows[0];
            if (
              source &&
              (source.collected_at.toISOString() !== new Date(binding.payloadCollectedAt).toISOString() ||
                source.expires_at.toISOString() !== new Date(binding.payloadExpiresAt).toISOString())
            )
              fail('CONFLICT');
            const payload = binding.designPayload as PurchaseDesignPayload | null;
            if (
              (payload && payload.version !== 'm8-purchase-design-v1') ||
              !Number.isFinite(+new Date(binding.payloadCollectedAt)) ||
              new Date(binding.payloadExpiresAt) <= new Date(binding.payloadCollectedAt)
            )
              fail('INVALID');
            await sql`INSERT INTO purchase_bindings VALUES(${order.shopId},${originalGeneration}::bigint,${purchaseId}::uuid,${binding.quoteId}::uuid,${binding.authorizationSetId}::uuid,${bounded(economics(binding.quote, binding.evidence), 262144)}::jsonb)`.execute(
              tx,
            );
            for (const line of binding.lines)
              await sql`INSERT INTO purchase_lines VALUES(${order.shopId},${originalGeneration}::bigint,${purchaseId}::uuid,${binding.authorizationSetId}::uuid,${line.orderLineId},${line.lineIndex},${line.productId},${line.variantId},${line.quantity},${line.unitPriceMinor}::numeric)`.execute(
                tx,
              );
            const expired =
              payload === null ||
              new Date(binding.payloadExpiresAt) <= new Date(order.observedAt) ||
              new Date(binding.payloadExpiresAt) <= new Date();
            await sql`INSERT INTO purchase_design_payloads VALUES(${order.shopId},${originalGeneration}::bigint,${purchaseId}::uuid,${binding.authorizationSetId}::uuid,${new Date(binding.payloadCollectedAt)},${new Date(binding.payloadExpiresAt)},${expired ? null : bounded(payload)}::jsonb,${expired ? new Date(order.observedAt) : null})`.execute(
              tx,
            );
          }
        }
        const { observedAt: _observedAt, ...source } = order;
        const digest = sha256CanonicalJson({
          ...source,
          lines: source.lines.map(({ attributes: _attributes, ...line }) => line),
          exception,
        });
        await sql`INSERT INTO purchase_observations VALUES(${randomUUID()}::uuid,${order.shopId},${originalGeneration}::bigint,${purchaseId}::uuid,${new Date(order.updatedAt)},${new Date(order.observedAt)},${digest},${order.financialStatus},${order.cancelledAt ? new Date(order.cancelledAt) : null},${exception}) ON CONFLICT(purchase_id,digest) DO NOTHING`.execute(
          tx,
        );
        if (input.firstPaidAt && !exception && input.bindings.length)
          await sql`INSERT INTO purchase_paid_facts(purchase_id,shop_id,installation_generation,occurred_at) VALUES(${purchaseId}::uuid,${order.shopId},${originalGeneration}::bigint,${new Date(input.firstPaidAt)}) ON CONFLICT DO NOTHING`.execute(
            tx,
          );
        for (const refund of order.refunds) {
          const prior = (
            await sql<{
              purchase_id: string;
              occurred_at: Date;
              currency: string;
              amount_minor: string;
              lines: unknown;
            }>`SELECT purchase_id::text,occurred_at,currency,amount_minor::text,lines FROM purchase_refund_facts WHERE shop_id=${order.shopId} AND refund_id=${refund.refundId}`.execute(
              tx,
            )
          ).rows[0];
          if (prior) {
            if (
              prior.purchase_id !== purchaseId ||
              prior.occurred_at.toISOString() !== new Date(refund.occurredAt).toISOString() ||
              prior.currency !== refund.currency ||
              prior.amount_minor !== refund.amountMinor ||
              sha256CanonicalJson(prior.lines) !== sha256CanonicalJson(refund.lines)
            )
              fail('CONFLICT');
            continue;
          }
          await sql`INSERT INTO purchase_refund_facts VALUES(${order.shopId},${originalGeneration}::bigint,${purchaseId}::uuid,${refund.refundId},${new Date(refund.occurredAt)},${refund.currency},${refund.amountMinor}::numeric,${bounded(refund.lines, 262144)}::jsonb)`.execute(
            tx,
          );
        }
        if (order.orderName !== undefined)
          await createPurchaseListRepository(tx).rememberNames(order.shopId, { [order.orderId]: order.orderName });
        await completeDelivery();
        return purchaseId;
      });
      return id === null ? { kind: 'not_customized' as const } : ((await get(order, id)) ?? fail('NOT_FOUND'));
    },
    async getPurchaseReconciliationHint(inboxId: string) {
      return hint(db, inboxId);
    },
    async selectPurchaseRecoveryHints(limit = 100) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) fail('INVALID');
      // A worker that stopped during the last allowed attempt leaves an expired lease nothing may reclaim:
      // close it as failed, keeping its attempts and identity (#496).
      await sql`UPDATE inbox_messages m SET state='failed',last_error_class='ATTEMPTS_EXHAUSTED_AFTER_LEASE',lease_owner=NULL,lease_until=NULL,next_attempt_at=NULL FROM shopify_webhook_deliveries d WHERE d.inbox_id=m.id AND m.state='leased' AND m.lease_until<=clock_timestamp() AND m.attempts>=${RECEIPT_ATTEMPTS} AND ${ORDER_TOPICS}`.execute(
        db,
      );
      // The selection applies every condition hint() can express in SQL, so receipts it would refuse take no
      // slots (#495). A body hint() refuses is fixed (only erasure rewrites a payload), so such a receipt is
      // closed and leaves the scan for good; each pass still reads at most RECOVERY_PAGES pages.
      const hints: PurchaseReconciliationHint[] = [];
      let after: string | null = null;
      for (let page = 0; page < RECOVERY_PAGES && hints.length < limit; page++) {
        const rows: { id: string }[] = (
          await sql<{
            id: string;
          }>`SELECT m.id::text FROM ${hintable} AND ${recoverable} ${after ? sql`AND (m.received_at,m.id)>((SELECT received_at FROM inbox_messages WHERE id=${after}::uuid),${after}::uuid)` : sql``} ORDER BY m.received_at,m.id LIMIT ${limit}`.execute(
            db,
          )
        ).rows;
        const found = await Promise.all(rows.map((r) => readHint(db, r.id)));
        const unusable = rows.filter((_, index) => found[index] === 'unusable').map((r) => r.id);
        if (unusable.length)
          await sql`UPDATE inbox_messages m SET state='failed',last_error_class='RECEIPT_BODY_UNUSABLE',lease_owner=NULL,lease_until=NULL,next_attempt_at=NULL FROM shopify_webhook_deliveries d WHERE d.inbox_id=m.id AND m.id=ANY(${unusable}::uuid[]) AND m.erasure_state='retained' AND ${recoverable}`.execute(
            db,
          );
        hints.push(
          ...found
            .filter((h): h is PurchaseReconciliationHint => h !== null && h !== 'unusable')
            .slice(0, limit - hints.length),
        );
        after = rows.at(-1)?.id ?? null;
        if (rows.length < limit || !after) break;
      }
      return hints;
    },
    async claimPurchaseReconciliationHint(inboxId: string) {
      return db.transaction().execute(async (tx) => {
        const found = await hint(tx, inboxId, true);
        if (!found || found.attempts >= RECEIPT_ATTEMPTS) return null;
        const token = randomUUID();
        const claimed =
          await sql`UPDATE inbox_messages m SET state='leased',attempts=attempts+1,lease_owner=${token},lease_until=clock_timestamp()+interval '1 minute' FROM shopify_webhook_deliveries d WHERE m.id=${inboxId}::uuid AND d.inbox_id=m.id AND d.queue_handoff_state='confirmed' AND (m.state IN ('pending','failed') OR m.lease_until<=clock_timestamp()) AND ${due} RETURNING m.id`.execute(
            tx,
          );
        return claimed.rows.length ? { ...found, attempts: found.attempts + 1, claimToken: token } : null;
      });
    },
    async failPurchaseReconciliation(input: { inboxId: string; claimToken: string; failureClass: string }) {
      if (!/^[A-Z_]{1,64}$/.test(input.failureClass)) fail('INVALID');
      // `attempts` already counts this attempt (reserved at claim): wait 5 s * 2^(attempts-1), at most
      // 15 minutes; the last attempt leaves no next one.
      await sql`UPDATE inbox_messages SET state='failed',last_error_class=${input.failureClass},lease_owner=NULL,lease_until=NULL,next_attempt_at=CASE WHEN attempts<${RECEIPT_ATTEMPTS} THEN clock_timestamp()+make_interval(secs=>LEAST(900,5*power(2,attempts-1))) END WHERE id=${input.inboxId}::uuid AND lease_owner=${input.claimToken} AND state='leased'`.execute(
        db,
      );
    },
    get: (scope: Scope, id: string) => get(scope, id),
    async rememberOrderNames(scope: PurchaseScope, names: Record<string, string | null>) {
      await db.transaction().execute(async (tx) => {
        await active(tx, scope, true);
        await createPurchaseListRepository(tx).rememberNames(scope.shopId, names);
      });
    },
    async missingOrderNames(scope: PurchaseScope, limit = 100) {
      await active(db, scope);
      return createPurchaseListRepository(db).missingNames(scope.shopId, limit);
    },
    async statistics(scope: PurchaseScope, timeZone: string, observedAt: Date) {
      await active(db, scope);
      return createPurchaseListRepository(db).statistics(scope.shopId, timeZone, observedAt);
    },
    async list(scope: PurchaseScope, input: Partial<PurchaseListQuery> = {}) {
      const ids = await listPurchaseIds(scope, input);
      return Promise.all(ids.map((id) => get(scope, id)));
    },
    async listPage(scope: PurchaseScope, input: PurchaseListQuery) {
      const { limit } = input;
      const ids = await listPurchaseIds(scope, input, true);
      const pageIds = ids.slice(0, limit);
      const purchases = await getMany(scope, pageIds, db, { latestObservationOnly: true });
      return {
        purchases: pageIds.flatMap((id) => {
          const purchase = purchases.get(id);
          return purchase ? [purchase] : [];
        }),
        nextCursor: ids.length > limit ? (pageIds.at(-1) ?? null) : null,
      };
    },
    async getOffer(input: {
      shopId: string;
      installationGeneration: string;
      quoteId: string;
      authorizationSetId: string;
    }): Promise<HistoricalPurchaseOffer | null> {
      await active(db, input);
      const result = (
        await sql<{
          quote_value: AcceptedQuote;
          set_id: string;
          key_id: string;
          public_key_fingerprint: string;
          first_valid_day: number;
          last_valid_day: number;
          valid_through_day: number;
          envelope_carrier: string;
          member_carriers: QuoteAuthorizationSet['members'];
          public_key: Uint8Array;
          original_generation: string;
          activated_at: Date;
          deactivated_at: Date | null;
          revoked_at: Date | null;
          issued_at: Date | null;
          issued_day: number | null;
          shop_timezone: string | null;
          payload: QuoteRequest | null;
          collected_at: Date | null;
          expires_at: Date | null;
          erased_at: Date | null;
          desired_request: QuoteRequest | null;
          created_at: Date | null;
          retain_private_until: Date | null;
        }>`SELECT * FROM public.read_purchase_offer_history(${input.shopId},${input.installationGeneration}::bigint,${input.quoteId}::uuid,${input.authorizationSetId}::uuid)`.execute(
          db,
        )
      ).rows[0];
      if (!result) return null;
      const request = result.collected_at ? result.payload : result.desired_request;
      const collectedAt = result.collected_at ?? result.created_at;
      const expiry = result.expires_at ?? result.retain_private_until;
      if (!collectedAt || !expiry) return null;
      const retained = !!request && !result.erased_at && !result.deactivated_at && expiry > new Date();
      const revisions: PurchaseDesignPayload['revisions'][number][] = [];
      if (retained)
        for (const revision of result.quote_value.effectiveRevisions) {
          const row = (
            await sql<{
              published_value: unknown;
              geometry_value: unknown;
              presentation_value: unknown;
            }>`SELECT * FROM public.read_purchase_revision_history(${input.shopId},${input.installationGeneration}::bigint,${input.quoteId}::uuid,${input.authorizationSetId}::uuid,${revision.revisionId},${revision.contentHash})`.execute(
              db,
            )
          ).rows[0];
          if (!row) return null;
          revisions.push({
            revisionId: revision.revisionId,
            published: row.published_value,
            geometry: row.geometry_value,
            presentation: row.presentation_value,
          });
        }
      let historicalRequest = request;
      if (retained && request) {
        try {
          const normalized = normalizeCustomizationGroups(
            request.groups.map((entry) => entry.group),
            revisions.map((revision) => revision.published as PublishedConfig),
          );
          if (normalized.length !== result.quote_value.physicalGroups.length) return null;
          for (const [index, group] of normalized.entries()) {
            const accepted = result.quote_value.physicalGroups[index];
            if (
              !accepted ||
              accepted.productId !== group.productId ||
              accepted.configRevisionId !== group.configRevisionId ||
              accepted.revisionContentHash !== group.revisionContentHash ||
              accepted.canonicalIdentitySha256 !== createHash('sha256').update(group.canonicalIdentity).digest('hex') ||
              sha256CanonicalJson(accepted.variants) !== sha256CanonicalJson(group.variants)
            )
              return null;
          }
          historicalRequest = {
            ...request,
            groups: normalized.map(({ canonicalIdentity: _identity, ...group }) => ({ group })),
          };
        } catch {
          return null;
        }
      }
      return {
        quote: result.quote_value,
        authorization: {
          setId: result.set_id,
          keyId: Number(result.key_id),
          publicKeyFingerprint: result.public_key_fingerprint,
          firstValidDay: result.first_valid_day,
          lastValidDay: result.last_valid_day,
          validThroughDay: result.valid_through_day,
          envelopeCarrier: result.envelope_carrier,
          members: result.member_carriers,
        },
        publicKey: new Uint8Array(result.public_key),
        keyRevokedAt: result.revoked_at?.toISOString() ?? null,
        installationWindow: {
          generation: result.original_generation,
          startedAt: result.activated_at.toISOString(),
          deactivatedAt: result.deactivated_at?.toISOString() ?? null,
        },
        issuance: {
          issuedAt: result.issued_at?.toISOString() ?? result.quote_value.acceptedAt,
          issuedDay: result.issued_day ?? result.quote_value.acceptedDay,
          validThroughDay: result.valid_through_day,
          shopTimezone: result.shop_timezone ?? result.quote_value.shopTimezone,
        },
        designPayload:
          retained && historicalRequest
            ? ({
                version: 'm8-purchase-design-v1',
                request: historicalRequest,
                collectedAt: collectedAt.toISOString(),
                revisions,
              } satisfies PurchaseDesignPayload)
            : null,
        payloadCollectedAt: collectedAt.toISOString(),
        payloadExpiresAt: expiry.toISOString(),
      };
    },
    async appendArtwork(
      scope: PurchaseScope,
      input: {
        purchaseId: string;
        expectedVersion: number;
        groupIndex: number;
        placementId: string;
        assetId: string;
        ownerHash: string;
      },
    ) {
      if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) fail('INVALID');
      // Keep a final slot for LOCK within the bounded merchant response contract.
      if (input.expectedVersion >= 999) fail('CONFLICT');
      if (
        scope.kind !== 'merchant' ||
        !/^[a-f0-9]{64}$/.test(input.ownerHash) ||
        !Number.isInteger(input.groupIndex) ||
        input.groupIndex < 0
      )
        fail('INVALID');
      await db.transaction().execute(async (tx) => {
        await active(tx, scope, true);
        const order = (
          await sql<{
            installation_generation: string;
          }>`SELECT installation_generation::text FROM purchase_orders WHERE shop_id=${scope.shopId} AND purchase_id=${input.purchaseId}::uuid FOR UPDATE`.execute(
            tx,
          )
        ).rows[0];
        if (!order) return fail('NOT_FOUND');
        const record = await get(scope, input.purchaseId, tx);
        if (!record) return fail('NOT_FOUND');
        if (record.artworkVersion !== input.expectedVersion) fail('CONFLICT');
        if (record.artworkState === 'ARTWORK_LOCKED') fail('LOCKED');
        const design = purchaseDesigns(record)[input.groupIndex];
        const placement = (design?.ordered ? design.group : undefined)?.design.placements.find(
          (p) => p.placementId === input.placementId,
        );
        if (!placement) fail('EXPIRED');
        // The ATTACH insert extends this asset's retention (migration 72): take the update lock now, so two
        // attachments of one asset queue instead of deadlocking on a shared lock.
        const asset = (
          await sql<{
            expires_at: Date;
          }>`SELECT expires_at FROM artwork_assets WHERE asset_id=${input.assetId}::uuid AND shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint AND owner_hash=${input.ownerHash} AND owner_kind='merchant' AND state='USABLE' AND expires_at>clock_timestamp() FOR NO KEY UPDATE`.execute(
            tx,
          )
        ).rows[0];
        if (!asset) return fail('NOT_FOUND');
        await sql`INSERT INTO purchase_artwork_events(event_id,shop_id,installation_generation,purchase_id,version,kind,group_index,placement_id,asset_id,expires_at) VALUES(${randomUUID()}::uuid,${scope.shopId},${order.installation_generation}::bigint,${input.purchaseId}::uuid,${input.expectedVersion + 1},'ATTACH',${input.groupIndex},${input.placementId},${input.assetId}::uuid,${asset.expires_at})`.execute(
          tx,
        );
      });
      return (await get(scope, input.purchaseId)) ?? fail('NOT_FOUND');
    },
    async lockArtwork(scope: PurchaseScope, input: { purchaseId: string; expectedVersion: number }) {
      if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion > 1000)
        fail('INVALID');
      if (scope.kind !== 'merchant') fail('INVALID');
      await db.transaction().execute(async (tx) => {
        await active(tx, scope, true);
        const order = (
          await sql<{
            installation_generation: string;
          }>`SELECT installation_generation::text FROM purchase_orders WHERE shop_id=${scope.shopId} AND purchase_id=${input.purchaseId}::uuid FOR UPDATE`.execute(
            tx,
          )
        ).rows[0];
        if (!order) return fail('NOT_FOUND');
        const record = await get(scope, input.purchaseId, tx);
        if (!record) return fail('NOT_FOUND');
        if (record.artworkVersion !== input.expectedVersion) fail('CONFLICT');
        if (record.artworkState === 'ARTWORK_LOCKED') return;
        if (record.artworkVersion >= 1000) fail('CONFLICT');
        if (record.artworkState !== 'READY') fail('NOT_READY');
        const assets = purchaseDesigns(record).flatMap(({ group, ordered }, index) =>
          !ordered
            ? []
            : group.design.placements.map(
                (p) =>
                  record.artworkEvents
                    .filter((e) => e.kind === 'ATTACH' && e.groupIndex === index && e.placementId === p.placementId)
                    .at(-1)?.assetId ?? (p.artwork.kind === 'revision' ? p.artwork.revisionId : null),
              ),
        );
        for (const assetId of assets) {
          if (!assetId) fail('NOT_READY');
          if (
            !(
              await sql`SELECT 1 FROM artwork_assets WHERE asset_id=${assetId}::uuid AND shop_id=${scope.shopId} AND state='USABLE' AND expires_at>clock_timestamp() FOR SHARE`.execute(
                tx,
              )
            ).rows.length
          )
            fail('NOT_READY');
        }
        await sql`INSERT INTO purchase_artwork_events(event_id,shop_id,installation_generation,purchase_id,version,kind) VALUES(${randomUUID()}::uuid,${scope.shopId},${order.installation_generation}::bigint,${input.purchaseId}::uuid,${input.expectedVersion + 1},'LOCK')`.execute(
          tx,
        );
      });
      return (await get(scope, input.purchaseId)) ?? fail('NOT_FOUND');
    },
    async getAuthorizedArtworkExpirations(scope: PurchaseScope, requested: ReadonlyMap<string, ReadonlySet<string>>) {
      if (scope.kind !== 'merchant') fail('INVALID');
      // A separate read after projecting the list checks that the retained artwork references still exist.
      const orders = await readOrders(scope, [...requested.keys()], db);
      if (!orders.length) return new Map<string, Map<string, Date>>();
      const records = await readArtworkSources(
        orders.map((order) => order.purchase_id),
        db,
      );
      const at = new Date();
      const permitted = new Map<string, string[]>();
      const assetIds = new Set<string>();
      for (const [purchaseId, record] of records) {
        const references = referencedArtworkIds(record, at);
        const ids = [...(requested.get(purchaseId) ?? [])].filter((id) => references.has(id));
        permitted.set(purchaseId, ids);
        for (const id of ids) assetIds.add(id.toLowerCase());
      }
      if (!assetIds.size) return new Map<string, Map<string, Date>>();
      const found = await sql<{
        asset_id: string;
        expires_at: Date;
      }>`SELECT asset_id::text,expires_at FROM artwork_assets
        WHERE asset_id=ANY(${[...assetIds]}::uuid[]) AND shop_id=${scope.shopId} AND state='USABLE' AND expires_at>clock_timestamp()`.execute(
        db,
      );
      const expirations = new Map(found.rows.map((row) => [row.asset_id, row.expires_at]));
      const result = new Map<string, Map<string, Date>>();
      for (const [purchaseId, ids] of permitted) {
        const owned = new Map<string, Date>();
        for (const id of ids) {
          const expiresAt = expirations.get(id.toLowerCase());
          if (expiresAt) owned.set(id, expiresAt);
        }
        result.set(purchaseId, owned);
      }
      return result;
    },
    async getAuthorizedArtwork(scope: PurchaseScope, input: { purchaseId: string; assetId: string }) {
      if (scope.kind !== 'merchant') fail('INVALID');
      const [order] = await readOrders(scope, [input.purchaseId], db);
      if (!order) return null;
      const sources = (await readArtworkSources([order.purchase_id], db)).get(order.purchase_id);
      if (!sources || !referencedArtworkIds(sources, new Date()).has(input.assetId)) return null;
      const row = (
        await sql<{
          asset_id: string;
          shop_id: string;
          installation_generation: string;
          owner_hash: string;
          declared_mime: 'image/svg+xml' | 'image/png' | 'image/jpeg';
          declared_bytes: number;
          state: 'USABLE';
          quarantine_key: string;
          original_key: string;
          preview_key: string;
          collected_at: Date;
          upload_until: Date;
          expires_at: Date;
          manifest: import('@insignia/application').ArtworkManifest;
        }>`SELECT * FROM artwork_assets WHERE asset_id=${input.assetId}::uuid AND shop_id=${scope.shopId} AND state='USABLE' AND expires_at>clock_timestamp()`.execute(
          db,
        )
      ).rows[0];
      if (!row) return null;
      return {
        assetId: row.asset_id,
        shopId: row.shop_id,
        installationGeneration: row.installation_generation,
        ownerHash: row.owner_hash,
        declaredMime: row.declared_mime,
        declaredBytes: row.declared_bytes,
        state: row.state,
        quarantineKey: row.quarantine_key,
        originalKey: row.original_key,
        previewKey: row.preview_key,
        collectedAt: row.collected_at,
        uploadUntil: row.upload_until,
        expiresAt: row.expires_at,
        manifest: row.manifest,
        claimId: null,
        rejection: null,
      } satisfies import('@insignia/application').ArtworkRecord;
    },
    async cleanupDue(limit = 100) {
      return (
        (await sql<{ count: number }>`SELECT public.cleanup_purchase_payloads(${limit}) AS count`.execute(db)).rows[0]
          ?.count ?? 0
      );
    },
  };
}
export type PurchaseRepository = ReturnType<typeof createPurchaseRepository>;
