-- migrate:up
-- First customer-order privacy seam. Ingress verifies HMAC before committing this inbox;
-- this definer derives purpose/shop/orders from those exact retained bytes, never headers
-- or caller-supplied authority. Economic facts are not erased by this migration.
CREATE TABLE customer_privacy_receipts (
 inbox_id uuid PRIMARY KEY REFERENCES inbox_messages(id), shop_id text NOT NULL REFERENCES shops(shop_id),
 raw_body_sha256 text NOT NULL CHECK(raw_body_sha256 ~ '^[a-f0-9]{64}$'),
 operation text NOT NULL CHECK(operation IN ('DATA_REQUEST_PENDING_EXPORT','ERASURE_STAGED')),
 request_id text, requested_order_count integer NOT NULL CHECK(requested_order_count BETWEEN 0 AND 1000),
 matched_purchase_count integer NOT NULL CHECK(matched_purchase_count>=0),
 staged_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK(isfinite(staged_at))
);
CREATE TABLE customer_privacy_order_links (
 inbox_id uuid NOT NULL REFERENCES customer_privacy_receipts(inbox_id),
 order_id text NOT NULL CHECK(order_id ~ '^gid://shopify/Order/[1-9][0-9]{0,19}$'),
 PRIMARY KEY(inbox_id,order_id)
);
CREATE TABLE customer_order_erasure_fences (
 shop_id text NOT NULL REFERENCES shops(shop_id), order_id text NOT NULL CHECK(order_id ~ '^gid://shopify/Order/[1-9][0-9]{0,19}$'),
 source_inbox_id uuid NOT NULL REFERENCES customer_privacy_receipts(inbox_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(shop_id,order_id)
);
CREATE TABLE customer_quote_erasure_fences (
 shop_id text NOT NULL REFERENCES shops(shop_id), quote_id uuid NOT NULL,
 source_inbox_id uuid NOT NULL REFERENCES customer_privacy_receipts(inbox_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(shop_id,quote_id)
);
CREATE TABLE customer_asset_erasure_fences (
 shop_id text NOT NULL REFERENCES shops(shop_id), asset_id uuid NOT NULL,
 source_inbox_id uuid NOT NULL REFERENCES customer_privacy_receipts(inbox_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(shop_id,asset_id)
);
REVOKE ALL ON customer_privacy_receipts,customer_privacy_order_links,customer_order_erasure_fences,customer_quote_erasure_fences,customer_asset_erasure_fences FROM PUBLIC;
CREATE TRIGGER customer_privacy_receipts_immutable BEFORE UPDATE OR DELETE ON customer_privacy_receipts FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE TRIGGER customer_privacy_orders_immutable BEFORE UPDATE OR DELETE ON customer_privacy_order_links FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE TRIGGER customer_order_fence_immutable BEFORE UPDATE OR DELETE ON customer_order_erasure_fences FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE TRIGGER customer_quote_fence_immutable BEFORE UPDATE OR DELETE ON customer_quote_erasure_fences FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE TRIGGER customer_asset_fence_immutable BEFORE UPDATE OR DELETE ON customer_asset_erasure_fences FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();

-- Only supported current design paths, not recursive searches through arbitrary UUIDs.
CREATE FUNCTION public.customer_privacy_payload_assets(p_payload jsonb) RETURNS TABLE(asset_id uuid)
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT DISTINCT (entry->>'revisionId')::uuid FROM (
  SELECT jsonb_path_query(p_payload,'$.groups[*].group.design.placements[*].artwork ? (@.kind == "revision")') AS entry
  UNION ALL SELECT jsonb_path_query(p_payload,'$.design.placements[*].artwork ? (@.kind == "revision")')
 ) ids WHERE entry->>'revisionId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
$$;
REVOKE ALL ON FUNCTION public.customer_privacy_payload_assets(jsonb) FROM PUBLIC;

CREATE FUNCTION public.customer_privacy_fence_asset(p_shop text,p_asset uuid,p_inbox uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- Foreign-tenant or absent UUIDs never authorize changing an asset.
 PERFORM 1 FROM public.artwork_assets WHERE shop_id=p_shop AND asset_id=p_asset FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 INSERT INTO public.customer_asset_erasure_fences(shop_id,asset_id,source_inbox_id) VALUES(p_shop,p_asset,p_inbox) ON CONFLICT DO NOTHING;
 -- Leave original collection/expiry and live custody lease untouched. The existing
 -- inspector waits for its lease to settle, then deletes all keys through DELETING.
 UPDATE public.artwork_assets SET state='DELETING',updated_at=clock_timestamp() WHERE shop_id=p_shop AND asset_id=p_asset AND state NOT IN ('DELETING','DELETED');
 -- Also cover artwork first discovered by a delayed offer/binding, after the
 -- original erasure worker already committed. Existing and future drafts must
 -- not preserve private design content associated with this fenced artwork.
 DELETE FROM public.quote_proposals p WHERE p.shop_id=p_shop AND EXISTS(SELECT 1 FROM public.customer_privacy_payload_assets(p.desired_request) a WHERE a.asset_id=p_asset);
 DELETE FROM public.design_drafts d WHERE d.shop_id=p_shop AND EXISTS(SELECT 1 FROM public.customer_privacy_payload_assets(d.payload) a WHERE a.asset_id=p_asset);
END $$;
REVOKE ALL ON FUNCTION public.customer_privacy_fence_asset(text,uuid,uuid) FROM PUBLIC;

CREATE FUNCTION public.customer_privacy_fence_payload(p_shop text,p_payload jsonb,p_inbox uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record;
BEGIN
 FOR item IN SELECT asset_id FROM public.customer_privacy_payload_assets(p_payload) ORDER BY asset_id LOOP
  PERFORM public.customer_privacy_fence_asset(p_shop,item.asset_id,p_inbox);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.customer_privacy_fence_payload(text,jsonb,uuid) FROM PUBLIC;

CREATE FUNCTION public.customer_privacy_fence_quote(p_shop text,p_quote uuid,p_inbox uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record; at_time timestamptz:=clock_timestamp();
BEGIN
 INSERT INTO public.customer_quote_erasure_fences(shop_id,quote_id,source_inbox_id) VALUES(p_shop,p_quote,p_inbox) ON CONFLICT DO NOTHING;
 FOR item IN
  SELECT p.payload FROM public.purchase_offer_payloads p WHERE p.shop_id=p_shop AND p.quote_id=p_quote AND p.payload IS NOT NULL
  UNION ALL SELECT p.desired_request FROM public.quote_proposals p JOIN public.buyer_quote_ownership o USING(shop_id,installation_generation,proposal_id) WHERE o.shop_id=p_shop AND o.quote_id=p_quote
  UNION ALL SELECT p.payload->'request' FROM public.purchase_design_payloads p JOIN public.purchase_bindings b USING(purchase_id,set_id) WHERE b.shop_id=p_shop AND b.quote_id=p_quote AND p.payload IS NOT NULL
 LOOP PERFORM public.customer_privacy_fence_payload(p_shop,item.payload,p_inbox); END LOOP;
 UPDATE public.purchase_offer_payloads SET payload=NULL,erased_at=at_time WHERE shop_id=p_shop AND quote_id=p_quote AND erased_at IS NULL;
 UPDATE public.purchase_design_payloads p SET payload=NULL,erased_at=at_time FROM public.purchase_bindings b
  WHERE p.purchase_id=b.purchase_id AND p.set_id=b.set_id AND b.shop_id=p_shop AND b.quote_id=p_quote AND p.erased_at IS NULL;
 -- These private transient proposals/drafts already have a deletion cleanup path;
 -- their separate immutable ownership/economic rows remain intact.
 DELETE FROM public.quote_proposals p WHERE p.shop_id=p_shop AND p.proposal_id IN (SELECT proposal_id FROM public.buyer_quote_ownership WHERE shop_id=p_shop AND quote_id=p_quote);
END $$;
REVOKE ALL ON FUNCTION public.customer_privacy_fence_quote(text,uuid,uuid) FROM PUBLIC;

CREATE FUNCTION public.process_customer_privacy_inbox(p_inbox uuid) RETURNS jsonb
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
  OR jsonb_typeof(body->'customer') IS DISTINCT FROM 'object' OR body#>>'{customer,id}' IS NULL
  OR body#>>'{customer,id}' !~ '^[1-9][0-9]{0,19}$'
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
REVOKE ALL ON FUNCTION public.process_customer_privacy_inbox(uuid) FROM PUBLIC;

-- Guards retain the irreversible erasure decision across delayed discovery,
-- stale already-read payloads, retries and new merchant attachment attempts.
CREATE FUNCTION public.guard_customer_private_ingestion() RETURNS trigger
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
REVOKE ALL ON FUNCTION public.guard_customer_private_ingestion() FROM PUBLIC;
CREATE TRIGGER customer_private_binding BEFORE INSERT ON purchase_bindings FOR EACH ROW EXECUTE FUNCTION public.guard_customer_private_ingestion();
CREATE TRIGGER customer_private_offer BEFORE INSERT ON purchase_offer_payloads FOR EACH ROW EXECUTE FUNCTION public.guard_customer_private_ingestion();
CREATE TRIGGER customer_private_design BEFORE INSERT ON purchase_design_payloads FOR EACH ROW EXECUTE FUNCTION public.guard_customer_private_ingestion();
CREATE TRIGGER customer_private_attachment BEFORE INSERT ON purchase_artwork_events FOR EACH ROW EXECUTE FUNCTION public.guard_customer_private_ingestion();
CREATE TRIGGER customer_private_asset BEFORE INSERT OR UPDATE ON artwork_assets FOR EACH ROW EXECUTE FUNCTION public.guard_customer_private_ingestion();
CREATE TRIGGER customer_private_proposal BEFORE INSERT ON quote_proposals FOR EACH ROW EXECUTE FUNCTION public.guard_customer_private_ingestion();
CREATE TRIGGER customer_private_draft BEFORE INSERT OR UPDATE ON design_drafts FOR EACH ROW EXECUTE FUNCTION public.guard_customer_private_ingestion();

-- migrate:down
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM customer_privacy_receipts) THEN RAISE EXCEPTION 'customer erasure history requires a forward-compatible reader'; END IF;
END $$;
DROP TRIGGER customer_private_binding ON purchase_bindings;
DROP TRIGGER customer_private_offer ON purchase_offer_payloads;
DROP TRIGGER customer_private_design ON purchase_design_payloads;
DROP TRIGGER customer_private_attachment ON purchase_artwork_events;
DROP TRIGGER customer_private_asset ON artwork_assets;
DROP TRIGGER customer_private_proposal ON quote_proposals;
DROP TRIGGER customer_private_draft ON design_drafts;
DROP FUNCTION public.guard_customer_private_ingestion(),public.process_customer_privacy_inbox(uuid),public.customer_privacy_fence_quote(text,uuid,uuid),public.customer_privacy_fence_payload(text,jsonb,uuid),public.customer_privacy_fence_asset(text,uuid,uuid),public.customer_privacy_payload_assets(jsonb);
DROP TABLE customer_asset_erasure_fences,customer_quote_erasure_fences,customer_order_erasure_fences,customer_privacy_order_links,customer_privacy_receipts;
