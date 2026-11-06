-- migrate:up
-- Store-level guidance acknowledgements and live customer wording. Neither is
-- publication authority or immutable order/production history.
CREATE TABLE merchant_preferences (
 shop_id text PRIMARY KEY REFERENCES shops(shop_id),
 guidance_version bigint NOT NULL DEFAULT 0 CHECK(guidance_version>=0),
 wording_version bigint NOT NULL DEFAULT 0 CHECK(wording_version>=0),
 guidance jsonb NOT NULL DEFAULT '{"dismissed":false,"completedSteps":[]}'::jsonb CHECK(jsonb_typeof(guidance)='object'),
 overlays jsonb NOT NULL DEFAULT '{"en":{"locale":"en","messages":{}}}'::jsonb CHECK(jsonb_typeof(overlays)='object'),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON merchant_preferences FROM PUBLIC;

CREATE FUNCTION public.erase_merchant_preferences_for_shop_privacy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target public.shops%ROWTYPE; installed public.installation_generations%ROWTYPE;
 saved public.customer_privacy_receipts%ROWTYPE; collected timestamptz;
BEGIN
 SELECT * INTO target FROM public.shops WHERE shop_id=NEW.shop_id FOR UPDATE;
 IF NEW.installation_generation<>target.current_generation THEN RETURN NEW; END IF;
 SELECT * INTO installed FROM public.installation_generations WHERE shop_id=NEW.shop_id AND generation=target.current_generation;
 SELECT * INTO saved FROM public.customer_privacy_receipts WHERE inbox_id=NEW.source_inbox_id;
 SELECT collected_at INTO collected FROM public.inbox_messages WHERE id=NEW.source_inbox_id;
 -- Match the existing qualified method-erasure authority: a late immutable
 -- recovery decision proves inactivity NOW without rewriting the original receipt.
 IF installed.deactivated_at IS NULL OR saved.shop_id IS DISTINCT FROM NEW.shop_id OR
  (NOT EXISTS(SELECT 1 FROM public.uninstall_privacy_recoveries r WHERE r.privacy_inbox_id=NEW.source_inbox_id AND r.shop_id=NEW.shop_id AND r.installation_generation=NEW.installation_generation) AND
   (saved.operation IS DISTINCT FROM 'SHOP_ERASURE_STAGED' OR collected IS NULL OR installed.deactivated_at>collected))
 THEN RAISE EXCEPTION 'qualified inactive shop erasure required' USING ERRCODE='check_violation'; END IF;
 DELETE FROM public.merchant_preferences WHERE shop_id=NEW.shop_id;
 UPDATE public.idempotency_records SET result_ref='{"kind":"conflict","message":"Store preferences erased. Reload before making a new change."}'
 WHERE shop_id=NEW.shop_id AND namespace LIKE 'merchant-preferences-%' AND status='completed';
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.erase_merchant_preferences_for_shop_privacy() FROM PUBLIC;
CREATE TRIGGER erase_merchant_preferences_shop_privacy AFTER INSERT ON public.shop_privacy_fences
 FOR EACH ROW EXECUTE FUNCTION public.erase_merchant_preferences_for_shop_privacy();

-- migrate:down
DROP TRIGGER erase_merchant_preferences_shop_privacy ON public.shop_privacy_fences;
DROP FUNCTION public.erase_merchant_preferences_for_shop_privacy();
DROP TABLE merchant_preferences;
