import { type EntitlementPolicyConfig, projectEntitlement } from '@insignia/application';
import type { ActiveSubscriptionSnapshot } from '@insignia/shopify';
import type { BillingView } from '../../shared/billing-view.js';
import type { AdminActor } from './contracts.js';

/** Shopify's supported top-level billing route for this app's configured handle.
 * No provider credential or app/client identity belongs in this display adapter.
 */
function managementUrl(shop: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return null;
  return `https://admin.shopify.com/store/${shop.slice(0, -'.myshopify.com'.length)}/charges/insignia-1/pricing_plans`;
}

type BoundSubscription = ActiveSubscriptionSnapshot & { tenantShopId: string; installationGeneration: string };
export function createMerchantBillingReader(ports: {
  appId: string;
  policy: EntitlementPolicyConfig;
  now(): Date;
  /** Verify the current installation and staff grant before and after the provider read. */
  current(actor: AdminActor): Promise<void>;
  read(actor: AdminActor): Promise<BoundSubscription>;
}): (actor: AdminActor) => Promise<BillingView> {
  return async (actor) => {
    await ports.current(actor);
    const snapshot = await ports.read(actor);
    await ports.current(actor);
    const projection = projectEntitlement(snapshot, ports.policy, {
      appId: ports.appId,
      shopId: actor.shopId,
      tenantShopId: actor.tenantShopId,
      installationGeneration: actor.installationGeneration,
      now: ports.now(),
    });
    const fresh = projection.freshness === 'fresh';
    const recognized = fresh && projection.recognizedPolicyId !== null;
    const item = recognized ? snapshot.items[0] : null;
    const recurringPrice =
      item?.price.kind === 'flat' ? { amount: item.price.amount, currency: item.price.currency } : null;
    return {
      status: !fresh
        ? 'unavailable'
        : !projection.active
          ? 'inactive'
          : !recognized
            ? 'unavailable'
            : projection.trial
              ? 'trial'
              : 'active',
      observedAt: fresh ? snapshot.observedAt : null,
      trialEndsAt: recognized ? snapshot.trialEndsAt : null,
      currentCycle: recognized ? snapshot.currentBillingCycle : null,
      scheduledCancellation: fresh && projection.scheduledCancellation,
      pendingChange: fresh && projection.pendingProviderUpdate !== null,
      newActionsAllowed: recognized && projection.qualifyingUsageDisposition === 'NOT_METERED',
      standardPrice: { amount: '49.99', currency: 'USD', intervalDays: 30 },
      recurringPrice,
      developmentTerms:
        recognized &&
        ports.policy.plans.some(
          (plan) => plan.policyId === projection.recognizedPolicyId && plan.shopId === actor.shopId,
        ) &&
        recurringPrice?.currency === 'USD' &&
        /^0(?:\.0+)?$/.test(recurringPrice.amount),
      managementUrl: managementUrl(actor.shop),
    };
  };
}
