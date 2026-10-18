-- migrate:up
-- Reusable labels are mutable shop defaults. Configurations copy their own
-- method IDs and names: no draft/revision/economic record references this table.
CREATE TABLE method_catalog (
 shop_id text NOT NULL REFERENCES shops(shop_id),
 method_id uuid NOT NULL,
 name text NOT NULL CHECK (name=btrim(name) AND char_length(name) BETWEEN 1 AND 80 AND name !~ '[[:cntrl:]]'),
 version bigint NOT NULL DEFAULT 1 CHECK (version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(shop_id,method_id)
);
REVOKE ALL ON method_catalog FROM PUBLIC;

-- A newly inserted current-generation erasure fence is the existing qualified
-- inactive-installation decision. Receipt replays insert no fence, so they can
-- never erase defaults created after reinstall. Historical drafts stay intact.
CREATE FUNCTION public.erase_method_catalog_for_shop_privacy() RETURNS trigger
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
REVOKE ALL ON FUNCTION public.erase_method_catalog_for_shop_privacy() FROM PUBLIC;
CREATE TRIGGER erase_method_catalog_shop_privacy AFTER INSERT ON public.shop_privacy_fences
 FOR EACH ROW EXECUTE FUNCTION public.erase_method_catalog_for_shop_privacy();

-- migrate:down
DROP TRIGGER erase_method_catalog_shop_privacy ON public.shop_privacy_fences;
DROP FUNCTION public.erase_method_catalog_for_shop_privacy();
DROP TABLE method_catalog;
