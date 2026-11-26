-- Separate owner operation AFTER install-queue.mts. pg-boss 12.40.0 / schema 48 only.
-- No passwords, login provisioning, application-table grants, upgrades or destructive down.
BEGIN;
DO $$ BEGIN
  IF (SELECT count(*) FROM pgboss.version) <> 1 OR (SELECT version FROM pgboss.version) <> 48 THEN
    RAISE EXCEPTION 'unreviewed_queue_version';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname='pgboss' AND n.nspowner <> (SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN
    RAISE EXCEPTION 'queue_schema_owner_required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_enqueue') THEN
    CREATE ROLE insignia_queue_enqueue NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_consume') THEN
    CREATE ROLE insignia_queue_consume NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('insignia_queue_enqueue','insignia_queue_consume')
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'unqualified_queue_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname IN ('insignia_queue_enqueue','insignia_queue_consume')) THEN
    RAISE EXCEPTION 'unqualified_queue_role_membership';
  END IF;
END $$;
REVOKE ALL ON SCHEMA pgboss FROM PUBLIC, insignia_queue_enqueue, insignia_queue_consume;
REVOKE ALL ON ALL TABLES IN SCHEMA pgboss FROM PUBLIC, insignia_queue_enqueue, insignia_queue_consume;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pgboss FROM PUBLIC, insignia_queue_enqueue, insignia_queue_consume;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgboss FROM PUBLIC, insignia_queue_enqueue, insignia_queue_consume;
GRANT USAGE ON SCHEMA pgboss TO insignia_queue_enqueue, insignia_queue_consume;
GRANT USAGE ON TYPE pgboss.job_state TO insignia_queue_enqueue, insignia_queue_consume;
GRANT EXECUTE ON FUNCTION pgboss.job_now() TO insignia_queue_enqueue, insignia_queue_consume;
GRANT SELECT ON pgboss.version, pgboss.queue, pgboss.job, pgboss.job_common TO insignia_queue_enqueue, insignia_queue_consume;
-- Retain the existing queue-schema capability boundary. Runtime never retries a
-- terminal job explicitly; application durable reservation prevents new budgets.
-- This is a queue-schema capability boundary, not per-operation or per-job row isolation.
GRANT INSERT, UPDATE ON pgboss.job, pgboss.job_common TO insignia_queue_enqueue;
GRANT INSERT, UPDATE, DELETE ON pgboss.job, pgboss.job_common TO insignia_queue_consume;
GRANT SELECT, DELETE ON pgboss.job_dependency TO insignia_queue_consume;
GRANT SELECT, INSERT, DELETE ON pgboss.warning TO insignia_queue_consume;
-- Supervision prunes the instance registry even when registration is disabled.
-- UPDATE(id) supplies the row-lock privilege used during pruning.
GRANT DELETE ON pgboss.instance TO insignia_queue_consume;
GRANT SELECT(id, started_on, stopped_on, heartbeat_on, heartbeat_seconds), UPDATE(id)
  ON pgboss.instance TO insignia_queue_consume;
GRANT UPDATE(flow_on, monitor_backoff_on) ON pgboss.version TO insignia_queue_consume;
GRANT UPDATE(deferred_count, queued_count, ready_count, active_count, failed_count, total_count,
  created_delta, completed_delta, failed_delta, delta_on, delta_seconds, ready_history,
  singletons_active, monitor_claim_on, monitor_on, maintain_on, blocked_count,
  retained_count, retained_on) ON pgboss.queue TO insignia_queue_consume;
-- PUBLIC defaults for newly created objects owned by this installer are closed as well.
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- Existing M3 uninstall/credential consumers, through the reviewed durable repositories.
-- Row locks need UPDATE on at least one column; shops identity/generation cannot be rewritten.
GRANT USAGE ON SCHEMA public TO insignia_queue_consume;
GRANT SELECT ON public.shops, public.installation_generations, public.shop_credentials,
  public.inbox_messages, public.shopify_webhook_deliveries, public.product_configs,
  public.publication_operations TO insignia_queue_consume;
-- Credential acquisition checks the issuance fence even on a fresh install where
-- this capability role was created after the credential migration. Read only.
GRANT SELECT ON public.shop_credential_acquisitions TO insignia_queue_consume;
GRANT UPDATE(updated_at) ON public.shops TO insignia_queue_consume;
GRANT UPDATE(deactivated_at) ON public.installation_generations TO insignia_queue_consume;
GRANT UPDATE ON public.shop_credentials TO insignia_queue_consume;
GRANT UPDATE(shop_id, installation_generation, state, attempts, last_error_class) ON public.inbox_messages TO insignia_queue_consume;
-- Raw-body erasure stays outside the queue role. The purchase grant script owns
-- lease updates, so replaying the baseline must preserve any grants it installed.
REVOKE UPDATE(payload, erasure_state) ON public.inbox_messages FROM insignia_queue_consume;
GRANT UPDATE(queue_handoff_state, queue_cleanup_pending, queue_recovery_selected_at) ON public.shopify_webhook_deliveries TO insignia_queue_consume;
GRANT UPDATE(effective_revision_id, effective_operation_id, updated_at) ON public.product_configs TO insignia_queue_consume;
-- A later qualified retention migration supplies only fixed-expiry executors.
-- No direct payload UPDATE or unexpired/Shop-wide erasure authority is granted.
DO $$ BEGIN
 IF to_regprocedure('public.expire_shopify_webhook_bytes(uuid)') IS NOT NULL THEN
  GRANT EXECUTE ON FUNCTION public.expire_shopify_webhook_bytes(uuid), public.expire_shopify_webhook_facts(integer), public.pending_shopify_webhook_obligations(integer) TO insignia_queue_consume;
 END IF;
END $$;
-- #466 B (schema 65): the abandoned-hold pass locks the six publication rows, claims and settles the
-- activation row, finalizes progress and operation and clears that request's current pointer.
-- Triggers guard every transition; the audit and the operator claim function stay owner-only.
DO $$ BEGIN
 IF to_regclass('public.m5_publication_abandonment_audit') IS NOT NULL THEN
  GRANT SELECT ON public.m5_activation_state, public.m4_publication_progress TO insignia_queue_consume;
  GRANT UPDATE(kind, version, hold) ON public.m5_activation_state TO insignia_queue_consume;
  GRANT UPDATE(phase, version) ON public.m4_publication_progress TO insignia_queue_consume;
  GRANT UPDATE(status, failed_at, failure_class, availability_resolved_at) ON public.publication_operations TO insignia_queue_consume;
  GRANT SELECT, DELETE ON public.m5_current_publication_pointer TO insignia_queue_consume;
  -- Read by the existing invoker transition triggers the pass fires.
  GRANT SELECT ON public.m5_availability_resolutions, public.m5_activation_evidence TO insignia_queue_consume;
 END IF;
END $$;
COMMIT;
