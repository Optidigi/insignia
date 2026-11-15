-- Existing installation delta for migration 69 (#491): schema owner only, no role creation, no revocation.
-- Grants the worker's NOLOGIN queue capability UPDATE on the one new column, written when an order receipt's
-- attempt fails. A fresh installation gets the same grant from scripts/database/purchase-runtime-grants.sql.
BEGIN;
SET LOCAL search_path=public,pg_catalog;
DO $$ BEGIN
  IF to_regclass('public.inbox_messages') IS NULL
    OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inbox_messages'
      AND column_name='next_attempt_at')
    OR (SELECT relowner FROM pg_class WHERE oid='public.inbox_messages'::regclass)<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
  THEN RAISE EXCEPTION 'migration 69 and the schema owner are required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_consume' AND NOT
      (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'qualified_existing_queue_consume_role_required';
  END IF;
END $$;
GRANT UPDATE(next_attempt_at) ON public.inbox_messages TO insignia_queue_consume;
DO $$ BEGIN
  IF NOT has_column_privilege('insignia_queue_consume','public.inbox_messages','next_attempt_at','UPDATE') THEN
    RAISE EXCEPTION 'order_receipt_backoff_grant_missing';
  END IF;
  -- Raw receipt bytes and their erasure stay outside the queue capability.
  IF has_column_privilege('insignia_queue_consume','public.inbox_messages','payload','UPDATE')
    OR has_column_privilege('insignia_queue_consume','public.inbox_messages','erasure_state','UPDATE') THEN
    RAISE EXCEPTION 'unqualified_queue_receipt_mutation';
  END IF;
END $$;
COMMIT;
