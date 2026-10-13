import { withAdminDeadline } from '../admin-deadline.js';
import type { AdminCredentialSource } from '../contextual-pricing.js';

export type ShopifyOrderTarget = { shopId: string; installationGeneration: string; orderId: string };
export type ShopifyOrderFacts = {
  shopId: string;
  installationGeneration: string;
  orderId: string;
  createdAt: string;
  updatedAt: string;
  observedAt: string;
  sourceApiVersion: '2026-07';
  currency: string;
  country: null;
  marketId: null;
  contextVerified: false;
  complete: true;
  edited: boolean;
  totalPriceMinor: string;
  financialStatus: string;
  cancelledAt: string | null;
  test: boolean;
  lines: {
    lineId: string;
    productId: string | null;
    variantId: string | null;
    quantity: number;
    currentQuantity: number;
    originalUnitPriceMinor: string;
    sellingPlanId: string | null;
    attributes: { key: string; value: string }[];
  }[];
  transactions: {
    transactionId: string;
    kind: string;
    status: string;
    occurredAt: string | null;
    amountMinor: string;
    currency: string;
  }[];
  refunds: {
    refundId: string;
    occurredAt: string;
    currency: string;
    amountMinor: string;
    lines: { lineId: string; quantity: number; amountMinor: string }[];
  }[];
};
export class ShopifyOrderReadError extends Error {
  constructor(
    readonly kind:
      | 'invalid_request'
      | 'credential_unavailable'
      | 'access_denied'
      | 'throttled'
      | 'provider_unavailable'
      | 'order_unavailable'
      | 'invalid_provider_shape'
      | 'incomplete_order'
      | 'order_changed'
      | 'unsupported_edit',
  ) {
    super(`Order reconciliation unavailable: ${kind}`);
    this.name = 'ShopifyOrderReadError';
  }
}
const MONEY = 'presentmentMoney { amount currencyCode }';
const TX = `id kind status processedAt amountSet { ${MONEY} }`;
const HEADER = `id createdAt updatedAt presentmentCurrencyCode displayFinancialStatus edited test cancelledAt originalTotalPriceSet { ${MONEY} } transactionsCount { count precision } transactions(first:250) { ${TX} } refunds { id updatedAt }`;
const LINES = `lineItems(first:100, after:$after) { nodes { id product { id } variant { id } quantity currentQuantity originalUnitPriceSet { ${MONEY} } sellingPlan { sellingPlanId } customAttributes { key value } } pageInfo { hasNextPage endCursor } }`;
const ORDER_QUERY = `query InsigniaPurchaseOrder($id:ID!,$after:String) { order(id:$id) { ${HEADER} ${LINES} } }`;
const RECHECK_QUERY = `query InsigniaPurchaseOrderRecheck($id:ID!) { order(id:$id) { ${HEADER} } }`;
const REFUND_LINES = `refundLineItems(first:100,after:$after) { nodes { id lineItem { id } quantity subtotalSet { ${MONEY} } } pageInfo { hasNextPage endCursor } }`;
const REFUND_TX = `transactions(first:100,after:$after) { nodes { ${TX} } pageInfo { hasNextPage endCursor } }`;
const REFUND_HEADER = `id order { id } processedAt updatedAt totalRefundedSet { ${MONEY} }`;
const MAX_BODY = 1024 * 1024;
function fail(kind: ShopifyOrderReadError['kind'] = 'invalid_provider_shape'): never {
  throw new ShopifyOrderReadError(kind);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function gid(value: unknown, type: string): string {
  if (typeof value !== 'string' || !new RegExp(`^gid://shopify/${type}/[1-9][0-9]{0,19}$`).test(value)) return fail();
  return value;
}
function nullableGid(value: unknown, type: string): string | null {
  if (value === null) return null;
  return gid(record(value).id, type);
}
function date(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return fail();
  const canonical = new Date(value).toISOString();
  if (canonical.slice(0, 19) !== value.slice(0, 19)) return fail();
  return canonical;
}
function hasControlCharacters(value: string, space = false): boolean {
  return [...value].some(
    (character) => character.charCodeAt(0) <= (space ? 32 : 31) || character.charCodeAt(0) === 127,
  );
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max || hasControlCharacters(value)) return fail();
  return value;
}
function attributeText(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\u0000')) return fail();
  return value;
}
function integer(value: unknown, max: number, min = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) return fail();
  return value as number;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') return fail();
  return value;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return fail('incomplete_order');
  return value;
}
function page(value: unknown): { nodes: unknown[]; cursor: string | null } {
  const c = record(value),
    p = record(c.pageInfo),
    nodes = array(c.nodes, 100),
    more = boolean(p.hasNextPage);
  if (more && !nodes.length) return fail('incomplete_order');
  return { nodes, cursor: more ? text(p.endCursor, 1024) || fail('incomplete_order') : null };
}
type OrderTransportDependencies = { credentials: AdminCredentialSource; fetchImpl?: typeof fetch; clock?: () => Date };
async function createOrderReadClient(
  target: Pick<ShopifyOrderTarget, 'shopId' | 'installationGeneration'>,
  dependencies: OrderTransportDependencies,
  signal: AbortSignal,
  onReader: (reader: ReadableStreamDefaultReader<Uint8Array> | undefined) => void,
) {
  const clock = dependencies.clock ?? (() => new Date());
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const credential = await dependencies.credentials.acquire({
    shopId: target.shopId,
    installationGeneration: target.installationGeneration,
  });
  if (
    credential.kind !== 'usable' ||
    !/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/.test(credential.shopDomain) ||
    !credential.accessToken ||
    credential.accessToken.length > 8192 ||
    hasControlCharacters(credential.accessToken, true) ||
    !Number.isFinite(+clock()) ||
    !(credential.accessExpiresAt instanceof Date) ||
    !Number.isFinite(+credential.accessExpiresAt) ||
    +credential.accessExpiresAt <= +clock() + 30000
  )
    return fail('credential_unavailable');
  let requests = 0;
  async function query(queryText: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (++requests > 100 || signal.aborted) return fail('incomplete_order');
    const response = await (dependencies.fetchImpl ?? fetch)(
      `https://${credential.kind === 'usable' ? credential.shopDomain : ''}/admin/api/2026-07/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': credential.kind === 'usable' ? credential.accessToken : '',
        },
        body: JSON.stringify({ query: queryText, variables }),
        redirect: 'error',
        signal,
      },
    );
    if (response.status === 401 || response.status === 403) return fail('access_denied');
    if (response.status === 429) return fail('throttled');
    if (response.status !== 200 || response.redirected) return fail('provider_unavailable');
    reader = response.body?.getReader();
    onReader(reader);
    if (!reader) return fail();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_BODY) return fail('incomplete_order');
        chunks.push(part.value);
      }
    } catch (error) {
      void reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
      reader = undefined;
      onReader(undefined);
    }
    let payload: Record<string, unknown>;
    try {
      payload = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
    } catch {
      return fail();
    }
    if (payload.errors !== undefined) {
      const errors = Array.isArray(payload.errors) ? payload.errors : [];
      if (errors.some((e) => record(record(e).extensions).code === 'ACCESS_DENIED')) return fail('access_denied');
      if (errors.some((e) => record(record(e).extensions).code === 'THROTTLED')) return fail('throttled');
      return fail();
    }
    return record(payload.data);
  }

  return query;
}

/** Read-only Admin 2026-07 order observation; no webhook body, cart confirmation, PII or current product prices are authority. */
export async function readShopifyOrder(
  target: ShopifyOrderTarget,
  dependencies: {
    credentials: AdminCredentialSource;
    currency: { exponent(code: string): number | null };
    fetchImpl?: typeof fetch;
    clock?: () => Date;
  },
): Promise<ShopifyOrderFacts> {
  if (
    !target?.shopId ||
    !/^[1-9][0-9]*$/.test(target.installationGeneration) ||
    !/^gid:\/\/shopify\/Order\/[1-9][0-9]{0,19}$/.test(target.orderId) ||
    !dependencies?.credentials ||
    !dependencies.currency
  )
    throw new ShopifyOrderReadError('invalid_request');
  const clock = dependencies.clock ?? (() => new Date());
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    return await withAdminDeadline(
      async (signal) => {
        const query = await createOrderReadClient(target, dependencies, signal, (value) => {
          reader = value;
        });
        function money(raw: unknown, currency: string): string {
          const m = record(record(raw).presentmentMoney);
          if (m.currencyCode !== currency) return fail();
          const exp = dependencies.currency.exponent(currency),
            lexical = text(m.amount, 25);
          if (
            exp === null ||
            !Number.isInteger(exp) ||
            exp < 0 ||
            exp > 3 ||
            !/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(lexical)
          )
            return fail();
          const [whole, fraction = ''] = lexical.split('.');
          if (fraction.length > exp) return fail();
          const minor = BigInt(whole!) * 10n ** BigInt(exp) + BigInt(fraction.padEnd(exp, '0') || '0');
          if (minor > 18446744073709551615n) return fail();
          return String(minor);
        }
        function transaction(raw: unknown, currency: string): ShopifyOrderFacts['transactions'][number] {
          const t = record(raw);
          return {
            transactionId: gid(t.id, 'OrderTransaction'),
            kind: text(t.kind, 32),
            status: text(t.status, 32),
            occurredAt: t.processedAt === null ? null : date(t.processedAt),
            amountMinor: money(t.amountSet, currency),
            currency,
          };
        }
        const initialData = await query(ORDER_QUERY, { id: target.orderId, after: null });
        if (initialData.order === null) return fail('order_unavailable');
        const initial = record(initialData.order);
        if (initial.id !== target.orderId) return fail();
        const edited = boolean(initial.edited);
        const currency = text(initial.presentmentCurrencyCode, 3);
        if (!/^[A-Z]{3}$/.test(currency) || dependencies.currency.exponent(currency) === null) return fail();
        const updatedAt = date(initial.updatedAt),
          initialHeader = JSON.stringify(
            Object.fromEntries(Object.entries(initial).filter(([key]) => key !== 'lineItems')),
          );
        const transactions = array(initial.transactions, 250).map((t) => transaction(t, currency));
        const count = record(initial.transactionsCount);
        if (
          count.precision !== 'EXACT' ||
          integer(count.count, 250) !== transactions.length ||
          new Set(transactions.map((t) => t.transactionId)).size !== transactions.length
        )
          return fail('incomplete_order');
        const lines: ShopifyOrderFacts['lines'] = [],
          lineIds = new Set<string>(),
          cursors = new Set<string>();
        let current = initial;
        for (;;) {
          if (current.id !== target.orderId || date(current.updatedAt) !== updatedAt) return fail('order_changed');
          const p = page(current.lineItems);
          for (const raw of p.nodes) {
            const l = record(raw),
              lineId = gid(l.id, 'LineItem');
            if (lineIds.has(lineId) || lines.length >= 2000) return fail('incomplete_order');
            lineIds.add(lineId);
            const attributes = array(l.customAttributes, 100).map((a) => {
              const v = record(a);
              return { key: attributeText(v.key, 256), value: attributeText(v.value, 4096) };
            });
            if (new Set(attributes.map((a) => a.key)).size !== attributes.length) return fail();
            const sellingPlan = l.sellingPlan === null ? null : record(l.sellingPlan);
            if (integer(l.currentQuantity, 4294967295) > integer(l.quantity, 4294967295, 1)) return fail();
            lines.push({
              lineId,
              productId: nullableGid(l.product, 'Product'),
              variantId: nullableGid(l.variant, 'ProductVariant'),
              quantity: integer(l.quantity, 4294967295, 1),
              currentQuantity: integer(l.currentQuantity, 4294967295),
              originalUnitPriceMinor: money(l.originalUnitPriceSet, currency),
              sellingPlanId: sellingPlan
                ? sellingPlan.sellingPlanId === null
                  ? 'UNKNOWN_PRESENT'
                  : gid(sellingPlan.sellingPlanId, 'SellingPlan')
                : null,
              attributes,
            });
          }
          if (!p.cursor) break;
          if (cursors.has(p.cursor)) return fail('incomplete_order');
          cursors.add(p.cursor);
          current = record((await query(ORDER_QUERY, { id: target.orderId, after: p.cursor })).order);
        }
        const refunds: ShopifyOrderFacts['refunds'] = [],
          refundIds = new Set<string>();
        for (const raw of array(initial.refunds, 100)) {
          const r = record(raw),
            refundId = gid(r.id, 'Refund'),
            refundUpdated = date(r.updatedAt);
          if (refundIds.has(refundId)) return fail();
          refundIds.add(refundId);
          const refundLines: ShopifyOrderFacts['refunds'][number]['lines'] = [],
            refundTransactions: ShopifyOrderFacts['transactions'] = [];
          let refundBase: Record<string, unknown> | undefined;
          for (const field of ['refundLineItems', 'transactions'] as const) {
            let cursor: string | null = null;
            const seen = new Set<string>(),
              nodeIds = new Set<string>();
            do {
              const fields = field === 'refundLineItems' ? REFUND_LINES : REFUND_TX;
              const d = await query(
                `query InsigniaPurchaseRefund($id:ID!,$after:String) { refund(id:$id) { ${REFUND_HEADER} ${fields} } }`,
                { id: refundId, after: cursor },
              );
              const rr = record(d.refund);
              if (rr.id !== refundId || record(rr.order).id !== target.orderId || date(rr.updatedAt) !== refundUpdated)
                return fail('order_changed');
              refundBase ??= rr;
              const p = page(rr[field]);
              for (const node of p.nodes) {
                if (nodeIds.size >= 2000) return fail('incomplete_order');
                const n = record(node),
                  key = field === 'transactions' ? gid(n.id, 'OrderTransaction') : gid(n.id, 'RefundLineItem');
                if (nodeIds.has(key)) return fail('incomplete_order');
                nodeIds.add(key);
                if (field === 'transactions') refundTransactions.push(transaction(n, currency));
                else {
                  const lineId = gid(record(n.lineItem).id, 'LineItem');
                  if (!lineIds.has(lineId)) return fail();
                  refundLines.push({
                    lineId,
                    quantity: integer(n.quantity, 4294967295, 1),
                    amountMinor: money(n.subtotalSet, currency),
                  });
                }
              }
              cursor = p.cursor;
              if (cursor && seen.has(cursor)) return fail('incomplete_order');
              if (cursor) seen.add(cursor);
            } while (cursor);
          }
          // A Refund record is not proof of returned money. Its transaction statuses stay independently observable.
          for (const t of refundTransactions) {
            const existing = transactions.find((e) => e.transactionId === t.transactionId);
            if (!existing || JSON.stringify(existing) !== JSON.stringify(t)) return fail('order_changed');
          }
          refunds.push({
            refundId,
            occurredAt: date(refundBase!.processedAt),
            currency,
            amountMinor: money(refundBase!.totalRefundedSet, currency),
            lines: refundLines,
          });
        }
        const final = record((await query(RECHECK_QUERY, { id: target.orderId })).order);
        const finalHeader = JSON.stringify(
          Object.fromEntries(Object.entries(final).filter(([key]) => key !== 'lineItems')),
        );
        if (initialHeader !== finalHeader) return fail('order_changed');
        const observedAt = clock();
        if (!Number.isFinite(+observedAt)) return fail('provider_unavailable');
        return {
          ...target,
          createdAt: date(initial.createdAt),
          updatedAt,
          observedAt: observedAt.toISOString(),
          sourceApiVersion: '2026-07',
          currency,
          country: null,
          marketId: null,
          contextVerified: false,
          complete: true,
          edited,
          totalPriceMinor: money(initial.originalTotalPriceSet, currency),
          financialStatus:
            initial.displayFinancialStatus === null ? 'UNKNOWN' : text(initial.displayFinancialStatus, 32),
          cancelledAt: initial.cancelledAt === null ? null : date(initial.cancelledAt),
          test: boolean(initial.test),
          lines,
          transactions,
          refunds,
        };
      },
      'Shopify order reconciliation',
      () => {
        void reader?.cancel().catch(() => {});
      },
    );
  } catch (error) {
    if (error instanceof ShopifyOrderReadError) throw error;
    throw new ShopifyOrderReadError('provider_unavailable');
  }
}

export type ShopifyOrderChangesTarget = {
  shopId: string;
  installationGeneration: string;
  since: string;
  until: string;
  cursor?: string | null;
};
export type ShopifyOrderChangesPage = {
  shopId: string;
  installationGeneration: string;
  since: string;
  until: string;
  orders: { orderId: string; updatedAt: string }[];
  nextCursor: string | null;
  observedAt: string;
};
/** Bounded discovery only. Every ID must subsequently undergo the complete independent order read. Keep the same window while paginating. */
export async function readShopifyOrderChanges(
  target: ShopifyOrderChangesTarget,
  dependencies: OrderTransportDependencies,
): Promise<ShopifyOrderChangesPage> {
  const clock = dependencies.clock ?? (() => new Date());
  let since: string, until: string;
  try {
    since = date(target?.since);
    until = date(target?.until);
    if (
      !target.shopId ||
      !/^[1-9][0-9]*$/.test(target.installationGeneration) ||
      Date.parse(since) > Date.parse(until) ||
      Date.parse(until) > +clock() ||
      !Number.isFinite(+clock()) ||
      (target.cursor !== undefined && target.cursor !== null && !text(target.cursor, 1024)) ||
      !dependencies.credentials
    )
      throw new Error('invalid');
  } catch {
    throw new ShopifyOrderReadError('invalid_request');
  }
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    return await withAdminDeadline(
      async (signal) => {
        const query = await createOrderReadClient(target, dependencies, signal, (value) => {
          reader = value;
        });
        const data = await query(
          'query InsigniaPurchaseChanges($after:String,$query:String!) { orders(first:20,after:$after,query:$query,sortKey:UPDATED_AT,reverse:false) { nodes { id updatedAt } pageInfo { hasNextPage endCursor } } }',
          { after: target.cursor ?? null, query: `updated_at:>='${since}' AND updated_at:<='${until}'` },
        );
        const result = page(data.orders),
          seen = new Set<string>();
        let previous = Date.parse(since);
        if (result.nodes.length > 20) return fail('incomplete_order');
        const orders = result.nodes.map((raw) => {
          const n = record(raw),
            orderId = gid(n.id, 'Order'),
            updatedAt = date(n.updatedAt),
            timestamp = Date.parse(updatedAt);
          if (seen.has(orderId) || timestamp < previous || timestamp > Date.parse(until))
            return fail('incomplete_order');
          seen.add(orderId);
          previous = timestamp;
          return { orderId, updatedAt };
        });
        if (result.cursor && result.cursor === target.cursor) return fail('incomplete_order');
        const observed = clock();
        if (!Number.isFinite(+observed)) return fail('provider_unavailable');
        return {
          shopId: target.shopId,
          installationGeneration: target.installationGeneration,
          since,
          until,
          orders,
          nextCursor: result.cursor,
          observedAt: observed.toISOString(),
        };
      },
      'Shopify order discovery',
      () => {
        void reader?.cancel().catch(() => {});
      },
    );
  } catch (error) {
    if (error instanceof ShopifyOrderReadError) throw error;
    throw new ShopifyOrderReadError('provider_unavailable');
  }
}
