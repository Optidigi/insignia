-- migrate:up
-- Persist the authenticated request as minimal order links before dropping its
-- contact-bearing transport bytes. Export is generated from live, unexpired
-- records at the authenticated merchant boundary, never a retained ZIP or URL.
ALTER FUNCTION public.process_customer_privacy_inbox(uuid) RENAME TO stage_customer_privacy_inbox;
CREATE FUNCTION public.process_customer_privacy_inbox(p_inbox uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 result:=public.stage_customer_privacy_inbox(p_inbox);
 UPDATE public.inbox_messages SET payload=''::bytea,erasure_state='erased',state='processed',last_error_class=NULL,lease_owner=NULL,lease_until=NULL WHERE id=p_inbox;
 UPDATE public.webhook_obligation_facts SET captured_fields='{}',facts_erased_at=coalesce(facts_erased_at,clock_timestamp()) WHERE inbox_id=p_inbox;
 UPDATE public.shopify_webhook_deliveries SET queue_cleanup_pending=true WHERE inbox_id=p_inbox;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.process_customer_privacy_inbox(uuid),public.stage_customer_privacy_inbox(uuid) FROM PUBLIC;
-- RENAME retains the original runtime ACL. Only the validating wrapper remains
-- callable by the queue role; the helper is owner-only.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_consume') THEN
  REVOKE ALL ON FUNCTION public.stage_customer_privacy_inbox(uuid) FROM insignia_queue_consume;
  GRANT EXECUTE ON FUNCTION public.process_customer_privacy_inbox(uuid) TO insignia_queue_consume;
 END IF;
END $$;

CREATE FUNCTION public.read_customer_privacy_requests(p_shop text,p_generation bigint,p_inbox uuid DEFAULT NULL,p_after uuid DEFAULT NULL)
RETURNS SETOF jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('inboxId',r.inbox_id::text,'requestId',r.request_id,'receivedAt',m.collected_at,
  'fulfillBy',m.collected_at+interval '30 days','requestedOrderCount',r.requested_order_count,
  'matchedPurchaseCount',r.matched_purchase_count)
 FROM public.customer_privacy_receipts r JOIN public.inbox_messages m ON m.id=r.inbox_id
 JOIN public.shops s ON s.shop_id=r.shop_id AND s.current_generation=p_generation
 JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation AND i.deactivated_at IS NULL
 WHERE r.shop_id=p_shop AND m.collected_at>=i.activated_at AND r.operation='DATA_REQUEST_PENDING_EXPORT' AND (p_inbox IS NULL OR r.inbox_id=p_inbox)
 AND (p_after IS NULL OR r.inbox_id>p_after) ORDER BY r.inbox_id LIMIT 100
$$;
CREATE FUNCTION public.read_customer_privacy_order_links(p_shop text,p_generation bigint,p_inbox uuid)
RETURNS SETOF jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('orderId',l.order_id,'purchaseId',p.purchase_id::text)
 FROM public.customer_privacy_order_links l LEFT JOIN public.purchase_orders p ON p.shop_id=p_shop AND p.order_id=l.order_id
 WHERE l.inbox_id=p_inbox AND EXISTS(SELECT 1 FROM public.read_customer_privacy_requests(p_shop,p_generation,p_inbox))
 ORDER BY l.order_id
$$;
CREATE FUNCTION public.export_customer_privacy_order(p_shop text,p_generation bigint,p_inbox uuid,p_purchase uuid,p_set uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 -- Sharing the shop lock serializes this read with erasure. A later request
 -- reconstructs from current tombstones, never from a cached private export.
 PERFORM 1 FROM public.shops WHERE shop_id=p_shop FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM public.read_customer_privacy_requests(p_shop,p_generation,p_inbox)) THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('version','insignia-customer-order-export-v1',
  'order',jsonb_build_object('purchaseId',p.purchase_id::text,'orderId',p.order_id,'orderCreatedAt',p.order_created_at,'currency',p.currency,'originalTotalMinor',p.original_total_minor::text),
  'bindings',coalesce((SELECT jsonb_agg(jsonb_build_object('quoteId',b.quote_id::text,'setId',b.set_id::text,'economics',CASE WHEN p_set=b.set_id THEN b.economics END) ORDER BY b.set_id) FROM public.purchase_bindings b WHERE b.purchase_id=p.purchase_id AND (p_set IS NULL OR b.set_id=p_set)),'[]'::jsonb),
  'lines',coalesce((SELECT jsonb_agg((to_jsonb(l)-'shop_id'-'installation_generation'-'purchase_id')||jsonb_build_object('unit_price_minor',l.unit_price_minor::text)) FROM public.purchase_lines l WHERE l.purchase_id=p.purchase_id),'[]'::jsonb),
  'designs',coalesce((SELECT jsonb_agg(jsonb_build_object('setId',d.set_id::text,'collectedAt',d.collected_at,'expiresAt',d.expires_at,'erasedAt',d.erased_at,
    'hasRetainedPayload',d.expires_at>clock_timestamp() AND d.payload IS NOT NULL,'payload',CASE WHEN d.expires_at>clock_timestamp() AND d.set_id=p_set THEN d.payload END)) FROM public.purchase_design_payloads d WHERE d.purchase_id=p.purchase_id AND (p_set IS NULL OR d.set_id=p_set)),'[]'::jsonb),
  'artworkEvents',coalesce((SELECT jsonb_agg((to_jsonb(e)-'shop_id'-'installation_generation'-'purchase_id')||CASE WHEN e.expires_at<=clock_timestamp() THEN jsonb_build_object('asset_id',NULL,'placement_id',NULL,'group_index',NULL) ELSE '{}'::jsonb END) FROM public.purchase_artwork_events e WHERE e.purchase_id=p.purchase_id),'[]'::jsonb),
  'payments',coalesce((SELECT jsonb_agg(to_jsonb(f)-'shop_id'-'installation_generation'-'purchase_id') FROM public.purchase_paid_facts f WHERE f.purchase_id=p.purchase_id),'[]'::jsonb),
  'refunds',coalesce((SELECT jsonb_agg((to_jsonb(f)-'shop_id'-'installation_generation'-'purchase_id')||jsonb_build_object('amount_minor',f.amount_minor::text)) FROM public.purchase_refund_facts f WHERE f.purchase_id=p.purchase_id),'[]'::jsonb),
  'observations',coalesce((SELECT jsonb_agg(to_jsonb(o)-'shop_id'-'installation_generation'-'purchase_id') FROM public.purchase_observations o WHERE o.purchase_id=p.purchase_id),'[]'::jsonb))
 INTO result FROM public.purchase_orders p JOIN public.customer_privacy_order_links l ON l.order_id=p.order_id AND l.inbox_id=p_inbox
 WHERE p.shop_id=p_shop AND p.installation_generation=p_generation AND p.purchase_id=p_purchase;
 IF p_set IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.purchase_bindings b WHERE b.purchase_id=p_purchase AND b.set_id=p_set AND b.shop_id=p_shop) THEN RETURN NULL; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_customer_privacy_requests(text,bigint,uuid,uuid),public.read_customer_privacy_order_links(text,bigint,uuid),public.export_customer_privacy_order(text,bigint,uuid,uuid,uuid) FROM PUBLIC;

-- migrate:down
DROP FUNCTION public.export_customer_privacy_order(text,bigint,uuid,uuid,uuid),public.read_customer_privacy_order_links(text,bigint,uuid),public.read_customer_privacy_requests(text,bigint,uuid,uuid);
DROP FUNCTION public.process_customer_privacy_inbox(uuid);
ALTER FUNCTION public.stage_customer_privacy_inbox(uuid) RENAME TO process_customer_privacy_inbox;
