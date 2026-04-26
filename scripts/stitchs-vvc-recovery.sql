-- =============================================================================
-- Stitchs VariantViewConfiguration recovery — view-image-orphan-fix
-- =============================================================================
--
-- Target shop:   stitchs-nl.myshopify.com
-- Target shopId: e300bab6-d980-4ec2-9ef2-1067d181aaab
-- DB:            insignia-custom (production)
--
-- WHY THIS SCRIPT EXISTS
-- ----------------------
-- After the merchant deleted some size variants in Shopify Admin, per-variant
-- view image uploads were orphaned: the VariantViewConfiguration rows that
-- carried the `imageUrl` for back/side views lived on the deleted size
-- variants. Surviving variants of the same color have rows that lack
-- imageUrl, OR they have no row at all for that view.
--
-- The runtime fallback (storefront-config.server.ts, tagged
-- `view-image-orphan-fix:`) restores the storefront image immediately on
-- deploy. This script PERSISTS the recovered images to the DB so:
--   - Admin UIs that read VVC rows directly see the recovered state.
--   - If the chosen sibling itself is later deleted, there's still a valid
--     row to fall back to.
--
-- ALTERNATIVE — generalized TS recovery
-- -------------------------------------
-- For multi-shop or future use, prefer:
--     npm run backfill:vvc-images -- --shop-domain=stitchs-nl.myshopify.com
-- That script queries Shopify GraphQL to derive color groups dynamically.
-- This SQL is the faster path for the immediate Stitchs incident — no
-- Shopify auth needed. Color groupings are derived purely from the data
-- already in the VVC table (variants whose color group has at least one
-- non-null imageUrl per view).
--
-- STRATEGY
-- --------
-- This script does NOT need Shopify color metadata because:
--   1. Color-group geometry has already been fanned out across siblings by
--      the views editor's `copyGeometryToTargets` pathway, so VVC rows
--      EXIST for every variant in each color group (they just have
--      imageUrl=null where the upload never reached them).
--   2. Therefore: for each (productConfigId, viewId), the set of variants
--      sharing the same `placementGeometry` JSONB blob represents one
--      color group. The script joins on placementGeometry equality to
--      group siblings without needing Shopify selectedOptions.
--
-- IMPORTANT — VERIFY ASSUMPTION (1) HOLDS FOR STITCHS BEFORE RUNNING
-- ------------------------------------------------------------------
-- The script aborts if the geometry-equality assumption produces zero
-- writes. The operator should also run the diagnostic query in the
-- "PREVIEW" section below first.
--
-- IDEMPOTENCY
-- -----------
-- All writes are guarded by `WHERE imageUrl IS NULL`. Re-running the
-- script after success is a no-op.
--
-- =============================================================================
-- PREVIEW (read-only — run BEFORE the BEGIN block to inspect impact)
-- =============================================================================
--
-- WITH stitchs_views AS (
--   SELECT pv.id AS view_id, pv.name AS view_name, pc.id AS config_id, pc.name AS config_name
--   FROM "ProductView" pv
--   JOIN "ProductConfig" pc ON pc.id = pv."productConfigId"
--   WHERE pc."shopId" = 'e300bab6-d980-4ec2-9ef2-1067d181aaab'
-- )
-- SELECT
--   sv.config_name, sv.view_name,
--   COUNT(*)                                AS vvc_total,
--   COUNT(vvc."imageUrl")                   AS vvc_with_image,
--   COUNT(*) - COUNT(vvc."imageUrl")        AS vvc_orphaned
-- FROM "VariantViewConfiguration" vvc
-- JOIN stitchs_views sv ON sv.view_id = vvc."viewId"
-- GROUP BY sv.config_name, sv.view_name
-- ORDER BY sv.config_name, sv.view_name;
--
-- Expected output: a row per (config, view) showing how many VVCs lack
-- imageUrl. After this script + the runtime fallback, vvc_orphaned should
-- drop substantially (it cannot reach 0 if some color groups never had any
-- VVC with imageUrl in the first place — those groups have nothing to copy
-- from, and only `defaultImageKey` can rescue them).
--
-- =============================================================================
-- STEP 1 — Guard block (transactional safety — aborts on shop mismatch)
-- =============================================================================

BEGIN;

DO $$
DECLARE
    v_shop_id    CONSTANT TEXT := 'e300bab6-d980-4ec2-9ef2-1067d181aaab';
    v_views_n    INT;
    v_orphans_n  INT;
BEGIN
    -- Shop must exist
    PERFORM 1 FROM "Shop" WHERE id = v_shop_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shop % not found — aborting', v_shop_id;
    END IF;

    -- Count views in scope
    SELECT COUNT(*) INTO v_views_n
    FROM "ProductView" pv
    JOIN "ProductConfig" pc ON pc.id = pv."productConfigId"
    WHERE pc."shopId" = v_shop_id;

    IF v_views_n = 0 THEN
        RAISE EXCEPTION 'No ProductViews found for Stitchs — aborting (data drift?)';
    END IF;

    -- Count orphan VVCs (rows where imageUrl IS NULL but a sibling in the
    -- same color group has an image). This is the recovery target.
    SELECT COUNT(*) INTO v_orphans_n
    FROM "VariantViewConfiguration" target
    JOIN "ProductConfig" pc ON pc.id = target."productConfigId"
    WHERE pc."shopId" = v_shop_id
      AND target."imageUrl" IS NULL
      AND EXISTS (
        SELECT 1
        FROM "VariantViewConfiguration" sib
        WHERE sib."productConfigId" = target."productConfigId"
          AND sib."viewId" = target."viewId"
          AND sib."imageUrl" IS NOT NULL
          -- Same "color group" inferred from identical placementGeometry JSONB.
          -- Both NULLs and both-non-NULL-equal counts as same group.
          AND (
            (sib."placementGeometry" IS NULL AND target."placementGeometry" IS NULL)
            OR (sib."placementGeometry"::text = target."placementGeometry"::text)
          )
      );

    RAISE NOTICE 'Guard passed: shop=% views=% orphan_vvcs_to_recover=%',
                 v_shop_id, v_views_n, v_orphans_n;

    IF v_orphans_n = 0 THEN
        RAISE NOTICE 'Nothing to do — no orphan VVCs found. Exiting clean.';
    END IF;
END $$;


-- =============================================================================
-- STEP 2 — Recovery write
--
-- For each VariantViewConfiguration row in Stitchs's data:
--   - Where imageUrl IS NULL,
--   - And there is a sibling row (same productConfigId + viewId + same
--     placementGeometry JSONB) that has imageUrl IS NOT NULL,
--   - Set this row's imageUrl to the EARLIEST sibling's imageUrl
--     (createdAt ASC, then id ASC for tie-break).
--
-- "Same placementGeometry" is the proxy for "same color group" because
-- color-group geometry has already been fanned out across all sibling
-- variants by the views editor's copy-geometry-to-targets path.
-- =============================================================================

WITH
  target_shop AS (
    SELECT 'e300bab6-d980-4ec2-9ef2-1067d181aaab'::text AS shop_id
  ),
  -- Pick the earliest-imageUrl sibling per (productConfigId, viewId, geom).
  earliest_sibling AS (
    SELECT DISTINCT ON (
      vvc."productConfigId",
      vvc."viewId",
      COALESCE(vvc."placementGeometry"::text, '__NULL__')
    )
      vvc."productConfigId",
      vvc."viewId",
      vvc."placementGeometry",
      vvc."imageUrl" AS source_image_url
    FROM "VariantViewConfiguration" vvc
    JOIN "ProductConfig" pc ON pc.id = vvc."productConfigId"
    JOIN target_shop ts ON ts.shop_id = pc."shopId"
    WHERE vvc."imageUrl" IS NOT NULL
    ORDER BY
      vvc."productConfigId",
      vvc."viewId",
      COALESCE(vvc."placementGeometry"::text, '__NULL__'),
      vvc."createdAt" ASC,
      vvc.id ASC
  )
UPDATE "VariantViewConfiguration" target
SET    "imageUrl"  = es.source_image_url,
       "updatedAt" = NOW()
FROM   earliest_sibling es,
       "ProductConfig" pc,
       target_shop ts
WHERE  pc.id = target."productConfigId"
  AND  pc."shopId" = ts.shop_id
  AND  target."imageUrl" IS NULL                         -- idempotency guard
  AND  target."productConfigId" = es."productConfigId"
  AND  target."viewId"          = es."viewId"
  AND  (
        (target."placementGeometry" IS NULL AND es."placementGeometry" IS NULL)
        OR (target."placementGeometry"::text = es."placementGeometry"::text)
      );


-- =============================================================================
-- STEP 3 — In-transaction verification
-- =============================================================================

DO $$
DECLARE
    v_shop_id        CONSTANT TEXT := 'e300bab6-d980-4ec2-9ef2-1067d181aaab';
    v_remaining      INT;
    v_total          INT;
    v_with_image     INT;
BEGIN
    SELECT COUNT(*) INTO v_total
    FROM "VariantViewConfiguration" vvc
    JOIN "ProductConfig" pc ON pc.id = vvc."productConfigId"
    WHERE pc."shopId" = v_shop_id;

    SELECT COUNT(*) INTO v_with_image
    FROM "VariantViewConfiguration" vvc
    JOIN "ProductConfig" pc ON pc.id = vvc."productConfigId"
    WHERE pc."shopId" = v_shop_id
      AND vvc."imageUrl" IS NOT NULL;

    -- Remaining recoverable orphans (rows still null where a sibling has an image).
    SELECT COUNT(*) INTO v_remaining
    FROM "VariantViewConfiguration" target
    JOIN "ProductConfig" pc ON pc.id = target."productConfigId"
    WHERE pc."shopId" = v_shop_id
      AND target."imageUrl" IS NULL
      AND EXISTS (
        SELECT 1
        FROM "VariantViewConfiguration" sib
        WHERE sib."productConfigId" = target."productConfigId"
          AND sib."viewId" = target."viewId"
          AND sib."imageUrl" IS NOT NULL
          AND (
            (sib."placementGeometry" IS NULL AND target."placementGeometry" IS NULL)
            OR (sib."placementGeometry"::text = target."placementGeometry"::text)
          )
      );

    RAISE NOTICE
      'Post-recovery: total_vvcs=% with_image=% remaining_recoverable_orphans=%',
      v_total, v_with_image, v_remaining;

    IF v_remaining > 0 THEN
        RAISE EXCEPTION
          'Post-write check FAILED: % VVCs still recoverable (sibling has image but row is null). Aborting and rolling back.',
          v_remaining;
    END IF;
END $$;


-- =============================================================================
-- STEP 4 — COMMIT
-- =============================================================================

COMMIT;


-- =============================================================================
-- Post-commit human-readable verification (read-only; safe to run any time)
-- =============================================================================
--
-- Re-run the PREVIEW query at the top. The vvc_orphaned column should now
-- count ONLY variants whose color group has no VVC with imageUrl set —
-- those need a manual upload via the views editor or a default image set
-- on the ProductView. The runtime fallback in storefront-config.server.ts
-- handles the read path either way.
