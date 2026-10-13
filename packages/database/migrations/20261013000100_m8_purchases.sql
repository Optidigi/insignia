-- migrate:up
-- Order facts are economic/audit records. Designs are separately erasable; reference never extends collection retention.
CREATE TABLE purchase_offer_payloads (
 shop_id text NOT NULL, installation_generation bigint NOT NULL, quote_id uuid NOT NULL,
 collected_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 payload jsonb, erased_at timestamptz,
 PRIMARY KEY(shop_id,installation_generation,quote_id),
 FOREIGN KEY(shop_id,installation_generation,quote_id) REFERENCES accepted_quotes(shop_id,installation_generation,quote_id),
 CHECK(expires_at>collected_at AND expires_at<=collected_at+interval '6 months'),
 CHECK((payload IS NULL)=(erased_at IS NOT NULL)), CHECK(payload IS NULL OR octet_length(payload::text)<=262144)
);
CREATE TABLE purchase_orders (
 purchase_id uuid PRIMARY KEY, shop_id text NOT NULL, installation_generation bigint NOT NULL,
 order_id text NOT NULL CHECK(order_id ~ '^gid://shopify/Order/[1-9][0-9]*$'),
 order_created_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), original_total_minor numeric(20,0) NOT NULL CHECK(original_total_minor>=0),
 UNIQUE(shop_id,order_id), UNIQUE(shop_id,installation_generation,purchase_id),
 FOREIGN KEY(shop_id,installation_generation) REFERENCES installation_generations(shop_id,generation)
);
CREATE TABLE purchase_bindings (
 shop_id text NOT NULL, installation_generation bigint NOT NULL, purchase_id uuid NOT NULL,
 quote_id uuid NOT NULL, set_id uuid NOT NULL, economics jsonb NOT NULL CHECK(octet_length(economics::text)<=262144),
 PRIMARY KEY(purchase_id,set_id),
 FOREIGN KEY(shop_id,installation_generation,purchase_id) REFERENCES purchase_orders(shop_id,installation_generation,purchase_id),
 FOREIGN KEY(shop_id,installation_generation,quote_id) REFERENCES accepted_quotes(shop_id,installation_generation,quote_id),
 FOREIGN KEY(set_id) REFERENCES quote_authorization_sets(set_id)
);
CREATE TABLE purchase_lines (
 shop_id text NOT NULL, installation_generation bigint NOT NULL, purchase_id uuid NOT NULL, set_id uuid NOT NULL,
 line_id text NOT NULL CHECK(line_id ~ '^gid://shopify/LineItem/[1-9][0-9]*$'), line_index integer NOT NULL CHECK(line_index BETWEEN 0 AND 31),
 product_id text NOT NULL, variant_id text NOT NULL, quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 10000),
 unit_price_minor numeric(20,0) NOT NULL CHECK(unit_price_minor>=0),
 PRIMARY KEY(purchase_id,line_id), UNIQUE(purchase_id,set_id,line_index),
 FOREIGN KEY(purchase_id,set_id) REFERENCES purchase_bindings(purchase_id,set_id),
 FOREIGN KEY(shop_id,installation_generation,purchase_id) REFERENCES purchase_orders(shop_id,installation_generation,purchase_id)
);
CREATE TABLE purchase_design_payloads (
 shop_id text NOT NULL, installation_generation bigint NOT NULL, purchase_id uuid NOT NULL, set_id uuid NOT NULL,
 collected_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, payload jsonb, erased_at timestamptz,
 PRIMARY KEY(purchase_id,set_id), FOREIGN KEY(purchase_id,set_id) REFERENCES purchase_bindings(purchase_id,set_id),
 FOREIGN KEY(shop_id,installation_generation,purchase_id) REFERENCES purchase_orders(shop_id,installation_generation,purchase_id),
 CHECK(expires_at>collected_at AND expires_at<=collected_at+interval '6 months'),
 CHECK((payload IS NULL)=(erased_at IS NOT NULL)), CHECK(payload IS NULL OR octet_length(payload::text)<=1048576)
);
CREATE TABLE purchase_observations (
 observation_id uuid PRIMARY KEY, shop_id text NOT NULL, installation_generation bigint NOT NULL,
 purchase_id uuid NOT NULL, source_updated_at timestamptz NOT NULL, observed_at timestamptz NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'), financial_status text NOT NULL,
 cancelled_at timestamptz, exception text,
 UNIQUE(purchase_id,digest), FOREIGN KEY(shop_id,installation_generation,purchase_id) REFERENCES purchase_orders(shop_id,installation_generation,purchase_id)
);
CREATE TABLE purchase_paid_facts (
 purchase_id uuid PRIMARY KEY, shop_id text NOT NULL, installation_generation bigint NOT NULL,
 occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(shop_id,installation_generation,purchase_id) REFERENCES purchase_orders(shop_id,installation_generation,purchase_id)
);
CREATE TABLE purchase_refund_facts (
 shop_id text NOT NULL, installation_generation bigint NOT NULL, purchase_id uuid NOT NULL,
 refund_id text NOT NULL CHECK(refund_id ~ '^gid://shopify/Refund/[1-9][0-9]*$'), occurred_at timestamptz NOT NULL,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), amount_minor numeric(20,0) NOT NULL CHECK(amount_minor>=0),
 lines jsonb NOT NULL CHECK(octet_length(lines::text)<=262144),
 PRIMARY KEY(shop_id,refund_id), FOREIGN KEY(shop_id,installation_generation,purchase_id) REFERENCES purchase_orders(shop_id,installation_generation,purchase_id)
);
CREATE TABLE purchase_artwork_events (
 event_id uuid PRIMARY KEY, shop_id text NOT NULL, installation_generation bigint NOT NULL, purchase_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0), kind text NOT NULL CHECK(kind IN ('ATTACH','LOCK')),
 group_index integer, placement_id text, asset_id uuid, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz, erased_at timestamptz,
 UNIQUE(purchase_id,version),
 FOREIGN KEY(shop_id,installation_generation,purchase_id) REFERENCES purchase_orders(shop_id,installation_generation,purchase_id),
 CHECK((kind='LOCK' AND group_index IS NULL AND placement_id IS NULL AND asset_id IS NULL AND expires_at IS NULL) OR
       (kind='ATTACH' AND ((erased_at IS NULL AND group_index>=0 AND placement_id IS NOT NULL AND asset_id IS NOT NULL AND expires_at IS NOT NULL) OR
                         (erased_at IS NOT NULL AND group_index IS NULL AND placement_id IS NULL AND asset_id IS NULL AND expires_at IS NOT NULL))))
);
CREATE INDEX purchase_orders_list ON purchase_orders(shop_id,created_at,purchase_id);
CREATE INDEX purchase_payload_deadline ON purchase_design_payloads(expires_at) WHERE erased_at IS NULL;
CREATE INDEX purchase_offer_deadline ON purchase_offer_payloads(expires_at) WHERE erased_at IS NULL;
CREATE INDEX purchase_artwork_deadline ON purchase_artwork_events(expires_at) WHERE kind='ATTACH' AND erased_at IS NULL;
CREATE FUNCTION guard_purchase_payload() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-'payload'-'erased_at') IS DISTINCT FROM (to_jsonb(OLD)-'payload'-'erased_at') OR
    OLD.erased_at IS NOT NULL OR NEW.payload IS NOT NULL OR NEW.erased_at IS NULL THEN
   RAISE EXCEPTION 'purchase payload may only become an erasure tombstone' USING ERRCODE='check_violation';
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER purchase_payload_guard BEFORE UPDATE ON purchase_design_payloads FOR EACH ROW EXECUTE FUNCTION guard_purchase_payload();
CREATE TRIGGER purchase_offer_guard BEFORE UPDATE ON purchase_offer_payloads FOR EACH ROW EXECUTE FUNCTION guard_purchase_payload();
CREATE TRIGGER purchase_orders_immutable BEFORE UPDATE OR DELETE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE TRIGGER purchase_bindings_immutable BEFORE UPDATE OR DELETE ON purchase_bindings FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE TRIGGER purchase_lines_immutable BEFORE UPDATE OR DELETE ON purchase_lines FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE TRIGGER purchase_observations_immutable BEFORE UPDATE OR DELETE ON purchase_observations FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE TRIGGER purchase_paid_immutable BEFORE UPDATE OR DELETE ON purchase_paid_facts FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE TRIGGER purchase_refunds_immutable BEFORE UPDATE OR DELETE ON purchase_refund_facts FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE FUNCTION guard_purchase_artwork_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-'asset_id'-'placement_id'-'group_index'-'erased_at') IS DISTINCT FROM (to_jsonb(OLD)-'asset_id'-'placement_id'-'group_index'-'erased_at') OR
    OLD.kind<>'ATTACH' OR OLD.erased_at IS NOT NULL OR NEW.erased_at IS NULL OR NEW.asset_id IS NOT NULL OR NEW.placement_id IS NOT NULL OR NEW.group_index IS NOT NULL THEN
  RAISE EXCEPTION 'artwork event is append-only except private erasure' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER purchase_artwork_guard BEFORE UPDATE ON purchase_artwork_events FOR EACH ROW EXECUTE FUNCTION guard_purchase_artwork_event();
CREATE TRIGGER purchase_artwork_no_delete BEFORE DELETE ON purchase_artwork_events FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE FUNCTION public.cleanup_purchase_payloads(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE at_time timestamptz:=clock_timestamp(); count_design integer; count_offer integer; count_event integer;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'invalid purchase cleanup budget'; END IF;
 UPDATE public.purchase_design_payloads SET payload=NULL,erased_at=at_time WHERE (purchase_id,set_id) IN (
  SELECT purchase_id,set_id FROM public.purchase_design_payloads WHERE expires_at<=at_time AND erased_at IS NULL ORDER BY expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS count_design=ROW_COUNT;
 UPDATE public.purchase_offer_payloads SET payload=NULL,erased_at=at_time WHERE (shop_id,installation_generation,quote_id) IN (
  SELECT shop_id,installation_generation,quote_id FROM public.purchase_offer_payloads WHERE expires_at<=at_time AND erased_at IS NULL ORDER BY expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS count_offer=ROW_COUNT;
 UPDATE public.purchase_artwork_events SET asset_id=NULL,placement_id=NULL,group_index=NULL,erased_at=at_time WHERE event_id IN (
  SELECT event_id FROM public.purchase_artwork_events WHERE expires_at<=at_time AND erased_at IS NULL AND kind='ATTACH' ORDER BY expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS count_event=ROW_COUNT;
 RETURN count_design+count_offer+count_event;
END; $$;
REVOKE ALL ON FUNCTION public.cleanup_purchase_payloads(integer) FROM PUBLIC;
-- migrate:down
DROP FUNCTION public.cleanup_purchase_payloads(integer);
DROP TABLE purchase_artwork_events,purchase_refund_facts,purchase_paid_facts,purchase_observations,purchase_design_payloads,purchase_lines,purchase_bindings,purchase_orders,purchase_offer_payloads;
DROP FUNCTION guard_purchase_payload(),guard_purchase_artwork_event();
