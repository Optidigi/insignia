-- Separate owner operation after migration31; no login creation or deployment authority.
-- Extends the existing queue capability with purchase reconciliation, not merchant artwork writes.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_consume') THEN RAISE EXCEPTION 'existing_queue_consume_role_required'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_consume'
    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolcanlogin)) THEN RAISE EXCEPTION 'unqualified_purchase_runtime_role'; END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
    WHERE r.rolname='insignia_queue_consume') THEN RAISE EXCEPTION 'unqualified_purchase_runtime_membership'; END IF;
  IF (SELECT proowner FROM pg_proc WHERE oid='public.cleanup_purchase_payloads(integer)'::regprocedure)
    <> (SELECT oid FROM pg_roles WHERE rolname=current_user) THEN RAISE EXCEPTION 'purchase_cleanup_function_owner_required'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.purchase_orders'::regclass,'public.purchase_bindings'::regclass,'public.purchase_lines'::regclass,'public.purchase_design_payloads'::regclass,'public.purchase_observations'::regclass,'public.purchase_paid_facts'::regclass,'public.purchase_refund_facts'::regclass,'public.purchase_reconciliation_cursors'::regclass) AND relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN RAISE EXCEPTION 'purchase_table_owner_required'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc WHERE oid IN ('public.read_purchase_offer_history(text,bigint,uuid,uuid)'::regprocedure,'public.read_purchase_revision_history(text,bigint,uuid,uuid,text,text)'::regprocedure) AND (proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user) OR NOT prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'])) THEN RAISE EXCEPTION 'purchase_history_function_owner_required'; END IF;
  IF has_column_privilege('insignia_queue_consume','public.signing_keys','private_envelope','SELECT') OR has_table_privilege('insignia_queue_consume','public.buyer_sessions','SELECT') OR has_table_privilege('insignia_queue_consume','public.quote_proposals','SELECT') THEN RAISE EXCEPTION 'unqualified_purchase_private_access'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname='insignia_queue_consume') OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE r.rolname='insignia_queue_consume') THEN RAISE EXCEPTION 'unqualified_purchase_runtime_ownership'; END IF;
  IF has_schema_privilege('insignia_queue_consume','public','CREATE') THEN RAISE EXCEPTION 'unqualified_purchase_runtime_schema_create'; END IF;
  IF has_table_privilege('insignia_queue_consume','public.purchase_orders','DELETE') OR has_table_privilege('insignia_queue_consume','public.purchase_orders','UPDATE') OR has_table_privilege('insignia_queue_consume','public.purchase_design_payloads','UPDATE') OR has_table_privilege('insignia_queue_consume','public.purchase_artwork_events','INSERT') OR has_table_privilege('insignia_queue_consume','public.purchase_paid_facts','UPDATE') OR has_column_privilege('insignia_queue_consume','public.artwork_assets','original_key','SELECT') THEN RAISE EXCEPTION 'unqualified_purchase_runtime_mutation'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class c WHERE c.oid IN ('public.purchase_orders'::regclass,'public.purchase_bindings'::regclass,'public.purchase_lines'::regclass,'public.purchase_design_payloads'::regclass,'public.purchase_observations'::regclass,'public.purchase_paid_facts'::regclass,'public.purchase_refund_facts'::regclass,'public.purchase_artwork_events'::regclass,'public.purchase_offer_payloads'::regclass) AND (has_table_privilege('insignia_queue_consume',c.oid,'DELETE') OR has_table_privilege('insignia_queue_consume',c.oid,'TRUNCATE') OR has_table_privilege('insignia_queue_consume',c.oid,'UPDATE'))) THEN RAISE EXCEPTION 'unqualified_purchase_runtime_mutation'; END IF;
  IF has_table_privilege('insignia_queue_consume','public.accepted_quotes','SELECT') OR has_column_privilege('insignia_queue_consume','public.purchase_offer_payloads','payload','SELECT') OR has_column_privilege('insignia_queue_consume','public.buyer_quote_ownership','owner_binding','SELECT') THEN RAISE EXCEPTION 'unqualified_purchase_private_access'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.cleanup_purchase_payloads(integer) FROM PUBLIC, insignia_queue_consume;
GRANT USAGE ON SCHEMA public TO insignia_queue_consume;
GRANT EXECUTE ON FUNCTION public.cleanup_purchase_payloads(integer) TO insignia_queue_consume;
REVOKE ALL ON FUNCTION public.read_purchase_offer_history(text,bigint,uuid,uuid), public.read_purchase_revision_history(text,bigint,uuid,uuid,text,text) FROM PUBLIC, insignia_queue_consume;
GRANT EXECUTE ON FUNCTION public.read_purchase_offer_history(text,bigint,uuid,uuid), public.read_purchase_revision_history(text,bigint,uuid,uuid,text,text) TO insignia_queue_consume;
GRANT SELECT, INSERT ON public.purchase_orders,public.purchase_bindings,public.purchase_lines,
 public.purchase_design_payloads,public.purchase_observations,public.purchase_paid_facts,public.purchase_refund_facts TO insignia_queue_consume;
-- PostgreSQL row locks require UPDATE on one column; immutable triggers still forbid edits.
GRANT UPDATE(purchase_id) ON public.purchase_orders TO insignia_queue_consume;
GRANT SELECT(shop_id,installation_generation,quote_id,collected_at,expires_at) ON public.purchase_offer_payloads TO insignia_queue_consume;
GRANT SELECT ON public.purchase_artwork_events TO insignia_queue_consume;
GRANT SELECT(asset_id,shop_id,state,expires_at) ON public.artwork_assets TO insignia_queue_consume;
-- Invoker trigger enforce_purchase_binding checks exactly these identifiers.
GRANT SELECT(set_id,quote_id,shop_id,installation_generation) ON public.quote_authorization_sets TO insignia_queue_consume;
GRANT SELECT, INSERT, UPDATE ON public.purchase_reconciliation_cursors TO insignia_queue_consume;
GRANT UPDATE(lease_owner,lease_until) ON public.inbox_messages TO insignia_queue_consume;
COMMIT;
