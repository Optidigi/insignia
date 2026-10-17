-- Apply only as the reviewed schema owner after the customer privacy migration.
-- Extends the existing queue capability with one body-bound function, never raw
-- artwork, receipt-table mutations, helper execution or storage credentials.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_consume' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
  THEN RAISE EXCEPTION 'privacy existing restricted queue role required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='insignia_queue_consume')
  OR has_schema_privilege('insignia_queue_consume','public','CREATE')
  THEN RAISE EXCEPTION 'privacy queue authority is excessive'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.process_customer_privacy_inbox(uuid)'::regprocedure AND proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog'])
  THEN RAISE EXCEPTION 'privacy reviewed definer owner required'; END IF;
 IF has_table_privilege('insignia_queue_consume','public.customer_privacy_receipts','INSERT,UPDATE,DELETE,TRUNCATE')
  OR has_table_privilege('insignia_queue_consume','public.customer_order_erasure_fences','INSERT,UPDATE,DELETE,TRUNCATE')
  OR has_column_privilege('insignia_queue_consume','public.artwork_assets','original_key','SELECT')
  THEN RAISE EXCEPTION 'privacy queue private authority is excessive'; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO insignia_queue_consume;
GRANT EXECUTE ON FUNCTION public.process_customer_privacy_inbox(uuid) TO insignia_queue_consume;
COMMIT;
