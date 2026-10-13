import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { Database } from '../client/database.js';
export type PurchaseDiscoveryClaim = {
  shopId: string;
  installationGeneration: string;
  since: string;
  until: string;
  cursor: string | null;
  claimToken: string;
};
/** Fixed windows survive page retries. Provider errors never change watermarks. */
export function createPurchaseCursorRepository(db: Kysely<Database>) {
  return {
    async claimPurchaseDiscovery(limit = 5): Promise<PurchaseDiscoveryClaim[]> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('INVALID_DISCOVERY_BUDGET');
      return db.transaction().execute(async (tx) => {
        await sql`INSERT INTO purchase_reconciliation_cursors(shop_id,installation_generation)
      SELECT s.shop_id,s.current_generation FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
      JOIN shop_credentials c ON c.shop_id=s.shop_id AND c.installation_generation=s.current_generation
      WHERE i.deactivated_at IS NULL AND c.state IN ('active','refresh-in-progress') AND 'read_orders'=ANY(string_to_array(c.scopes,','))
      AND NOT EXISTS(SELECT 1 FROM purchase_reconciliation_cursors p WHERE p.shop_id=s.shop_id AND p.installation_generation=s.current_generation)
      ORDER BY s.shop_id LIMIT ${limit} ON CONFLICT DO NOTHING`.execute(tx);
        const rows = await sql<{
          shop_id: string;
          installation_generation: string;
        }>`SELECT p.shop_id,p.installation_generation::text FROM purchase_reconciliation_cursors p
      JOIN shops s ON s.shop_id=p.shop_id AND s.current_generation=p.installation_generation
      JOIN installation_generations i ON i.shop_id=p.shop_id AND i.generation=p.installation_generation
      JOIN shop_credentials c ON c.shop_id=p.shop_id AND c.installation_generation=p.installation_generation
      WHERE i.deactivated_at IS NULL AND c.state IN ('active','refresh-in-progress') AND 'read_orders'=ANY(string_to_array(c.scopes,','))
       AND p.next_attempt_at<=clock_timestamp() AND (p.claim_until IS NULL OR p.claim_until<=clock_timestamp())
      ORDER BY p.next_attempt_at,p.shop_id LIMIT ${limit} FOR UPDATE OF p SKIP LOCKED`.execute(tx);
        const claims: PurchaseDiscoveryClaim[] = [];
        for (const row of rows.rows) {
          const token = randomUUID();
          const result = await sql<{
            since: Date;
            until: Date;
            page_cursor: string | null;
          }>`UPDATE purchase_reconciliation_cursors
       SET window_since=COALESCE(window_since,date_trunc('milliseconds',GREATEST(watermark-interval '5 minutes',clock_timestamp()-interval '60 days'))),
           window_until=COALESCE(window_until,date_trunc('milliseconds',clock_timestamp())), claim_token=${token}::uuid,claim_until=clock_timestamp()+interval '10 minutes'
       WHERE shop_id=${row.shop_id} AND installation_generation=${row.installation_generation}::bigint
       RETURNING window_since AS since,window_until AS until,page_cursor`.execute(tx);
          const window = result.rows[0]!;
          claims.push({
            shopId: row.shop_id,
            installationGeneration: row.installation_generation,
            since: window.since.toISOString(),
            until: window.until.toISOString(),
            cursor: window.page_cursor,
            claimToken: token,
          });
        }
        return claims;
      });
    },
    async completePurchaseDiscovery(input: PurchaseDiscoveryClaim & { nextCursor: string | null }) {
      if (
        input.nextCursor !== null &&
        (!input.nextCursor || input.nextCursor.length > 1024 || input.nextCursor === input.cursor)
      )
        throw new Error('INVALID_DISCOVERY_CURSOR');
      const result = await sql`UPDATE purchase_reconciliation_cursors p SET
      watermark=CASE WHEN ${input.nextCursor}::text IS NULL THEN window_until ELSE watermark END,
      window_since=CASE WHEN ${input.nextCursor}::text IS NULL THEN NULL ELSE window_since END,
      window_until=CASE WHEN ${input.nextCursor}::text IS NULL THEN NULL ELSE window_until END,
      page_cursor=${input.nextCursor},claim_token=NULL,claim_until=NULL,last_error_class=NULL,
      next_attempt_at=clock_timestamp()+CASE WHEN ${input.nextCursor}::text IS NULL THEN interval '5 minutes' ELSE interval '0 seconds' END
      WHERE p.shop_id=${input.shopId} AND p.installation_generation=${input.installationGeneration}::bigint AND p.claim_token=${input.claimToken}::uuid
       AND p.claim_until>clock_timestamp() AND p.window_since=${input.since}::timestamptz AND p.window_until=${input.until}::timestamptz
       AND p.page_cursor IS NOT DISTINCT FROM ${input.cursor}::text
       AND EXISTS(SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
         JOIN shop_credentials c ON c.shop_id=s.shop_id AND c.installation_generation=s.current_generation
         WHERE s.shop_id=p.shop_id AND s.current_generation=p.installation_generation AND i.deactivated_at IS NULL
          AND c.state IN ('active','refresh-in-progress') AND 'read_orders'=ANY(string_to_array(c.scopes,',')))
      RETURNING p.shop_id`.execute(db);
      if (!result.rows.length) throw new Error('STALE_DISCOVERY_CLAIM');
    },
    async failPurchaseDiscovery(input: PurchaseDiscoveryClaim) {
      await sql`UPDATE purchase_reconciliation_cursors SET claim_token=NULL,claim_until=NULL,last_error_class='PURCHASE_DISCOVERY_UNAVAILABLE',next_attempt_at=clock_timestamp()+interval '5 minutes'
      WHERE shop_id=${input.shopId} AND installation_generation=${input.installationGeneration}::bigint AND claim_token=${input.claimToken}::uuid`.execute(
        db,
      );
    },
  };
}
