import { type Kysely, sql } from 'kysely';
import type { Database } from '../client/database.js';

export type CustomerPrivacyProcessing = {
  kind: 'DATA_REQUEST_PENDING_EXPORT' | 'ERASURE_STAGED' | 'SHOP_ERASURE_STAGED' | 'SHOP_ERASURE_BLOCKED';
  shopId: string;
  requestedOrderCount: number;
  matchedPurchaseCount: number;
};
const uuid = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
type MerchantScope = { shopId: string; installationGeneration: string };
export type PrivacyRequest = {
  inboxId: string;
  requestId: string;
  receivedAt: string;
  fulfillBy: string;
  requestedOrderCount: number;
  matchedPurchaseCount: number;
};
export type PrivacyOrderLink = { orderId: string; purchaseId: string | null };

/** Processing accepts only the durable inbox identity. The definer rederives
 * signed-body purpose, shop and orders; callers cannot assert erasure authority.
 * This is not export delivery or confirmation that R2 objects are already gone. */
export function createCustomerPrivacyRepository(db: Kysely<Database>) {
  return {
    async blockedShopErasureCount(): Promise<number> {
      return (
        (await sql<{ count: number }>`SELECT public.blocked_shop_privacy_count() AS count`.execute(db)).rows[0]
          ?.count ?? 0
      );
    },
    async cleanupInboxes(limit = 100): Promise<number> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid privacy inbox budget');
      return (
        (await sql<{ count: number }>`SELECT public.cleanup_customer_privacy_inboxes(${limit}) AS count`.execute(db))
          .rows[0]?.count ?? 0
      );
    },
    async listDataRequests(scope: MerchantScope, after: string | null = null): Promise<PrivacyRequest[]> {
      if (after !== null && !uuid(after)) throw new Error('Invalid privacy cursor');
      const rows = await sql<{
        value: PrivacyRequest;
      }>`SELECT value FROM public.read_customer_privacy_requests(${scope.shopId},${scope.installationGeneration}::bigint,NULL,${after}::uuid) value`.execute(
        db,
      );
      return rows.rows.map((row) => row.value);
    },
    async readDataRequest(scope: MerchantScope, inboxId: string) {
      if (!uuid(inboxId)) throw new Error('Invalid privacy inbox identity');
      const row = (
        await sql<{
          value: PrivacyRequest;
        }>`SELECT value FROM public.read_customer_privacy_requests(${scope.shopId},${scope.installationGeneration}::bigint,${inboxId}::uuid) value`.execute(
          db,
        )
      ).rows[0];
      if (!row) return null;
      const links = await sql<{
        value: PrivacyOrderLink;
      }>`SELECT value FROM public.read_customer_privacy_order_links(${scope.shopId},${scope.installationGeneration}::bigint,${inboxId}::uuid) value`.execute(
        db,
      );
      return { ...row.value, orders: links.rows.map((row) => row.value) };
    },
    async exportOrder(
      scope: MerchantScope,
      inboxId: string,
      purchaseId: string,
      setId: string | null = null,
    ): Promise<Record<string, unknown> | null> {
      if (!uuid(inboxId) || !uuid(purchaseId) || (setId !== null && !uuid(setId)))
        throw new Error('Invalid privacy export identity');
      return (
        (
          await sql<{
            value: Record<string, unknown> | null;
          }>`SELECT public.export_customer_privacy_order(${scope.shopId},${scope.installationGeneration}::bigint,${inboxId}::uuid,${purchaseId}::uuid,${setId}::uuid) AS value`.execute(
            db,
          )
        ).rows[0]?.value ?? null
      );
    },
    async processInbox(inboxId: string): Promise<CustomerPrivacyProcessing> {
      if (!uuid(inboxId)) throw new Error('Invalid privacy inbox identity');
      const row = (
        await sql<{
          result: CustomerPrivacyProcessing;
        }>`SELECT public.process_customer_privacy_inbox(${inboxId}::uuid) AS result`.execute(db)
      ).rows[0];
      if (!row) throw new Error('Privacy processing returned no durable outcome');
      return row.result;
    },
  };
}
export type CustomerPrivacyRepository = ReturnType<typeof createCustomerPrivacyRepository>;
