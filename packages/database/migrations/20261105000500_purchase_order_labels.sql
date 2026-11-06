-- migrate:up
-- Mutable provider display labels, separate from immutable economic facts.
CREATE TABLE purchase_order_labels (
 shop_id text NOT NULL REFERENCES shops(shop_id),
 purchase_id uuid NOT NULL REFERENCES purchase_orders(purchase_id),
 order_name text CHECK(order_name IS NULL OR (char_length(order_name) BETWEEN 1 AND 512 AND order_name !~ '[[:cntrl:]]')),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(shop_id,purchase_id)
);
REVOKE ALL ON purchase_order_labels FROM PUBLIC;
CREATE FUNCTION public.erase_purchase_labels_for_order_privacy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 DELETE FROM public.purchase_order_labels l USING public.purchase_orders o WHERE l.shop_id=NEW.shop_id AND o.shop_id=l.shop_id AND o.purchase_id=l.purchase_id AND o.order_id=NEW.order_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.erase_purchase_labels_for_order_privacy() FROM PUBLIC;
CREATE TRIGGER erase_purchase_labels_order_privacy AFTER INSERT ON customer_order_erasure_fences FOR EACH ROW EXECUTE FUNCTION public.erase_purchase_labels_for_order_privacy();


CREATE FUNCTION public.erase_purchase_labels_for_shop_privacy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target public.shops%ROWTYPE; installed public.installation_generations%ROWTYPE;
 saved public.customer_privacy_receipts%ROWTYPE; collected timestamptz;
BEGIN
 SELECT * INTO target FROM public.shops WHERE shop_id=NEW.shop_id FOR UPDATE;
 SELECT * INTO installed FROM public.installation_generations WHERE shop_id=NEW.shop_id AND generation=NEW.installation_generation;
 SELECT * INTO saved FROM public.customer_privacy_receipts WHERE inbox_id=NEW.source_inbox_id;
 SELECT collected_at INTO collected FROM public.inbox_messages WHERE id=NEW.source_inbox_id;
 -- Match the existing qualified method-erasure authority: a late immutable
 -- recovery decision proves inactivity NOW without rewriting the original receipt.
 IF installed.deactivated_at IS NULL OR saved.shop_id IS DISTINCT FROM NEW.shop_id OR
  (NOT EXISTS(SELECT 1 FROM public.uninstall_privacy_recoveries r WHERE r.privacy_inbox_id=NEW.source_inbox_id AND r.shop_id=NEW.shop_id AND r.installation_generation=NEW.installation_generation) AND
   (saved.operation IS DISTINCT FROM 'SHOP_ERASURE_STAGED' OR collected IS NULL OR installed.deactivated_at>collected))
 THEN RAISE EXCEPTION 'qualified inactive shop erasure required' USING ERRCODE='check_violation'; END IF;
 -- Display metadata belongs to an exact immutable purchase generation. An old
 -- qualified recovery must erase its labels while preserving active reinstall data.
 DELETE FROM public.purchase_order_labels l USING public.purchase_orders o
 WHERE l.shop_id=NEW.shop_id AND o.shop_id=l.shop_id AND o.purchase_id=l.purchase_id
  AND o.installation_generation=NEW.installation_generation;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.erase_purchase_labels_for_shop_privacy() FROM PUBLIC;
CREATE TRIGGER erase_purchase_labels_shop_privacy AFTER INSERT ON shop_privacy_fences FOR EACH ROW EXECUTE FUNCTION public.erase_purchase_labels_for_shop_privacy();

-- migrate:down
DROP TRIGGER erase_purchase_labels_shop_privacy ON shop_privacy_fences;
DROP FUNCTION public.erase_purchase_labels_for_shop_privacy();
DROP TRIGGER erase_purchase_labels_order_privacy ON customer_order_erasure_fences;
DROP FUNCTION public.erase_purchase_labels_for_order_privacy();
DROP TABLE purchase_order_labels;
