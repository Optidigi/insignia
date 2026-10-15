import type { PaidOrderUsageHistory, UsagePolicyIdentity } from '@insignia/domain';
import type { ProviderSubscriptionSnapshot } from './provider-policy.js';

/** Verified source observations only: this adapter performs no provider authentication or I/O. */
export interface CurrentCycleUsageHistoryInput {
  installation: {
    tenantShopId: string;
    providerShopId: string;
    appId: string;
    generation: string;
    activatedAt: string;
    deactivatedAt: string | null;
  };
  /** An independently qualified billing mapping, not a quote-only feature recognition. */
  binding: {
    appId: string;
    shopId: string;
    planHandle: string;
    usageHandle: string;
    policy: UsagePolicyIdentity;
  } | null;
  current: ProviderSubscriptionSnapshot;
  range: {
    sourceApiVersion: '2026-07';
    appId: string;
    shopId: string;
    from: string;
    through: string;
    observedAt: string;
    pagesRead: number;
    pagination: 'EXHAUSTED' | 'PAGE_LIMIT';
    nextCursor: string | null;
    trustedEntitlementIntervals: false;
    events: readonly {
      id: string;
      cursor: string;
      occurredAt: string;
      eventType: string;
      state: string;
      cancelEffectiveOn: string | null;
      plan: {
        handle: string;
        billingPeriod: 'ANNUAL' | 'EVERY_30_DAYS';
        trialDays: number | null;
        trialDaysRemaining: number | null;
      } | null;
    }[];
  };
}
export type CurrentCycleUsageHistoryResult =
  | { kind: 'NORMALIZED'; history: Extract<PaidOrderUsageHistory, { kind: 'TRUSTED' }> }
  | {
      kind: 'UNRESOLVED';
      reason:
        | 'UNRECOGNIZED_POLICY'
        | 'INVALID_SOURCE'
        | 'SCOPE_MISMATCH'
        | 'INCOMPLETE_HISTORY'
        | 'UNSUPPORTED_HISTORY'
        | 'NO_COVERAGE';
      history: { kind: 'UNVERIFIED' };
    };

type UnresolvedReason = Extract<CurrentCycleUsageHistoryResult, { kind: 'UNRESOLVED' }>['reason'];
const unresolved = (reason: UnresolvedReason): CurrentCycleUsageHistoryResult => ({
  kind: 'UNRESOLVED',
  reason,
  history: { kind: 'UNVERIFIED' },
});
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function sourceText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\s\p{Cc}]/u.test(value);
}
function identifier(value: unknown): value is string {
  return sourceText(value, 256);
}
function instant(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function days(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647);
}

/** Finite same-cycle coverage only, from upstream verified reads and a separately qualified billing mapping.
 * Does not establish historical trial ends, earlier cycles, inactive intervals or provider authenticity. */
export function normalizeCurrentCycleUsageHistory(
  input: CurrentCycleUsageHistoryInput,
): CurrentCycleUsageHistoryResult {
  if (!object(input)) return unresolved('INVALID_SOURCE');
  const { binding, current, installation, range } = input;
  if (!object(binding)) return unresolved('UNRECOGNIZED_POLICY');
  if (!object(installation) || !object(current) || !object(range)) return unresolved('INVALID_SOURCE');
  if (
    !object(binding.policy) ||
    !identifier(binding.policy.id) ||
    !identifier(binding.policy.version) ||
    !identifier(binding.planHandle) ||
    !identifier(binding.usageHandle) ||
    binding.planHandle === binding.usageHandle
  )
    return unresolved('UNRECOGNIZED_POLICY');
  if (
    !identifier(installation.tenantShopId) ||
    !identifier(installation.generation) ||
    !/^[1-9][0-9]*$/.test(installation.generation) ||
    !identifier(installation.appId) ||
    !identifier(installation.providerShopId) ||
    !/^gid:\/\/shopify\/App\/[1-9][0-9]{0,39}$/.test(installation.appId) ||
    !/^gid:\/\/shopify\/Shop\/[1-9][0-9]{0,39}$/.test(installation.providerShopId) ||
    !instant(installation.activatedAt) ||
    current.schemaVersion !== 'm4-active-subscription-v1' ||
    current.sourceApiVersion !== '2026-07' ||
    range.sourceApiVersion !== '2026-07'
  )
    return unresolved('INVALID_SOURCE');
  if (
    current.appId !== installation.appId ||
    current.shopId !== installation.providerShopId ||
    current.tenantShopId !== installation.tenantShopId ||
    current.installationGeneration !== installation.generation ||
    range.appId !== installation.appId ||
    range.shopId !== installation.providerShopId ||
    binding.appId !== installation.appId ||
    binding.shopId !== installation.providerShopId
  )
    return unresolved('SCOPE_MISMATCH');
  if (
    installation.deactivatedAt !== null ||
    current.active !== true ||
    current.billingPeriod !== 'EVERY_30_DAYS' ||
    current.trialEndsAt !== null ||
    current.pendingUpdate !== null ||
    current.cancelAtEndOfCycle !== false
  )
    return unresolved('UNSUPPORTED_HISTORY');
  const cycle = current.currentBillingCycle;
  if (
    !object(cycle) ||
    !instant(cycle.startTime) ||
    !instant(cycle.endTime) ||
    cycle.startTime >= cycle.endTime ||
    !instant(current.observedAt) ||
    current.observedAt < cycle.startTime ||
    current.observedAt >= cycle.endTime ||
    !instant(range.from) ||
    !instant(range.through) ||
    !instant(range.observedAt) ||
    range.from > range.through ||
    range.observedAt < range.through ||
    range.observedAt < current.observedAt ||
    Date.parse(range.through) - Date.parse(range.from) > 365 * 86400000 ||
    !Number.isInteger(range.pagesRead) ||
    range.pagesRead < 1 ||
    range.pagesRead > 4 ||
    !Array.isArray(range.events)
  )
    return unresolved('INVALID_SOURCE');
  if (
    range.pagination !== 'EXHAUSTED' ||
    range.nextCursor !== null ||
    range.through < current.observedAt ||
    !range.events.length
  )
    return unresolved('INCOMPLETE_HISTORY');
  // Holding every additional event deliberately excludes unimplemented change/cancellation/freeze semantics.
  if (range.events.length !== 1) return unresolved('UNSUPPORTED_HISTORY');
  const created = range.events[0];
  if (
    !object(created) ||
    !sourceText(created.id, 512) ||
    !created.id.startsWith('gid://partners/SubscriptionStatus/') ||
    created.id === 'gid://partners/SubscriptionStatus/' ||
    !sourceText(created.cursor, 2048) ||
    !instant(created.occurredAt) ||
    created.occurredAt < range.from ||
    created.occurredAt > current.observedAt ||
    created.occurredAt > range.through
  )
    return unresolved('INVALID_SOURCE');
  if (
    created.eventType !== 'SUBSCRIPTION_CREATED' ||
    created.state !== 'CREATED' ||
    created.cancelEffectiveOn !== null ||
    !object(created.plan) ||
    created.plan.handle !== binding.planHandle ||
    created.plan.billingPeriod !== 'EVERY_30_DAYS' ||
    !days(created.plan.trialDays) ||
    !days(created.plan.trialDaysRemaining)
  )
    return unresolved('UNSUPPORTED_HISTORY');
  if (!Array.isArray(current.items) || current.items.length !== 2) return unresolved('UNRECOGNIZED_POLICY');
  const plan = current.items.find((item) => object(item) && item.handle === binding.planHandle);
  const meter = current.items.find((item) => object(item) && item.handle === binding.usageHandle);
  if (
    !plan ||
    !meter ||
    !object(plan.price) ||
    plan.price.kind !== 'flat' ||
    typeof plan.price.active !== 'boolean' ||
    !object(meter.price) ||
    meter.price.kind !== 'tiered' ||
    typeof meter.price.active !== 'boolean'
  )
    return unresolved('UNRECOGNIZED_POLICY');
  const startsAt = [created.occurredAt, installation.activatedAt, range.from].reduce(
    (a, b) => (a > b ? a : b),
    cycle.startTime,
  );
  const endsAt = [current.observedAt, range.through].reduce((a, b) => (a < b ? a : b), cycle.endTime);
  if (startsAt >= endsAt) return unresolved('NO_COVERAGE');
  return {
    kind: 'NORMALIZED',
    history: {
      kind: 'TRUSTED',
      shopId: installation.tenantShopId,
      installationGeneration: installation.generation,
      windows: [
        {
          kind: 'PAID',
          policy: { ...binding.policy },
          cycleId: `partner-2026-07:${current.appId.split('/').at(-1)}:${current.shopId.split('/').at(-1)}:${cycle.startTime}/${cycle.endTime}`,
          cycle: { startsAt: cycle.startTime, endsAt: cycle.endTime },
          startsAt,
          endsAt,
        },
      ],
    },
  };
}
