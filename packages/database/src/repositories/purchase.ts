import { createHash, randomUUID } from 'node:crypto';
import type {
  AcceptedQuote,
  HistoricalPurchaseOffer,
  PurchaseObservation,
  QuoteAuthorizationSet,
  QuoteRequest,
} from '@insignia/application';
import { normalizeCustomizationGroups, type PublishedConfig } from '@insignia/domain';
import { type Kysely, sql } from 'kysely';
import type { Database } from '../client/database.js';
import { sha256CanonicalJson } from '../hash/canonical.js';
import { createPurchaseCursorRepository } from './purchase-cursors.js';

export type PurchaseReconciliationHint = {
  inboxId: string;
  shopId: string;
  installationGeneration: string;
  orderId: string;
  apiVersion: string;
  topic: string;
  status: string;
  attempts: number;
};
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
function canonicalWebhookId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n;
}
export function createPurchaseRepository(db: Kysely<Database>) {
  async function hint(
    executor: Kysely<Database>,
    id: string,
    lock = false,
  ): Promise<PurchaseReconciliationHint | null> {
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
        queue_handoff_state: string;
      }>`SELECT m.id::text,m.shop_id,m.installation_generation::text,m.payload,m.payload_sha256,d.topic,d.api_version,m.state,m.attempts,d.queue_handoff_state FROM inbox_messages m JOIN shopify_webhook_deliveries d ON d.inbox_id=m.id JOIN shops s ON s.shop_id=m.shop_id AND s.current_generation=m.installation_generation JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE m.id=${id}::uuid AND m.source='shopify' AND m.retention_class='shopify-webhook' AND m.erasure_state='retained' AND m.purge_after>clock_timestamp() AND isfinite(m.purge_after) AND i.deactivated_at IS NULL AND m.state<>'processed' AND m.attempts<${lock ? 6 : 5} AND d.queue_handoff_state<>'exhausted' AND d.api_version='2026-07' AND d.topic IN ('orders/create','orders/paid','orders/updated','refunds/create') ${lock ? sql`FOR UPDATE OF m` : sql``}`.execute(
        executor,
      )
    ).rows[0];
    if (
      !row ||
      row.payload.length > 8 * 1024 * 1024 ||
      createHash('sha256').update(row.payload).digest('hex') !== row.payload_sha256
    )
      return null;
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(row.payload.toString('utf8'), (key: string, value: unknown, context?: { source?: string }) => {
        // Node 24 preserves the numeric lexeme here, before any rounded Number is consumed.
        // Object-valued/string identifiers bypass this primitive-only extraction and are checked below.
        if ((key === 'id' || key === 'order_id') && typeof value === 'number') {
          const source = context?.source;
          if (!canonicalWebhookId(source)) throw new Error('INVALID_WEBHOOK_ID_LITERAL');
          return source;
        }
        return value;
      });
    } catch {
      return null;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const raw = row.topic === 'refunds/create' ? body.order_id : body.id;
    const numeric = raw;
    if (!canonicalWebhookId(numeric)) return null;
    // A routing header cannot turn a signed Shop/privacy body into an order processing purpose.
    const resourceId = body.admin_graphql_api_id;
    if (row.topic === 'refunds/create') {
      const refundId = body.id;
      if (!canonicalWebhookId(refundId) || resourceId !== `gid://shopify/Refund/${refundId}`) return null;
    } else if (resourceId !== `gid://shopify/Order/${numeric}`) return null;
    return {
      inboxId: row.id,
      shopId: row.shop_id,
      installationGeneration: row.installation_generation,
      orderId: `gid://shopify/Order/${numeric}`,
      apiVersion: row.api_version,
      topic: row.topic,
      status: row.state,
      attempts: row.attempts,
    };
  }

  async function get(scope: Scope, id: string, executor: Kysely<Database> = db): Promise<PurchaseRecord | null> {
    await active(executor, scope);
    const order = (
      await sql<{
        purchase_id: string;
        shop_id: string;
        installation_generation: string;
        order_id: string;
        order_created_at: Date;
        currency: string;
        original_total_minor: string;
        is_test: boolean | null;
      }>`SELECT purchase_id::text,shop_id,installation_generation::text,order_id,order_created_at,currency,original_total_minor::text,is_test FROM purchase_orders WHERE shop_id=${scope.shopId} AND purchase_id=${id}::uuid`.execute(
        executor,
      )
    ).rows[0];
    if (!order) return null;
    const bindings = await sql<{
      set_id: string;
      quote_id: string;
      economics: unknown;
      payload: PurchaseDesignPayload | null;
      expires_at: Date;
      erased_at: Date | null;
    }>`SELECT b.set_id::text,b.quote_id::text,b.economics,CASE WHEN p.expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=p.shop_id AND s.current_generation=p.installation_generation AND i.deactivated_at IS NULL) THEN p.payload ELSE NULL END AS payload,p.expires_at,p.erased_at FROM purchase_bindings b JOIN purchase_design_payloads p USING(purchase_id,set_id) WHERE b.purchase_id=${id}::uuid ORDER BY b.set_id`.execute(
      executor,
    );
    const lines = await sql<{
      set_id: string;
      line_id: string;
      line_index: number;
      product_id: string;
      variant_id: string;
      quantity: number;
      unit_price_minor: string;
    }>`SELECT set_id::text,line_id,line_index,product_id,variant_id,quantity,unit_price_minor::text FROM purchase_lines WHERE purchase_id=${id}::uuid ORDER BY line_index`.execute(
      executor,
    );
    const observations = await sql<{
      source_updated_at: Date;
      observed_at: Date;
      financial_status: string;
      cancelled_at: Date | null;
      exception: string | null;
    }>`SELECT source_updated_at,observed_at,financial_status,cancelled_at,exception FROM purchase_observations WHERE purchase_id=${id}::uuid ORDER BY source_updated_at DESC,observed_at DESC,observation_id DESC`.execute(
      executor,
    );
    const paid = (
      await sql<{
        occurred_at: Date;
      }>`SELECT occurred_at FROM purchase_paid_facts WHERE purchase_id=${id}::uuid`.execute(executor)
    ).rows[0];
    const refunds = await sql<{
      refund_id: string;
      occurred_at: Date;
      currency: string;
      amount_minor: string;
      lines: PurchaseObservation['order']['refunds'][number]['lines'];
    }>`SELECT refund_id,occurred_at,currency,amount_minor::text,lines FROM purchase_refund_facts WHERE purchase_id=${id}::uuid ORDER BY occurred_at,refund_id`.execute(
      executor,
    );
    const events = await sql<{
      event_id: string;
      version: number;
      kind: 'ATTACH' | 'LOCK';
      group_index: number | null;
      placement_id: string | null;
      asset_id: string | null;
      expires_at: Date | null;
      erased_at: Date | null;
    }>`SELECT event_id::text,version,kind,CASE WHEN expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=purchase_artwork_events.shop_id AND s.current_generation=purchase_artwork_events.installation_generation AND i.deactivated_at IS NULL) THEN group_index END AS group_index,CASE WHEN expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=purchase_artwork_events.shop_id AND s.current_generation=purchase_artwork_events.installation_generation AND i.deactivated_at IS NULL) THEN placement_id END AS placement_id,CASE WHEN expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=purchase_artwork_events.shop_id AND s.current_generation=purchase_artwork_events.installation_generation AND i.deactivated_at IS NULL) THEN asset_id::text END AS asset_id,expires_at,erased_at FROM purchase_artwork_events WHERE purchase_id=${id}::uuid ORDER BY version`.execute(
      executor,
    );
    const artworkEvents = events.rows.map((e) => ({
      eventId: e.event_id,
      version: e.version,
      kind: e.kind,
      groupIndex: e.group_index,
      placementId: e.placement_id,
      assetId: e.asset_id,
      expiresAt: e.expires_at?.toISOString() ?? null,
      erasedAt: e.erased_at?.toISOString() ?? null,
    }));
    const result: PurchaseRecord = {
      purchaseId: order.purchase_id,
      shopId: order.shop_id,
      installationGeneration: order.installation_generation,
      orderId: order.order_id,
      orderCreatedAt: order.order_created_at.toISOString(),
      currency: order.currency,
      originalTotalMinor: order.original_total_minor,
      isTest: order.is_test,
      bindings: bindings.rows.map((b) => ({
        quoteId: b.quote_id,
        authorizationSetId: b.set_id,
        economics: b.economics,
        designPayload: b.payload,
        payloadExpiresAt: b.expires_at.toISOString(),
        erasedAt: b.erased_at?.toISOString() ?? null,
        lines: lines.rows
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
      observations: observations.rows.map((o) => ({
        sourceUpdatedAt: o.source_updated_at.toISOString(),
        observedAt: o.observed_at.toISOString(),
        financialStatus: o.financial_status,
        cancelledAt: o.cancelled_at?.toISOString() ?? null,
        exception: o.exception,
      })),
      firstPaidAt: paid?.occurred_at.toISOString() ?? null,
      refunds: refunds.rows.map((r) => ({
        refundId: r.refund_id,
        occurredAt: r.occurred_at.toISOString(),
        currency: r.currency,
        amountMinor: r.amount_minor,
        lines: r.lines,
      })),
      artworkEvents,
      artworkVersion: artworkEvents.at(-1)?.version ?? 0,
      artworkState: 'PENDING_ARTWORK',
    };
    result.artworkState = artworkEvents.some((e) => e.kind === 'LOCK')
      ? 'ARTWORK_LOCKED'
      : result.bindings.some((b) => !b.designPayload)
        ? 'ERASED'
        : (await ready(result, executor))
          ? 'READY'
          : artworkEvents.some((e) => e.kind === 'ATTACH' && e.assetId === null)
            ? 'ERASED'
            : 'PENDING_ARTWORK';
    return result;
  }
  async function ready(record: PurchaseRecord, executor: Kysely<Database> = db) {
    if (!record.bindings.length) return false;
    // After attachment linkage erasure we cannot safely infer which old source should resume.
    // A merchant must explicitly recollect the working slots; never restore an earlier choice silently.
    const erasedVersion = Math.max(
      0,
      ...record.artworkEvents.filter((e) => e.kind === 'ATTACH' && e.assetId === null).map((e) => e.version),
    );
    let index = -1;
    for (const binding of record.bindings) {
      if (!binding.designPayload) return false;
      for (const item of binding.designPayload.request.groups) {
        index++;
        for (const placement of item.group.design.placements) {
          const replacement = record.artworkEvents
            .filter((e) => e.kind === 'ATTACH' && e.groupIndex === index && e.placementId === placement.placementId)
            .at(-1);
          if (erasedVersion > 0 && (!replacement || replacement.version <= erasedVersion)) return false;
          const assetId =
            replacement?.assetId ?? (placement.artwork.kind === 'revision' ? placement.artwork.revisionId : null);
          if (!assetId) return false;
          const found =
            await sql`SELECT 1 FROM artwork_assets WHERE asset_id=${assetId}::uuid AND shop_id=${record.shopId} AND state='USABLE' AND expires_at>clock_timestamp()`.execute(
              executor,
            );
          if (!found.rows.length) return false;
        }
      }
    }
    return true;
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
      const ids = await sql<{
        id: string;
      }>`SELECT m.id::text FROM inbox_messages m JOIN shopify_webhook_deliveries d ON d.inbox_id=m.id WHERE (m.state IN ('pending','failed') OR (m.state='leased' AND m.lease_until<=clock_timestamp())) AND m.attempts<5 AND m.erasure_state='retained' AND m.purge_after>clock_timestamp() AND d.queue_handoff_state='confirmed' AND d.api_version='2026-07' AND d.topic IN ('orders/create','orders/paid','orders/updated','refunds/create') ORDER BY m.received_at LIMIT ${limit}`.execute(
        db,
      );
      const hints = await Promise.all(ids.rows.map((r) => hint(db, r.id)));
      return hints.filter((h): h is PurchaseReconciliationHint => h !== null);
    },
    async claimPurchaseReconciliationHint(inboxId: string) {
      return db.transaction().execute(async (tx) => {
        const found = await hint(tx, inboxId, true);
        if (!found || found.attempts >= 5) return null;
        const token = randomUUID();
        const claimed =
          await sql`UPDATE inbox_messages m SET state='leased',attempts=attempts+1,lease_owner=${token},lease_until=clock_timestamp()+interval '1 minute' FROM shopify_webhook_deliveries d WHERE m.id=${inboxId}::uuid AND d.inbox_id=m.id AND d.queue_handoff_state='confirmed' AND (m.state IN ('pending','failed') OR m.lease_until<=clock_timestamp()) RETURNING m.id`.execute(
            tx,
          );
        return claimed.rows.length ? { ...found, attempts: found.attempts + 1, claimToken: token } : null;
      });
    },
    async failPurchaseReconciliation(input: { inboxId: string; claimToken: string; failureClass: string }) {
      if (!/^[A-Z_]{1,64}$/.test(input.failureClass)) fail('INVALID');
      await sql`UPDATE inbox_messages SET state='failed',last_error_class=${input.failureClass},lease_owner=NULL,lease_until=NULL WHERE id=${input.inboxId}::uuid AND lease_owner=${input.claimToken} AND state='leased'`.execute(
        db,
      );
    },
    get: (scope: Scope, id: string) => get(scope, id),
    async list(scope: PurchaseScope, input: { limit?: number; before?: string } = {}) {
      await active(db, scope);
      const limit = input.limit ?? 25;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('INVALID');
      const ids = await sql<{
        purchase_id: string;
      }>`SELECT purchase_id::text FROM purchase_orders WHERE shop_id=${scope.shopId} ${input.before ? sql`AND (created_at,purchase_id)<(SELECT created_at,purchase_id FROM purchase_orders WHERE shop_id=${scope.shopId} AND purchase_id=${input.before}::uuid)` : sql``} ORDER BY created_at DESC,purchase_id DESC LIMIT ${limit}`.execute(
        db,
      );
      return Promise.all(ids.rows.map((row) => get(scope, row.purchase_id)));
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
        const groups = record.bindings.flatMap((b) => b.designPayload?.request.groups ?? []);
        const placement = groups[input.groupIndex]?.group.design.placements.find(
          (p) => p.placementId === input.placementId,
        );
        if (!placement) fail('EXPIRED');
        const asset = (
          await sql<{
            expires_at: Date;
          }>`SELECT expires_at FROM artwork_assets WHERE asset_id=${input.assetId}::uuid AND shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint AND owner_hash=${input.ownerHash} AND owner_kind='merchant' AND state='USABLE' AND expires_at>clock_timestamp() FOR SHARE`.execute(
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
        const assets = record.bindings
          .flatMap((b) => b.designPayload?.request.groups ?? [])
          .flatMap((g, index) =>
            g.group.design.placements.map(
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
    async getAuthorizedArtwork(scope: PurchaseScope, input: { purchaseId: string; assetId: string }) {
      if (scope.kind !== 'merchant') fail('INVALID');
      const record = await get(scope, input.purchaseId);
      if (!record) return null;
      const original = record.bindings.some((b) =>
        b.designPayload?.request.groups.some((g) =>
          g.group.design.placements.some(
            (p) => p.artwork.kind === 'revision' && p.artwork.revisionId === input.assetId,
          ),
        ),
      );
      const attached = record.artworkEvents.some(
        (e) => e.kind === 'ATTACH' && e.assetId === input.assetId && e.expiresAt && new Date(e.expiresAt) > new Date(),
      );
      if (!original && !attached) return null;
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
