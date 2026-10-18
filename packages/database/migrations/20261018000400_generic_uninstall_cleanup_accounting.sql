-- migrate:up
-- These records never qualify an uninstall. They freeze the local data scope
-- whose later independently authorized privacy cleanup can cover a diagnostic.
CREATE TABLE generic_uninstall_scopes (
 inbox_id uuid PRIMARY KEY REFERENCES inbox_messages(id),
 shop_id text NOT NULL,
 generation_ceiling bigint NOT NULL,
 snapshotted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(shop_id,generation_ceiling) REFERENCES installation_generations(shop_id,generation)
);
CREATE TABLE generic_uninstall_dispositions (
 inbox_id uuid PRIMARY KEY REFERENCES generic_uninstall_scopes(inbox_id),
 classification text NOT NULL DEFAULT 'GENERATION_PRIVATE_CLEANUP_STAGED'
  CHECK(classification='GENERATION_PRIVATE_CLEANUP_STAGED'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON generic_uninstall_scopes,generic_uninstall_dispositions FROM PUBLIC;
CREATE TRIGGER generic_uninstall_scope_immutable BEFORE UPDATE OR DELETE ON generic_uninstall_scopes FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE TRIGGER generic_uninstall_disposition_immutable BEFORE UPDATE OR DELETE ON generic_uninstall_dispositions FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE FUNCTION public.snapshot_generic_uninstall_scope(p_inbox uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.inbox_messages%ROWTYPE; body jsonb; target public.shops%ROWTYPE;
BEGIN
 SELECT * INTO receipt FROM public.inbox_messages WHERE id=p_inbox;
 IF NOT FOUND OR receipt.source<>'shopify' OR receipt.erasure_state<>'retained'
  OR NOT coalesce(receipt.purge_after>clock_timestamp() AND isfinite(receipt.purge_after),false)
  OR encode(sha256(receipt.payload),'hex')<>receipt.payload_sha256
  OR NOT EXISTS(SELECT 1 FROM public.shopify_webhook_deliveries WHERE inbox_id=p_inbox AND topic='app/uninstalled')
  OR EXISTS(SELECT 1 FROM public.uninstall_delivery_authority WHERE inbox_id=p_inbox)
 THEN RETURN; END IF;
 body:=convert_from(receipt.payload,'UTF8')::jsonb;
 SELECT * INTO target FROM public.shops WHERE shopify_shop_id=body->>'id'
  AND (body->>'myshopify_domain' IS NULL OR shop_domain=body->>'myshopify_domain') FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO receipt FROM public.inbox_messages WHERE id=p_inbox FOR UPDATE NOWAIT;
 IF NOT FOUND OR receipt.erasure_state<>'retained'
  OR NOT coalesce(receipt.purge_after>clock_timestamp() AND isfinite(receipt.purge_after),false)
  OR encode(sha256(receipt.payload),'hex')<>receipt.payload_sha256 THEN RETURN; END IF;
 IF convert_from(receipt.payload,'UTF8')::jsonb IS DISTINCT FROM body THEN RETURN; END IF;
 INSERT INTO public.generic_uninstall_scopes(inbox_id,shop_id,generation_ceiling)
 VALUES(p_inbox,target.shop_id,target.current_generation) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.snapshot_generic_uninstall_scope(uuid) FROM PUBLIC;
CREATE FUNCTION public.cover_generic_uninstall_cleanup(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record; covered integer:=0;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'invalid cleanup accounting budget'; END IF;
 FOR item IN SELECT g.* FROM public.generic_uninstall_scopes g
  WHERE NOT EXISTS(SELECT 1 FROM public.generic_uninstall_dispositions d WHERE d.inbox_id=g.inbox_id)
   AND NOT EXISTS(SELECT 1 FROM public.installation_generations i WHERE i.shop_id=g.shop_id AND i.generation<=g.generation_ceiling
    AND (i.deactivated_at IS NULL OR NOT EXISTS(SELECT 1 FROM public.shop_privacy_fences f WHERE f.shop_id=i.shop_id AND f.installation_generation=i.generation)))
  ORDER BY g.snapshotted_at,g.inbox_id LIMIT p_limit
 LOOP
  -- Inactivity and privacy fences are immutable. No current generation or
  -- merchant defaults are changed; physical object deletion remains separate.
  INSERT INTO public.generic_uninstall_dispositions(inbox_id) VALUES(item.inbox_id) ON CONFLICT DO NOTHING;
  UPDATE public.inbox_messages SET payload=''::bytea,erasure_state='erased',state='processed',last_error_class=NULL,
   lease_owner=NULL,lease_until=NULL WHERE id=item.inbox_id;
  UPDATE public.webhook_obligation_facts SET captured_fields='{}',facts_erased_at=coalesce(facts_erased_at,clock_timestamp()) WHERE inbox_id=item.inbox_id;
  UPDATE public.shopify_webhook_deliveries SET queue_cleanup_pending=true WHERE inbox_id=item.inbox_id;
  covered:=covered+1;
 END LOOP;
 RETURN covered;
END $$;
REVOKE ALL ON FUNCTION public.cover_generic_uninstall_cleanup(integer) FROM PUBLIC;

-- migrate:down
DO $$ BEGIN IF EXISTS(SELECT 1 FROM generic_uninstall_dispositions) THEN RAISE EXCEPTION 'cleanup accounting prevents rollback'; END IF; END $$;
DROP FUNCTION public.cover_generic_uninstall_cleanup(integer);
DROP FUNCTION public.snapshot_generic_uninstall_scope(uuid);
DROP TABLE generic_uninstall_dispositions;
DROP TABLE generic_uninstall_scopes;
