-- Apply with the existing schema operator only after method_catalog migration.
-- This script neither creates roles nor changes workers/inspection capabilities.
BEGIN;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.method_catalog TO insignia_runtime;
COMMIT;
