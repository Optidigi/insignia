-- migrate:up
-- Permanent financial identity only. No payload, queue, sender, delivery state or runtime grants.
CREATE TABLE m9_usage_delivery_intents (
 purchase_id uuid PRIMARY KEY REFERENCES m9_order_usage(purchase_id),
 shop_id text NOT NULL, installation_generation bigint NOT NULL CHECK(installation_generation>0),
 order_id text NOT NULL,
 occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)), units smallint NOT NULL CHECK(units=1),
 policy_id text NOT NULL CHECK(length(policy_id) BETWEEN 1 AND 256 AND policy_id !~ '[[:space:][:cntrl:]]'),
 policy_version text NOT NULL CHECK(length(policy_version) BETWEEN 1 AND 256 AND policy_version !~ '[[:space:][:cntrl:]]'),
 cycle_id text NOT NULL CHECK(length(cycle_id) BETWEEN 1 AND 256 AND cycle_id !~ '[[:space:][:cntrl:]]'),
 app_id text NOT NULL CHECK(app_id ~ '^gid://shopify/App/[1-9][0-9]{0,39}$'),
 provider_shop_id text NOT NULL CHECK(provider_shop_id ~ '^gid://shopify/Shop/[1-9][0-9]{0,39}$'),
 meter_handle text NOT NULL CHECK(length(meter_handle) BETWEEN 1 AND 256 AND meter_handle !~ '[[:space:][:cntrl:]]'),
 idempotency_key uuid NOT NULL UNIQUE, created_at timestamptz NOT NULL,
 UNIQUE(shop_id,order_id),
 FOREIGN KEY(shop_id,installation_generation,purchase_id) REFERENCES purchase_orders(shop_id,installation_generation,purchase_id)
);
CREATE FUNCTION guard_m9_usage_delivery_intents() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE source public.m9_order_usage%ROWTYPE; actual_paid timestamptz; actual_test boolean; provider_id text; bound boolean;
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'usage delivery intent is immutable' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO source FROM public.m9_order_usage WHERE purchase_id=NEW.purchase_id FOR SHARE;
 IF NOT FOUND OR source.qualification <> 'ELIGIBLE' OR
   ROW(source.shop_id,source.installation_generation,source.order_id,source.first_paid_at)
   IS DISTINCT FROM ROW(NEW.shop_id,NEW.installation_generation,NEW.order_id,NEW.occurred_at) OR
   source.decision->>'kind' IS DISTINCT FROM 'ELIGIBLE' OR source.decision->>'units' IS DISTINCT FROM '1' OR
   source.decision->'policy'->>'id' IS DISTINCT FROM NEW.policy_id OR
   source.decision->'policy'->>'version' IS DISTINCT FROM NEW.policy_version OR
   source.decision->>'cycleId' IS DISTINCT FROM NEW.cycle_id THEN
  RAISE EXCEPTION 'usage delivery requires matching eligible financial facts' USING ERRCODE='check_violation'; END IF;
 SELECT p.is_test,f.occurred_at,s.shopify_shop_id::text INTO actual_test,actual_paid,provider_id
  FROM public.purchase_orders p JOIN public.purchase_paid_facts f
   ON f.purchase_id=p.purchase_id AND f.shop_id=p.shop_id AND f.installation_generation=p.installation_generation
  JOIN public.shops s ON s.shop_id=p.shop_id
  WHERE p.purchase_id=NEW.purchase_id AND p.shop_id=NEW.shop_id AND p.installation_generation=NEW.installation_generation;
 SELECT EXISTS(SELECT 1 FROM public.purchase_bindings WHERE purchase_id=NEW.purchase_id
  AND shop_id=NEW.shop_id AND installation_generation=NEW.installation_generation) INTO bound;
 IF actual_test IS DISTINCT FROM false OR actual_paid IS DISTINCT FROM NEW.occurred_at OR NOT bound OR
   NEW.provider_shop_id IS DISTINCT FROM ('gid://shopify/Shop/'||provider_id) THEN
  RAISE EXCEPTION 'usage delivery purchase or provider identity mismatch' USING ERRCODE='check_violation'; END IF;
 -- Always generated here: even a directly supplied UUID or creation time cannot choose this permanent identity.
 NEW.idempotency_key:=gen_random_uuid(); NEW.created_at:=clock_timestamp();
 RETURN NEW;
END; $$;
CREATE TRIGGER m9_usage_delivery_intents_guard BEFORE INSERT OR UPDATE OR DELETE ON m9_usage_delivery_intents
 FOR EACH ROW EXECUTE FUNCTION guard_m9_usage_delivery_intents();
CREATE TRIGGER m9_usage_delivery_intents_truncate_guard BEFORE TRUNCATE ON m9_usage_delivery_intents
 FOR EACH STATEMENT EXECUTE FUNCTION guard_m9_usage_delivery_intents();
REVOKE ALL ON m9_usage_delivery_intents FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_m9_usage_delivery_intents() FROM PUBLIC;
-- migrate:down
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM m9_usage_delivery_intents) THEN RAISE EXCEPTION 'persisted usage delivery intents prevent rollback'; END IF;
END $$;
DROP TABLE m9_usage_delivery_intents;
DROP FUNCTION guard_m9_usage_delivery_intents();
