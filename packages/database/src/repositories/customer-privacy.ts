import { type Kysely, sql } from 'kysely';
import type { Database } from '../client/database.js';

export type CustomerPrivacyProcessing = {
  kind: 'DATA_REQUEST_PENDING_EXPORT' | 'ERASURE_STAGED';
  shopId: string;
  requestedOrderCount: number;
  matchedPurchaseCount: number;
};
const uuid = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);

/** Processing accepts only the durable inbox identity. The definer rederives
 * signed-body purpose, shop and orders; callers cannot assert erasure authority.
 * This is not export delivery or confirmation that R2 objects are already gone. */
export function createCustomerPrivacyRepository(db: Kysely<Database>) {
  return {
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
    /** Minimal order lookup for the pending export path; never returns customer
     * contact fields, artwork URLs, raw webhook bytes or identifying designs. */
    async lookupDataRequest(inboxId: string) {
      if (!uuid(inboxId)) throw new Error('Invalid privacy inbox identity');
      const rows = await sql<{ purchase_id: string; order_id: string; has_private_design: boolean }>`
        SELECT p.purchase_id::text,p.order_id,EXISTS(SELECT 1 FROM purchase_design_payloads d WHERE d.purchase_id=p.purchase_id AND d.payload IS NOT NULL AND d.expires_at>clock_timestamp()) AS has_private_design
        FROM customer_privacy_receipts r JOIN customer_privacy_order_links l ON l.inbox_id=r.inbox_id
        JOIN purchase_orders p ON p.shop_id=r.shop_id AND p.order_id=l.order_id
        WHERE r.inbox_id=${inboxId}::uuid AND r.operation='DATA_REQUEST_PENDING_EXPORT' ORDER BY p.order_id`.execute(
        db,
      );
      return rows.rows.map((row) => ({
        purchaseId: row.purchase_id,
        orderId: row.order_id,
        hasPrivateDesign: row.has_private_design,
      }));
    },
  };
}
export type CustomerPrivacyRepository = ReturnType<typeof createCustomerPrivacyRepository>;
