import { createHash } from 'node:crypto';
import type { VerifiedHistory } from './index.ts';
import { canonicalInstant as exactTime } from './time.ts';

/** Shopify Partner API 2026-07 contract shape. No network or credentials here. */
export const PARTNER_ACTIVE_QUERY = `query ActiveSubscription($appId: ID!, $shopId: ID!) {
  activeSubscription(appId: $appId, shopId: $shopId) {
    app { id }
    shop { id myshopifyDomain }
    billingPeriod cancelAtEndOfCycle trialEndsAt
    currentBillingCycle { startTime endTime }
    items {
      handle
      price {
        __typename active currency
        ... on FlatRatePrice { amount }
        ... on TieredPrice { tiersMode tiers { upTo amountPerUnit amount } }
      }
      usage { quantity cost { amount currencyCode } }
    }
    pendingUpdate { billingPeriod items { handle } }
    legacySubscriptionId
  }
}`;

export const PARTNER_HISTORY_QUERY = `query SubscriptionHistory(
  $appId: ID!, $shopId: ID!, $from: DateTime!, $through: DateTime!, $after: String
) {
  events(
    filter: {
      subjectId: $appId, shopId: $shopId, occurredAtMin: $from, occurredAtMax: $through,
      eventTypes: [SUBSCRIPTION_CREATED, SUBSCRIPTION_UPDATED,
        SUBSCRIPTION_CANCELLATION_SCHEDULED, SUBSCRIPTION_CANCELED,
        SUBSCRIPTION_FROZEN, SUBSCRIPTION_UNFROZEN]
    }
    first: 250, after: $after
  ) {
    edges { cursor node {
      id occurredAt eventType shop { id }
      subject { ... on AppReference { id } }
      ... on SubscriptionStatus {
        state cancelEffectiveOn
        plan { handle billingPeriod trialDays trialDaysRemaining }
      }
    } }
    pageInfo { hasNextPage endCursor }
  }
}`;

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue : null;
}
function noErrors(body: unknown): RecordValue | null {
  const root = record(body);
  if (!root || ('errors' in root && root.errors !== undefined)) return null;
  return record(root.data);
}
function decimalAmount(value: unknown): boolean {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(value);
}
function zeroDecimal(value: unknown): boolean {
  return typeof value === 'string' && /^0(?:\.0{1,9})?$/.test(value);
}

export interface ActiveObservation {
  appId: string;
  shopId: string;
  observedAt: string;
  planHandle: string;
  meterHandle: 'customized_order_paid';
  zeroCostBandUpTo: number;
  currency: string;
  overageUnitAmount: string;
  trialEndsAt: string | null;
  currentCycle: { from: string; until: string } | null;
  cancelAtEndOfCycle: boolean;
  pendingPlanHandles: readonly string[];
}
export type ActiveRead =
  | { kind: 'ACTIVE'; observation: ActiveObservation }
  | { kind: 'NO_ACTIVE_CURRENT' | 'PUBLIC_APP_REQUIRED' | 'AUTH_REQUIRED' |
      'RATE_LIMITED' | 'UNAVAILABLE' | 'MISMATCH' | 'UNSUPPORTED_TARIFF' | 'UNKNOWN_CONTRACT' };

export function parseActiveSubscription(
  httpStatus: number, body: unknown,
  context: { appId: string; shopId: string; observedAt: string }
): ActiveRead {
  if (httpStatus === 401 || httpStatus === 403) return { kind: 'AUTH_REQUIRED' };
  if (httpStatus === 429) return { kind: 'RATE_LIMITED' };
  if (httpStatus !== 200 || !exactTime(context.observedAt)) return { kind: 'UNAVAILABLE' };
  if (!/^gid:\/\/shopify\/App\/[1-9]\d*$/.test(context.appId) ||
      !/^gid:\/\/shopify\/Shop\/[1-9]\d*$/.test(context.shopId)) return { kind: 'MISMATCH' };
  const root = record(body);
  if (Array.isArray(root?.errors)) {
    const publicError = root.errors.some(error => record(error)?.message === 'Only public apps can access active subscription');
    return { kind: publicError ? 'PUBLIC_APP_REQUIRED' : 'UNAVAILABLE' };
  }
  const data = noErrors(body);
  if (!data || !('activeSubscription' in data)) return { kind: 'UNAVAILABLE' };
  if (data.activeSubscription === null) return { kind: 'NO_ACTIVE_CURRENT' };
  const active = record(data.activeSubscription);
  const app = record(active?.app);
  const shop = record(active?.shop);
  if (!active || app?.id !== context.appId || shop?.id !== context.shopId ||
      typeof shop.myshopifyDomain !== 'string' || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop.myshopifyDomain))
    return { kind: 'MISMATCH' };
  if (active.billingPeriod !== 'EVERY_30_DAYS' || typeof active.cancelAtEndOfCycle !== 'boolean' ||
      !Array.isArray(active.items)) return { kind: 'UNKNOWN_CONTRACT' };
  const items = active.items.map(record);
  if (items.some(item => !item)) return { kind: 'UNKNOWN_CONTRACT' };
  const flat = items.filter(item => {
    const price = record(item?.price);
    return price?.__typename === 'FlatRatePrice' && price.active === true;
  });
  const tiered = items.filter(item => item?.handle === 'customized_order_paid' &&
    record(item.price)?.__typename === 'TieredPrice' && record(item.price)?.active === true);
  if (flat.length !== 1 || tiered.length !== 1 || typeof flat[0]?.handle !== 'string')
    return { kind: 'UNKNOWN_CONTRACT' };
  const price = record(tiered[0]?.price);
  const tiers = price?.tiers;
  const flatPrice = record(flat[0]?.price);
  if (price?.tiersMode !== 'GRADUATED' || !Array.isArray(tiers) || tiers.length !== 2 ||
      typeof price.currency !== 'string' || !/^[A-Z]{3}$/.test(price.currency) ||
      flatPrice?.currency !== price.currency || !decimalAmount(flatPrice.amount))
    return { kind: 'UNSUPPORTED_TARIFF' };
  const first = record(tiers[0]);
  const second = record(tiers[1]);
  const band = first?.upTo;
  if (!Number.isSafeInteger(band) || typeof band !== 'number' || band < 1 ||
      !zeroDecimal(first?.amountPerUnit) || !zeroDecimal(first?.amount) ||
      second?.upTo !== null || !decimalAmount(second?.amountPerUnit) ||
      !zeroDecimal(second?.amount))
    return { kind: 'UNSUPPORTED_TARIFF' };
  const trialEndsAt = active.trialEndsAt;
  const cycle = record(active.currentBillingCycle);
  if (!(trialEndsAt === null && cycle && exactTime(cycle.startTime) && exactTime(cycle.endTime)) &&
      !(exactTime(trialEndsAt) && active.currentBillingCycle === null))
    return { kind: 'UNKNOWN_CONTRACT' };
  const observedAt = exactTime(context.observedAt)!;
  const observedAtMs = Date.parse(observedAt);
  if ((typeof trialEndsAt === 'string' && Date.parse(exactTime(trialEndsAt)!) <= observedAtMs) ||
      (cycle && (Date.parse(exactTime(cycle.startTime)!) > observedAtMs ||
        Date.parse(exactTime(cycle.endTime)!) <= observedAtMs)))
    return { kind: 'UNKNOWN_CONTRACT' };
  const pending = active.pendingUpdate;
  const pendingItems = record(pending)?.items;
  if (pending !== null && (!Array.isArray(pendingItems) || pendingItems.length === 0))
    return { kind: 'UNKNOWN_CONTRACT' };
  const pendingPlanHandles: string[] = [];
  if (pending !== null) {
    for (const item of pendingItems as unknown[]) {
      const handle = record(item)?.handle;
      if (typeof handle !== 'string') return { kind: 'UNKNOWN_CONTRACT' };
      pendingPlanHandles.push(handle);
    }
  }
  const currentCycle = cycle ? { from: exactTime(cycle.startTime)!, until: exactTime(cycle.endTime)! } : null;
  return { kind: 'ACTIVE', observation: {
    appId: context.appId, shopId: context.shopId, observedAt,
    planHandle: flat[0].handle as string, meterHandle: 'customized_order_paid',
    zeroCostBandUpTo: band, currency: price.currency, overageUnitAmount: second.amountPerUnit as string,
    trialEndsAt: trialEndsAt === null ? null : exactTime(trialEndsAt),
    currentCycle, cancelAtEndOfCycle: active.cancelAtEndOfCycle as boolean,
    pendingPlanHandles
  } };
}

/** Current observation intentionally has no historical coverage before the read. */
export function currentHistory(active: ActiveObservation): VerifiedHistory {
  const start = active.observedAt;
  // A fresh observation cannot authorize through a known plan/trial/cancellation transition.
  const until = active.trialEndsAt ??
    (active.cancelAtEndOfCycle || active.pendingPlanHandles.length > 0
      ? active.currentCycle?.until ?? null : null);
  const evidenceId = createHash('sha256').update(JSON.stringify(active)).digest('hex');
  return {
    source: 'PARTNER_API_2026_07', appId: active.appId, shopId: active.shopId,
    observedAt: start, completeFrom: start, completeThrough: start,
    intervals: [{ from: start, until, state: 'ACTIVE', planHandle: active.planHandle,
      evidenceId, trial: active.trialEndsAt ? { from: start, until: active.trialEndsAt } : null }]
  };
}

export interface HistoricalStatusEvent {
  id: string;
  occurredAt: string;
  eventType: string;
  state: string;
  planHandle: string | null;
  trialDays: number | null;
  trialDaysRemaining: number | null;
  cancelEffectiveOn: string | null;
}
export type HistoryRead =
  | { kind: 'PAGE'; events: HistoricalStatusEvent[]; hasNextPage: boolean;
      endCursor: string | null; exactHistoricalTrialInterval: false }
  | { kind: 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'MISMATCH' | 'INCOMPLETE' };

export function parseHistoryPage(
  httpStatus: number, body: unknown,
  context: { appId: string; shopId: string; observedAt: string; from: string; through: string }
): HistoryRead {
  if (httpStatus === 401 || httpStatus === 403) return { kind: 'AUTH_REQUIRED' };
  if (httpStatus === 429) return { kind: 'RATE_LIMITED' };
  const start = exactTime(context.from), end = exactTime(context.through);
  if (httpStatus !== 200 || !start || !end || !exactTime(context.observedAt)) return { kind: 'UNAVAILABLE' };
  if (!/^gid:\/\/shopify\/App\/[1-9]\d*$/.test(context.appId) ||
      !/^gid:\/\/shopify\/Shop\/[1-9]\d*$/.test(context.shopId)) return { kind: 'MISMATCH' };
  if (Date.parse(end) < Date.parse(start) || Date.parse(end) - Date.parse(start) > 365 * 86_400_000)
    return { kind: 'INCOMPLETE' };
  const data = noErrors(body);
  const events = record(data?.events);
  const page = record(events?.pageInfo);
  if (!Array.isArray(events?.edges) || typeof page?.hasNextPage !== 'boolean' ||
      !(typeof page.endCursor === 'string' || page.endCursor === null)) return { kind: 'UNAVAILABLE' };
  const parsed: HistoricalStatusEvent[] = [];
  for (const edge of events.edges) {
    const node = record(record(edge)?.node);
    if (record(node?.shop)?.id !== context.shopId ||
        record(node?.subject)?.id !== context.appId) return { kind: 'MISMATCH' };
    const plan = node?.plan === null ? null : record(node?.plan);
    if (!node || typeof node.id !== 'string' || !exactTime(node.occurredAt) ||
        typeof node.eventType !== 'string' || typeof node.state !== 'string' ||
        (plan !== null && (typeof plan.handle !== 'string' ||
          (plan.trialDays !== null && !Number.isSafeInteger(plan.trialDays)) ||
          (plan.trialDaysRemaining !== null && !Number.isSafeInteger(plan.trialDaysRemaining)))))
      return { kind: 'UNAVAILABLE' };
    parsed.push({
      id: node.id, occurredAt: exactTime(node.occurredAt)!,
      eventType: node.eventType, state: node.state,
      planHandle: plan?.handle as string | null ?? null,
      trialDays: plan?.trialDays as number | null ?? null,
      trialDaysRemaining: plan?.trialDaysRemaining as number | null ?? null,
      cancelEffectiveOn: typeof node.cancelEffectiveOn === 'string' ? node.cancelEffectiveOn : null
    });
  }
  return { kind: 'PAGE', events: parsed,
    hasNextPage: page.hasNextPage, endCursor: page.endCursor as string | null,
    exactHistoricalTrialInterval: false };
}
