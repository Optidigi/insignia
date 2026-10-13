-- Owner operation after the qualified31 migrations and M6 capability grants.
-- inspection_password is generated/stored privately; never pass it on a CLI argv.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path=public,pg_catalog;
DO $$ BEGIN
  IF current_database()<>'insignia_rewrite' OR current_user<>'insignia_rewrite' THEN
    RAISE EXCEPTION 'exact_rewrite_owner_required';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='insignia_artwork_worker') THEN
    RAISE EXCEPTION 'existing_inspection_login_requires_reconciliation';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='insignia_artwork_inspect'
    AND NOT(rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'qualified_inspection_capability_required';
  END IF;
END $$;
CREATE ROLE insignia_artwork_worker LOGIN PASSWORD :'inspection_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;
GRANT insignia_artwork_inspect TO insignia_artwork_worker;
COMMIT;
