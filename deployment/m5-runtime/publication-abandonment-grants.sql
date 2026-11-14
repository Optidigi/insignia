-- Existing installation delta for migration 65 (#466 B): schema owner only, no role creation.
-- Explicit psql identifier worker_role names the existing queue capability (insignia_queue_consume);
-- the same lines are in scripts/worker/queue-roles.sql for a fresh installation.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.m5_publication_abandonment_audit') IS NULL
 OR EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.m5_activation_state'::regclass,'public.m4_publication_progress'::regclass,
   'public.publication_operations'::regclass,'public.m5_current_publication_pointer'::regclass)
   AND relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user))
 THEN RAISE EXCEPTION 'migration 65 and the schema owner are required'; END IF;
END $$;
GRANT SELECT, UPDATE ON public.m5_activation_state, public.m4_publication_progress TO :"worker_role";
GRANT UPDATE(status, failed_at, failure_class, availability_resolved_at) ON public.publication_operations TO :"worker_role";
GRANT SELECT, DELETE ON public.m5_current_publication_pointer TO :"worker_role";
GRANT SELECT ON public.m5_availability_resolutions, public.m5_activation_evidence TO :"worker_role";
-- Never: the audit table, the restoration consumptions or the operator claim function.
SELECT set_config('insignia.grant_check_role', :'worker_role', true);
DO $$ DECLARE role text:=current_setting('insignia.grant_check_role'); BEGIN
 IF has_table_privilege(role,'public.m5_publication_abandonment_audit','SELECT,INSERT,UPDATE,DELETE')
 OR has_table_privilege(role,'public.m5_restoration_no_dispatch_consumptions','SELECT,INSERT,UPDATE,DELETE')
 OR has_function_privilege(role,'public.m5_operator_claim_abandoned_hold(text,text,text,bigint,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'worker role must not reach the abandonment audit or operator claim'; END IF;
END $$;
COMMIT;
