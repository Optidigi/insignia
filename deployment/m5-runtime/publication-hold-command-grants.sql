-- #466 part A: the owner-run publication hold command's own database identity. Schema owner only,
-- after migration 65 and scripts/database/publication-operator-role.sql:
--   psql -v ON_ERROR_STOP=1 -v command_role=insignia_publication_hold -f publication-hold-command-grants.sql
-- The LOGIN role is created beforehand from private custody (its password exists only in the host's
-- private command file; see the runtime README, #466 part A). This file creates no role and sets
-- no password. The identity gets the operator role (EXECUTE on m5_operator_claim_abandoned_hold) and
-- only what inspect, B's restore and finalize, the observation-only resolution and offline-token
-- acquisition read or write. Never the abandonment audit, the restoration consumptions, signing
-- keys, the queue or any runtime role.
BEGIN;
SELECT set_config('insignia.command_role', :'command_role', true);
DO $$ DECLARE role text := current_setting('insignia.command_role'); BEGIN
 IF to_regprocedure('public.m5_operator_claim_abandoned_hold(text,text,text,bigint,text,text)') IS NULL
 OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname='insignia_publication_operator') THEN
  RAISE EXCEPTION 'migration 65 and publication-operator-role.sql are required';
 END IF;
 IF EXISTS (SELECT FROM pg_class WHERE oid='public.m5_activation_state'::regclass
   AND relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN
  RAISE EXCEPTION 'the schema owner is required';
 END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname=role AND rolcanlogin
   AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
  RAISE EXCEPTION 'the command role must be an existing unprivileged LOGIN role';
 END IF;
 IF role IN ('insignia_runtime','insignia_worker','insignia_signer','insignia_queue_consume','insignia_queue_enqueue',
   'insignia_artwork_worker','insignia_artwork_inspect','insignia_publication_operator') THEN
  RAISE EXCEPTION 'the command role must be its own identity, not a runtime role';
 END IF;
 IF EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member JOIN pg_roles g ON g.oid=m.roleid
   WHERE r.rolname=role AND g.rolname<>'insignia_publication_operator') THEN
  RAISE EXCEPTION 'the command role must hold no other role';
 END IF;
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), role);
 EXECUTE format('GRANT insignia_publication_operator TO %I', role);
END $$;
GRANT USAGE ON SCHEMA public TO :"command_role";
-- Inspect, B's six-row lock, the resolution and the triggers they fire.
GRANT SELECT ON public.shops, public.installation_generations, public.product_configs, public.publication_operations,
  public.m4_publication_progress, public.m5_activation_state, public.m5_current_publication_pointer,
  public.m5_availability_resolutions, public.m5_activation_evidence TO :"command_role";
-- Row locks (FOR UPDATE) need UPDATE on one column; these columns carry no authority.
GRANT UPDATE(updated_at) ON public.shops, public.product_configs TO :"command_role";
GRANT UPDATE(activated_at) ON public.installation_generations TO :"command_role";
-- B's T2/T3 and the observation-only resolution; the triggers decide every transition.
GRANT UPDATE(kind, version, hold, resolution_digest) ON public.m5_activation_state TO :"command_role";
GRANT UPDATE(phase, version) ON public.m4_publication_progress TO :"command_role";
GRANT UPDATE(status, failed_at, failure_class, availability_resolved_at) ON public.publication_operations TO :"command_role";
GRANT DELETE ON public.m5_current_publication_pointer TO :"command_role";
GRANT INSERT ON public.m5_availability_resolutions TO :"command_role";
-- The shop's offline token through the fenced refresh lifecycle (as the worker).
GRANT SELECT, UPDATE ON public.shop_credentials TO :"command_role";
GRANT SELECT ON public.shop_credential_acquisitions TO :"command_role";
DO $$ DECLARE role text := current_setting('insignia.command_role'); BEGIN
 IF NOT has_function_privilege(role,'public.m5_operator_claim_abandoned_hold(text,text,text,bigint,text,text)','EXECUTE')
 OR has_table_privilege(role,'public.m5_publication_abandonment_audit','SELECT,INSERT,UPDATE,DELETE')
 OR has_table_privilege(role,'public.m5_restoration_no_dispatch_consumptions','SELECT,INSERT,UPDATE,DELETE')
 OR has_table_privilege(role,'public.signing_keys','SELECT,INSERT,UPDATE,DELETE')
 OR has_column_privilege(role,'public.installation_generations','deactivated_at','UPDATE')
 OR has_column_privilege(role,'public.shops','current_generation','UPDATE')
 OR has_table_privilege(role,'public.publication_operations','INSERT,DELETE') THEN
  RAISE EXCEPTION 'publication hold command grants are not least privilege';
 END IF;
END $$;
COMMIT;
