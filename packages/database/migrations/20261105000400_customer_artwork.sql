-- migrate:up
CREATE TABLE customer_artwork_epoch(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), value uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO customer_artwork_epoch(singleton) VALUES(true);
REVOKE ALL ON customer_artwork_epoch FROM PUBLIC;
-- Hashes, narrowly scoped authority and delivery metadata; never bearer links or customer email addresses.
CREATE TABLE customer_artwork_grants (
 capability_hash text PRIMARY KEY CHECK(capability_hash ~ '^[a-f0-9]{64}$'),
 shop_id text NOT NULL,
 installation_generation bigint NOT NULL,
 purchase_id uuid NOT NULL,
 request_id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('merchant','paid-email')),
 slots jsonb NOT NULL CHECK(jsonb_typeof(slots)='array' AND jsonb_array_length(slots) BETWEEN 1 AND 1024 AND octet_length(slots::text)<=262144),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 UNIQUE(shop_id,installation_generation,purchase_id,purpose,request_id),
 FOREIGN KEY(shop_id,installation_generation,purchase_id) REFERENCES purchase_orders(shop_id,installation_generation,purchase_id),
 CHECK(expires_at>created_at)
);
CREATE TABLE customer_artwork_submissions (
 capability_hash text NOT NULL REFERENCES customer_artwork_grants(capability_hash),
 request_id uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 event_id uuid NOT NULL REFERENCES purchase_artwork_events(event_id),
 PRIMARY KEY(capability_hash,request_id)
);
CREATE TABLE customer_artwork_notifications (
 notification_id uuid PRIMARY KEY,
 shop_id text NOT NULL,
 installation_generation bigint NOT NULL,
 purchase_id uuid NOT NULL,
 capability_hash text REFERENCES customer_artwork_grants(capability_hash),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','DISPATCHING','SENT','UNCERTAIN','NO_EFFECT','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 claimed_at timestamptz,
 retry_at timestamptz,
 settled_at timestamptz,
 provider_receipt text CHECK(provider_receipt IS NULL OR octet_length(provider_receipt)<=512),
 UNIQUE(shop_id,installation_generation,purchase_id),
 FOREIGN KEY(shop_id,installation_generation,purchase_id) REFERENCES purchase_orders(shop_id,installation_generation,purchase_id)
);
REVOKE ALL ON customer_artwork_grants,customer_artwork_submissions,customer_artwork_notifications FROM PUBLIC;
-- Planning is part of the immutable verified first-paid transaction. No caller invents payment facts.
CREATE FUNCTION public.plan_customer_artwork_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS (
  WITH groups AS (
   SELECT p.purchase_id,p.shop_id,p.installation_generation,
    (row_number() OVER(ORDER BY p.set_id,g.ordinality)-1)::integer AS group_index,g.value AS body
   FROM public.purchase_design_payloads p
   CROSS JOIN LATERAL jsonb_array_elements(p.payload->'request'->'groups') WITH ORDINALITY g(value,ordinality)
   WHERE p.purchase_id=NEW.purchase_id AND p.payload IS NOT NULL AND p.expires_at>clock_timestamp()
  )
  SELECT 1 FROM groups g CROSS JOIN LATERAL jsonb_array_elements(g.body->'group'->'design'->'placements') place
  JOIN public.shops s ON s.shop_id=g.shop_id AND s.current_generation=g.installation_generation
  JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation AND i.deactivated_at IS NULL
  WHERE place->'artwork'->>'kind'='deferred'
   AND NOT EXISTS(SELECT 1 FROM public.purchase_artwork_events e WHERE e.purchase_id=g.purchase_id AND (e.kind='LOCK' OR e.erased_at IS NOT NULL OR (e.kind='ATTACH' AND e.group_index=g.group_index AND e.placement_id=place->>'placementId')))
   AND NOT EXISTS(SELECT 1 FROM public.purchase_design_payloads p WHERE p.purchase_id=g.purchase_id AND (p.payload IS NULL OR p.expires_at<=clock_timestamp()))
   AND NOT EXISTS(SELECT 1 FROM public.purchase_observations o WHERE o.purchase_id=g.purchase_id AND o.cancelled_at IS NOT NULL AND o.observation_id=(SELECT o2.observation_id FROM public.purchase_observations o2 WHERE o2.purchase_id=g.purchase_id ORDER BY source_updated_at DESC,observed_at DESC,observation_id DESC LIMIT 1))
 ) THEN
  INSERT INTO public.customer_artwork_notifications(notification_id,shop_id,installation_generation,purchase_id)
  VALUES(gen_random_uuid(),NEW.shop_id,NEW.installation_generation,NEW.purchase_id)
  ON CONFLICT(shop_id,installation_generation,purchase_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.plan_customer_artwork_notification() FROM PUBLIC;
CREATE TRIGGER plan_customer_artwork_notification AFTER INSERT ON public.purchase_paid_facts FOR EACH ROW EXECUTE FUNCTION public.plan_customer_artwork_notification();
-- Original payload cleanup also destroys associated capabilities/notification metadata.
CREATE FUNCTION public.erase_customer_artwork_for_payload() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 DELETE FROM public.customer_artwork_notifications WHERE purchase_id=NEW.purchase_id;
 DELETE FROM public.customer_artwork_submissions WHERE capability_hash IN (SELECT capability_hash FROM public.customer_artwork_grants WHERE purchase_id=NEW.purchase_id);
 DELETE FROM public.customer_artwork_grants WHERE purchase_id=NEW.purchase_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.erase_customer_artwork_for_payload() FROM PUBLIC;
CREATE TRIGGER erase_customer_artwork_for_payload AFTER UPDATE OF payload ON public.purchase_design_payloads FOR EACH ROW WHEN (OLD.payload IS NOT NULL AND NEW.payload IS NULL) EXECUTE FUNCTION public.erase_customer_artwork_for_payload();

-- Erasure destroys mutable upload-link authority/delivery metadata, preserving immutable purchase facts.
CREATE FUNCTION public.erase_customer_artwork_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.shops s JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=NEW.shop_id AND i.generation=NEW.installation_generation AND i.deactivated_at IS NOT NULL) THEN
  DELETE FROM public.customer_artwork_notifications WHERE shop_id=NEW.shop_id AND installation_generation=NEW.installation_generation;
  DELETE FROM public.customer_artwork_submissions WHERE capability_hash IN (SELECT capability_hash FROM public.customer_artwork_grants WHERE shop_id=NEW.shop_id AND installation_generation=NEW.installation_generation);
  DELETE FROM public.customer_artwork_grants WHERE shop_id=NEW.shop_id AND installation_generation=NEW.installation_generation;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.erase_customer_artwork_authority() FROM PUBLIC;
CREATE TRIGGER erase_customer_artwork_authority AFTER INSERT ON public.shop_privacy_fences FOR EACH ROW EXECUTE FUNCTION public.erase_customer_artwork_authority();

-- migrate:down
DROP TRIGGER plan_customer_artwork_notification ON public.purchase_paid_facts;
DROP FUNCTION public.plan_customer_artwork_notification();
DROP TRIGGER erase_customer_artwork_for_payload ON public.purchase_design_payloads;
DROP FUNCTION public.erase_customer_artwork_for_payload();
DROP TRIGGER erase_customer_artwork_authority ON public.shop_privacy_fences;
DROP FUNCTION public.erase_customer_artwork_authority();
DROP TABLE customer_artwork_notifications,customer_artwork_submissions,customer_artwork_grants,customer_artwork_epoch;
