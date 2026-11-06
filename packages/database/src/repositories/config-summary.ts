import { sql } from 'kysely';
import type { DatabaseExecutor } from '../client/database.js';

export type ConfigSummaryRecord = { productId: string; draft: unknown; published: boolean };
/** One bounded query for a Shopify catalog page; no per-product database/provider reads. */
export async function readConfigSummaries(
  db: DatabaseExecutor,
  shopId: string,
  productIds: readonly string[],
): Promise<ConfigSummaryRecord[]> {
  if (productIds.length > 100 || productIds.some((id) => !/^[1-9][0-9]{0,24}$/.test(id)))
    throw new Error('Invalid product summary identities');
  if (!productIds.length) return [];
  const rows = await sql<{ product_id: string; draft_value: unknown; published: boolean }>`
    SELECT c.external_product_id AS product_id, c.draft_value,
      (p.operation_id IS NOT NULL AND p.status='activated' AND p.installation_generation=s.current_generation
       AND p.revision_id=c.effective_revision_id AND p.operation_sequence=c.publication_sequence
       AND p.observed_projection=p.expected_projection AND p.observed_projection_digest=p.expected_projection_digest) AS published
    FROM product_configs c JOIN shops s ON s.shop_id=c.shop_id
    LEFT JOIN publication_operations p ON p.shop_id=c.shop_id AND p.config_id=c.config_id AND p.operation_id=c.effective_operation_id
    WHERE c.shop_id=${shopId} AND c.external_product_id IN (${sql.join(productIds)})
  `.execute(db);
  return rows.rows.map((row) => ({
    productId: row.product_id,
    draft: row.draft_value,
    published: row.published === true,
  }));
}
