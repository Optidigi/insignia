-- Owner-applied after migration27. Cleanup-only: no purchase/order reconciliation, credential, login, data access or deployment grant is created.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_consume') THEN RAISE EXCEPTION 'existing_queue_consume_role_required'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_consume'
    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolcanlogin)) THEN RAISE EXCEPTION 'unqualified_purchase_cleanup_role'; END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
    WHERE r.rolname='insignia_queue_consume') THEN RAISE EXCEPTION 'unqualified_purchase_cleanup_membership'; END IF;
  IF (SELECT proowner FROM pg_proc WHERE oid='public.cleanup_purchase_payloads(integer)'::regprocedure)
    <> (SELECT oid FROM pg_roles WHERE rolname=current_user) THEN RAISE EXCEPTION 'purchase_cleanup_function_owner_required'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.cleanup_purchase_payloads(integer) FROM PUBLIC, insignia_queue_consume;
GRANT USAGE ON SCHEMA public TO insignia_queue_consume;
GRANT EXECUTE ON FUNCTION public.cleanup_purchase_payloads(integer) TO insignia_queue_consume;
COMMIT;
