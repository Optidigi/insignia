-- migrate:up
-- A new decision links an actual privacy receipt to independent exact-generation
-- uninstall authority. It never changes the historical BLOCKED receipt.
-- Receipt-local trusted coverage is accounting only, never erasure authority.
CREATE TABLE uninstall_privacy_scopes (
 privacy_inbox_id uuid PRIMARY KEY REFERENCES customer_privacy_receipts(inbox_id),
 shop_id text NOT NULL, generation_ceiling bigint NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(observed_at)),
 observation_kind text NOT NULL CHECK(observation_kind IN ('original_processing','legacy_recovery')),
 FOREIGN KEY(shop_id,generation_ceiling) REFERENCES installation_generations(shop_id,generation)
);
REVOKE ALL ON uninstall_privacy_scopes FROM PUBLIC;
CREATE TRIGGER uninstall_privacy_scope_immutable BEFORE UPDATE OR DELETE ON uninstall_privacy_scopes
 FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE FUNCTION public.snapshot_uninstall_privacy_scope(p_privacy uuid,p_kind text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.customer_privacy_receipts%ROWTYPE; ceiling bigint;
BEGIN
 IF p_kind NOT IN ('original_processing','legacy_recovery') THEN RAISE EXCEPTION 'invalid privacy scope observation'; END IF;
 SELECT * INTO receipt FROM public.customer_privacy_receipts WHERE inbox_id=p_privacy;
 IF NOT FOUND OR receipt.operation NOT IN ('SHOP_ERASURE_BLOCKED','SHOP_ERASURE_STAGED') THEN RAISE EXCEPTION 'shop privacy receipt required'; END IF;
 SELECT current_generation INTO ceiling FROM public.shops WHERE shop_id=receipt.shop_id FOR UPDATE;
 INSERT INTO public.uninstall_privacy_scopes(privacy_inbox_id,shop_id,generation_ceiling,observation_kind)
 VALUES(p_privacy,receipt.shop_id,ceiling,p_kind) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.snapshot_uninstall_privacy_scope(uuid,text) FROM PUBLIC;
CREATE TABLE uninstall_privacy_recoveries (
 privacy_inbox_id uuid NOT NULL REFERENCES customer_privacy_receipts(inbox_id),
 shop_id text NOT NULL,
 installation_generation bigint NOT NULL,
 uninstall_inbox_id uuid NOT NULL,
 capability_digest text NOT NULL CHECK(capability_digest ~ '^[a-f0-9]{64}$'),
 external_installation_id text NOT NULL,
 decided_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(decided_at)),
 PRIMARY KEY(privacy_inbox_id,shop_id,installation_generation),
 FOREIGN KEY(shop_id,installation_generation) REFERENCES installation_generations(shop_id,generation)
);
-- uninstall_inbox_id is an immutable evidence reference, not a new HMAC claim.
-- No FK to the raw uninstall transport: restore copies this minimal decision
-- without reviving discarded payloads or provisioning an executable capability.
REVOKE ALL ON uninstall_privacy_recoveries FROM PUBLIC;
CREATE TRIGGER uninstall_privacy_recovery_immutable BEFORE UPDATE OR DELETE ON uninstall_privacy_recoveries
 FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE FUNCTION public.recover_uninstall_privacy(p_privacy uuid,p_uninstall uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE privacy public.customer_privacy_receipts%ROWTYPE; destination public.uninstall_destinations%ROWTYPE;
 installed public.installation_generations%ROWTYPE; item record; at_time timestamptz:=clock_timestamp();
BEGIN
 SELECT d.* INTO destination FROM public.uninstall_delivery_authority a JOIN public.uninstall_destinations d USING(capability_digest)
  WHERE a.inbox_id=p_uninstall;
 IF NOT FOUND OR destination.state NOT IN ('dispatched','registered','retired') THEN RAISE EXCEPTION 'qualified uninstall authority required'; END IF;
 PERFORM 1 FROM public.shops WHERE shop_id=destination.shop_id FOR UPDATE;
 SELECT * INTO installed FROM public.installation_generations WHERE shop_id=destination.shop_id AND generation=destination.installation_generation FOR UPDATE;
 IF NOT FOUND OR installed.deactivated_at IS NULL OR installed.external_installation_id IS DISTINCT FROM destination.external_installation_id
 THEN RAISE EXCEPTION 'independently inactive exact installation required'; END IF;
 SELECT * INTO privacy FROM public.customer_privacy_receipts WHERE inbox_id=p_privacy;
 IF NOT FOUND OR privacy.shop_id<>destination.shop_id OR privacy.operation NOT IN ('SHOP_ERASURE_BLOCKED','SHOP_ERASURE_STAGED')
 THEN RAISE EXCEPTION 'actual same-shop privacy receipt required'; END IF;
 PERFORM public.snapshot_uninstall_privacy_scope(p_privacy,'legacy_recovery');
 IF destination.installation_generation>(SELECT generation_ceiling FROM public.uninstall_privacy_scopes WHERE privacy_inbox_id=p_privacy)
 THEN RAISE EXCEPTION 'uninstall generation exceeds frozen privacy scope'; END IF;
 -- The late-authority decision says inactive NOW; it never asserts that the
 -- generation was already inactive at the original receipt collection time.
 INSERT INTO public.uninstall_privacy_recoveries(privacy_inbox_id,shop_id,installation_generation,uninstall_inbox_id,capability_digest,external_installation_id)
 VALUES(p_privacy,destination.shop_id,destination.installation_generation,p_uninstall,destination.capability_digest,destination.external_installation_id)
 ON CONFLICT DO NOTHING;
 INSERT INTO public.shop_privacy_fences(shop_id,installation_generation,source_inbox_id)
 VALUES(destination.shop_id,destination.installation_generation,p_privacy) ON CONFLICT DO NOTHING;
 FOR item IN SELECT quote_id FROM public.accepted_quotes WHERE shop_id=destination.shop_id AND installation_generation=destination.installation_generation ORDER BY quote_id
 LOOP PERFORM public.customer_privacy_fence_quote(destination.shop_id,item.quote_id,p_privacy); END LOOP;
 FOR item IN SELECT asset_id FROM public.artwork_assets WHERE shop_id=destination.shop_id AND installation_generation=destination.installation_generation ORDER BY asset_id
 LOOP PERFORM public.customer_privacy_fence_asset(destination.shop_id,item.asset_id,p_privacy); END LOOP;
 UPDATE public.purchase_design_payloads SET payload=NULL,erased_at=at_time WHERE shop_id=destination.shop_id AND installation_generation=destination.installation_generation AND erased_at IS NULL;
 UPDATE public.purchase_offer_payloads SET payload=NULL,erased_at=at_time WHERE shop_id=destination.shop_id AND installation_generation=destination.installation_generation AND erased_at IS NULL;
 UPDATE public.purchase_artwork_events SET asset_id=NULL,placement_id=NULL,group_index=NULL,erased_at=at_time WHERE shop_id=destination.shop_id AND installation_generation=destination.installation_generation AND kind='ATTACH' AND erased_at IS NULL;
 DELETE FROM public.buyer_sessions WHERE shop_id=destination.shop_id AND installation_generation=destination.installation_generation;
 RETURN jsonb_build_object('kind','GENERATION_ERASURE_STAGED','shopId',destination.shop_id,'installationGeneration',destination.installation_generation::text);
END $$;
REVOKE ALL ON FUNCTION public.recover_uninstall_privacy(uuid,uuid) FROM PUBLIC;
CREATE FUNCTION public.recover_pending_uninstall_privacy(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record; recovered integer:=0;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'invalid recovery budget'; END IF;
 FOR item IN SELECT DISTINCT ON (r.inbox_id,d.shop_id,d.installation_generation) r.inbox_id AS privacy_id,a.inbox_id AS uninstall_id
  FROM public.customer_privacy_receipts r JOIN public.uninstall_destinations d ON d.shop_id=r.shop_id
  JOIN public.uninstall_delivery_authority a USING(capability_digest)
  JOIN public.installation_generations i ON i.shop_id=d.shop_id AND i.generation=d.installation_generation
  WHERE r.operation IN ('SHOP_ERASURE_BLOCKED','SHOP_ERASURE_STAGED') AND d.state IN ('dispatched','registered','retired')
   AND i.deactivated_at IS NOT NULL AND i.external_installation_id=d.external_installation_id
   AND (NOT EXISTS(SELECT 1 FROM public.uninstall_privacy_scopes scope WHERE scope.privacy_inbox_id=r.inbox_id) OR d.installation_generation<=(SELECT scope.generation_ceiling FROM public.uninstall_privacy_scopes scope WHERE scope.privacy_inbox_id=r.inbox_id))
   AND NOT EXISTS(SELECT 1 FROM public.uninstall_privacy_recoveries done WHERE done.privacy_inbox_id=r.inbox_id AND done.shop_id=d.shop_id AND done.installation_generation=d.installation_generation)
  ORDER BY r.inbox_id,d.shop_id,d.installation_generation,a.inbox_id LIMIT p_limit
 LOOP PERFORM public.recover_uninstall_privacy(item.privacy_id,item.uninstall_id); recovered:=recovered+1; END LOOP;
 RETURN recovered;
END $$;
REVOKE ALL ON FUNCTION public.recover_pending_uninstall_privacy(integer) FROM PUBLIC;
CREATE FUNCTION public.uninstall_privacy_status() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object(
  'blockedReceiptCount',(SELECT count(*) FROM public.customer_privacy_receipts WHERE operation='SHOP_ERASURE_BLOCKED'),
  'recoveryDecisionCount',(SELECT count(*) FROM public.uninstall_privacy_recoveries),
  'legacyScopeReceiptCount',(SELECT count(*) FROM public.uninstall_privacy_scopes scope JOIN public.customer_privacy_receipts r ON r.inbox_id=scope.privacy_inbox_id WHERE r.operation='SHOP_ERASURE_BLOCKED' AND scope.observation_kind='legacy_recovery'),
  'activeGenerationHoldCount',(SELECT count(*) FROM public.customer_privacy_receipts r JOIN public.uninstall_privacy_scopes scope ON scope.privacy_inbox_id=r.inbox_id
    WHERE r.operation='SHOP_ERASURE_BLOCKED' AND EXISTS(SELECT 1 FROM public.installation_generations i WHERE i.shop_id=r.shop_id AND i.generation<=scope.generation_ceiling AND i.deactivated_at IS NULL)),
  'unrecoveredBlockedReceiptCount',(SELECT count(*) FROM public.customer_privacy_receipts r LEFT JOIN public.uninstall_privacy_scopes scope ON scope.privacy_inbox_id=r.inbox_id
    WHERE r.operation='SHOP_ERASURE_BLOCKED' AND (scope.privacy_inbox_id IS NULL OR scope.observation_kind='legacy_recovery'
      OR EXISTS(SELECT 1 FROM public.installation_generations i WHERE i.shop_id=r.shop_id AND i.generation<=scope.generation_ceiling
        AND NOT EXISTS(SELECT 1 FROM public.shop_privacy_fences f WHERE f.shop_id=i.shop_id AND f.installation_generation=i.generation)))))
$$;
REVOKE ALL ON FUNCTION public.uninstall_privacy_status() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.erase_method_catalog_for_shop_privacy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target public.shops%ROWTYPE; installed public.installation_generations%ROWTYPE;
 saved public.customer_privacy_receipts%ROWTYPE; collected timestamptz;
BEGIN
 SELECT * INTO target FROM public.shops WHERE shop_id=NEW.shop_id FOR UPDATE;
 IF NEW.installation_generation<>target.current_generation THEN RETURN NEW; END IF;
 SELECT * INTO installed FROM public.installation_generations WHERE shop_id=NEW.shop_id AND generation=target.current_generation;
 SELECT * INTO saved FROM public.customer_privacy_receipts WHERE inbox_id=NEW.source_inbox_id;
 SELECT collected_at INTO collected FROM public.inbox_messages WHERE id=NEW.source_inbox_id;
 IF installed.deactivated_at IS NULL OR saved.shop_id IS DISTINCT FROM NEW.shop_id OR
  (NOT EXISTS(SELECT 1 FROM public.uninstall_privacy_recoveries r WHERE r.privacy_inbox_id=NEW.source_inbox_id AND r.shop_id=NEW.shop_id AND r.installation_generation=NEW.installation_generation) AND
   (saved.operation IS DISTINCT FROM 'SHOP_ERASURE_STAGED' OR collected IS NULL OR installed.deactivated_at>collected))
 THEN RAISE EXCEPTION 'qualified inactive shop erasure required' USING ERRCODE='check_violation'; END IF;
 DELETE FROM public.method_catalog WHERE shop_id=NEW.shop_id;
 -- This namespace owns mutable method-command metadata only. Preserve command
 -- dedup identity and all unrelated namespaces/economic/historical records.
 UPDATE public.idempotency_records SET result_ref='{"kind":"conflict","message":"Method library erased. Reload before making a new change."}'
 WHERE shop_id=NEW.shop_id AND namespace LIKE 'merchant-method-%' AND status='completed';
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.process_customer_privacy_inbox(p_inbox uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; body jsonb; operation text; new_receipt boolean;
BEGIN
 new_receipt:=NOT EXISTS(SELECT 1 FROM public.customer_privacy_receipts WHERE inbox_id=p_inbox);
 SELECT r.operation INTO operation FROM public.customer_privacy_receipts r WHERE inbox_id=p_inbox;
 IF operation IN ('SHOP_ERASURE_STAGED','SHOP_ERASURE_BLOCKED') THEN result:=public.stage_shop_privacy_inbox(p_inbox);
 ELSIF operation IS NOT NULL THEN result:=public.stage_customer_privacy_inbox(p_inbox);
 ELSE
  SELECT convert_from(payload,'UTF8')::jsonb INTO body FROM public.inbox_messages WHERE id=p_inbox;
  IF body ? 'customer' OR body ? 'orders_requested' OR body ? 'orders_to_redact' THEN result:=public.stage_customer_privacy_inbox(p_inbox);
  ELSE result:=public.stage_shop_privacy_inbox(p_inbox); END IF;
 END IF;
 IF new_receipt AND result->>'kind' IN ('SHOP_ERASURE_STAGED','SHOP_ERASURE_BLOCKED') THEN PERFORM public.snapshot_uninstall_privacy_scope(p_inbox,'original_processing'); END IF;
 UPDATE public.inbox_messages SET payload=''::bytea,erasure_state='erased',state='processed',last_error_class=NULL,lease_owner=NULL,lease_until=NULL WHERE id=p_inbox;
 UPDATE public.webhook_obligation_facts SET captured_fields='{}',facts_erased_at=coalesce(facts_erased_at,clock_timestamp()) WHERE inbox_id=p_inbox;
 UPDATE public.shopify_webhook_deliveries SET queue_cleanup_pending=true WHERE inbox_id=p_inbox;
 RETURN result;
END $$;



-- migrate:down
DO $$ BEGIN IF EXISTS(SELECT 1 FROM uninstall_privacy_recoveries) OR EXISTS(SELECT 1 FROM uninstall_privacy_scopes) THEN RAISE EXCEPTION 'uninstall privacy decisions prevent rollback'; END IF; END $$;
DROP FUNCTION public.uninstall_privacy_status();
DROP FUNCTION public.recover_pending_uninstall_privacy(integer);
DROP FUNCTION public.recover_uninstall_privacy(uuid,uuid);
DROP TABLE uninstall_privacy_recoveries;
CREATE OR REPLACE FUNCTION public.process_customer_privacy_inbox(p_inbox uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; body jsonb; operation text;
BEGIN
 SELECT r.operation INTO operation FROM public.customer_privacy_receipts r WHERE inbox_id=p_inbox;
 IF operation IN ('SHOP_ERASURE_STAGED','SHOP_ERASURE_BLOCKED') THEN result:=public.stage_shop_privacy_inbox(p_inbox);
 ELSIF operation IS NOT NULL THEN result:=public.stage_customer_privacy_inbox(p_inbox);
 ELSE
  SELECT convert_from(payload,'UTF8')::jsonb INTO body FROM public.inbox_messages WHERE id=p_inbox;
  IF body ? 'customer' OR body ? 'orders_requested' OR body ? 'orders_to_redact' THEN result:=public.stage_customer_privacy_inbox(p_inbox);
  ELSE result:=public.stage_shop_privacy_inbox(p_inbox); END IF;
 END IF;
 UPDATE public.inbox_messages SET payload=''::bytea,erasure_state='erased',state='processed',last_error_class=NULL,lease_owner=NULL,lease_until=NULL WHERE id=p_inbox;
 UPDATE public.webhook_obligation_facts SET captured_fields='{}',facts_erased_at=coalesce(facts_erased_at,clock_timestamp()) WHERE inbox_id=p_inbox;
 UPDATE public.shopify_webhook_deliveries SET queue_cleanup_pending=true WHERE inbox_id=p_inbox;
 RETURN result;
END $$;



DROP FUNCTION public.snapshot_uninstall_privacy_scope(uuid,text);
DROP TABLE uninstall_privacy_scopes;
CREATE OR REPLACE FUNCTION public.erase_method_catalog_for_shop_privacy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target public.shops%ROWTYPE; installed public.installation_generations%ROWTYPE;
 saved public.customer_privacy_receipts%ROWTYPE; collected timestamptz;
BEGIN
 SELECT * INTO target FROM public.shops WHERE shop_id=NEW.shop_id FOR UPDATE;
 IF NEW.installation_generation<>target.current_generation THEN RETURN NEW; END IF;
 SELECT * INTO installed FROM public.installation_generations WHERE shop_id=NEW.shop_id AND generation=target.current_generation;
 SELECT * INTO saved FROM public.customer_privacy_receipts WHERE inbox_id=NEW.source_inbox_id;
 SELECT collected_at INTO collected FROM public.inbox_messages WHERE id=NEW.source_inbox_id;
 IF saved.operation IS DISTINCT FROM 'SHOP_ERASURE_STAGED' OR saved.shop_id IS DISTINCT FROM NEW.shop_id
  OR installed.deactivated_at IS NULL OR collected IS NULL OR installed.deactivated_at>collected
 THEN RAISE EXCEPTION 'qualified inactive shop erasure required' USING ERRCODE='check_violation'; END IF;
 DELETE FROM public.method_catalog WHERE shop_id=NEW.shop_id;
 -- This namespace owns mutable method-command metadata only. Preserve command
 -- dedup identity and all unrelated namespaces/economic/historical records.
 UPDATE public.idempotency_records SET result_ref='{"kind":"conflict","message":"Method library erased. Reload before making a new change."}'
 WHERE shop_id=NEW.shop_id AND namespace LIKE 'merchant-method-%' AND status='completed';
 RETURN NEW;
END $$;
