-- Existing installation delta for migration 67 (#474): schema owner only, no role creation, no revocation.
-- Grants the host inspector's NOLOGIN capability UPDATE on exactly the six cleanup bookkeeping columns.
-- A fresh installation gets the same columns from scripts/database/artwork-runtime-grants.sql. That file is not
-- re-applied on an existing installation: its access check refuses the later merchant-preview grants
-- (deployment/m8-journey/merchant-preview-runtime-grants.sql) that the inspector legitimately holds.
BEGIN;
SET LOCAL search_path=public,pg_catalog;
DO $$ BEGIN
  IF to_regclass('public.artwork_assets') IS NULL
    OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='artwork_assets'
      AND column_name='quarantine_cleanup_review_at')
    OR (SELECT relowner FROM pg_class WHERE oid='public.artwork_assets'::regclass)<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
  THEN RAISE EXCEPTION 'migration 67 and the schema owner are required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='insignia_artwork_inspect' AND NOT
      (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'qualified_existing_artwork_inspect_role_required';
  END IF;
END $$;
GRANT UPDATE(cleanup_attempts, cleanup_failure, cleanup_review_at,
  quarantine_cleanup_attempts, quarantine_cleanup_failure, quarantine_cleanup_review_at)
  ON public.artwork_assets TO insignia_artwork_inspect;
DO $$ DECLARE column_name text; BEGIN
  FOREACH column_name IN ARRAY ARRAY['cleanup_attempts','cleanup_failure','cleanup_review_at',
    'quarantine_cleanup_attempts','quarantine_cleanup_failure','quarantine_cleanup_review_at'] LOOP
    IF NOT has_column_privilege('insignia_artwork_inspect','public.artwork_assets',column_name,'UPDATE') THEN
      RAISE EXCEPTION 'artwork_cleanup_backoff_grant_missing';
    END IF;
  END LOOP;
  -- The capability stays a NOLOGIN role without signing-key or credential access.
  IF has_column_privilege('insignia_artwork_inspect','public.signing_keys','private_envelope','SELECT')
    OR has_table_privilege('insignia_artwork_inspect','public.shop_credentials','SELECT') THEN
    RAISE EXCEPTION 'unqualified_artwork_private_access';
  END IF;
END $$;
COMMIT;
