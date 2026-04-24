-- =============================================================================
-- Stitchs placement-method bulk-write
-- =============================================================================
--
-- Target shop:   stitchs-nl.myshopify.com
-- Target shopId: e300bab6-d980-4ec2-9ef2-1067d181aaab
-- DB:            insignia-custom (production)
--
-- RUN CONTEXT:
--   This script MUST be run AFTER the Prisma migration
--   `20260426000000_drop_placement_step_method_price` has been applied. That
--   migration drops `PlacementStepMethodPrice` and (via the preceding
--   `20260425000000_add_placement_method_price`) creates
--   `PlacementDefinitionMethodPrice`. Both tables must be in the state
--   implied by prisma/schema.prisma HEAD before running this file.
--
-- PRE-CHECKS: run `\i stitchs-placement-method-bulk-write.sql` inside
--   `docker compose exec -T db psql ...`. The script guards itself: if
--   counts don't match expected fixtures, it raises and aborts the
--   transaction BEFORE any writes. Nothing is applied unless every guard
--   passes.
--
-- IDEMPOTENCY: all writes are UPSERT / SET-to-constant, so re-running the
--   script is safe. Running it twice yields the same post-state.
--
-- EXPECTED STITCHS FIXTURES (hard-coded in the guard below):
--   Methods:     2  (Borduren, Bedrukken)
--   Products:    7  ProductConfigs
--   Placements: 28  (7 products x 4 placements: Linkerborst, Rechterborst,
--                    Linker Schouder, Rug)
--   Steps:      56  (28 placements x 2 steps: Klein, Groot)
--   Overrides: 56  (28 placements x 2 methods) to be upserted
--
-- FEE FORMULA (post-cleanup):
--   fee = methodBase
--       + coalesce(PlacementDefinitionMethodPrice.basePriceAdjustmentCents,
--                  PlacementDefinition.basePriceAdjustmentCents)
--       + PlacementStep.priceAdjustmentCents
--
--   Since this script sets methodBase=0, placement.baseAdj=0, step.adj=0,
--   the effective fee reduces to just the override row per (placement, method).
--
-- TARGET PRICING (cents) — per placement name, per method name:
--
--     placement           | Borduren | Bedrukken
--     --------------------+----------+----------
--     Linkerborst         |    1500  |     750
--     Rechterborst        |    1500  |     750
--     Linker Schouder     |    1500  |    1000
--     Rug                 |    3000  |    1500
--
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Optional: preview (read-only) — run separately BEFORE the transaction below
-- to see what rows will be touched. Does not modify anything.
-- -----------------------------------------------------------------------------
--
-- WITH target_shop AS (
--   SELECT id AS shop_id
--   FROM "Shop"
--   WHERE id = 'e300bab6-d980-4ec2-9ef2-1067d181aaab'
-- ),
-- stitchs_placements AS (
--   SELECT pd.id, pd.name, pc.name AS product_config_name,
--          pd."basePriceAdjustmentCents" AS current_base_adj
--   FROM "PlacementDefinition" pd
--   JOIN "ProductView" pv ON pv.id = pd."productViewId"
--   JOIN "ProductConfig" pc ON pc.id = pv."productConfigId"
--   JOIN target_shop ts ON ts.shop_id = pc."shopId"
-- )
-- SELECT 'methods' AS scope, COUNT(*)::text AS n FROM "DecorationMethod" WHERE "shopId" = (SELECT shop_id FROM target_shop)
-- UNION ALL SELECT 'products',    COUNT(*)::text FROM "ProductConfig"    WHERE "shopId" = (SELECT shop_id FROM target_shop)
-- UNION ALL SELECT 'placements',  COUNT(*)::text FROM stitchs_placements
-- UNION ALL SELECT 'steps',       COUNT(*)::text FROM "PlacementStep" ps
--                                               JOIN stitchs_placements sp ON sp.id = ps."placementDefinitionId"
-- UNION ALL SELECT 'current overrides', COUNT(*)::text FROM "PlacementDefinitionMethodPrice" pdmp
--                                                     JOIN stitchs_placements sp ON sp.id = pdmp."placementDefinitionId";


-- =============================================================================
-- STEP 1 — Guard block (transactional safety — aborts on fixture mismatch)
-- STEP 2 — BEGIN transaction
-- =============================================================================

BEGIN;

DO $$
DECLARE
    v_shop_id       CONSTANT TEXT := 'e300bab6-d980-4ec2-9ef2-1067d181aaab';
    v_methods       INT;
    v_products      INT;
    v_placements    INT;
    v_steps         INT;
    v_borduren_id   TEXT;
    v_bedrukken_id  TEXT;
BEGIN
    -- Shop must exist
    PERFORM 1 FROM "Shop" WHERE id = v_shop_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shop % not found — aborting', v_shop_id;
    END IF;

    -- Methods
    SELECT COUNT(*) INTO v_methods
    FROM "DecorationMethod"
    WHERE "shopId" = v_shop_id;

    IF v_methods <> 2 THEN
        RAISE EXCEPTION 'Expected 2 DecorationMethods for Stitchs, got %', v_methods;
    END IF;

    SELECT id INTO v_borduren_id
    FROM "DecorationMethod"
    WHERE "shopId" = v_shop_id AND name = 'Borduren';

    IF v_borduren_id IS NULL THEN
        RAISE EXCEPTION 'DecorationMethod "Borduren" not found for Stitchs';
    END IF;

    SELECT id INTO v_bedrukken_id
    FROM "DecorationMethod"
    WHERE "shopId" = v_shop_id AND name = 'Bedrukken';

    IF v_bedrukken_id IS NULL THEN
        RAISE EXCEPTION 'DecorationMethod "Bedrukken" not found for Stitchs';
    END IF;

    -- Products
    SELECT COUNT(*) INTO v_products
    FROM "ProductConfig"
    WHERE "shopId" = v_shop_id;

    IF v_products <> 7 THEN
        RAISE EXCEPTION 'Expected 7 ProductConfigs for Stitchs, got %', v_products;
    END IF;

    -- Placements — only count the 4 named placements we will override
    SELECT COUNT(*) INTO v_placements
    FROM "PlacementDefinition" pd
    JOIN "ProductView"   pv ON pv.id = pd."productViewId"
    JOIN "ProductConfig" pc ON pc.id = pv."productConfigId"
    WHERE pc."shopId" = v_shop_id
      AND pd.name IN ('Linkerborst','Rechterborst','Linker Schouder','Rug');

    IF v_placements <> 28 THEN
        RAISE EXCEPTION
          'Expected 28 targeted PlacementDefinitions for Stitchs (7 products x 4 placements), got %',
          v_placements;
    END IF;

    -- Steps — 2 per targeted placement = 56
    SELECT COUNT(*) INTO v_steps
    FROM "PlacementStep" ps
    JOIN "PlacementDefinition" pd ON pd.id = ps."placementDefinitionId"
    JOIN "ProductView"   pv ON pv.id = pd."productViewId"
    JOIN "ProductConfig" pc ON pc.id = pv."productConfigId"
    WHERE pc."shopId" = v_shop_id
      AND pd.name IN ('Linkerborst','Rechterborst','Linker Schouder','Rug');

    IF v_steps <> 56 THEN
        RAISE EXCEPTION
          'Expected 56 PlacementSteps for Stitchs (28 placements x 2 steps), got %',
          v_steps;
    END IF;

    RAISE NOTICE 'Guard passed: shop=% methods=% products=% placements=% steps=%',
                 v_shop_id, v_methods, v_products, v_placements, v_steps;
END $$;


-- =============================================================================
-- STEP 3 — Reset DecorationMethod.basePriceCents to 0 for Stitchs
-- =============================================================================

UPDATE "DecorationMethod"
SET    "basePriceCents" = 0,
       "updatedAt"      = NOW()
WHERE  "shopId" = 'e300bab6-d980-4ec2-9ef2-1067d181aaab';


-- =============================================================================
-- STEP 4 — Reset PlacementDefinition.basePriceAdjustmentCents to 0
--          (scoped via placement -> view -> config -> shop)
-- =============================================================================

UPDATE "PlacementDefinition" pd
SET    "basePriceAdjustmentCents" = 0,
       "updatedAt"                = NOW()
FROM   "ProductView"   pv,
       "ProductConfig" pc
WHERE  pv.id = pd."productViewId"
  AND  pc.id = pv."productConfigId"
  AND  pc."shopId" = 'e300bab6-d980-4ec2-9ef2-1067d181aaab';


-- =============================================================================
-- STEP 5 — Reset PlacementStep.priceAdjustmentCents to 0 for Stitchs steps
-- =============================================================================

UPDATE "PlacementStep" ps
SET    "priceAdjustmentCents" = 0,
       "updatedAt"            = NOW()
FROM   "PlacementDefinition" pd,
       "ProductView"   pv,
       "ProductConfig" pc
WHERE  pd.id = ps."placementDefinitionId"
  AND  pv.id = pd."productViewId"
  AND  pc.id = pv."productConfigId"
  AND  pc."shopId" = 'e300bab6-d980-4ec2-9ef2-1067d181aaab';


-- =============================================================================
-- STEP 6 — Upsert PlacementDefinitionMethodPrice rows per pricelist
--
-- For each of the 7 products, for each of the 4 named placements, insert
-- one override row per method. 7 * 4 * 2 = 56 rows upserted.
--
-- ON CONFLICT ... DO UPDATE makes this idempotent.
-- =============================================================================

WITH
  target_shop AS (
    SELECT 'e300bab6-d980-4ec2-9ef2-1067d181aaab'::text AS shop_id
  ),
  methods AS (
    SELECT
      MAX(id) FILTER (WHERE name = 'Borduren')  AS borduren_id,
      MAX(id) FILTER (WHERE name = 'Bedrukken') AS bedrukken_id
    FROM "DecorationMethod"
    WHERE "shopId" = (SELECT shop_id FROM target_shop)
  ),
  stitchs_placements AS (
    SELECT pd.id, pd.name
    FROM   "PlacementDefinition" pd
    JOIN   "ProductView"   pv ON pv.id = pd."productViewId"
    JOIN   "ProductConfig" pc ON pc.id = pv."productConfigId"
    WHERE  pc."shopId" = (SELECT shop_id FROM target_shop)
      AND  pd.name IN ('Linkerborst','Rechterborst','Linker Schouder','Rug')
  ),
  price_map(placement_name, method_key, cents) AS (
    VALUES
      ('Linkerborst',      'borduren',  1500),
      ('Linkerborst',      'bedrukken',  750),
      ('Rechterborst',     'borduren',  1500),
      ('Rechterborst',     'bedrukken',  750),
      ('Linker Schouder',  'borduren',  1500),
      ('Linker Schouder',  'bedrukken', 1000),
      ('Rug',              'borduren',  3000),
      ('Rug',              'bedrukken', 1500)
  ),
  rows_to_write AS (
    SELECT
      sp.id AS placement_definition_id,
      CASE pm.method_key
        WHEN 'borduren'  THEN m.borduren_id
        WHEN 'bedrukken' THEN m.bedrukken_id
      END AS decoration_method_id,
      pm.cents AS base_price_adjustment_cents
    FROM stitchs_placements sp
    JOIN price_map pm ON pm.placement_name = sp.name
    CROSS JOIN methods m
  )
INSERT INTO "PlacementDefinitionMethodPrice"
  ("placementDefinitionId", "decorationMethodId", "basePriceAdjustmentCents")
SELECT
  placement_definition_id,
  decoration_method_id,
  base_price_adjustment_cents
FROM rows_to_write
ON CONFLICT ("placementDefinitionId", "decorationMethodId")
DO UPDATE SET "basePriceAdjustmentCents" = EXCLUDED."basePriceAdjustmentCents";


-- =============================================================================
-- STEP 7 — In-transaction verification: sanity-check write count
-- =============================================================================

DO $$
DECLARE
    v_shop_id     CONSTANT TEXT := 'e300bab6-d980-4ec2-9ef2-1067d181aaab';
    v_overrides   INT;
BEGIN
    SELECT COUNT(*) INTO v_overrides
    FROM   "PlacementDefinitionMethodPrice" pdmp
    JOIN   "PlacementDefinition" pd ON pd.id = pdmp."placementDefinitionId"
    JOIN   "ProductView"   pv ON pv.id = pd."productViewId"
    JOIN   "ProductConfig" pc ON pc.id = pv."productConfigId"
    WHERE  pc."shopId" = v_shop_id
      AND  pd.name IN ('Linkerborst','Rechterborst','Linker Schouder','Rug');

    IF v_overrides <> 56 THEN
        RAISE EXCEPTION
          'Post-write verification failed: expected 56 override rows, got %',
          v_overrides;
    END IF;

    RAISE NOTICE 'Post-write verification: % override rows present (expected 56)', v_overrides;
END $$;


-- =============================================================================
-- STEP 8 — COMMIT
-- =============================================================================

COMMIT;


-- =============================================================================
-- Post-commit human-readable verification (read-only; safe to run any time)
-- =============================================================================
--
-- A. Effective decoration fee per product x placement x method:
--
-- WITH target_shop AS (
--   SELECT 'e300bab6-d980-4ec2-9ef2-1067d181aaab'::text AS shop_id
-- )
-- SELECT
--   pc.name                                               AS product,
--   pd.name                                               AS placement,
--   dm.name                                               AS method,
--   dm."basePriceCents"                                   AS method_base,
--   COALESCE(pdmp."basePriceAdjustmentCents",
--            pd."basePriceAdjustmentCents")               AS placement_adj,
--   ps."priceAdjustmentCents"                             AS step_adj,
--   ps.label                                              AS step_label,
--   dm."basePriceCents"
--     + COALESCE(pdmp."basePriceAdjustmentCents",
--                pd."basePriceAdjustmentCents")
--     + ps."priceAdjustmentCents"                         AS effective_fee_cents
-- FROM "ProductConfig" pc
-- JOIN "ProductView"          pv   ON pv.id = (SELECT id FROM "ProductView" WHERE "productConfigId" = pc.id LIMIT 1)
-- JOIN "PlacementDefinition"  pd   ON pd."productViewId" = pv.id
-- JOIN "PlacementStep"        ps   ON ps."placementDefinitionId" = pd.id
-- CROSS JOIN "DecorationMethod" dm
-- LEFT JOIN "PlacementDefinitionMethodPrice" pdmp
--        ON pdmp."placementDefinitionId" = pd.id
--       AND pdmp."decorationMethodId"    = dm.id
-- WHERE pc."shopId" = (SELECT shop_id FROM target_shop)
--   AND dm."shopId" = (SELECT shop_id FROM target_shop)
--   AND pd.name IN ('Linkerborst','Rechterborst','Linker Schouder','Rug')
-- ORDER BY pc.name, pd.name, dm.name, ps."displayOrder";
--
--
-- B. Confirm no targeted placement is missing an override:
--
-- WITH target_shop AS (
--   SELECT 'e300bab6-d980-4ec2-9ef2-1067d181aaab'::text AS shop_id
-- ),
-- stitchs_pairs AS (
--   SELECT pd.id AS placement_id, pd.name AS placement_name,
--          dm.id AS method_id,    dm.name AS method_name
--   FROM "PlacementDefinition" pd
--   JOIN "ProductView"   pv ON pv.id = pd."productViewId"
--   JOIN "ProductConfig" pc ON pc.id = pv."productConfigId"
--   CROSS JOIN "DecorationMethod" dm
--   WHERE pc."shopId" = (SELECT shop_id FROM target_shop)
--     AND dm."shopId" = (SELECT shop_id FROM target_shop)
--     AND pd.name IN ('Linkerborst','Rechterborst','Linker Schouder','Rug')
-- )
-- SELECT sp.placement_name, sp.method_name
-- FROM   stitchs_pairs sp
-- LEFT JOIN "PlacementDefinitionMethodPrice" pdmp
--        ON pdmp."placementDefinitionId" = sp.placement_id
--       AND pdmp."decorationMethodId"    = sp.method_id
-- WHERE pdmp."placementDefinitionId" IS NULL;
-- -- expected: 0 rows.
--
--
-- C. Orphan check — every override points at a Stitchs placement + method:
--
-- SELECT pdmp.*
-- FROM   "PlacementDefinitionMethodPrice" pdmp
-- LEFT JOIN "PlacementDefinition" pd ON pd.id = pdmp."placementDefinitionId"
-- LEFT JOIN "DecorationMethod"    dm ON dm.id = pdmp."decorationMethodId"
-- WHERE pd.id IS NULL OR dm.id IS NULL;
-- -- expected: 0 rows. (FK constraints should also guarantee this.)
