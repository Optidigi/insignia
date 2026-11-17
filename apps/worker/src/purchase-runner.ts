import { type PurchasePorts, reconcilePurchase, type VerifiedOrder } from '@insignia/application';
import { type DurableCore, webhookIdParsingSupported } from '@insignia/database';
import type { ShopifyOrderChangesPage, ShopifyOrderChangesTarget } from '@insignia/shopify';

type OrderTarget = { shopId: string; installationGeneration: string; orderId: string };
type Observation = Parameters<PurchasePorts['store']['reconcile']>[0];

/** Only a customized order without complete verified context can reach checkout admission. */
function mayNeedCheckoutAdmission(order: VerifiedOrder): boolean {
  return (
    order.lines.some((line) => line.attributes.some((attribute) => attribute.key.startsWith('_insignia_'))) &&
    !(order.contextVerified && order.country !== null && order.marketId !== null)
  );
}

/** Reads Shopify independently. A signed webhook supplies only a scoped lookup hint. */
export function createPurchaseRunner(input: {
  core: DurableCore;
  checkout?: PurchasePorts['checkout'];
  prepareRelease?(target: { shopId: string; installationGeneration: string; orderId: string }): Promise<void>;
  orders: {
    read(target: { shopId: string; installationGeneration: string; orderId: string }): Promise<VerifiedOrder>;
    changes?(target: ShopifyOrderChangesTarget): Promise<ShopifyOrderChangesPage>;
  };
  onError?: (errorClass: 'PURCHASE_DISCOVERY_UNAVAILABLE' | 'PURCHASE_RECONCILIATION_UNAVAILABLE') => void;
}) {
  // Receipt hints need exact 64-bit ids; a runtime that cannot read them must not start (or close receipts).
  if (!webhookIdParsingSupported()) throw new Error('PURCHASE_RUNNER_JSON_SOURCE_UNSUPPORTED');
  const offers: PurchasePorts['offers'] = { get: (target) => input.core.purchases.getOffer(target) };
  /**
   * Release evidence serves only checkout admission, so it is prepared only when binding reaches
   * admission. Other orders (ordinary ones, ones with verified context, an earlier installation's
   * orders) reconcile without it: a store without its checkout Functions (a reinstall before its
   * first publish) still completes its windows. An order that reaches admission fails closed without
   * evidence, and is observed again after collection, so admission keeps its fresh SELECT and
   * enforcement checks on an observation that follows collection.
   */
  async function reconcile(target: OrderTarget, store: PurchasePorts['store']) {
    const scoped = {
      shopId: target.shopId,
      installationGeneration: target.installationGeneration,
      orderId: target.orderId,
    };
    const order = await input.orders.read(scoped);
    const observed = { read: async () => order };
    const { checkout, prepareRelease } = input;
    if (!checkout || !prepareRelease || !mayNeedCheckoutAdmission(order))
      return reconcilePurchase(target, { checkout, orders: observed, offers, store });
    // A dry run on the same observation: nothing is admitted and nothing is stored.
    let reachesAdmission = false;
    let dryRun: Observation | undefined;
    await reconcilePurchase(target, {
      checkout: {
        async admit() {
          reachesAdmission = true;
          return null;
        },
      },
      orders: observed,
      offers,
      store: {
        async reconcile(observation) {
          dryRun = observation;
        },
      },
    });
    if (!reachesAdmission && dryRun) return store.reconcile(dryRun);
    await prepareRelease(scoped);
    return reconcilePurchase(target, { checkout, orders: input.orders, offers, store });
  }
  async function processInbox(inboxId: string) {
    const hint = await input.core.purchases.claimPurchaseReconciliationHint(inboxId);
    if (!hint) return 'deferred' as const;
    try {
      await reconcile(hint, {
        reconcile: (observation) =>
          input.core.purchases.reconcile({ ...observation, inboxId, claimToken: hint.claimToken }),
      });
    } catch {
      await input.core.purchases.failPurchaseReconciliation({
        inboxId,
        claimToken: hint.claimToken,
        failureClass: 'PURCHASE_RECONCILIATION_UNAVAILABLE',
      });
      throw new Error('PURCHASE_RECONCILIATION_UNAVAILABLE');
    }
  }
  return {
    processInbox,
    async discoverChanges(limit = 5) {
      if (!input.orders.changes) return 0;
      const claims = await input.core.purchases.claimPurchaseDiscovery(limit);
      let processed = 0;
      for (const claim of claims) {
        try {
          const page = await input.orders.changes(claim);
          if (
            page.shopId !== claim.shopId ||
            page.installationGeneration !== claim.installationGeneration ||
            page.since !== claim.since ||
            page.until !== claim.until ||
            page.orders.length > 20
          )
            throw new Error('INVALID_DISCOVERY_PAGE');
          for (const order of page.orders)
            await reconcile(
              { ...claim, orderId: order.orderId },
              { reconcile: (observation) => input.core.purchases.reconcile(observation) },
            );
          await input.core.purchases.completePurchaseDiscovery({ ...claim, nextCursor: page.nextCursor });
          processed += page.orders.length;
        } catch {
          await input.core.purchases.failPurchaseDiscovery(claim);
          try {
            input.onError?.('PURCHASE_DISCOVERY_UNAVAILABLE');
          } catch {}
        }
      }
      return processed;
    },
    async recover(limit = 20) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_PURCHASE_RECOVERY_LIMIT');
      const hints = await input.core.purchases.selectPurchaseRecoveryHints(limit);
      let processed = 0;
      for (const hint of hints) {
        try {
          if ((await processInbox(hint.inboxId)) !== 'deferred') processed++;
        } catch {
          try {
            input.onError?.('PURCHASE_RECONCILIATION_UNAVAILABLE');
          } catch {}
        }
      }
      return processed;
    },
  };
}
