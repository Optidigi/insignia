import { canonicalInstant } from '../../m0-010/src/time.ts';

/** An isolated prototype profile for the recorded new-app dev subscription. */
export interface ContractExpectation {
  appId: 'gid://shopify/App/429028933633';
  shopId: 'gid://shopify/Shop/105501393179';
  shopDomain: 'insignia-rewrite-dev.myshopify.com';
  subscriptionId: 'gid://shopify/AppSubscription/38085427483';
  planHandle: 'insignia-dev-zero-20260928';
  meterHandle: 'customized_order_paid';
  cycleFrom: string;
  cycleUntil: string;
  maxDistinctUnits: number;
  observedAt: string;
}

export interface VerifiedContract {
  appId: string;
  shopId: string;
  shopDomain: string;
  subscriptionId: string;
  observedAt: string;
  cycleFrom: string;
  cycleUntil: string;
  billingPeriod: 'EVERY_30_DAYS';
  cancelAtEndOfCycle: false;
  trialEndsAt: null;
  pendingUpdate: null;
  plan: { handle: string; description: string; catalogPriceActive: false;
    priceType: 'FlatRatePrice'; currency: 'USD'; amount: string };
  meter: { handle: 'customized_order_paid'; description: string; catalogPriceActive: false;
    priceType: 'TieredPrice'; currency: 'USD'; tiersMode: 'VOLUME';
    tier: { upTo: number | null; amountPerUnit: string; amount: string } };
  usage: { kind: 'OBSERVED'; quantity: number; cost: string; currency: 'USD' } | { kind: 'UNKNOWN' };
}

export type ContractRead = { kind: 'VERIFIED'; contract: VerifiedContract } |
  { kind: 'REJECTED'; reason: 'HTTP_OR_GRAPHQL' | 'ABSENT' | 'IDENTITY' |
    'CYCLE_OR_TRANSITION' | 'ITEMS' | 'PRICE' | 'USAGE' | 'TIME' };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function zero(value: unknown): value is string {
  return typeof value === 'string' && /^0(?:\.0{1,9})?$/.test(value);
}

/** Price-record active metadata is preserved, never used as subscription cancellation status. */
export function validateEffectiveZeroContract(
  httpStatus: number, body: unknown, expected: ContractExpectation,
): ContractRead {
  const observedAt = canonicalInstant(expected.observedAt);
  const cycleFrom = canonicalInstant(expected.cycleFrom);
  const cycleUntil = canonicalInstant(expected.cycleUntil);
  if (!observedAt || !cycleFrom || !cycleUntil ||
      !Number.isSafeInteger(expected.maxDistinctUnits) || expected.maxDistinctUnits < 1)
    return { kind: 'REJECTED', reason: 'TIME' };
  const root = record(body);
  if (httpStatus !== 200 || !root || 'errors' in root || !record(root.data))
    return { kind: 'REJECTED', reason: 'HTTP_OR_GRAPHQL' };
  const data = record(root.data)!;
  if (!('activeSubscription' in data) || data.activeSubscription === null)
    return { kind: 'REJECTED', reason: 'ABSENT' };
  const active = record(data.activeSubscription);
  const shop = record(active?.shop);
  if (!active || record(active.app)?.id !== expected.appId ||
      shop?.id !== expected.shopId || shop.myshopifyDomain !== expected.shopDomain ||
      active.legacySubscriptionId !== expected.subscriptionId)
    return { kind: 'REJECTED', reason: 'IDENTITY' };
  const cycle = record(active.currentBillingCycle);
  if (active.billingPeriod !== 'EVERY_30_DAYS' ||
      active.cancelAtEndOfCycle !== false || active.trialEndsAt !== null ||
      active.pendingUpdate !== null || !cycle ||
      canonicalInstant(cycle.startTime) !== cycleFrom ||
      canonicalInstant(cycle.endTime) !== cycleUntil ||
      Date.parse(cycleFrom) > Date.parse(observedAt) ||
      Date.parse(observedAt) >= Date.parse(cycleUntil))
    return { kind: 'REJECTED', reason: 'CYCLE_OR_TRANSITION' };
  if (!Array.isArray(active.items) || active.items.length !== 2 ||
      active.items.some((x: unknown) => !record(x)))
    return { kind: 'REJECTED', reason: 'ITEMS' };
  const items = active.items as Record<string, unknown>[];
  const planItems = items.filter(x => x.handle === expected.planHandle);
  const meterItems = items.filter(x => x.handle === expected.meterHandle);
  if (planItems.length !== 1 || meterItems.length !== 1)
    return { kind: 'REJECTED', reason: 'ITEMS' };
  const plan = planItems[0]!, meter = meterItems[0]!;
  const planPrice = record(plan.price), meterPrice = record(meter.price);
  if (plan.description !== 'Insignia $0 Test' || meter.description !== 'Test custom order' ||
      plan.discount !== null || meter.discount !== null || plan.usage !== null ||
      planPrice?.__typename !== 'FlatRatePrice' || planPrice.active !== false ||
      planPrice.currency !== 'USD' || !zero(planPrice.amount) ||
      meterPrice?.__typename !== 'TieredPrice' || meterPrice.active !== false ||
      meterPrice.currency !== 'USD' || meterPrice.tiersMode !== 'VOLUME' ||
      !Array.isArray(meterPrice.tiers) || meterPrice.tiers.length !== 1)
    return { kind: 'REJECTED', reason: 'PRICE' };
  const tier = record(meterPrice.tiers[0]);
  if (!tier || !zero(tier.amountPerUnit) || !zero(tier.amount) ||
      !(tier.upTo === null || Number.isSafeInteger(tier.upTo) && Number(tier.upTo) >= 1))
    return { kind: 'REJECTED', reason: 'PRICE' };
  let usage: VerifiedContract['usage'] = { kind: 'UNKNOWN' };
  if (meter.usage !== null && meter.usage !== undefined) {
    const rawUsage = record(meter.usage), cost = record(rawUsage?.cost);
    if (!rawUsage || !Number.isSafeInteger(rawUsage.quantity) ||
        Number(rawUsage.quantity) < 0 || !cost || !zero(cost.amount) ||
        cost.currencyCode !== 'USD')
      return { kind: 'REJECTED', reason: 'USAGE' };
    usage = { kind: 'OBSERVED', quantity: Number(rawUsage.quantity),
      cost: cost.amount, currency: 'USD' };
  }
  if (tier.upTo !== null &&
      (usage.kind !== 'OBSERVED' ||
        Number(tier.upTo) < usage.quantity + expected.maxDistinctUnits))
    return { kind: 'REJECTED', reason: 'PRICE' };
  return { kind: 'VERIFIED', contract: {
    appId: expected.appId, shopId: expected.shopId, shopDomain: expected.shopDomain,
    subscriptionId: expected.subscriptionId, observedAt, cycleFrom, cycleUntil,
    billingPeriod: 'EVERY_30_DAYS', cancelAtEndOfCycle: false,
    trialEndsAt: null, pendingUpdate: null,
    plan: { handle: expected.planHandle, description: plan.description as string,
      catalogPriceActive: false, priceType: 'FlatRatePrice', currency: 'USD',
      amount: planPrice.amount },
    meter: { handle: expected.meterHandle, description: meter.description as string,
      catalogPriceActive: false, priceType: 'TieredPrice', currency: 'USD',
      tiersMode: 'VOLUME', tier: { upTo: tier.upTo as number | null,
        amountPerUnit: tier.amountPerUnit, amount: tier.amount } },
    usage,
  } };
}

/** Stable price/identity terms only; usage quantity may advance after processing. */
export function contractTerms(contract: VerifiedContract): string {
  const { usage: _usage, observedAt: _observedAt, ...terms } = contract;
  return JSON.stringify(terms);
}
