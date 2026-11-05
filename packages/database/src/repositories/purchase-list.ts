import type { PurchaseListQuery } from '@insignia/contracts';
import { type Kysely, sql } from 'kysely';
import type { Database } from '../client/database.js';

/** Query projection only. This never changes immutable order/economic records. */
export function createPurchaseListRepository(db: Kysely<Database>) {
  return {
    async rememberNames(shopId: string, values: Record<string, string | null>) {
      for (const [orderId, name] of Object.entries(values)) {
        if (
          !/^gid:\/\/shopify\/Order\/[1-9][0-9]*$/.test(orderId) ||
          (name !== null && (!name.trim() || name.length > 512 || /[\p{Cc}]/u.test(name)))
        )
          throw new Error('INVALID_ORDER_LABEL');
        await sql`INSERT INTO purchase_order_labels(shop_id,purchase_id,order_name) SELECT o.shop_id,o.purchase_id,${name} FROM purchase_orders o WHERE o.shop_id=${shopId} AND o.order_id=${orderId} AND NOT EXISTS(SELECT 1 FROM customer_order_erasure_fences f WHERE f.shop_id=o.shop_id AND f.order_id=o.order_id) AND NOT EXISTS(SELECT 1 FROM shop_privacy_fences f WHERE f.shop_id=o.shop_id AND f.installation_generation>=o.installation_generation) ON CONFLICT(shop_id,purchase_id) DO UPDATE SET order_name=EXCLUDED.order_name,observed_at=clock_timestamp()`.execute(
          db,
        );
      }
    },
    async missingNames(shopId: string, limit = 100): Promise<string[]> {
      const result = await sql<{
        order_id: string;
      }>`SELECT o.order_id FROM purchase_orders o LEFT JOIN purchase_order_labels l ON l.shop_id=o.shop_id AND l.purchase_id=o.purchase_id WHERE o.shop_id=${shopId} AND l.purchase_id IS NULL AND NOT EXISTS(SELECT 1 FROM customer_order_erasure_fences f WHERE f.shop_id=o.shop_id AND f.order_id=o.order_id) AND NOT EXISTS(SELECT 1 FROM shop_privacy_fences f WHERE f.shop_id=o.shop_id AND f.installation_generation>=o.installation_generation) ORDER BY o.created_at,o.purchase_id LIMIT ${limit}`.execute(
        db,
      );
      return result.rows.map((row) => row.order_id);
    },
    async listIds(shopId: string, input: Omit<PurchaseListQuery, 'limit'> & { limit: number }): Promise<string[]> {
      const dateColumn = input.sort ? sql.ref('o.order_created_at') : sql.ref('o.created_at');
      const ascending = input.sort === 'date-asc';
      const cursorColumn = input.sort ? sql.ref('c.order_created_at') : sql.ref('c.created_at');
      const term = input.q?.trim().toLowerCase();
      const artwork =
        input.artwork && input.artwork !== 'all'
          ? sql`AND (${availableArtwork}) = ${input.artwork === 'complete'}`
          : sql``;
      const result = await sql<{ purchase_id: string }>`SELECT o.purchase_id::text FROM purchase_orders o
        LEFT JOIN purchase_order_labels l ON l.shop_id=o.shop_id AND l.purchase_id=o.purchase_id
        WHERE o.shop_id=${shopId}
        ${input.createdFrom ? sql`AND o.order_created_at>=${new Date(input.createdFrom)}` : sql``}
        ${input.createdBefore ? sql`AND o.order_created_at<${new Date(input.createdBefore)}` : sql``}
        ${term ? sql`AND (strpos(lower(o.order_id), ${term})>0 OR strpos(lower(COALESCE(l.order_name,'')), ${term})>0)` : sql``}
        ${input.before ? sql`AND (${dateColumn},o.purchase_id) ${ascending ? sql`>` : sql`<`} (SELECT ${cursorColumn},c.purchase_id FROM purchase_orders c WHERE c.shop_id=${shopId} AND c.purchase_id=${input.before}::uuid)` : sql``}
        ${artwork}
        ORDER BY ${dateColumn} ${ascending ? sql`ASC` : sql`DESC`},o.purchase_id ${ascending ? sql`ASC` : sql`DESC`} LIMIT ${input.limit}`.execute(
        db,
      );
      return result.rows.map((row) => row.purchase_id);
    },
    async statistics(shopId: string, timeZone: string, observedAt: Date) {
      const result = await sql<{
        day: string;
        orders: string;
        items: string;
        product_ids: string[];
        unknown_test: string;
      }>`
        WITH relevant AS (
          SELECT o.purchase_id,o.is_test,(o.order_created_at AT TIME ZONE ${timeZone})::date AS day,
            (SELECT x.cancelled_at FROM purchase_observations x WHERE x.purchase_id=o.purchase_id ORDER BY x.source_updated_at DESC,x.observed_at DESC,x.observation_id DESC LIMIT 1) AS cancelled_at
          FROM purchase_orders o WHERE o.shop_id=${shopId} AND o.order_created_at<=${observedAt}
            AND o.order_created_at >= (((CAST(${observedAt} AS timestamptz) AT TIME ZONE ${timeZone})::date - 59)::timestamp AT TIME ZONE ${timeZone})
        ), counts AS (
          SELECT r.day,count(*) FILTER(WHERE r.is_test=false AND r.cancelled_at IS NULL)::text AS orders,
            COALESCE(sum((SELECT COALESCE(sum(l.quantity),0) FROM purchase_lines l WHERE l.purchase_id=r.purchase_id)) FILTER(WHERE r.is_test=false AND r.cancelled_at IS NULL),0)::text AS items,
            count(*) FILTER(WHERE r.is_test IS NULL)::text AS unknown_test
          FROM relevant r GROUP BY r.day
        ), products AS (
          SELECT r.day,array_agg(DISTINCT l.product_id ORDER BY l.product_id) AS product_ids FROM relevant r JOIN purchase_lines l ON l.purchase_id=r.purchase_id WHERE r.is_test=false AND r.cancelled_at IS NULL GROUP BY r.day
        ) SELECT c.day::text,c.orders,c.items,c.unknown_test,COALESCE(p.product_ids,ARRAY[]::text[]) AS product_ids FROM counts c LEFT JOIN products p USING(day) ORDER BY c.day`.execute(
        db,
      );
      return result.rows;
    },
  };
}

// Same currently-usable artwork requirement as the selected list presentation.
// A lock remains audit state, not a promise that expired originals are available.
const availableArtwork = sql<boolean>`
  EXISTS(SELECT 1 FROM purchase_lines pl WHERE pl.purchase_id=o.purchase_id)
  AND EXISTS(SELECT 1 FROM purchase_design_payloads p WHERE p.purchase_id=o.purchase_id)
  AND NOT EXISTS(SELECT 1 FROM purchase_design_payloads p WHERE p.purchase_id=o.purchase_id AND (p.payload IS NULL OR p.erased_at IS NOT NULL OR p.expires_at<=clock_timestamp()
    OR NOT EXISTS(SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=p.shop_id AND s.current_generation=p.installation_generation AND i.deactivated_at IS NULL)))
  AND (WITH groups AS (
    SELECT row_number() OVER(ORDER BY p.set_id,g.ordinality)-1 AS group_index,g.value#>'{group,design,placements}' AS placements
    FROM purchase_design_payloads p CROSS JOIN LATERAL jsonb_array_elements(p.payload#>'{request,groups}') WITH ORDINALITY g(value,ordinality)
    WHERE p.purchase_id=o.purchase_id
  ), erased AS (
    SELECT COALESCE(max(version),0) AS version FROM purchase_artwork_events WHERE purchase_id=o.purchase_id AND kind='ATTACH' AND (erased_at IS NOT NULL OR asset_id IS NULL OR expires_at<=clock_timestamp())
  ) SELECT EXISTS(SELECT 1 FROM groups) AND NOT EXISTS(
    SELECT 1 FROM groups WHERE jsonb_array_length(placements)=0
  ) AND NOT EXISTS(
    SELECT 1 FROM groups g CROSS JOIN LATERAL jsonb_array_elements(g.placements) p(value) CROSS JOIN erased e
    LEFT JOIN LATERAL (SELECT a.asset_id::text,a.version FROM purchase_artwork_events a WHERE a.purchase_id=o.purchase_id AND a.kind='ATTACH' AND a.group_index=g.group_index AND a.placement_id=p.value->>'placementId' AND a.version>e.version AND a.erased_at IS NULL AND a.expires_at>clock_timestamp() ORDER BY a.version DESC LIMIT 1) latest ON true
    WHERE NOT EXISTS(SELECT 1 FROM artwork_assets asset WHERE asset.shop_id=o.shop_id AND asset.state='USABLE' AND asset.expires_at>clock_timestamp() AND asset.asset_id::text=COALESCE(latest.asset_id,CASE WHEN e.version=0 AND p.value#>>'{artwork,kind}'='revision' THEN p.value#>>'{artwork,revisionId}' END))
  ))`;
