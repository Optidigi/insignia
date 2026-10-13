import { type PurchasePorts, reconcilePurchase, type VerifiedOrder } from '@insignia/application';
import type { DurableCore } from '@insignia/database';
import type { ShopifyOrderChangesPage, ShopifyOrderChangesTarget } from '@insignia/shopify';

/** Reads Shopify independently. A signed webhook supplies only a scoped lookup hint. */
export function createPurchaseRunner(input: {
  core: DurableCore;
  checkout?: PurchasePorts['checkout'];
  orders: {
    read(target: { shopId: string; installationGeneration: string; orderId: string }): Promise<VerifiedOrder>;
    changes?(target: ShopifyOrderChangesTarget): Promise<ShopifyOrderChangesPage>;
  };
  onError?: (errorClass: string) => void;
}) {
  async function processInbox(inboxId: string) {
    const hint = await input.core.purchases.claimPurchaseReconciliationHint(inboxId);
    if (!hint) return 'deferred' as const;
    try {
      await reconcilePurchase(hint, {
        checkout: input.checkout,
        orders: input.orders,
        offers: { get: (target) => input.core.purchases.getOffer(target) },
        store: {
          reconcile: (observation) =>
            input.core.purchases.reconcile({ ...observation, inboxId, claimToken: hint.claimToken }),
        },
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
            await reconcilePurchase(
              { ...claim, orderId: order.orderId },
              {
                checkout: input.checkout,
                orders: input.orders,
                offers: { get: (target) => input.core.purchases.getOffer(target) },
                store: { reconcile: (observation) => input.core.purchases.reconcile(observation) },
              },
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
