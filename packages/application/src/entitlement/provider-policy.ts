/** Application policy for an observed, versioned subscription projection. Provider prices are not policy. */
import type { ProviderTenantScopePort } from '../shopify/provider-scope.js';
export type ProviderSubscriptionSnapshot = {
  schemaVersion: 'm4-active-subscription-v1';
  sourceApiVersion: '2026-07';
  appId: string;
  shopId: string;
  /** M3 tenant identity and generation bind this observation across reinstall. */
  tenantShopId: string;
  installationGeneration: string;
  observedAt: string;
  active: boolean;
  billingPeriod: 'ANNUAL' | 'EVERY_30_DAYS' | null;
  cancelAtEndOfCycle: boolean;
  trialEndsAt: string | null;
  currentBillingCycle: { startTime: string; endTime: string } | null;
  items: { handle: string; price: { kind: 'flat' | 'tiered'; active: boolean }; usage: { quantity: string } | null }[];
  pendingUpdate: { billingPeriod: 'ANNUAL' | 'EVERY_30_DAYS'; itemHandles: string[] } | null;
};
export type UnscopedProviderSubscriptionSnapshot = Omit<
  ProviderSubscriptionSnapshot,
  'tenantShopId' | 'installationGeneration'
>;

/** Bind a verified provider read to the authenticated M3 tenant/install before projection. */
export async function bindProviderSubscription(
  snapshot: UnscopedProviderSubscriptionSnapshot,
  scope: { appId: string; shopId: string; tenantShopId: string; installationGeneration: string },
  tenants: ProviderTenantScopePort,
): Promise<ProviderSubscriptionSnapshot> {
  if (
    snapshot.appId !== scope.appId ||
    snapshot.shopId !== scope.shopId ||
    !scope.tenantShopId ||
    !/^[1-9][0-9]*$/.test(scope.installationGeneration)
  )
    throw new Error('Provider subscription identity mismatch');
  const verified = await tenants.getActiveProviderScope({
    shopId: scope.tenantShopId,
    installationGeneration: scope.installationGeneration,
  });
  if (
    !verified ||
    verified.shopId !== scope.tenantShopId ||
    verified.installationGeneration !== scope.installationGeneration ||
    `gid://shopify/Shop/${verified.shopifyShopId}` !== scope.shopId
  )
    throw new Error('Provider subscription tenant identity mismatch');
  return { ...snapshot, tenantShopId: scope.tenantShopId, installationGeneration: scope.installationGeneration };
}
export type PlanFeaturePolicy = {
  planHandle: string;
  usageHandle: string;
  policyId: string;
  features: readonly string[];
  includedUsage: number;
};
export type EntitlementPolicyConfig = {
  policyVersion: string;
  maxAgeMs: number;
  plans: readonly PlanFeaturePolicy[];
};
export type EntitlementProjection = {
  policyVersion: string;
  active: boolean;
  recognizedPolicyId: string | null;
  trial: boolean;
  features: string[];
  includedUsage: number | null;
  observedUsageQuantity: string | null;
  billableUsageAllowed: boolean;
  /** Current eligibility only. M9 must classify each order by its first full payment time. */
  qualifyingUsageDisposition: 'REQUIRES_EVENT_TIME' | 'WAIVE_TRIAL' | 'DENY';
  scheduledCancellation: boolean;
  pendingProviderUpdate: ProviderSubscriptionSnapshot['pendingUpdate'];
  freshness: 'fresh' | 'stale' | 'missing';
  observedAt: string | null;
  sourceApiVersion: string | null;
};

function validConfig(config: EntitlementPolicyConfig): boolean {
  if (
    !config.policyVersion ||
    !Number.isSafeInteger(config.maxAgeMs) ||
    config.maxAgeMs <= 0 ||
    config.maxAgeMs > 5 * 60 * 1000 ||
    !Array.isArray(config.plans)
  )
    return false;
  const handles = new Set<string>();
  const ids = new Set<string>();
  for (const plan of config.plans) {
    if (
      !plan.planHandle ||
      !plan.usageHandle ||
      !plan.policyId ||
      plan.planHandle === plan.usageHandle ||
      !Number.isSafeInteger(plan.includedUsage) ||
      plan.includedUsage < 0 ||
      !Array.isArray(plan.features) ||
      plan.features.some((feature: string) => !feature)
    )
      return false;
    if (handles.has(plan.planHandle) || ids.has(plan.policyId)) return false;
    handles.add(plan.planHandle);
    ids.add(plan.policyId);
  }
  return true;
}
const decimal = (value: unknown): value is string =>
  typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);

/** Fail closed for stale, malformed or unrecognized current provider state. */
export function projectEntitlement(
  snapshot: ProviderSubscriptionSnapshot | null,
  config: EntitlementPolicyConfig,
  context: { appId: string; shopId: string; tenantShopId: string; installationGeneration: string; now: Date },
): EntitlementProjection {
  if (!validConfig(config)) throw new Error('Invalid entitlement policy configuration');
  if (
    !context.tenantShopId ||
    !/^[1-9][0-9]*$/.test(context.installationGeneration) ||
    !Number.isFinite(context.now.getTime())
  )
    throw new Error('Invalid entitlement tenant context');
  const { now } = context;
  const observedMs = snapshot ? Date.parse(snapshot.observedAt) : NaN;
  const age = now.getTime() - observedMs;
  const freshness: EntitlementProjection['freshness'] =
    snapshot === null
      ? 'missing'
      : Number.isFinite(age) &&
          age >= 0 &&
          age <= config.maxAgeMs &&
          snapshot.schemaVersion === 'm4-active-subscription-v1' &&
          snapshot.sourceApiVersion === '2026-07' &&
          snapshot.appId === context.appId &&
          snapshot.shopId === context.shopId &&
          snapshot.tenantShopId === context.tenantShopId &&
          snapshot.installationGeneration === context.installationGeneration
        ? 'fresh'
        : 'stale';
  const active = snapshot?.active === true;
  const base: EntitlementProjection = {
    policyVersion: config.policyVersion,
    active,
    recognizedPolicyId: null,
    trial: false,
    features: [],
    includedUsage: null,
    observedUsageQuantity: null,
    billableUsageAllowed: false,
    qualifyingUsageDisposition: 'DENY',
    scheduledCancellation: active && snapshot?.cancelAtEndOfCycle === true,
    pendingProviderUpdate: active ? (snapshot?.pendingUpdate ?? null) : null,
    freshness,
    observedAt: snapshot?.observedAt ?? null,
    sourceApiVersion: snapshot?.sourceApiVersion ?? null,
  };
  if (!active || freshness !== 'fresh' || !snapshot || !Array.isArray(snapshot.items)) return base;
  if (
    snapshot.items.some(
      (item) => !item || typeof item.handle !== 'string' || !item.price || typeof item.price.active !== 'boolean',
    )
  )
    return base;
  const handles = snapshot.items.map((item) => item.handle);
  if (new Set(handles).size !== handles.length) return base;
  const matched = config.plans.filter((plan) =>
    snapshot.items.some((item) => item.handle === plan.planHandle && item.price.kind === 'flat'),
  );
  if (matched.length !== 1) return base;
  const plan = matched[0];
  if (!plan) return base;
  if (
    snapshot.billingPeriod !== 'EVERY_30_DAYS' ||
    snapshot.items.length !== 2 ||
    snapshot.items.some((item) => item.handle !== plan.planHandle && item.handle !== plan.usageHandle)
  )
    return base;
  const usage = snapshot.items.find((item) => item.handle === plan.usageHandle);
  if (
    usage?.price.kind !== 'tiered' ||
    usage.usage === undefined ||
    (usage.usage !== null && !decimal(usage.usage.quantity))
  )
    return base;
  const trial =
    snapshot.trialEndsAt !== null &&
    snapshot.currentBillingCycle === null &&
    Date.parse(snapshot.trialEndsAt) > now.getTime();
  const paid =
    snapshot.trialEndsAt === null &&
    snapshot.currentBillingCycle !== null &&
    Date.parse(snapshot.currentBillingCycle.startTime) <= now.getTime() &&
    Date.parse(snapshot.currentBillingCycle.endTime) > now.getTime();
  if (!trial && !paid) return base;
  return {
    ...base,
    recognizedPolicyId: plan.policyId,
    trial,
    features: [...plan.features],
    includedUsage: plan.includedUsage,
    observedUsageQuantity: usage.usage?.quantity ?? null,
    billableUsageAllowed: paid,
    qualifyingUsageDisposition: trial ? 'WAIVE_TRIAL' : 'REQUIRES_EVENT_TIME',
  };
}
