-- migrate:up
-- A generationless signed shop body cannot distinguish a delayed delivery from
-- a request for a successor. Preserve already committed exact-generation
-- decisions. A first-generation request received before activation cannot grant
-- direct authority either.
CREATE OR REPLACE FUNCTION public.stage_shop_privacy_inbox(p_inbox uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.inbox_messages%ROWTYPE; saved public.customer_privacy_receipts%ROWTYPE;
 body jsonb; target public.shops%ROWTYPE; installed public.installation_generations%ROWTYPE;
 operation text; item record; matched integer; at_time timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO receipt FROM public.inbox_messages WHERE id=p_inbox;
 IF NOT FOUND THEN RAISE EXCEPTION 'privacy inbox not found' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO saved FROM public.customer_privacy_receipts WHERE inbox_id=p_inbox;
 IF FOUND THEN
  IF saved.raw_body_sha256<>receipt.payload_sha256 THEN RAISE EXCEPTION 'privacy receipt integrity conflict' USING ERRCODE='check_violation'; END IF;
  RETURN jsonb_build_object('kind',saved.operation,'shopId',saved.shop_id,'requestedOrderCount',saved.requested_order_count,'matchedPurchaseCount',saved.matched_purchase_count);
 END IF;
 IF receipt.source<>'shopify' OR receipt.retention_class<>'shopify-webhook' OR receipt.erasure_state<>'retained'
  OR NOT coalesce(receipt.purge_after>at_time AND isfinite(receipt.purge_after),false)
  OR encode(sha256(receipt.payload),'hex')<>receipt.payload_sha256
  OR NOT EXISTS(SELECT 1 FROM public.shopify_webhook_deliveries WHERE inbox_id=p_inbox)
 THEN RAISE EXCEPTION 'privacy retained body unavailable' USING ERRCODE='check_violation'; END IF;
 body:=convert_from(receipt.payload,'UTF8')::jsonb;
 IF jsonb_typeof(body)<>'object' OR body->>'shop_id' IS NULL OR body->>'shop_id' !~ '^[1-9][0-9]{0,19}$'
  OR (body->>'shop_id')::numeric>18446744073709551615
  OR jsonb_typeof(body->'shop_domain') IS DISTINCT FROM 'string'
  OR (SELECT count(*) FROM jsonb_object_keys(body))<>2
 THEN RAISE EXCEPTION 'not an exact shop privacy body' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO target FROM public.shops WHERE shopify_shop_id=body->>'shop_id' AND shop_domain=body->>'shop_domain' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'privacy signed shop is unknown' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO receipt FROM public.inbox_messages WHERE id=p_inbox FOR UPDATE NOWAIT;
 SELECT * INTO saved FROM public.customer_privacy_receipts WHERE inbox_id=p_inbox;
 IF FOUND THEN RETURN jsonb_build_object('kind',saved.operation,'shopId',saved.shop_id,'requestedOrderCount',saved.requested_order_count,'matchedPurchaseCount',saved.matched_purchase_count); END IF;
 IF receipt.erasure_state<>'retained' OR receipt.purge_after<=clock_timestamp()
  OR encode(sha256(receipt.payload),'hex')<>receipt.payload_sha256 OR convert_from(receipt.payload,'UTF8')::jsonb IS DISTINCT FROM body
  OR (receipt.shop_id IS NOT NULL AND receipt.shop_id<>target.shop_id)
 THEN RAISE EXCEPTION 'privacy inbox changed or routed to another shop' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO installed FROM public.installation_generations WHERE shop_id=target.shop_id AND generation=target.current_generation FOR UPDATE;
 -- The signed payload contains no generation. Only an already independently
 -- inactive installation preceding collection is eligible. A delayed request
 -- seen while active is a permanent operator hold, never a later automatic grant.
 operation:=CASE WHEN installed.generation=1 AND installed.activated_at<=receipt.collected_at
  AND installed.deactivated_at<=receipt.collected_at
  THEN 'SHOP_ERASURE_STAGED' ELSE 'SHOP_ERASURE_BLOCKED' END;
 SELECT count(*) INTO matched FROM public.purchase_orders WHERE shop_id=target.shop_id AND installation_generation<=target.current_generation;
 INSERT INTO public.customer_privacy_receipts(inbox_id,shop_id,raw_body_sha256,operation,request_id,requested_order_count,matched_purchase_count)
 VALUES(p_inbox,target.shop_id,receipt.payload_sha256,operation,NULL,0,matched);
 IF operation='SHOP_ERASURE_STAGED' THEN
  INSERT INTO public.shop_privacy_fences(shop_id,installation_generation,source_inbox_id)
   SELECT shop_id,generation,p_inbox FROM public.installation_generations WHERE shop_id=target.shop_id AND generation<=target.current_generation ON CONFLICT DO NOTHING;
  INSERT INTO public.customer_privacy_order_links SELECT p_inbox,order_id FROM public.purchase_orders WHERE shop_id=target.shop_id AND installation_generation<=target.current_generation ON CONFLICT DO NOTHING;
  INSERT INTO public.customer_order_erasure_fences SELECT target.shop_id,order_id,p_inbox,at_time FROM public.customer_privacy_order_links WHERE inbox_id=p_inbox ON CONFLICT DO NOTHING;
  FOR item IN SELECT quote_id FROM public.accepted_quotes WHERE shop_id=target.shop_id AND installation_generation<=target.current_generation ORDER BY quote_id
  LOOP PERFORM public.customer_privacy_fence_quote(target.shop_id,item.quote_id,p_inbox); END LOOP;
  FOR item IN SELECT asset_id FROM public.artwork_assets WHERE shop_id=target.shop_id AND installation_generation<=target.current_generation ORDER BY asset_id
  LOOP PERFORM public.customer_privacy_fence_asset(target.shop_id,item.asset_id,p_inbox); END LOOP;
  UPDATE public.purchase_design_payloads SET payload=NULL,erased_at=at_time WHERE shop_id=target.shop_id AND installation_generation<=target.current_generation AND erased_at IS NULL;
  UPDATE public.purchase_offer_payloads SET payload=NULL,erased_at=at_time WHERE shop_id=target.shop_id AND installation_generation<=target.current_generation AND erased_at IS NULL;
  UPDATE public.purchase_artwork_events SET asset_id=NULL,placement_id=NULL,group_index=NULL,erased_at=at_time WHERE shop_id=target.shop_id AND installation_generation<=target.current_generation AND kind='ATTACH' AND erased_at IS NULL;
  -- Buyer sessions are not deleted here (#406): see the header of this migration.
  -- Existing inactive-generation merchant-preview and lease-aware artwork
  -- cleaners own physical deletion. Their keys, custody claims and deadlines
  -- must remain intact until that separate cleanup actually settles.
 END IF;
 RETURN jsonb_build_object('kind',operation,'shopId',target.shop_id,'requestedOrderCount',0,'matchedPurchaseCount',matched);
END $$;

CREATE OR REPLACE FUNCTION public.recover_uninstall_privacy(p_privacy uuid,p_uninstall uuid) RETURNS jsonb
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
 IF NOT EXISTS(SELECT 1 FROM public.inbox_messages e WHERE e.id=p_privacy
     AND e.collected_at>=installed.activated_at)
 THEN RAISE EXCEPTION 'privacy receipt predates installation'; END IF;
 IF destination.installation_generation>1 AND NOT EXISTS (
   SELECT 1 FROM public.uninstall_privacy_recoveries r
    WHERE r.privacy_inbox_id=p_privacy AND r.shop_id=destination.shop_id
      AND r.installation_generation=destination.installation_generation)
 THEN RAISE EXCEPTION 'generationless request cannot qualify a successor installation'; END IF;
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
 -- Buyer sessions are not deleted here (#406): see the header of this migration.
 RETURN jsonb_build_object('kind','GENERATION_ERASURE_STAGED','shopId',destination.shop_id,'installationGeneration',destination.installation_generation::text);
END $$;

CREATE OR REPLACE FUNCTION public.recover_pending_uninstall_privacy(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record; recovered integer:=0;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'invalid recovery budget'; END IF;
 FOR item IN SELECT DISTINCT ON (r.inbox_id,d.shop_id,d.installation_generation) r.inbox_id AS privacy_id,a.inbox_id AS uninstall_id
  FROM public.customer_privacy_receipts r JOIN public.uninstall_destinations d ON d.shop_id=r.shop_id
  JOIN public.uninstall_delivery_authority a USING(capability_digest)
  JOIN public.installation_generations i ON i.shop_id=d.shop_id AND i.generation=d.installation_generation
  JOIN public.inbox_messages e ON e.id=r.inbox_id
  WHERE e.collected_at>=i.activated_at AND d.installation_generation=1 AND r.operation IN ('SHOP_ERASURE_BLOCKED','SHOP_ERASURE_STAGED') AND d.state IN ('dispatched','registered','retired')
   AND i.deactivated_at IS NOT NULL AND i.external_installation_id=d.external_installation_id
   AND (NOT EXISTS(SELECT 1 FROM public.uninstall_privacy_scopes scope WHERE scope.privacy_inbox_id=r.inbox_id) OR d.installation_generation<=(SELECT scope.generation_ceiling FROM public.uninstall_privacy_scopes scope WHERE scope.privacy_inbox_id=r.inbox_id))
   AND NOT EXISTS(SELECT 1 FROM public.uninstall_privacy_recoveries done WHERE done.privacy_inbox_id=r.inbox_id AND done.shop_id=d.shop_id AND done.installation_generation=d.installation_generation)
  ORDER BY r.inbox_id,d.shop_id,d.installation_generation,a.inbox_id LIMIT p_limit
 LOOP PERFORM public.recover_uninstall_privacy(item.privacy_id,item.uninstall_id); recovered:=recovered+1; END LOOP;
 RETURN recovered;
END $$;

-- The fence remains the authority. Progress contains only its primary key and
-- worker timestamps. It is deliberately not an input to restore exclusions.
CREATE TABLE public.shop_privacy_finalization (
 shop_id text NOT NULL,
 installation_generation bigint NOT NULL,
 attempted_at timestamptz NOT NULL,
 drained_at timestamptz,
 PRIMARY KEY(shop_id,installation_generation),
 FOREIGN KEY(shop_id,installation_generation) REFERENCES public.shop_privacy_fences(shop_id,installation_generation)
);
REVOKE ALL ON public.shop_privacy_finalization FROM PUBLIC;

CREATE VIEW public.shop_privacy_finalization_targets AS
 SELECT f.shop_id,f.installation_generation,f.source_inbox_id
 FROM public.shop_privacy_fences f
 JOIN public.installation_generations i ON i.shop_id=f.shop_id AND i.generation=f.installation_generation
 JOIN public.customer_privacy_receipts r ON r.inbox_id=f.source_inbox_id AND r.shop_id=f.shop_id
 JOIN public.inbox_messages e ON e.id=r.inbox_id AND e.payload_sha256=r.raw_body_sha256
 LEFT JOIN public.uninstall_privacy_scopes s ON s.privacy_inbox_id=r.inbox_id AND s.shop_id=r.shop_id
 WHERE i.deactivated_at IS NOT NULL AND e.source='shopify' AND e.retention_class='shopify-webhook'
   AND e.erasure_state='erased' AND e.payload=''::bytea AND e.state='processed'
   AND r.operation IN ('SHOP_ERASURE_STAGED','SHOP_ERASURE_BLOCKED')
   AND ((r.operation='SHOP_ERASURE_STAGED' AND i.deactivated_at<=e.collected_at
         AND (s.privacy_inbox_id IS NULL OR f.installation_generation<=s.generation_ceiling))
     OR (f.installation_generation<=s.generation_ceiling AND EXISTS (
         SELECT 1 FROM public.uninstall_privacy_recoveries u
         WHERE u.privacy_inbox_id=f.source_inbox_id AND u.shop_id=f.shop_id
           AND u.installation_generation=f.installation_generation
           AND u.external_installation_id=i.external_installation_id)));
REVOKE ALL ON public.shop_privacy_finalization_targets FROM PUBLIC;

CREATE VIEW public.shop_privacy_transport_scope AS
 SELECT t.shop_id,t.installation_generation,e.id AS inbox_id
 FROM public.shop_privacy_finalization_targets t
 JOIN public.shop_privacy_fences f USING(shop_id,installation_generation)
 JOIN public.shops s USING(shop_id)
 JOIN public.inbox_messages e ON
   (e.shop_id=t.shop_id AND e.installation_generation=t.installation_generation)
   OR e.id=t.source_inbox_id
   OR (e.installation_generation IS NULL AND (
        EXISTS(SELECT 1 FROM public.uninstall_delivery_authority a
               JOIN public.uninstall_destinations d USING(capability_digest)
               WHERE a.inbox_id=e.id AND d.shop_id=t.shop_id AND d.installation_generation=t.installation_generation)
        OR EXISTS(SELECT 1 FROM public.generic_uninstall_scopes g
                  WHERE g.inbox_id=e.id AND g.shop_id=t.shop_id AND g.generation_ceiling=t.installation_generation)
        OR (s.current_generation=t.installation_generation AND e.collected_at<=f.created_at AND (
          e.shop_id=t.shop_id OR
          EXISTS(SELECT 1 FROM public.customer_privacy_receipts r WHERE r.inbox_id=e.id AND r.shop_id=t.shop_id)))));
REVOKE ALL ON public.shop_privacy_transport_scope FROM PUBLIC;

-- Trigger exceptions require the finalizer's effective owner and transaction-local
-- scope. Ordinary SQL retains the same immutable-row guards, including for a
-- fenced generation. The configured scope is cleared automatically at function exit.
CREATE FUNCTION public.shop_privacy_delete_scope(p_shop text,p_generation text DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT current_user=pg_get_userbyid(c.relowner)
   AND p_shop=current_setting('insignia.shop_privacy_shop',true)
   AND (p_generation IS NULL OR p_generation=current_setting('insignia.shop_privacy_generation',true))
 FROM pg_class c WHERE c.oid='public.shop_privacy_finalization'::regclass
$$;
REVOKE ALL ON FUNCTION public.shop_privacy_delete_scope(text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.reject_quote_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='uninstall_privacy_recoveries'
    AND current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN
   IF public.shop_privacy_delete_scope(OLD.shop_id,OLD.installation_generation::text)
     AND (to_jsonb(NEW)-'external_installation_id')=(to_jsonb(OLD)-'external_installation_id')
     AND NEW.external_installation_id=public.shop_privacy_installation_token(OLD.shop_id,OLD.external_installation_id)
   THEN RETURN NEW; END IF;
 END IF;
 IF TG_OP='DELETE' AND TG_TABLE_SCHEMA='public'
    AND current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN
   IF TG_TABLE_NAME IN ('accepted_quotes','quote_authorization_sets','quote_authorization_renewals',
     'purchase_design_payloads','purchase_offer_payloads','purchase_orders','purchase_bindings',
     'purchase_lines','purchase_observations','purchase_paid_facts','purchase_refund_facts','purchase_artwork_events')
   THEN
     IF public.shop_privacy_delete_scope(OLD.shop_id,OLD.installation_generation::text) THEN RETURN OLD; END IF;
   ELSIF TG_TABLE_NAME IN ('uninstall_delivery_authority','uninstall_destination_events') THEN
     IF EXISTS (SELECT 1 FROM public.uninstall_destinations d WHERE d.capability_digest=OLD.capability_digest
       AND public.shop_privacy_delete_scope(d.shop_id,d.installation_generation::text)) THEN RETURN OLD; END IF;
   ELSIF TG_TABLE_NAME='customer_privacy_order_links' THEN
     IF EXISTS (SELECT 1 FROM public.customer_privacy_receipts r WHERE r.inbox_id=OLD.inbox_id
       AND r.operation='SHOP_ERASURE_STAGED' AND public.shop_privacy_delete_scope(r.shop_id)) THEN RETURN OLD; END IF;
   ELSIF TG_TABLE_NAME='customer_order_erasure_fences' THEN
     IF EXISTS (SELECT 1 FROM public.customer_privacy_receipts r WHERE r.inbox_id=OLD.source_inbox_id
       AND r.shop_id=OLD.shop_id AND r.operation='SHOP_ERASURE_STAGED'
       AND public.shop_privacy_delete_scope(r.shop_id)) THEN RETURN OLD; END IF;
   END IF;
 END IF;
 RAISE EXCEPTION 'accepted quote and authorization rows are immutable' USING ERRCODE='integrity_constraint_violation';
END $$;

CREATE OR REPLACE FUNCTION public.reject_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND TG_TABLE_SCHEMA='public' AND
   current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN
   IF TG_TABLE_NAME IN ('merchant_preview_assets','config_revision_preview_assets') THEN
     IF public.shop_privacy_delete_scope(OLD.shop_id,OLD.installation_generation::text) THEN RETURN OLD; END IF;
   ELSIF TG_TABLE_NAME IN ('config_revisions','config_revision_geometry','config_revision_presentation') AND
     current_setting('insignia.shop_privacy_current',true)='yes' AND public.shop_privacy_delete_scope(OLD.shop_id) THEN
     RETURN OLD;
   END IF;
 END IF;
 RAISE EXCEPTION 'config revisions are immutable' USING ERRCODE='integrity_constraint_violation';
END $$;

CREATE OR REPLACE FUNCTION public.reject_activation_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN
   IF public.shop_privacy_delete_scope(OLD.shop_id) THEN RETURN OLD; END IF;
 END IF;
  RAISE EXCEPTION 'activation evidence is immutable' USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE OR REPLACE FUNCTION public.forbid_trusted_release_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN
   IF public.shop_privacy_delete_scope(OLD.shop_id,OLD.installation_generation::text) THEN RETURN OLD; END IF;
 END IF;
  RAISE EXCEPTION 'trusted release evidence is append-only' USING ERRCODE = 'check_violation';
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_publication_abandonment_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' AND current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN
   IF public.shop_privacy_delete_scope(OLD.shop_id) THEN RETURN OLD; END IF;
 END IF; RAISE EXCEPTION 'publication abandonment audit is append-only' USING ERRCODE='check_violation'; END $$;

CREATE OR REPLACE FUNCTION public.guard_method_catalog_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' AND current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))
    AND current_setting('insignia.shop_privacy_current',true)='yes' THEN
   IF public.shop_privacy_delete_scope(OLD.shop_id) THEN RETURN OLD; END IF;
 END IF;
 IF TG_OP='DELETE' THEN
  IF pg_trigger_depth()<2 OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.method_catalog'::regclass)
  THEN RAISE EXCEPTION 'qualified method identity erasure required' USING ERRCODE='check_violation'; END IF;
  RETURN OLD;
 END IF;
 IF ROW(NEW.shop_id,NEW.method_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.shop_id,OLD.method_id,OLD.created_at) OR OLD.deleted_at IS NOT NULL
 THEN RAISE EXCEPTION 'method identity or tombstone is immutable' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.guard_owner_lifecycle_decisions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN
   IF public.shop_privacy_delete_scope(OLD.shop_id,OLD.installation_generation::text) THEN RETURN OLD; END IF;
 END IF;
 RAISE EXCEPTION 'owner lifecycle decisions are append-only' USING ERRCODE='check_violation';
END $$;

-- Keep the original definer on UPDATE, where it writes the transition event.
-- The DELETE guard must be invoker-security to reject callers that set custom GUCs.
CREATE FUNCTION public.guard_uninstall_destination_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN
   IF public.shop_privacy_delete_scope(OLD.shop_id,OLD.installation_generation::text) THEN RETURN OLD; END IF;
 END IF;
 RAISE EXCEPTION 'immutable uninstall destination or invalid transition';
END $$;
REVOKE ALL ON FUNCTION public.guard_uninstall_destination_delete() FROM PUBLIC;
CREATE OR REPLACE TRIGGER uninstall_destination_guard BEFORE UPDATE ON public.uninstall_destinations
 FOR EACH ROW EXECUTE FUNCTION public.guard_uninstall_destination();
CREATE TRIGGER uninstall_destination_delete_guard BEFORE DELETE ON public.uninstall_destinations
 FOR EACH ROW EXECUTE FUNCTION public.guard_uninstall_destination_delete();

-- Retired metering candidates contain retail order IDs. Actual subscription
-- invoices and payout statements are kept in Optidigi's accounting system.
CREATE FUNCTION public.guard_shop_privacy_usage_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN
   IF public.shop_privacy_delete_scope(OLD.shop_id,OLD.installation_generation::text) THEN RETURN OLD; END IF;
 END IF;
 RAISE EXCEPTION 'usage facts are immutable outside verified shop erasure' USING ERRCODE='check_violation';
END $$;
REVOKE ALL ON FUNCTION public.guard_shop_privacy_usage_delete() FROM PUBLIC;
CREATE OR REPLACE TRIGGER m9_order_usage_guard BEFORE INSERT OR UPDATE ON public.m9_order_usage
 FOR EACH ROW EXECUTE FUNCTION public.guard_m9_order_usage();
CREATE OR REPLACE TRIGGER m9_usage_delivery_intents_guard BEFORE INSERT OR UPDATE ON public.m9_usage_delivery_intents
 FOR EACH ROW EXECUTE FUNCTION public.guard_m9_usage_delivery_intents();
CREATE TRIGGER m9_order_usage_delete_guard BEFORE DELETE ON public.m9_order_usage
 FOR EACH ROW EXECUTE FUNCTION public.guard_shop_privacy_usage_delete();
CREATE TRIGGER m9_usage_delivery_intents_delete_guard BEFORE DELETE ON public.m9_usage_delivery_intents
 FOR EACH ROW EXECUTE FUNCTION public.guard_shop_privacy_usage_delete();

-- The key stays in the database owner boundary and in encrypted database
-- backups. It is never returned by a runtime function or exclusion export.
CREATE TABLE public.shop_privacy_proof_key (
 singleton boolean PRIMARY KEY CHECK (singleton),
 secret bytea NOT NULL CHECK (octet_length(secret)=32)
);
INSERT INTO public.shop_privacy_proof_key VALUES(true, uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()));
REVOKE ALL ON public.shop_privacy_proof_key FROM PUBLIC;

CREATE FUNCTION public.shop_privacy_digest(p_identity jsonb) RETURNS text
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE key_bytes bytea;
BEGIN
 SELECT secret INTO STRICT key_bytes FROM public.shop_privacy_proof_key WHERE singleton;
 -- The inner digest gives this keyed SHA-256 construction fixed-length input.
 RETURN encode(sha256(key_bytes || sha256(convert_to(p_identity::text,'UTF8'))),'hex');
END $$;
REVOKE ALL ON FUNCTION public.shop_privacy_digest(jsonb) FROM PUBLIC;

CREATE TABLE public.shop_privacy_replays (
 inbox_id uuid PRIMARY KEY REFERENCES public.inbox_messages(id),
 delivery_digest text NOT NULL UNIQUE CHECK (delivery_digest ~ '^[0-9a-f]{64}$'),
 content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
 forget_at timestamptz NOT NULL CHECK(isfinite(forget_at)),
 uninstall_domain_digest text CHECK(uninstall_domain_digest ~ '^[0-9a-f]{64}$'),
 uninstall_observed_at timestamptz,
 CHECK ((uninstall_domain_digest IS NULL)=(uninstall_observed_at IS NULL))
);
CREATE INDEX shop_privacy_replays_expiry ON public.shop_privacy_replays(forget_at,inbox_id);
REVOKE ALL ON public.shop_privacy_replays FROM PUBLIC;

CREATE FUNCTION public.shop_privacy_replay_digest(
 p_topic text,p_version text,p_at timestamptz,p_event text,p_name text,p_hash text
) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT public.shop_privacy_digest(jsonb_build_array(
   'webhook-content',p_topic,p_version,trunc(extract(epoch FROM p_at)*1000),p_event,p_name,p_hash))
$$;
REVOKE ALL ON FUNCTION public.shop_privacy_replay_digest(text,text,timestamptz,text,text,text) FROM PUBLIC;

CREATE FUNCTION public.lookup_shop_privacy_replay(
 p_domain text,p_delivery text,p_topic text,p_version text,p_at timestamptz,p_event text,p_name text,p_hash text
) RETURNS TABLE(id uuid,exact boolean,shop_id text,installation_generation bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT r.inbox_id,
   r.content_digest=public.shop_privacy_replay_digest(p_topic,p_version,p_at,p_event,p_name,p_hash),
   i.shop_id,i.installation_generation
 FROM public.shop_privacy_replays r JOIN public.inbox_messages i ON i.id=r.inbox_id
 WHERE r.delivery_digest=public.shop_privacy_digest(jsonb_build_array('webhook-delivery',p_domain,p_delivery))
   AND r.forget_at>statement_timestamp()
$$;
REVOKE ALL ON FUNCTION public.lookup_shop_privacy_replay(text,text,text,text,timestamptz,text,text,text) FROM PUBLIC;

CREATE FUNCTION public.has_compacted_shop_uninstall(p_domain text,p_since timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.shop_privacy_replays r
  WHERE r.uninstall_domain_digest=public.shop_privacy_digest(jsonb_build_array('shop-domain',p_domain))
    AND r.uninstall_observed_at>=p_since AND r.forget_at>statement_timestamp())
$$;
REVOKE ALL ON FUNCTION public.has_compacted_shop_uninstall(text,timestamptz) FROM PUBLIC;

CREATE FUNCTION public.compact_erased_shopify_delivery(p_inbox uuid) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE i public.inbox_messages%ROWTYPE; d public.shopify_webhook_deliveries%ROWTYPE;
        identity text; content text; uninstall_digest text; uninstall_at timestamptz;
BEGIN
 SELECT * INTO i FROM public.inbox_messages WHERE id=p_inbox FOR UPDATE;
 IF NOT FOUND OR i.source<>'shopify' OR i.retention_class<>'shopify-webhook'
   OR i.erasure_state<>'erased' OR i.payload<>''::bytea OR i.state<>'processed'
 THEN RETURN false; END IF;
 SELECT * INTO d FROM public.shopify_webhook_deliveries WHERE inbox_id=i.id;
 IF NOT FOUND OR d.queue_cleanup_pending THEN RETURN false; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(jsonb_build_array('shopify-delivery',d.shop_domain,d.delivery_id)::text,0))
 THEN RETURN false; END IF;
 identity:=public.shop_privacy_digest(jsonb_build_array('webhook-delivery',d.shop_domain,d.delivery_id));
 content:=public.shop_privacy_replay_digest(d.topic,d.api_version,d.triggered_at,d.event_id,d.webhook_name,i.payload_sha256);
 IF d.topic='app/uninstalled' THEN
   uninstall_digest:=public.shop_privacy_digest(jsonb_build_array('shop-domain',d.shop_domain));
   uninstall_at:=d.triggered_at;
 END IF;
 IF i.purge_after>clock_timestamp() THEN
   INSERT INTO public.shop_privacy_replays VALUES(i.id,identity,content,i.purge_after,uninstall_digest,uninstall_at)
   ON CONFLICT(inbox_id) DO NOTHING;
 END IF;
 IF EXISTS(SELECT 1 FROM public.shop_privacy_replays r WHERE r.inbox_id=i.id
   AND (r.delivery_digest<>identity OR r.content_digest<>content OR r.forget_at<>i.purge_after
     OR r.uninstall_domain_digest IS DISTINCT FROM uninstall_digest OR r.uninstall_observed_at IS DISTINCT FROM uninstall_at))
 THEN RAISE EXCEPTION 'conflicting compact Shopify replay proof' USING ERRCODE='check_violation'; END IF;
 DELETE FROM public.shopify_webhook_deliveries WHERE inbox_id=i.id;
 UPDATE public.inbox_messages SET external_delivery_id=NULL WHERE id=i.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.compact_erased_shopify_delivery(uuid) FROM PUBLIC;

-- The internal shop and generation keys still fence old authorizations. The
-- detached identity lets verified reinstall advance the same generation counter.
CREATE TABLE public.shop_privacy_identity (
 shop_id text PRIMARY KEY REFERENCES public.shops(shop_id),
 domain_digest text NOT NULL UNIQUE CHECK (domain_digest ~ '^[0-9a-f]{64}$'),
 provider_digest text UNIQUE CHECK (provider_digest ~ '^[0-9a-f]{64}$')
);
REVOKE ALL ON public.shop_privacy_identity FROM PUBLIC;

CREATE FUNCTION public.shop_privacy_installation_token(p_shop text,p_external text) RETURNS text
LANGUAGE sql STABLE STRICT SET search_path=pg_catalog AS $$
 SELECT 'erased:' || public.shop_privacy_digest(jsonb_build_array('shop-installation',p_shop,p_external))
$$;
REVOKE ALL ON FUNCTION public.shop_privacy_installation_token(text,text) FROM PUBLIC;

CREATE FUNCTION public.find_erased_shop(p_domain text,p_provider text DEFAULT NULL) RETURNS TABLE(shop_id text,current_generation bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT s.shop_id,s.current_generation FROM public.shop_privacy_identity p
 JOIN public.shops s USING(shop_id)
 JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
 WHERE (p.domain_digest=public.shop_privacy_digest(jsonb_build_array('shop-domain',p_domain))
   OR (p_provider IS NOT NULL AND p.provider_digest=public.shop_privacy_digest(jsonb_build_array('shop-provider',p_provider))))
   AND s.shop_domain=s.shop_id||'.erased.invalid' AND i.deactivated_at IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.find_erased_shop(text,text) FROM PUBLIC;

CREATE FUNCTION public.shop_installation_was_seen(p_shop text,p_external text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.installation_generations i WHERE i.shop_id=p_shop
   AND i.external_installation_id IN (p_external,public.shop_privacy_installation_token(p_shop,p_external)))
$$;
REVOKE ALL ON FUNCTION public.shop_installation_was_seen(text,text) FROM PUBLIC;

CREATE FUNCTION public.reattach_erased_shop(
 p_shop text,p_generation bigint,p_domain text,p_provider text,p_started timestamptz
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE public.shops s SET shop_domain=p_domain,shopify_shop_id=p_provider,updated_at=clock_timestamp()
 FROM public.shop_privacy_identity p,public.shop_privacy_finalization f
 WHERE s.shop_id=p_shop AND s.current_generation=p_generation AND s.shop_domain=s.shop_id||'.erased.invalid'
   AND p.shop_id=s.shop_id AND f.shop_id=s.shop_id AND f.installation_generation=s.current_generation
   AND f.drained_at<=p_started
   AND p.domain_digest=public.shop_privacy_digest(jsonb_build_array('shop-domain',p_domain))
   AND p.provider_digest=public.shop_privacy_digest(jsonb_build_array('shop-provider',p_provider));
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.reattach_erased_shop(text,bigint,text,text,timestamptz) FROM PUBLIC;

CREATE FUNCTION public.finalize_shop_privacy_generation(p_shop text,p_generation bigint,p_limit integer) RETURNS text
-- Legacy publication and signing triggers resolve relations in public.
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp
SET insignia.shop_privacy_shop='' SET insignia.shop_privacy_generation='' SET insignia.shop_privacy_current='no' AS $$
DECLARE current_generation bigint; exact_current boolean;
        at_time timestamptz:=clock_timestamp(); target record; n integer;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION 'invalid shop privacy row budget' USING ERRCODE='check_violation';
 END IF;
 -- Same lock order as reinstall, original staging and recovery. Shop-wide work
 -- gets a fresh equality check on every batch and never follows a reinstall.
 SELECT s.current_generation INTO current_generation
 FROM public.shops s WHERE s.shop_id=p_shop FOR UPDATE NOWAIT;
 PERFORM 1 FROM public.installation_generations i
 WHERE i.shop_id=p_shop AND i.generation=p_generation AND i.deactivated_at IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN 'no_authority'; END IF;
 PERFORM 1 FROM public.shop_privacy_finalization_targets t
 WHERE t.shop_id=p_shop AND t.installation_generation=p_generation;
 IF NOT FOUND THEN RETURN 'no_authority'; END IF;
 IF EXISTS (SELECT 1 FROM public.shop_privacy_finalization f
   WHERE f.shop_id=p_shop AND f.installation_generation=p_generation AND f.drained_at IS NOT NULL)
 THEN RETURN 'drained'; END IF;

 exact_current:=current_generation=p_generation;
 PERFORM set_config('insignia.shop_privacy_shop',p_shop,true);
 PERFORM set_config('insignia.shop_privacy_generation',p_generation::text,true);
 PERFORM set_config('insignia.shop_privacy_current',CASE WHEN exact_current THEN 'yes' ELSE 'no' END,true);
 INSERT INTO public.shop_privacy_finalization VALUES(p_shop,p_generation,at_time,NULL)
 ON CONFLICT (shop_id,installation_generation) DO UPDATE SET attempted_at=EXCLUDED.attempted_at;

 -- Migration 71 handles future deactivations. Scrub legacy envelopes before
 -- any FK, storage or accounting dependency can defer completion.
 WITH batch AS (
  SELECT key_id FROM public.signing_keys WHERE shop_id=p_shop AND installation_generation=p_generation
   AND state<>'destroyed' ORDER BY key_id LIMIT p_limit
 )
 UPDATE public.signing_keys k SET state='destroyed',private_envelope=NULL,wrapping_key_id=NULL,destroyed_at=at_time
 FROM batch b WHERE k.shop_id=p_shop AND k.installation_generation=p_generation AND k.key_id=b.key_id;
 IF FOUND THEN RETURN 'progress'; END IF;

 -- Preserve empty receipt provenance and schedule the ordinary queue cleanup.
 -- A null-generation transport is eligible only on an exact inactive current
 -- shop and only if collected by the authorized fence's observation.
 WITH batch AS (
   SELECT e.id FROM public.shop_privacy_transport_scope t JOIN public.inbox_messages e ON e.id=t.inbox_id
   WHERE t.shop_id=p_shop AND t.installation_generation=p_generation
     AND (e.erasure_state<>'erased' OR e.payload<>''::bytea OR e.state<>'processed'
       OR EXISTS(SELECT 1 FROM public.webhook_obligation_facts w
                   WHERE w.inbox_id=e.id AND w.facts_erased_at IS NULL))
   ORDER BY e.id LIMIT p_limit FOR UPDATE OF e NOWAIT
 ), erased AS (
   UPDATE public.inbox_messages e SET payload=''::bytea,erasure_state='erased',state='processed',
     last_error_class=NULL,lease_owner=NULL,lease_until=NULL,next_attempt_at=NULL
   FROM batch WHERE e.id=batch.id RETURNING e.id
 ), facts AS (
   UPDATE public.webhook_obligation_facts w SET captured_fields='{}',facts_erased_at=coalesce(facts_erased_at,at_time)
   FROM erased WHERE w.inbox_id=erased.id
 ), handoff AS (
   UPDATE public.shopify_webhook_deliveries d SET queue_cleanup_pending=true
   FROM erased WHERE d.inbox_id=erased.id
 ) SELECT count(*) INTO n FROM erased;
 IF n>0 THEN RETURN 'progress'; END IF;

 -- Compact each proved inbox after the queue confirms removal. Hold completion
 -- below while any scoped routing remains, but keep draining independent data.
 WITH batch AS (
   SELECT e.id FROM public.shop_privacy_transport_scope t JOIN public.inbox_messages e ON e.id=t.inbox_id
   JOIN public.shopify_webhook_deliveries d ON d.inbox_id=e.id
   WHERE t.shop_id=p_shop AND t.installation_generation=p_generation
     AND e.erasure_state='erased' AND NOT d.queue_cleanup_pending
   ORDER BY e.id LIMIT p_limit FOR UPDATE OF e NOWAIT
 )
 SELECT count(*) FILTER (WHERE public.compact_erased_shopify_delivery(id)) INTO n FROM batch;
 IF n>0 THEN RETURN 'progress'; END IF;

 IF exact_current THEN
   WITH batch AS (
     SELECT c.ctid FROM public.product_configs c JOIN public.publication_operations o
       ON o.shop_id=c.shop_id AND o.config_id=c.config_id AND o.operation_id=c.effective_operation_id
     WHERE c.shop_id=p_shop AND (o.installation_generation=p_generation OR EXISTS (
       SELECT 1 FROM public.shop_privacy_finalization_targets t
       WHERE t.shop_id=o.shop_id AND t.installation_generation=o.installation_generation))
     ORDER BY c.config_id LIMIT p_limit
   )
   UPDATE public.product_configs c SET effective_revision_id=NULL,effective_operation_id=NULL
   FROM batch WHERE c.ctid=batch.ctid;
   IF FOUND THEN RETURN 'progress'; END IF;
 END IF;

 -- Fixed leaf-to-root order. Each iteration either removes at most p_limit
 -- rows from one table or advances to the next independent table. Statements
 -- that cap session deletion also bound the large existing session cascades.
 FOR target IN SELECT * FROM (VALUES
   ('shop_credentials', 'exact', 'true'),
   ('shop_credential_acquisitions', 'exact', 'true'),
   ('authorization_epoch_commands', 'exact', 'true'),
   ('owner_lifecycle_decisions', 'exact', 'true'),
   ('buyer_sessions', 'exact', 'true'),
   ('buyer_admission', 'exact', 'true'),
   ('buyer_visitor_admission', 'exact', 'true'),
   ('buyer_quote_ownership', 'exact', 'true'),
   ('outbox_events', 'exact', 'true'),
   ('uninstall_delivery_authority', 'destination', 'NOT EXISTS(SELECT 1 FROM public.shopify_webhook_deliveries d WHERE d.inbox_id=a.inbox_id)'),
   ('uninstall_destination_events', 'destination', 'true'),
   ('uninstall_destinations', 'exact', 'NOT EXISTS(SELECT 1 FROM public.uninstall_delivery_authority u WHERE u.capability_digest=a.capability_digest)'),
   ('purchase_reconciliation_cursors', 'exact', 'true'),
   ('customer_artwork_notifications', 'exact', 'true'),
   ('customer_artwork_submissions', 'linked', 'EXISTS(SELECT 1 FROM public.customer_artwork_grants g WHERE g.capability_hash=a.capability_hash AND g.shop_id=$1 AND g.installation_generation=$2)'),
   ('customer_artwork_grants', 'exact', 'true'),
   ('purchase_order_labels', 'shared_match', 'EXISTS(SELECT 1 FROM public.purchase_orders o WHERE o.purchase_id=a.purchase_id AND o.shop_id=$1 AND o.installation_generation=$2)'),
   ('purchase_artwork_events', 'exact', 'true'),
   ('purchase_design_payloads', 'exact', 'true'),
   ('purchase_offer_payloads', 'exact', 'true'),
   ('purchase_lines', 'exact', 'true'),
   ('purchase_bindings', 'exact', 'true'),
   ('purchase_observations', 'exact', 'true'),
   ('purchase_refund_facts', 'exact', 'true'),
   ('purchase_paid_facts', 'exact', 'true'),
   -- The generation fence now blocks purchase reingestion. Drop order IDs
   -- staged as part of shop erasure, while leaving independent customer grants
   -- and fences intact. Match the receipt and the purchase's original generation.
   ('customer_privacy_order_links', 'linked', 'EXISTS(SELECT 1 FROM public.customer_privacy_receipts r JOIN public.purchase_orders o ON o.shop_id=r.shop_id AND o.order_id=a.order_id WHERE r.inbox_id=a.inbox_id AND r.operation=''SHOP_ERASURE_STAGED'' AND o.shop_id=$1 AND o.installation_generation=$2)'),
   ('customer_order_erasure_fences', 'shared_match', 'EXISTS(SELECT 1 FROM public.customer_privacy_receipts r JOIN public.purchase_orders o ON o.shop_id=r.shop_id AND o.order_id=a.order_id WHERE r.inbox_id=a.source_inbox_id AND r.operation=''SHOP_ERASURE_STAGED'' AND o.shop_id=$1 AND o.installation_generation=$2)'),
   ('m9_usage_delivery_intents', 'exact', 'true'),
   ('m9_order_usage', 'exact', 'true'),
   ('purchase_orders', 'exact', 'true'),
   ('quote_authorization_renewals', 'exact', 'true'),
   ('quote_authorization_sets', 'exact', 'true'),
   ('accepted_quotes', 'exact', 'true'),
   ('trusted_release_records', 'exact', 'true'),
   ('m5_current_publication_pointer', 'exact', 'true'),
   ('m5_activation_state', 'operation', 'true'),
   ('m5_activation_evidence', 'exact', 'true'),
   ('m5_availability_resolutions', 'operation', 'true'),
   ('m5_publication_abandonment_audit', 'operation', 'true'),
   ('m4_publication_progress', 'operation', 'true'),
   ('publication_operations', 'exact', 'NOT EXISTS(SELECT 1 FROM public.product_configs c WHERE c.shop_id=a.shop_id AND c.config_id=a.config_id AND c.effective_operation_id=a.operation_id)'),
   ('signing_keys', 'exact', 'true'),
   ('config_revision_preview_assets', 'exact', 'true'),
   -- Match artwork tombstonePending: ARTWORK_POLICY.leaseMs plus 30 seconds.
   -- The timestamp records when a successful, all-key sweep was issued.
   ('artwork_assets', 'exact', 'state=''DELETED'' AND quarantine_cleaned_at>=greatest(updated_at,upload_until)+interval ''390 seconds'''),
   ('merchant_preview_assets', 'exact', 'state=''DELETED'''),
   ('merchant_preferences', 'current', 'true'),
   ('method_catalog', 'current', 'true'),
   ('idempotency_records', 'current', 'true'),
   ('outbox_events', 'current', 'installation_generation IS NULL'),
   ('config_revision_geometry', 'current', 'NOT EXISTS(SELECT 1 FROM public.publication_operations o WHERE o.shop_id=a.shop_id AND o.config_id=a.config_id AND o.revision_id=a.revision_id)'),
   ('config_revision_presentation', 'current', 'NOT EXISTS(SELECT 1 FROM public.publication_operations o WHERE o.shop_id=a.shop_id AND o.config_id=a.config_id AND o.revision_id=a.revision_id)'),
   ('config_revisions', 'current', 'NOT EXISTS(SELECT 1 FROM public.publication_operations o WHERE o.shop_id=a.shop_id AND o.config_id=a.config_id AND o.revision_id=a.revision_id) AND NOT EXISTS(SELECT 1 FROM public.product_configs c WHERE c.shop_id=a.shop_id AND c.config_id=a.config_id AND c.effective_revision_id=a.revision_id) AND NOT EXISTS(SELECT 1 FROM public.config_revision_preview_assets p WHERE p.shop_id=a.shop_id AND p.config_id=a.config_id AND p.revision_id=a.revision_id) AND NOT EXISTS(SELECT 1 FROM public.m5_current_publication_pointer p WHERE p.shop_id=a.shop_id AND p.config_id=a.config_id AND p.revision_id=a.revision_id)'),
   ('product_configs', 'current', 'NOT EXISTS(SELECT 1 FROM public.config_revisions r WHERE r.shop_id=a.shop_id AND r.config_id=a.config_id) AND NOT EXISTS(SELECT 1 FROM public.publication_operations o WHERE o.shop_id=a.shop_id AND o.config_id=a.config_id)')
 ) AS targets(relation,scope,eligible)
 LOOP
   IF target.scope='current' AND NOT exact_current THEN CONTINUE; END IF;
   EXECUTE format('WITH batch AS (SELECT a.ctid FROM public.%1$I a WHERE (%2$s) AND (%3$s)
                      ORDER BY a.ctid LIMIT $3 FOR UPDATE OF a)
                   DELETE FROM public.%1$I a USING batch WHERE a.ctid=batch.ctid',
     target.relation,
     CASE target.scope
       WHEN 'exact' THEN 'a.shop_id=$1 AND a.installation_generation=$2'
       WHEN 'linked' THEN 'true'
       WHEN 'operation' THEN 'a.shop_id=$1 AND EXISTS(SELECT 1 FROM public.publication_operations o WHERE o.shop_id=a.shop_id AND o.config_id=a.config_id AND o.operation_id=a.operation_id AND o.installation_generation=$2)'
       WHEN 'destination' THEN 'EXISTS(SELECT 1 FROM public.uninstall_destinations d WHERE d.capability_digest=a.capability_digest AND d.shop_id=$1 AND d.installation_generation=$2)'
       ELSE 'a.shop_id=$1'
     END, target.eligible)
   USING p_shop,p_generation,CASE WHEN target.relation='buyer_sessions' THEN least(p_limit,10) ELSE p_limit END;
   GET DIAGNOSTICS n=ROW_COUNT;
   IF n>0 THEN RETURN 'progress'; END IF;
 END LOOP;

 IF EXISTS(SELECT 1 FROM public.artwork_assets WHERE shop_id=p_shop AND installation_generation=p_generation)
   OR EXISTS(SELECT 1 FROM public.merchant_preview_assets WHERE shop_id=p_shop AND installation_generation=p_generation)
 THEN RETURN 'storage_pending'; END IF;
 IF EXISTS(SELECT 1 FROM public.purchase_orders WHERE shop_id=p_shop AND installation_generation=p_generation)
   OR EXISTS(SELECT 1 FROM public.publication_operations WHERE shop_id=p_shop AND installation_generation=p_generation)
   OR (exact_current AND EXISTS(SELECT 1 FROM public.product_configs WHERE shop_id=p_shop))
 THEN RETURN 'dependency_pending'; END IF;
 -- A successor may already be using shop-wide data which has no generation
 -- owner. Preserve it and keep the deletion open until scope is established.
 IF NOT exact_current AND (
    EXISTS(SELECT 1 FROM public.product_configs WHERE shop_id=p_shop)
    OR EXISTS(SELECT 1 FROM public.merchant_preferences WHERE shop_id=p_shop)
    OR EXISTS(SELECT 1 FROM public.method_catalog WHERE shop_id=p_shop)
    OR EXISTS(SELECT 1 FROM public.idempotency_records WHERE shop_id=p_shop)
    OR EXISTS(SELECT 1 FROM public.outbox_events WHERE shop_id=p_shop AND installation_generation IS NULL)
 ) THEN RETURN 'dependency_pending'; END IF;
 IF EXISTS(SELECT 1 FROM public.shop_privacy_transport_scope t
   JOIN public.shopify_webhook_deliveries d ON d.inbox_id=t.inbox_id
   WHERE t.shop_id=p_shop AND t.installation_generation=p_generation)
 THEN RETURN 'dependency_pending'; END IF;
 -- Headers can identify unresolved routing for accounting, but cannot assign
 -- an unresolved body to a generation. Keep residual routing visible.
 IF EXISTS(SELECT 1 FROM public.shopify_webhook_deliveries d
   JOIN public.inbox_messages e ON e.id=d.inbox_id
   JOIN public.shops s ON s.shop_id=p_shop
   JOIN public.shop_privacy_fences f ON f.shop_id=p_shop AND f.installation_generation=p_generation
   WHERE e.installation_generation IS NULL AND (e.shop_id=p_shop OR d.shop_domain=s.shop_domain)
     AND (exact_current OR e.collected_at<=f.created_at))
 THEN RETURN 'dependency_pending'; END IF;

 -- A customer request/export or an order fence without an installation owner
 -- cannot be assigned by its shop ID after a reinstall. Keep the erasure open.
 IF EXISTS (SELECT 1 FROM public.customer_privacy_order_links l
     JOIN public.customer_privacy_receipts r USING(inbox_id) WHERE r.shop_id=p_shop)
   OR EXISTS (SELECT 1 FROM public.customer_order_erasure_fences WHERE shop_id=p_shop)
   OR EXISTS (SELECT 1 FROM public.customer_privacy_receipts WHERE shop_id=p_shop AND request_id IS NOT NULL)
 THEN RETURN 'dependency_pending'; END IF;

 -- The generation keys are used by existing runtime fences. Replace only the
 -- provider ID, including the matching historical decision backing this fence.
 UPDATE public.uninstall_privacy_recoveries r
 SET external_installation_id=public.shop_privacy_installation_token(r.shop_id,r.external_installation_id)
 WHERE r.shop_id=p_shop AND r.installation_generation=p_generation AND r.external_installation_id NOT LIKE 'erased:%';
 UPDATE public.installation_generations i
 SET external_installation_id=public.shop_privacy_installation_token(i.shop_id,i.external_installation_id)
 WHERE i.shop_id=p_shop AND i.generation=p_generation AND i.external_installation_id NOT LIKE 'erased:%';
 IF exact_current THEN
   IF EXISTS(
     SELECT 1 FROM public.installation_generations i LEFT JOIN public.shop_privacy_finalization f
       ON f.shop_id=i.shop_id AND f.installation_generation=i.generation
     WHERE i.shop_id=p_shop AND i.generation<p_generation AND f.drained_at IS NULL
   ) THEN RETURN 'dependency_pending'; END IF;
   INSERT INTO public.shop_privacy_identity(shop_id,domain_digest,provider_digest)
    SELECT s.shop_id,public.shop_privacy_digest(jsonb_build_array('shop-domain',s.shop_domain)),
      CASE WHEN s.shopify_shop_id IS NOT NULL THEN public.shop_privacy_digest(jsonb_build_array('shop-provider',s.shopify_shop_id)) END
    FROM public.shops s WHERE s.shop_id=p_shop AND s.shop_domain<>s.shop_id||'.erased.invalid'
   ON CONFLICT(shop_id) DO UPDATE SET domain_digest=EXCLUDED.domain_digest,provider_digest=EXCLUDED.provider_digest;
   UPDATE public.shops SET shop_domain=shop_id||'.erased.invalid',shopify_shop_id=NULL WHERE shop_id=p_shop;
 END IF;
 UPDATE public.shop_privacy_finalization SET drained_at=clock_timestamp()
 WHERE shop_id=p_shop AND installation_generation=p_generation;
 RETURN 'drained';
END $$;
REVOKE ALL ON FUNCTION public.finalize_shop_privacy_generation(text,bigint,integer) FROM PUBLIC;

-- Worker discovery discloses internal counts only. Serialize on the shop row
-- in the finalizer, and let least-recently-attempted fences take the next turn.
CREATE FUNCTION public.finalize_pending_shop_privacy(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target record; result text; summary jsonb:='{}';
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10 THEN
   RAISE EXCEPTION 'invalid shop privacy generation budget' USING ERRCODE='check_violation';
 END IF;
 WITH expired AS (
   SELECT inbox_id FROM public.shop_privacy_replays WHERE forget_at<=clock_timestamp()
   ORDER BY forget_at,inbox_id LIMIT 100 FOR UPDATE SKIP LOCKED
 )
 DELETE FROM public.shop_privacy_replays r USING expired WHERE r.inbox_id=expired.inbox_id;
 FOR target IN
   SELECT t.shop_id,t.installation_generation FROM public.shop_privacy_finalization_targets t
   LEFT JOIN public.shop_privacy_finalization f USING(shop_id,installation_generation)
   WHERE f.drained_at IS NULL ORDER BY f.attempted_at NULLS FIRST,t.shop_id,t.installation_generation LIMIT p_limit
 LOOP
   BEGIN
     result:=public.finalize_shop_privacy_generation(target.shop_id,target.installation_generation,100);
   EXCEPTION WHEN lock_not_available THEN
     result:='busy';
   WHEN OTHERS THEN
     -- A failed transaction slice cannot prevent other fenced shops from progressing.
     INSERT INTO public.shop_privacy_finalization VALUES(target.shop_id,target.installation_generation,clock_timestamp(),NULL)
     ON CONFLICT (shop_id,installation_generation) DO UPDATE SET attempted_at=EXCLUDED.attempted_at;
     result:='failed';
   END;
   summary:=jsonb_set(summary,ARRAY[result],to_jsonb(coalesce((summary->>result)::integer,0)+1));
 END LOOP;
 RETURN summary;
END $$;
REVOKE ALL ON FUNCTION public.finalize_pending_shop_privacy(integer) FROM PUBLIC;

-- migrate:down
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.shop_privacy_finalization) OR EXISTS(SELECT 1 FROM public.shop_privacy_replays) THEN
   RAISE EXCEPTION 'shop privacy finalization has started';
 END IF;
END $$;
DROP FUNCTION public.finalize_pending_shop_privacy(integer);
DROP FUNCTION public.finalize_shop_privacy_generation(text,bigint,integer);
DROP FUNCTION public.reattach_erased_shop(text,bigint,text,text,timestamptz);
DROP FUNCTION public.find_erased_shop(text,text);
DROP FUNCTION public.shop_installation_was_seen(text,text);
DROP FUNCTION public.shop_privacy_installation_token(text,text);
DROP TABLE public.shop_privacy_identity;
DROP FUNCTION public.compact_erased_shopify_delivery(uuid);
DROP FUNCTION public.has_compacted_shop_uninstall(text,timestamptz);
DROP FUNCTION public.lookup_shop_privacy_replay(text,text,text,text,timestamptz,text,text,text);
DROP FUNCTION public.shop_privacy_replay_digest(text,text,timestamptz,text,text,text);
DROP FUNCTION public.shop_privacy_digest(jsonb);
DROP TABLE public.shop_privacy_replays,public.shop_privacy_proof_key;

CREATE OR REPLACE FUNCTION public.stage_shop_privacy_inbox(p_inbox uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.inbox_messages%ROWTYPE; saved public.customer_privacy_receipts%ROWTYPE;
 body jsonb; target public.shops%ROWTYPE; installed public.installation_generations%ROWTYPE;
 operation text; item record; matched integer; at_time timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO receipt FROM public.inbox_messages WHERE id=p_inbox;
 IF NOT FOUND THEN RAISE EXCEPTION 'privacy inbox not found' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO saved FROM public.customer_privacy_receipts WHERE inbox_id=p_inbox;
 IF FOUND THEN
  IF saved.raw_body_sha256<>receipt.payload_sha256 THEN RAISE EXCEPTION 'privacy receipt integrity conflict' USING ERRCODE='check_violation'; END IF;
  RETURN jsonb_build_object('kind',saved.operation,'shopId',saved.shop_id,'requestedOrderCount',saved.requested_order_count,'matchedPurchaseCount',saved.matched_purchase_count);
 END IF;
 IF receipt.source<>'shopify' OR receipt.retention_class<>'shopify-webhook' OR receipt.erasure_state<>'retained'
  OR NOT coalesce(receipt.purge_after>at_time AND isfinite(receipt.purge_after),false)
  OR encode(sha256(receipt.payload),'hex')<>receipt.payload_sha256
  OR NOT EXISTS(SELECT 1 FROM public.shopify_webhook_deliveries WHERE inbox_id=p_inbox)
 THEN RAISE EXCEPTION 'privacy retained body unavailable' USING ERRCODE='check_violation'; END IF;
 body:=convert_from(receipt.payload,'UTF8')::jsonb;
 IF jsonb_typeof(body)<>'object' OR body->>'shop_id' IS NULL OR body->>'shop_id' !~ '^[1-9][0-9]{0,19}$'
  OR (body->>'shop_id')::numeric>18446744073709551615
  OR jsonb_typeof(body->'shop_domain') IS DISTINCT FROM 'string'
  OR (SELECT count(*) FROM jsonb_object_keys(body))<>2
 THEN RAISE EXCEPTION 'not an exact shop privacy body' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO target FROM public.shops WHERE shopify_shop_id=body->>'shop_id' AND shop_domain=body->>'shop_domain' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'privacy signed shop is unknown' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO receipt FROM public.inbox_messages WHERE id=p_inbox FOR UPDATE NOWAIT;
 SELECT * INTO saved FROM public.customer_privacy_receipts WHERE inbox_id=p_inbox;
 IF FOUND THEN RETURN jsonb_build_object('kind',saved.operation,'shopId',saved.shop_id,'requestedOrderCount',saved.requested_order_count,'matchedPurchaseCount',saved.matched_purchase_count); END IF;
 IF receipt.erasure_state<>'retained' OR receipt.purge_after<=clock_timestamp()
  OR encode(sha256(receipt.payload),'hex')<>receipt.payload_sha256 OR convert_from(receipt.payload,'UTF8')::jsonb IS DISTINCT FROM body
  OR (receipt.shop_id IS NOT NULL AND receipt.shop_id<>target.shop_id)
 THEN RAISE EXCEPTION 'privacy inbox changed or routed to another shop' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO installed FROM public.installation_generations WHERE shop_id=target.shop_id AND generation=target.current_generation FOR UPDATE;
 -- The signed payload contains no generation. Only an already independently
 -- inactive installation preceding collection is eligible. A delayed request
 -- seen while active is a permanent operator hold, never a later automatic grant.
 operation:=CASE WHEN installed.deactivated_at IS NOT NULL AND installed.deactivated_at<=receipt.collected_at
  THEN 'SHOP_ERASURE_STAGED' ELSE 'SHOP_ERASURE_BLOCKED' END;
 SELECT count(*) INTO matched FROM public.purchase_orders WHERE shop_id=target.shop_id AND installation_generation<=target.current_generation;
 INSERT INTO public.customer_privacy_receipts(inbox_id,shop_id,raw_body_sha256,operation,request_id,requested_order_count,matched_purchase_count)
 VALUES(p_inbox,target.shop_id,receipt.payload_sha256,operation,NULL,0,matched);
 IF operation='SHOP_ERASURE_STAGED' THEN
  INSERT INTO public.shop_privacy_fences(shop_id,installation_generation,source_inbox_id)
   SELECT shop_id,generation,p_inbox FROM public.installation_generations WHERE shop_id=target.shop_id AND generation<=target.current_generation ON CONFLICT DO NOTHING;
  INSERT INTO public.customer_privacy_order_links SELECT p_inbox,order_id FROM public.purchase_orders WHERE shop_id=target.shop_id AND installation_generation<=target.current_generation ON CONFLICT DO NOTHING;
  INSERT INTO public.customer_order_erasure_fences SELECT target.shop_id,order_id,p_inbox,at_time FROM public.customer_privacy_order_links WHERE inbox_id=p_inbox ON CONFLICT DO NOTHING;
  FOR item IN SELECT quote_id FROM public.accepted_quotes WHERE shop_id=target.shop_id AND installation_generation<=target.current_generation ORDER BY quote_id
  LOOP PERFORM public.customer_privacy_fence_quote(target.shop_id,item.quote_id,p_inbox); END LOOP;
  FOR item IN SELECT asset_id FROM public.artwork_assets WHERE shop_id=target.shop_id AND installation_generation<=target.current_generation ORDER BY asset_id
  LOOP PERFORM public.customer_privacy_fence_asset(target.shop_id,item.asset_id,p_inbox); END LOOP;
  UPDATE public.purchase_design_payloads SET payload=NULL,erased_at=at_time WHERE shop_id=target.shop_id AND installation_generation<=target.current_generation AND erased_at IS NULL;
  UPDATE public.purchase_offer_payloads SET payload=NULL,erased_at=at_time WHERE shop_id=target.shop_id AND installation_generation<=target.current_generation AND erased_at IS NULL;
  UPDATE public.purchase_artwork_events SET asset_id=NULL,placement_id=NULL,group_index=NULL,erased_at=at_time WHERE shop_id=target.shop_id AND installation_generation<=target.current_generation AND kind='ATTACH' AND erased_at IS NULL;
  -- Buyer sessions are not deleted here (#406): see the header of this migration.
  -- Existing inactive-generation merchant-preview and lease-aware artwork
  -- cleaners own physical deletion. Their keys, custody claims and deadlines
  -- must remain intact until that separate cleanup actually settles.
 END IF;
 RETURN jsonb_build_object('kind',operation,'shopId',target.shop_id,'requestedOrderCount',0,'matchedPurchaseCount',matched);
END $$;
CREATE OR REPLACE FUNCTION public.recover_uninstall_privacy(p_privacy uuid,p_uninstall uuid) RETURNS jsonb
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
 -- Buyer sessions are not deleted here (#406): see the header of this migration.
 RETURN jsonb_build_object('kind','GENERATION_ERASURE_STAGED','shopId',destination.shop_id,'installationGeneration',destination.installation_generation::text);
END $$;
CREATE OR REPLACE FUNCTION public.recover_pending_uninstall_privacy(p_limit integer DEFAULT 100) RETURNS integer
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
DROP VIEW public.shop_privacy_transport_scope;
DROP VIEW public.shop_privacy_finalization_targets;
DROP TRIGGER uninstall_destination_delete_guard ON public.uninstall_destinations;
CREATE OR REPLACE TRIGGER uninstall_destination_guard BEFORE UPDATE OR DELETE ON public.uninstall_destinations
 FOR EACH ROW EXECUTE FUNCTION public.guard_uninstall_destination();
DROP FUNCTION public.guard_uninstall_destination_delete();
CREATE OR REPLACE FUNCTION public.guard_owner_lifecycle_decisions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'owner lifecycle decisions are append-only' USING ERRCODE='check_violation'; END $$;
CREATE OR REPLACE FUNCTION public.reject_activation_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'activation evidence is immutable' USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE OR REPLACE FUNCTION public.forbid_trusted_release_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trusted release evidence is append-only' USING ERRCODE = 'check_violation';
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_publication_abandonment_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'publication abandonment audit is append-only' USING ERRCODE='check_violation'; END $$;

CREATE OR REPLACE FUNCTION public.guard_method_catalog_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF pg_trigger_depth()<2 OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.method_catalog'::regclass)
  THEN RAISE EXCEPTION 'qualified method identity erasure required' USING ERRCODE='check_violation'; END IF;
  RETURN OLD;
 END IF;
 IF ROW(NEW.shop_id,NEW.method_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.shop_id,OLD.method_id,OLD.created_at) OR OLD.deleted_at IS NOT NULL
 THEN RAISE EXCEPTION 'method identity or tombstone is immutable' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.reject_quote_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'accepted quote and authorization rows are immutable' USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'config revisions are immutable' USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
DROP TRIGGER m9_order_usage_delete_guard ON public.m9_order_usage;
DROP TRIGGER m9_usage_delivery_intents_delete_guard ON public.m9_usage_delivery_intents;
CREATE OR REPLACE TRIGGER m9_order_usage_guard BEFORE INSERT OR UPDATE OR DELETE ON public.m9_order_usage
 FOR EACH ROW EXECUTE FUNCTION public.guard_m9_order_usage();
CREATE OR REPLACE TRIGGER m9_usage_delivery_intents_guard BEFORE INSERT OR UPDATE OR DELETE ON public.m9_usage_delivery_intents
 FOR EACH ROW EXECUTE FUNCTION public.guard_m9_usage_delivery_intents();
DROP FUNCTION public.guard_shop_privacy_usage_delete();
DROP FUNCTION public.shop_privacy_delete_scope(text,text);
DROP TABLE public.shop_privacy_finalization;
