-- migrate:up
ALTER TABLE customer_privacy_receipts DROP CONSTRAINT customer_privacy_receipts_operation_check;
ALTER TABLE customer_privacy_receipts ADD CHECK(operation IN ('DATA_REQUEST_PENDING_EXPORT','ERASURE_STAGED','SHOP_ERASURE_STAGED','SHOP_ERASURE_BLOCKED'));
CREATE TABLE shop_privacy_fences (
 shop_id text NOT NULL, installation_generation bigint NOT NULL,
 source_inbox_id uuid NOT NULL REFERENCES customer_privacy_receipts(inbox_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(shop_id,installation_generation),
 FOREIGN KEY(shop_id,installation_generation) REFERENCES installation_generations(shop_id,generation)
);
REVOKE ALL ON shop_privacy_fences FROM PUBLIC;
CREATE TRIGGER shop_privacy_fence_immutable BEFORE UPDATE OR DELETE ON shop_privacy_fences FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();

CREATE FUNCTION public.stage_shop_privacy_inbox(p_inbox uuid) RETURNS jsonb
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
  DELETE FROM public.buyer_sessions WHERE shop_id=target.shop_id AND installation_generation<=target.current_generation;
  -- Existing inactive-generation merchant-preview and lease-aware artwork
  -- cleaners own physical deletion. Their keys, custody claims and deadlines
  -- must remain intact until that separate cleanup actually settles.
 END IF;
 RETURN jsonb_build_object('kind',operation,'shopId',target.shop_id,'requestedOrderCount',0,'matchedPurchaseCount',matched);
END $$;
REVOKE ALL ON FUNCTION public.stage_shop_privacy_inbox(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.stage_customer_privacy_inbox(p_inbox uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.inbox_messages%ROWTYPE; saved public.customer_privacy_receipts%ROWTYPE;
 body jsonb; orders jsonb; operation text; provider_shop text; target_shop text; item record;
 requested_count integer; matched_count integer; at_time timestamptz:=clock_timestamp();
BEGIN
 -- Resolve shop from body before acquiring locks; all writes lock shop -> inbox,
 -- matching purchase/artwork operations. NOWAIT on the inbox avoids a lock cycle
 -- with ingress resolution (inbox -> shop); contention rolls back before any effect.
 -- Re-read bytes after acquiring both locks.
 SELECT * INTO receipt FROM public.inbox_messages WHERE id=p_inbox;
 IF NOT FOUND THEN RAISE EXCEPTION 'privacy inbox not found' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO saved FROM public.customer_privacy_receipts WHERE inbox_id=p_inbox;
 IF FOUND THEN
  IF saved.raw_body_sha256<>receipt.payload_sha256 THEN RAISE EXCEPTION 'privacy receipt integrity conflict' USING ERRCODE='check_violation'; END IF;
  RETURN jsonb_build_object('kind',saved.operation,'shopId',saved.shop_id,'requestedOrderCount',saved.requested_order_count,'matchedPurchaseCount',saved.matched_purchase_count);
 END IF;
 IF receipt.source<>'shopify' OR receipt.retention_class<>'shopify-webhook' OR receipt.erasure_state<>'retained'
  OR NOT coalesce(receipt.purge_after>at_time AND isfinite(receipt.purge_after),false)
  OR octet_length(receipt.payload)>8388608 OR encode(sha256(receipt.payload),'hex')<>receipt.payload_sha256
  OR NOT EXISTS(SELECT 1 FROM public.shopify_webhook_deliveries WHERE inbox_id=p_inbox)
 THEN RAISE EXCEPTION 'privacy retained body unavailable' USING ERRCODE='check_violation'; END IF;
 body:=convert_from(receipt.payload,'UTF8')::jsonb;
 provider_shop:=body->>'shop_id';
 IF jsonb_typeof(body)<>'object' OR provider_shop IS NULL OR provider_shop !~ '^[1-9][0-9]{0,19}$' OR provider_shop::numeric>18446744073709551615
  OR jsonb_typeof(body->'customer') IS DISTINCT FROM 'object' OR NOT coalesce((body#>>'{customer,id}' ~ '^[1-9][0-9]{0,19}$' AND (body#>>'{customer,id}')::numeric<=18446744073709551615)
    OR (NOT(body->'customer' ? 'id') AND jsonb_typeof(body#>'{customer,email}')='string' AND length(body#>>'{customer,email}') BETWEEN 1 AND 320),false)
  OR ((body ? 'orders_requested')=(body ? 'orders_to_redact'))
 THEN RAISE EXCEPTION 'not an exact customer privacy body' USING ERRCODE='check_violation'; END IF;
 IF body ? 'orders_requested' THEN
  IF jsonb_typeof(body->'data_request') IS DISTINCT FROM 'object' OR body#>>'{data_request,id}' IS NULL OR body#>>'{data_request,id}' !~ '^[1-9][0-9]{0,19}$'
  THEN RAISE EXCEPTION 'customer data request identity missing' USING ERRCODE='check_violation'; END IF;
  operation:='DATA_REQUEST_PENDING_EXPORT'; orders:=body->'orders_requested';
 ELSE
  IF body ? 'data_request' THEN RAISE EXCEPTION 'ambiguous customer redact body' USING ERRCODE='check_violation'; END IF;
  operation:='ERASURE_STAGED'; orders:=body->'orders_to_redact';
 END IF;
 IF jsonb_typeof(orders) IS DISTINCT FROM 'array' OR jsonb_array_length(orders)>1000 THEN RAISE EXCEPTION 'privacy order budget or shape' USING ERRCODE='check_violation'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(orders) entry WHERE jsonb_typeof(entry) NOT IN ('number','string') OR entry#>>'{}' !~ '^[1-9][0-9]{0,19}$' OR (entry#>>'{}')::numeric>18446744073709551615)
 THEN RAISE EXCEPTION 'privacy order identity invalid' USING ERRCODE='check_violation'; END IF;
 SELECT shop_id INTO target_shop FROM public.shops WHERE shopify_shop_id=provider_shop FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'privacy signed shop is unknown' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO receipt FROM public.inbox_messages WHERE id=p_inbox FOR UPDATE NOWAIT;
 SELECT * INTO saved FROM public.customer_privacy_receipts WHERE inbox_id=p_inbox;
 IF FOUND THEN RETURN jsonb_build_object('kind',saved.operation,'shopId',saved.shop_id,'requestedOrderCount',saved.requested_order_count,'matchedPurchaseCount',saved.matched_purchase_count); END IF;
 IF encode(sha256(receipt.payload),'hex')<>receipt.payload_sha256 OR convert_from(receipt.payload,'UTF8')::jsonb IS DISTINCT FROM body
  OR receipt.erasure_state<>'retained' OR receipt.purge_after<=clock_timestamp()
  OR (receipt.shop_id IS NOT NULL AND receipt.shop_id<>target_shop)
 THEN RAISE EXCEPTION 'privacy inbox changed or routed to another shop' USING ERRCODE='check_violation'; END IF;
 SELECT count(DISTINCT entry#>>'{}') INTO requested_count FROM jsonb_array_elements(orders) entry;
 SELECT count(*) INTO matched_count FROM public.purchase_orders p WHERE p.shop_id=target_shop AND p.order_id IN (SELECT 'gid://shopify/Order/'||(entry#>>'{}') FROM jsonb_array_elements(orders) entry);
 INSERT INTO public.customer_privacy_receipts(inbox_id,shop_id,raw_body_sha256,operation,request_id,requested_order_count,matched_purchase_count)
 VALUES(p_inbox,target_shop,receipt.payload_sha256,operation,body#>>'{data_request,id}',requested_count,matched_count);
 INSERT INTO public.customer_privacy_order_links SELECT p_inbox,'gid://shopify/Order/'||(entry#>>'{}') FROM jsonb_array_elements(orders) entry ON CONFLICT DO NOTHING;
 IF operation='ERASURE_STAGED' THEN
  INSERT INTO public.customer_order_erasure_fences(shop_id,order_id,source_inbox_id) SELECT target_shop,order_id,p_inbox FROM public.customer_privacy_order_links WHERE inbox_id=p_inbox ON CONFLICT DO NOTHING;
  FOR item IN SELECT DISTINCT b.quote_id FROM public.purchase_orders p JOIN public.purchase_bindings b USING(purchase_id)
   JOIN public.customer_privacy_order_links l ON l.order_id=p.order_id AND l.inbox_id=p_inbox WHERE p.shop_id=target_shop ORDER BY b.quote_id
  LOOP PERFORM public.customer_privacy_fence_quote(target_shop,item.quote_id,p_inbox); END LOOP;
  FOR item IN SELECT e.asset_id FROM public.purchase_artwork_events e JOIN public.purchase_orders p USING(purchase_id)
   JOIN public.customer_privacy_order_links l ON l.order_id=p.order_id AND l.inbox_id=p_inbox WHERE p.shop_id=target_shop AND e.kind='ATTACH' AND e.asset_id IS NOT NULL ORDER BY e.asset_id
  LOOP PERFORM public.customer_privacy_fence_asset(target_shop,item.asset_id,p_inbox); END LOOP;
  UPDATE public.purchase_artwork_events e SET asset_id=NULL,placement_id=NULL,group_index=NULL,erased_at=at_time FROM public.purchase_orders p,public.customer_privacy_order_links l
   WHERE e.purchase_id=p.purchase_id AND p.shop_id=target_shop AND l.inbox_id=p_inbox AND l.order_id=p.order_id AND e.kind='ATTACH' AND e.erased_at IS NULL;
  UPDATE public.inbox_messages SET payload=''::bytea,erasure_state='erased',state='processed',last_error_class=NULL,lease_owner=NULL,lease_until=NULL WHERE id=p_inbox;
 END IF;
 -- Request receipt is durable lookup/export-pending, not fulfillment; retain its
 -- original inbox/deadline while the separate export/delivery capability is open.
 RETURN jsonb_build_object('kind',operation,'shopId',target_shop,'requestedOrderCount',requested_count,'matchedPurchaseCount',matched_count);
END $$;

CREATE OR REPLACE FUNCTION public.guard_customer_private_ingestion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source_id uuid; item record; private_value jsonb;
BEGIN
 -- A fresh statement snapshot after this share lock observes any committed
 -- erasure; the eraser's exclusive shop lock serializes direct role inserts too.
 PERFORM 1 FROM public.shops WHERE shop_id=NEW.shop_id FOR SHARE;
 SELECT f.source_inbox_id INTO source_id FROM public.shop_privacy_fences f WHERE f.shop_id=NEW.shop_id AND f.installation_generation=NEW.installation_generation;
 IF FOUND THEN
  IF TG_TABLE_NAME='purchase_bindings' THEN
   PERFORM public.customer_privacy_fence_quote(NEW.shop_id,NEW.quote_id,source_id);
  ELSIF TG_TABLE_NAME IN ('purchase_offer_payloads','purchase_design_payloads') THEN
   PERFORM public.customer_privacy_fence_payload(NEW.shop_id,CASE WHEN TG_TABLE_NAME='purchase_design_payloads' THEN NEW.payload->'request' ELSE NEW.payload END,source_id);
   NEW.payload:=NULL; NEW.erased_at:=clock_timestamp();
  ELSIF TG_TABLE_NAME='artwork_assets' THEN
   IF NEW.state NOT IN ('DELETING','DELETED') THEN RAISE EXCEPTION 'shop erased artwork cannot resume' USING ERRCODE='check_violation'; END IF;
  ELSIF TG_TABLE_NAME IN ('quote_proposals','design_drafts') THEN
   RAISE EXCEPTION 'shop erasure prevents private reingestion' USING ERRCODE='check_violation';
  ELSIF TG_TABLE_NAME='purchase_artwork_events' THEN
   IF NEW.kind='ATTACH' THEN RAISE EXCEPTION 'shop erasure prevents artwork attachment' USING ERRCODE='check_violation'; END IF;
  END IF;
  RETURN NEW;
 END IF;

 IF TG_TABLE_NAME='purchase_bindings' THEN
  SELECT f.source_inbox_id INTO source_id FROM public.customer_order_erasure_fences f JOIN public.purchase_orders p USING(shop_id,order_id) WHERE p.purchase_id=NEW.purchase_id AND p.shop_id=NEW.shop_id;
  IF FOUND THEN PERFORM public.customer_privacy_fence_quote(NEW.shop_id,NEW.quote_id,source_id); END IF;
 ELSIF TG_TABLE_NAME='purchase_offer_payloads' OR TG_TABLE_NAME='purchase_design_payloads' THEN
  IF TG_TABLE_NAME='purchase_offer_payloads' THEN
   SELECT source_inbox_id INTO source_id FROM public.customer_quote_erasure_fences WHERE shop_id=NEW.shop_id AND quote_id=NEW.quote_id;
  ELSE
   SELECT candidate.source_inbox_id INTO source_id FROM (
    SELECT f.source_inbox_id FROM public.customer_order_erasure_fences f JOIN public.purchase_orders p USING(shop_id,order_id) WHERE p.purchase_id=NEW.purchase_id AND p.shop_id=NEW.shop_id
    UNION ALL SELECT f.source_inbox_id FROM public.customer_quote_erasure_fences f JOIN public.purchase_bindings b USING(shop_id,quote_id) WHERE b.purchase_id=NEW.purchase_id AND b.set_id=NEW.set_id AND b.shop_id=NEW.shop_id
   ) candidate LIMIT 1;
  END IF;
  IF source_id IS NOT NULL THEN
   PERFORM public.customer_privacy_fence_payload(NEW.shop_id,CASE WHEN TG_TABLE_NAME='purchase_design_payloads' THEN NEW.payload->'request' ELSE NEW.payload END,source_id);
   NEW.payload:=NULL; NEW.erased_at:=clock_timestamp();
  END IF;
 ELSIF TG_TABLE_NAME='purchase_artwork_events' THEN
  IF NEW.kind='ATTACH' AND (EXISTS(SELECT 1 FROM public.customer_order_erasure_fences f JOIN public.purchase_orders p USING(shop_id,order_id) WHERE p.purchase_id=NEW.purchase_id)
   OR EXISTS(SELECT 1 FROM public.customer_asset_erasure_fences WHERE shop_id=NEW.shop_id AND asset_id=NEW.asset_id)
   OR EXISTS(SELECT 1 FROM public.customer_quote_erasure_fences f JOIN public.purchase_bindings b USING(shop_id,quote_id) WHERE b.purchase_id=NEW.purchase_id AND b.shop_id=NEW.shop_id))
  THEN RAISE EXCEPTION 'customer erasure prevents artwork attachment' USING ERRCODE='check_violation'; END IF;
 ELSIF TG_TABLE_NAME='artwork_assets' THEN
  IF EXISTS(SELECT 1 FROM public.customer_asset_erasure_fences WHERE shop_id=NEW.shop_id AND asset_id=NEW.asset_id) AND NEW.state NOT IN ('DELETING','DELETED')
  THEN RAISE EXCEPTION 'customer erased artwork cannot resume' USING ERRCODE='check_violation'; END IF;
 ELSIF TG_TABLE_NAME IN ('quote_proposals','design_drafts') THEN
  IF TG_TABLE_NAME='quote_proposals' THEN private_value:=NEW.desired_request; ELSE private_value:=NEW.payload; END IF;
  FOR item IN SELECT asset_id FROM public.customer_privacy_payload_assets(private_value) LOOP
   IF EXISTS(SELECT 1 FROM public.customer_asset_erasure_fences WHERE shop_id=NEW.shop_id AND asset_id=item.asset_id)
   THEN RAISE EXCEPTION 'customer erased artwork cannot be reingested' USING ERRCODE='check_violation'; END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;

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


-- Only signed body resource types supply linkage; unsigned topic/domain headers
-- and generic integer id fields never select another receipt for erasure.
CREATE FUNCTION public.privacy_webhook_identity(p_bytes bytea) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE body jsonb; order_ref text;
BEGIN
 body:=convert_from(p_bytes,'UTF8')::jsonb;
 IF jsonb_typeof(body)<>'object' THEN RETURN '{}'::jsonb; END IF;
 IF body->>'admin_graphql_api_id'='gid://shopify/Order/'||(body->>'id') AND body->>'id' ~ '^[1-9][0-9]{0,19}$' THEN order_ref:=body->>'admin_graphql_api_id';
 ELSIF body->>'admin_graphql_api_id'='gid://shopify/Refund/'||(body->>'id') AND body->>'id' ~ '^[1-9][0-9]{0,19}$' AND body->>'order_id' ~ '^[1-9][0-9]{0,19}$' THEN order_ref:='gid://shopify/Order/'||(body->>'order_id'); END IF;
 RETURN jsonb_build_object('order',order_ref,'shop',body->>'shop_id');
EXCEPTION WHEN invalid_text_representation OR character_not_in_repertoire OR numeric_value_out_of_range OR untranslatable_character OR statement_too_complex THEN RETURN '{}'::jsonb;
END $$;
REVOKE ALL ON FUNCTION public.privacy_webhook_identity(bytea) FROM PUBLIC;
CREATE FUNCTION public.cleanup_customer_privacy_inboxes(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record; erased integer:=0;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'invalid privacy inbox budget'; END IF;
 FOR item IN SELECT m.id FROM public.inbox_messages m
  WHERE m.source='shopify' AND m.retention_class='shopify-webhook' AND m.erasure_state='retained' AND m.state='processed'
   AND encode(sha256(m.payload),'hex')=m.payload_sha256
   AND (EXISTS(SELECT 1 FROM public.customer_order_erasure_fences f JOIN public.purchase_orders p ON p.shop_id=f.shop_id AND p.order_id=f.order_id
      WHERE f.order_id=public.privacy_webhook_identity(m.payload)->>'order')
    OR EXISTS(SELECT 1 FROM public.shop_privacy_fences f JOIN public.shops s ON s.shop_id=f.shop_id
      JOIN public.inbox_messages source ON source.id=f.source_inbox_id
      WHERE m.collected_at<=source.collected_at AND s.shopify_shop_id=public.privacy_webhook_identity(m.payload)->>'shop'
       AND (m.installation_generation IS NULL OR (m.shop_id=f.shop_id AND m.installation_generation<=f.installation_generation))))
  ORDER BY m.collected_at,m.id LIMIT p_limit FOR UPDATE OF m SKIP LOCKED
 LOOP
  UPDATE public.inbox_messages SET payload=''::bytea,erasure_state='erased',state='processed',last_error_class=NULL,lease_owner=NULL,lease_until=NULL WHERE id=item.id;
  UPDATE public.webhook_obligation_facts SET captured_fields='{}',facts_erased_at=coalesce(facts_erased_at,clock_timestamp()) WHERE inbox_id=item.id;
  UPDATE public.shopify_webhook_deliveries SET queue_cleanup_pending=true WHERE inbox_id=item.id;
  erased:=erased+1;
 END LOOP;
 RETURN erased;
END $$;
REVOKE ALL ON FUNCTION public.cleanup_customer_privacy_inboxes(integer) FROM PUBLIC;


CREATE FUNCTION public.blocked_shop_privacy_count() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT count(*)::integer FROM public.customer_privacy_receipts WHERE operation='SHOP_ERASURE_BLOCKED'
$$;
REVOKE ALL ON FUNCTION public.blocked_shop_privacy_count() FROM PUBLIC;

-- migrate:down
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM customer_privacy_receipts WHERE operation IN ('SHOP_ERASURE_STAGED','SHOP_ERASURE_BLOCKED')) THEN RAISE EXCEPTION 'shop erasure decisions prevent rollback'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.guard_customer_private_ingestion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source_id uuid; item record; private_value jsonb;
BEGIN
 -- A fresh statement snapshot after this share lock observes any committed
 -- erasure; the eraser's exclusive shop lock serializes direct role inserts too.
 PERFORM 1 FROM public.shops WHERE shop_id=NEW.shop_id FOR SHARE;
 IF TG_TABLE_NAME='purchase_bindings' THEN
  SELECT f.source_inbox_id INTO source_id FROM public.customer_order_erasure_fences f JOIN public.purchase_orders p USING(shop_id,order_id) WHERE p.purchase_id=NEW.purchase_id AND p.shop_id=NEW.shop_id;
  IF FOUND THEN PERFORM public.customer_privacy_fence_quote(NEW.shop_id,NEW.quote_id,source_id); END IF;
 ELSIF TG_TABLE_NAME='purchase_offer_payloads' OR TG_TABLE_NAME='purchase_design_payloads' THEN
  IF TG_TABLE_NAME='purchase_offer_payloads' THEN
   SELECT source_inbox_id INTO source_id FROM public.customer_quote_erasure_fences WHERE shop_id=NEW.shop_id AND quote_id=NEW.quote_id;
  ELSE
   SELECT candidate.source_inbox_id INTO source_id FROM (
    SELECT f.source_inbox_id FROM public.customer_order_erasure_fences f JOIN public.purchase_orders p USING(shop_id,order_id) WHERE p.purchase_id=NEW.purchase_id AND p.shop_id=NEW.shop_id
    UNION ALL SELECT f.source_inbox_id FROM public.customer_quote_erasure_fences f JOIN public.purchase_bindings b USING(shop_id,quote_id) WHERE b.purchase_id=NEW.purchase_id AND b.set_id=NEW.set_id AND b.shop_id=NEW.shop_id
   ) candidate LIMIT 1;
  END IF;
  IF source_id IS NOT NULL THEN
   PERFORM public.customer_privacy_fence_payload(NEW.shop_id,CASE WHEN TG_TABLE_NAME='purchase_design_payloads' THEN NEW.payload->'request' ELSE NEW.payload END,source_id);
   NEW.payload:=NULL; NEW.erased_at:=clock_timestamp();
  END IF;
 ELSIF TG_TABLE_NAME='purchase_artwork_events' THEN
  IF NEW.kind='ATTACH' AND (EXISTS(SELECT 1 FROM public.customer_order_erasure_fences f JOIN public.purchase_orders p USING(shop_id,order_id) WHERE p.purchase_id=NEW.purchase_id)
   OR EXISTS(SELECT 1 FROM public.customer_asset_erasure_fences WHERE shop_id=NEW.shop_id AND asset_id=NEW.asset_id)
   OR EXISTS(SELECT 1 FROM public.customer_quote_erasure_fences f JOIN public.purchase_bindings b USING(shop_id,quote_id) WHERE b.purchase_id=NEW.purchase_id AND b.shop_id=NEW.shop_id))
  THEN RAISE EXCEPTION 'customer erasure prevents artwork attachment' USING ERRCODE='check_violation'; END IF;
 ELSIF TG_TABLE_NAME='artwork_assets' THEN
  IF EXISTS(SELECT 1 FROM public.customer_asset_erasure_fences WHERE shop_id=NEW.shop_id AND asset_id=NEW.asset_id) AND NEW.state NOT IN ('DELETING','DELETED')
  THEN RAISE EXCEPTION 'customer erased artwork cannot resume' USING ERRCODE='check_violation'; END IF;
 ELSIF TG_TABLE_NAME IN ('quote_proposals','design_drafts') THEN
  IF TG_TABLE_NAME='quote_proposals' THEN private_value:=NEW.desired_request; ELSE private_value:=NEW.payload; END IF;
  FOR item IN SELECT asset_id FROM public.customer_privacy_payload_assets(private_value) LOOP
   IF EXISTS(SELECT 1 FROM public.customer_asset_erasure_fences WHERE shop_id=NEW.shop_id AND asset_id=item.asset_id)
   THEN RAISE EXCEPTION 'customer erased artwork cannot be reingested' USING ERRCODE='check_violation'; END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.process_customer_privacy_inbox(p_inbox uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 result:=public.stage_customer_privacy_inbox(p_inbox);
 UPDATE public.inbox_messages SET payload=''::bytea,erasure_state='erased',state='processed',last_error_class=NULL,lease_owner=NULL,lease_until=NULL WHERE id=p_inbox;
 UPDATE public.webhook_obligation_facts SET captured_fields='{}',facts_erased_at=coalesce(facts_erased_at,clock_timestamp()) WHERE inbox_id=p_inbox;
 UPDATE public.shopify_webhook_deliveries SET queue_cleanup_pending=true WHERE inbox_id=p_inbox;
 RETURN result;
END $$;
DROP FUNCTION public.blocked_shop_privacy_count();
DROP FUNCTION public.cleanup_customer_privacy_inboxes(integer),public.privacy_webhook_identity(bytea);
DROP TRIGGER shop_privacy_fence_immutable ON shop_privacy_fences;
DROP TABLE shop_privacy_fences;
DROP FUNCTION public.stage_shop_privacy_inbox(uuid);
ALTER TABLE customer_privacy_receipts DROP CONSTRAINT customer_privacy_receipts_operation_check;
ALTER TABLE customer_privacy_receipts ADD CHECK(operation IN ('DATA_REQUEST_PENDING_EXPORT','ERASURE_STAGED'));
