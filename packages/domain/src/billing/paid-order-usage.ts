/** Immutable independently verified purchase facts; adapters establish their provenance. */
export interface PaidOrderUsagePurchase {
  readonly shopId: string;
  readonly installationGeneration: string;
  readonly orderId: string;
  readonly isTest: boolean | null;
  readonly hasVerifiedCustomization: boolean | null;
  readonly firstPaidAt: string | null;
}
export interface UsagePolicyIdentity {
  readonly id: string;
  readonly version: string;
}
/** Normalized UTC millisecond timestamps, with inclusive start and exclusive finite end. */
export interface UsageInterval {
  readonly startsAt: string;
  readonly endsAt: string;
}
export type UsageEntitlementWindow = UsageInterval &
  (
    | { readonly kind: 'INACTIVE' }
    | { readonly kind: 'TRIAL'; readonly policy: UsagePolicyIdentity; readonly trial: UsageInterval }
    | {
        readonly kind: 'PAID';
        readonly policy: UsagePolicyIdentity;
        readonly cycleId: string;
        readonly cycle: UsageInterval;
      }
  );
/** TRUSTED means an upstream authority has normalized complete effective transitions.
 * Current subscriptions, quote policy and signed carriers cannot establish these intervals. */
export type PaidOrderUsageHistory =
  | { readonly kind: 'UNAVAILABLE' | 'UNVERIFIED' }
  | {
      readonly kind: 'TRUSTED';
      readonly shopId: string;
      readonly installationGeneration: string;
      readonly windows: readonly UsageEntitlementWindow[];
    };
export type UsageQualificationReason =
  | 'TEST_STATUS_UNKNOWN'
  | 'CUSTOMIZATION_UNVERIFIED'
  | 'INVALID_PURCHASE_FACTS'
  | 'HISTORY_UNAVAILABLE'
  | 'HISTORY_UNVERIFIED'
  | 'HISTORY_SCOPE_MISMATCH'
  | 'INVALID_HISTORY'
  | 'HISTORY_OVERLAP'
  | 'HISTORY_GAP'
  | 'POLICY_MISMATCH'
  | 'PERIOD_MISMATCH';
interface UsageOccurrence {
  readonly shopId: string;
  readonly installationGeneration: string;
  readonly orderId: string;
  readonly occurredAt: string;
}
export type PaidOrderUsageQualification =
  | { readonly kind: 'EXCLUDED'; readonly reason: 'TEST_ORDER' | 'PLAIN_ORDER'; readonly units: 0 }
  | { readonly kind: 'PENDING_PAYMENT'; readonly units: 0 }
  | { readonly kind: 'UNRESOLVED'; readonly reason: UsageQualificationReason; readonly units: 0 }
  | (UsageOccurrence & { readonly kind: 'WAIVED_TRIAL' | 'UNBILLABLE_INACTIVE'; readonly units: 0 })
  | (UsageOccurrence & {
      readonly kind: 'ELIGIBLE';
      readonly units: 1;
      readonly policy: UsagePolicyIdentity;
      readonly cycleId: string;
    });

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\p{Cc}]/u.test(value);
}
function instant(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}
const unresolved = (reason: UsageQualificationReason): PaidOrderUsageQualification => ({
  kind: 'UNRESOLVED',
  reason,
  units: 0,
});

function interval(value: UsageInterval | undefined): { start: number; end: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const start = instant(value.startsAt);
  const end = instant(value.endsAt);
  return start !== null && end !== null && start < end ? { start, end } : null;
}
function validPolicy(value: UsagePolicyIdentity | null | undefined): value is UsagePolicyIdentity {
  return (
    !!value && typeof value === 'object' && !Array.isArray(value) && identifier(value.id) && identifier(value.version)
  );
}
function contains(period: { start: number; end: number }, at: number): boolean {
  return at >= period.start && at < period.end;
}

/** Pure qualification only. It neither deduplicates orders nor creates a ledger/delivery/charge.
 * Historical adapters must supply authoritative effective instants, never a date-only cancellation guess. */
export function qualifyPaidOrderUsage(input: {
  readonly purchase: PaidOrderUsagePurchase;
  readonly policy: UsagePolicyIdentity | null;
  readonly history: PaidOrderUsageHistory;
}): PaidOrderUsageQualification {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return unresolved('INVALID_PURCHASE_FACTS');
  const { purchase, history, policy } = input;
  if (purchase?.isTest === true) return { kind: 'EXCLUDED', reason: 'TEST_ORDER', units: 0 };
  if (purchase?.isTest !== false) return unresolved('TEST_STATUS_UNKNOWN');
  if (purchase.hasVerifiedCustomization === false) return { kind: 'EXCLUDED', reason: 'PLAIN_ORDER', units: 0 };
  if (purchase.hasVerifiedCustomization !== true) return unresolved('CUSTOMIZATION_UNVERIFIED');
  if (
    ![purchase.shopId, purchase.installationGeneration, purchase.orderId].every(identifier) ||
    !/^[1-9][0-9]*$/.test(purchase.installationGeneration)
  )
    return unresolved('INVALID_PURCHASE_FACTS');
  if (purchase.firstPaidAt === null) return { kind: 'PENDING_PAYMENT', units: 0 };
  const at = instant(purchase.firstPaidAt);
  if (at === null) return unresolved('INVALID_PURCHASE_FACTS');
  if (!history || history.kind === 'UNAVAILABLE') return unresolved('HISTORY_UNAVAILABLE');
  if (history.kind === 'UNVERIFIED') return unresolved('HISTORY_UNVERIFIED');
  if (typeof history !== 'object' || Array.isArray(history) || history.kind !== 'TRUSTED')
    return unresolved('INVALID_HISTORY');
  if (history.shopId !== purchase.shopId || history.installationGeneration !== purchase.installationGeneration)
    return unresolved('HISTORY_SCOPE_MISMATCH');
  // This is a bounded normalized history segment, not an unbounded provider event archive.
  if (!Array.isArray(history.windows) || history.windows.length > 1024) return unresolved('INVALID_HISTORY');
  const periods: { segment: UsageEntitlementWindow; start: number; end: number }[] = [];
  for (const segment of history.windows) {
    const effective = interval(segment);
    if (!effective || !['INACTIVE', 'TRIAL', 'PAID'].includes(segment.kind)) return unresolved('INVALID_HISTORY');
    if (segment.kind !== 'INACTIVE') {
      if (!validPolicy(segment.policy)) return unresolved('INVALID_HISTORY');
      if (segment.kind === 'TRIAL' && !interval(segment.trial)) return unresolved('INVALID_HISTORY');
      if (segment.kind === 'PAID' && (!identifier(segment.cycleId) || !interval(segment.cycle)))
        return unresolved('INVALID_HISTORY');
    }
    periods.push({ segment, ...effective });
  }
  periods.sort((a, b) => a.start - b.start);
  let priorEnd: number | null = null;
  for (const period of periods) {
    if (priorEnd !== null && period.start < priorEnd) return unresolved('HISTORY_OVERLAP');
    priorEnd = period.end;
  }
  const selected = periods.find((period) => contains(period, at))?.segment;
  if (!selected) return unresolved('HISTORY_GAP');
  const occurrence: UsageOccurrence = {
    shopId: purchase.shopId,
    installationGeneration: purchase.installationGeneration,
    orderId: purchase.orderId,
    occurredAt: purchase.firstPaidAt,
  };
  if (selected.kind === 'INACTIVE') return { kind: 'UNBILLABLE_INACTIVE', units: 0, ...occurrence };
  if (!validPolicy(policy) || selected.policy.id !== policy.id || selected.policy.version !== policy.version)
    return unresolved('POLICY_MISMATCH');
  const period = interval(selected.kind === 'TRIAL' ? selected.trial : selected.cycle);
  if (!period || !contains(period, at)) return unresolved('PERIOD_MISMATCH');
  if (selected.kind === 'TRIAL') return { kind: 'WAIVED_TRIAL', units: 0, ...occurrence };
  return { kind: 'ELIGIBLE', units: 1, ...occurrence, policy: { ...policy }, cycleId: selected.cycleId };
}
