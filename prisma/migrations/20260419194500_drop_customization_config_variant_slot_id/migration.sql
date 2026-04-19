-- Drop the bidirectional back-pointer CustomizationConfig.variantSlotId.
-- VariantSlot.currentConfigId becomes the sole source of truth for which
-- config currently owns a slot. This eliminates the orphan-pointer class
-- of bugs (P2002 unique violations on stale historical pointers).

-- Step 1: backfill VariantSlot.currentConfigId from CustomizationConfig.variantSlotId
-- where the slot side wasn't kept in sync. Slot side wins on disagreement
-- (it's where row locks are held during /prepare).
UPDATE "VariantSlot" vs
SET "currentConfigId" = cc.id
FROM "CustomizationConfig" cc
WHERE cc."variantSlotId" = vs.id
  AND vs."currentConfigId" IS NULL;

-- Step 2: heal active orphans — RESERVED/IN_CART configs whose claimed slot
-- no longer points back at them. These are the rows that would have caused
-- P2002 on the next slot recycle. Mark EXPIRED so the storefront treats them
-- as needing a fresh prepare. Skip ORDERED/PURCHASED — those are tied to
-- real orders and the slot snapshot now lives on OrderLineCustomization.
UPDATE "CustomizationConfig" c
SET state = 'EXPIRED', "expiredAt" = NOW()
WHERE c.state IN ('RESERVED', 'IN_CART')
  AND c."variantSlotId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "VariantSlot" s
    WHERE s.id = c."variantSlotId" AND s."currentConfigId" = c.id
  );

-- Step 3: drop the FK + unique constraint + column itself.
ALTER TABLE "CustomizationConfig" DROP CONSTRAINT IF EXISTS "CustomizationConfig_variantSlotId_fkey";
DROP INDEX IF EXISTS "CustomizationConfig_variantSlotId_key";
ALTER TABLE "CustomizationConfig" DROP COLUMN "variantSlotId";

-- Step 4: re-create the FK on VariantSlot.currentConfigId now that the
-- relation is owned by the slot side. The unique index already exists.
ALTER TABLE "VariantSlot"
  ADD CONSTRAINT "VariantSlot_currentConfigId_fkey"
  FOREIGN KEY ("currentConfigId")
  REFERENCES "CustomizationConfig"(id)
  ON DELETE SET NULL
  ON UPDATE CASCADE;
