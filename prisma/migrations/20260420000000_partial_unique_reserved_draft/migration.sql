-- M1: Enforce at most one RESERVED CustomizationConfig per customizationDraftId.
-- Prisma does not support partial indexes in schema.prisma, so this is a raw migration.
CREATE UNIQUE INDEX IF NOT EXISTS "CustomizationConfig_customizationDraftId_reserved_key"
  ON "CustomizationConfig" ("customizationDraftId")
  WHERE state = 'RESERVED' AND "customizationDraftId" IS NOT NULL;
