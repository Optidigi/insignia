-- migrate:up
-- #406: shop privacy erasure and uninstall privacy recovery deleted every buyer session of the shop
-- (generation) in one statement. A full session cascades to ~1,600 rows (#371), so a shop with many
-- sessions outlasted the worker's 10 s statement timeout; the whole erasure rolled back and retried
-- forever. Neither function deletes sessions any more. Each still records the shop_privacy_fences
-- row that makes the generation's private reingestion impossible (design_drafts and quote_proposals
-- reject inserts for a fenced generation), and a session of a deactivated or superseded generation
-- cannot be issued or used. The sessions are removed by cleanup_buyer_payloads, which the worker
-- already runs as ten-session statements (#404) and whose predicate (session not of the shop's
-- current, active generation) covers every generation either function fences: staging requires the
-- shop's current generation to be deactivated, and recovery requires its generation to be.
-- Only these two function bodies change; signatures, owners and grants are untouched.
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

-- migrate:down
-- Restores the previous bodies, which delete the sessions inline.
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
  DELETE FROM public.buyer_sessions WHERE shop_id=target.shop_id AND installation_generation<=target.current_generation;
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
 DELETE FROM public.buyer_sessions WHERE shop_id=destination.shop_id AND installation_generation=destination.installation_generation;
 RETURN jsonb_build_object('kind','GENERATION_ERASURE_STAGED','shopId',destination.shop_id,'installationGeneration',destination.installation_generation::text);
END $$;
