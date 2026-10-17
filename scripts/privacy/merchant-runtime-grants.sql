-- Schema owner only. Adds only bounded, tenant/generation-fenced read functions
-- to the existing authenticated web login. No privacy mutation or helper grant.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='insignia_runtime' AND rolcanlogin AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
  OR has_schema_privilege('insignia_runtime','public','CREATE')
  THEN RAISE EXCEPTION 'qualified existing web login required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid IN (
   'public.read_customer_privacy_requests(text,bigint,uuid,uuid)'::regprocedure,
   'public.read_customer_privacy_order_links(text,bigint,uuid)'::regprocedure,
   'public.export_customer_privacy_order(text,bigint,uuid,uuid,uuid)'::regprocedure)
   AND (proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user) OR NOT prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']))
  THEN RAISE EXCEPTION 'reviewed owner read functions required'; END IF;
 IF has_function_privilege('insignia_runtime','public.process_customer_privacy_inbox(uuid)','EXECUTE')
  OR has_table_privilege('insignia_runtime','public.customer_privacy_receipts','INSERT,UPDATE,DELETE,TRUNCATE')
  OR has_table_privilege('insignia_runtime','public.shop_privacy_fences','INSERT,UPDATE,DELETE,TRUNCATE')
  THEN RAISE EXCEPTION 'web privacy authority is excessive'; END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.read_customer_privacy_requests(text,bigint,uuid,uuid),public.read_customer_privacy_order_links(text,bigint,uuid),public.export_customer_privacy_order(text,bigint,uuid,uuid,uuid) TO insignia_runtime;
COMMIT;
