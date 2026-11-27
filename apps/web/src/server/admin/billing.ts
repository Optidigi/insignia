import { type EntitlementPolicyConfig, projectEntitlement } from '@insignia/application';
import { createObservability } from '@insignia/observability';
import { type ActiveSubscriptionSnapshot, PartnerSubscriptionError } from '@insignia/shopify';
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
const logger = createObservability().logger;
const monthlyPlans: ReadonlyMap<string, NonNullable<BillingView['plan']>> = new Map([
  ['insignia-free', { name: 'Insignia Free', monthlyAmount: '0.00' }],
  ['insignia-standard', { name: 'Insignia Standard', monthlyAmount: '49.99' }],
  ['insignia-pro', { name: 'Insignia Pro', monthlyAmount: '69.99' }],
]);

export function createMerchantBillingReader(ports: {
  appId: string;
  policy: EntitlementPolicyConfig;
  now(): Date;
  /** Verify the current installation and staff grant before and after the provider read. */
  current(actor: AdminActor): Promise<void>;
  read(actor: AdminActor): Promise<BoundSubscription>;
  readFreeProduct?(actor: AdminActor): Promise<string | null>;
}): (actor: AdminActor) => Promise<BillingView> {
  return async (actor) => {
    await ports.current(actor);
    let snapshot: BoundSubscription | null = null;
    try {
      snapshot = await ports.read(actor);
    } catch (error) {
      if (!(error instanceof PartnerSubscriptionError)) throw error;
      logger.error('admin_request_failed', {
        adminFailure: {
          adminRoute: 'billing',
          httpMethod: 'GET',
          errorClass: error.name,
          errorCode: error.kind.toUpperCase(),
        },
      });
    }
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
    const billingPeriod = recognized ? snapshot?.billingPeriod : null;
    const item = recognized ? snapshot?.items[0] : null;
    const plan = item ? (monthlyPlans.get(item.handle) ?? null) : null;
    const pending = fresh ? projection.pendingProviderUpdate : null;
    const pendingHandle =
      pending?.billingPeriod === 'EVERY_30_DAYS' && pending.itemHandles.length === 1
        ? pending.itemHandles[0]
        : undefined;
    const pendingPlan =
      pendingHandle && ports.policy.plans.some((entry) => entry.planHandle === pendingHandle)
        ? (monthlyPlans.get(pendingHandle) ?? null)
        : null;
    const recurringPrice =
      item?.price.kind === 'flat' && billingPeriod
        ? { amount: item.price.amount, currency: item.price.currency, billingPeriod }
        : null;
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
      observedAt: fresh ? (snapshot?.observedAt ?? null) : null,
      trialEndsAt: recognized && projection.trial ? (snapshot?.trialEndsAt ?? null) : null,
      currentCycle: recognized ? (snapshot?.currentBillingCycle ?? null) : null,
      scheduledCancellation: fresh && projection.scheduledCancellation,
      pendingChange: fresh && projection.pendingProviderUpdate !== null,
      newActionsAllowed: recognized && projection.qualifyingUsageDisposition === 'NOT_METERED',
      ...(plan && { plan }),
      ...(pendingPlan && { pendingPlan }),
      ...(ports.policy.plans.some((entry) => entry.planHandle === 'insignia-pro') && {
        productionTools: recognized && projection.features.includes('m5.production-tools'),
      }),
      ...((plan?.monthlyAmount === '0.00' || pendingPlan?.monthlyAmount === '0.00') &&
        ports.readFreeProduct && {
          freeProductId: await ports.readFreeProduct(actor),
        }),
      // The nominal Standard rate is known for the 30-day option.
      standardPrice:
        !snapshot || billingPeriod === 'ANNUAL' || (plan && plan.monthlyAmount !== '49.99')
          ? null
          : { amount: '49.99', currency: 'USD', intervalDays: 30 },
      recurringPrice,
      // Shopify charges development stores $0 for a recognized paid plan.
      developmentTerms:
        recognized &&
        plan?.monthlyAmount !== '0.00' &&
        recurringPrice?.currency === 'USD' &&
        /^0(?:\.0+)?$/.test(recurringPrice.amount),
      managementUrl: managementUrl(actor.shop),
    };
  };
}
