-- Migration-owner operation after migration31; extends the existing web LOGIN only.
-- Preserve M5 grants and tenant checks. No login creation, native deployment or data mutation.
-- Purchase reconciliation is a worker operation; web may read purchases and append artwork events.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='insignia_runtime' AND rolcanlogin
    AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'qualified_existing_web_login_required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
    JOIN pg_roles parent ON parent.oid=m.roleid WHERE r.rolname='insignia_runtime'
    AND (parent.rolname<>'insignia_queue_enqueue' OR m.admin_option)) THEN
    RAISE EXCEPTION 'unqualified_web_membership';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
    WHERE r.rolname='insignia_queue_enqueue') THEN
    RAISE EXCEPTION 'unqualified_web_enqueue_inheritance';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_enqueue'
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'unqualified_web_enqueue_capability';
  END IF;
  IF has_schema_privilege('insignia_runtime','public','CREATE') OR
    EXISTS(SELECT 1 FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname='insignia_runtime')) OR
    EXISTS(SELECT 1 FROM pg_proc WHERE proowner=(SELECT oid FROM pg_roles WHERE rolname='insignia_runtime')) THEN
    RAISE EXCEPTION 'unqualified_web_ownership';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef AND p.prorettype<>'pg_catalog.trigger'::regtype
    AND has_function_privilege('insignia_runtime',p.oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'unqualified_web_security_definer';
  END IF;
  IF NOT has_table_privilege('insignia_runtime','public.trusted_release_records','SELECT') OR
    has_table_privilege('insignia_runtime','public.trusted_release_records','INSERT,UPDATE,DELETE,TRUNCATE') OR
    EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.trusted_release_records'::regclass
      AND a.attnum>0 AND NOT a.attisdropped AND
      (has_column_privilege('insignia_runtime',a.attrelid,a.attnum,'INSERT') OR has_column_privilege('insignia_runtime',a.attrelid,a.attnum,'UPDATE'))) THEN
    RAISE EXCEPTION 'unqualified_web_release_authority';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class c WHERE c.oid IN
    ('public.purchase_orders'::regclass,'public.purchase_bindings'::regclass,'public.purchase_lines'::regclass,
     'public.purchase_design_payloads'::regclass,'public.purchase_observations'::regclass,
     'public.purchase_paid_facts'::regclass,'public.purchase_refund_facts'::regclass,
     'public.purchase_reconciliation_cursors'::regclass) AND
    (has_table_privilege('insignia_runtime',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') OR
     EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND
       (has_column_privilege('insignia_runtime',c.oid,a.attnum,'INSERT') OR
        (has_column_privilege('insignia_runtime',c.oid,a.attnum,'UPDATE') AND
         NOT((c.oid='public.purchase_orders'::regclass AND a.attname='purchase_id') OR
             (c.oid='public.purchase_reconciliation_cursors'::regclass AND a.attname='next_attempt_at'))))))) THEN
    RAISE EXCEPTION 'unqualified_web_purchase_mutation';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class c WHERE c.oid IN
    ('public.purchase_artwork_events'::regclass,'public.purchase_offer_payloads'::regclass) AND
    (has_table_privilege('insignia_runtime',c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR
     EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND
       (has_column_privilege('insignia_runtime',c.oid,a.attnum,'UPDATE') OR
        (has_column_privilege('insignia_runtime',c.oid,a.attnum,'INSERT') AND NOT
         ((c.oid='public.purchase_offer_payloads'::regclass AND a.attname IN
           ('shop_id','installation_generation','quote_id','collected_at','expires_at','payload')) OR
          (c.oid='public.purchase_artwork_events'::regclass AND a.attname IN
           ('event_id','shop_id','installation_generation','purchase_id','version','kind','group_index','placement_id','asset_id','expires_at')))))))) THEN
    RAISE EXCEPTION 'unqualified_web_payload_mutation';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.purchase_reconciliation_cursors'::regclass
    AND a.attnum>0 AND NOT a.attisdropped AND a.attname NOT IN ('shop_id','installation_generation','next_attempt_at')
    AND has_column_privilege('insignia_runtime',a.attrelid,a.attnum,'SELECT')) THEN
    RAISE EXCEPTION 'unqualified_web_cursor_access';
  END IF;
END $$;
GRANT SELECT ON public.artwork_assets TO insignia_runtime;
GRANT INSERT(asset_id,shop_id,installation_generation,owner_hash,owner_kind,declared_mime,declared_bytes,
 state,quarantine_key,original_key,preview_key,collected_at,upload_until,expires_at) ON public.artwork_assets TO insignia_runtime;
-- complete() queues an upload and takes row locks; inspection/cleanup columns stay excluded.
GRANT UPDATE(state,updated_at) ON public.artwork_assets TO insignia_runtime;
GRANT SELECT, INSERT ON public.buyer_admission,public.buyer_sessions,public.design_drafts,
 public.quote_proposals,public.buyer_quote_ownership,public.cart_applications,public.buyer_commands TO insignia_runtime;
GRANT UPDATE(window_at,issued) ON public.buyer_admission TO insignia_runtime;
GRANT UPDATE(write_window,write_count) ON public.buyer_sessions TO insignia_runtime;
GRANT UPDATE(version,payload,expires_at) ON public.design_drafts TO insignia_runtime;
-- putProposal removes expired owned proposals before issuing another; cleanup remains worker-only.
GRANT DELETE ON public.quote_proposals TO insignia_runtime;
GRANT UPDATE(observed_fingerprint,status) ON public.cart_applications TO insignia_runtime;
GRANT UPDATE(application_id) ON public.buyer_commands TO insignia_runtime;
-- linkQuote preserves the original owned design before checkout; not an order/payment fact.
GRANT SELECT ON public.purchase_offer_payloads TO insignia_runtime;
GRANT INSERT(shop_id,installation_generation,quote_id,collected_at,expires_at,payload)
 ON public.purchase_offer_payloads TO insignia_runtime;
GRANT SELECT ON public.purchase_orders,public.purchase_bindings,public.purchase_lines,
 public.purchase_design_payloads,public.purchase_observations,public.purchase_paid_facts,
 public.purchase_refund_facts,public.purchase_artwork_events TO insignia_runtime;
-- PostgreSQL requires UPDATE on one column for merchant attachment/lock row locks;
-- the existing immutable trigger still refuses every actual order mutation.
GRANT UPDATE(purchase_id) ON public.purchase_orders TO insignia_runtime;
GRANT INSERT(event_id,shop_id,installation_generation,purchase_id,version,kind,group_index,placement_id,asset_id,expires_at)
 ON public.purchase_artwork_events TO insignia_runtime;
GRANT SELECT(shop_id,installation_generation,next_attempt_at) ON public.purchase_reconciliation_cursors TO insignia_runtime;
GRANT UPDATE(next_attempt_at) ON public.purchase_reconciliation_cursors TO insignia_runtime;
COMMIT;
