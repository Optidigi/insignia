-- migrate:up
-- Spec §10.4: 7 days covers only unfinished/abandoned work. Artwork and the design payload of a recorded
-- order are kept until six calendar months after their original collection (never longer). Before this
-- migration a recorded order kept the session-bounded 7-day deadlines, so its artwork, design, previews
-- and customer upload link disappeared about a week after upload, paid or not.
--
-- The order is recorded when Shopify reports it (orders/create), before or without payment: a
-- pending-payment order is placed, not abandoned, and must still have its artwork when payment
-- arrives. Cancellation does not shorten the deadline; the six-month maximum still applies.
--
-- "Collection" is each record's own collected_at: the artwork upload time for an asset, the buyer
-- session start for a design payload. The deadline is six calendar months later, computed in UTC,
-- less a 2-day margin: the existing 6-month CHECKs add the interval in the session time zone and are
-- re-evaluated by every later UPDATE (erasure included). Month-end clamping in another zone can move
-- that bound up to a day (plus a DST hour) earlier, and erasure must never fail on it.
--
-- Everything runs as the schema owner (SECURITY DEFINER), so no runtime role needs a grant. The
-- guards keep each deadline immutable for every other role. Erasure is unchanged: customer/shop
-- redaction sets the asset DELETING and the payload to a tombstone, which the inspector and
-- cleanup_purchase_payloads remove at once whatever the deadline.
CREATE FUNCTION public.purchased_retention_deadline(p_collected timestamptz) RETURNS timestamptz
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT ((p_collected AT TIME ZONE 'UTC') + interval '6 months' - interval '2 days') AT TIME ZONE 'UTC'
$$;
REVOKE ALL ON FUNCTION public.purchased_retention_deadline(timestamptz) FROM PUBLIC;

-- Assets: the maximum moves from 7 days to six months; a new upload still starts at 7 days at most.
ALTER TABLE public.artwork_assets
 DROP CONSTRAINT artwork_assets_check4,
 ADD CONSTRAINT artwork_assets_retention_check CHECK (expires_at > collected_at AND expires_at <= collected_at + interval '6 months');
CREATE FUNCTION public.guard_artwork_initial_retention() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.expires_at > NEW.collected_at + interval '7 days' THEN
  RAISE EXCEPTION 'new artwork is retained at most 7 days until an order records it' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_artwork_initial_retention() FROM PUBLIC;
CREATE TRIGGER artwork_initial_retention_guard BEFORE INSERT ON public.artwork_assets FOR EACH ROW EXECUTE FUNCTION public.guard_artwork_initial_retention();

-- Only the schema owner (inside retain_purchased_detail) may move a deadline, only later, only while
-- the record is live. The CHECKs bound the result.
CREATE OR REPLACE FUNCTION public.guard_artwork_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.asset_id,NEW.shop_id,NEW.installation_generation,NEW.declared_mime,NEW.declared_bytes,
         NEW.quarantine_key,NEW.original_key,NEW.preview_key,NEW.collected_at,NEW.upload_until)
     IS DISTINCT FROM
     ROW(OLD.asset_id,OLD.shop_id,OLD.installation_generation,OLD.declared_mime,OLD.declared_bytes,
         OLD.quarantine_key,OLD.original_key,OLD.preview_key,OLD.collected_at,OLD.upload_until)
     OR (NEW.expires_at IS DISTINCT FROM OLD.expires_at AND NOT (
         NEW.expires_at > OLD.expires_at AND OLD.expires_at > clock_timestamp() AND OLD.state='USABLE' AND NEW.state='USABLE'
         AND current_user::text = (SELECT pg_get_userbyid(c.relowner)::text FROM pg_class c WHERE c.oid='public.artwork_assets'::regclass))) THEN
    RAISE EXCEPTION 'artwork identity and original retention deadline are immutable' USING ERRCODE='check_violation';
  END IF;
  IF OLD.manifest IS NOT NULL AND NEW.manifest IS DISTINCT FROM OLD.manifest AND NEW.state <> 'DELETED' THEN
    RAISE EXCEPTION 'artwork manifest is immutable' USING ERRCODE='check_violation';
  END IF;
  IF NEW.owner_hash IS DISTINCT FROM OLD.owner_hash AND NOT (NEW.state='DELETED' AND NEW.owner_hash IS NULL) THEN
    RAISE EXCEPTION 'artwork owner is immutable' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.guard_purchase_payload() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-'expires_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'expires_at') AND NEW.expires_at > OLD.expires_at
    AND OLD.erased_at IS NULL AND OLD.expires_at > clock_timestamp()
    AND current_user::text = (SELECT pg_get_userbyid(c.relowner)::text FROM pg_class c WHERE c.oid='public.purchase_design_payloads'::regclass) THEN
   RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-'payload'-'erased_at') IS DISTINCT FROM (to_jsonb(OLD)-'payload'-'erased_at') OR
    OLD.erased_at IS NOT NULL OR NEW.payload IS NOT NULL OR NEW.erased_at IS NULL THEN
   RAISE EXCEPTION 'purchase payload may only become an erasure tombstone' USING ERRCODE='check_violation';
 END IF; RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.guard_purchase_artwork_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-'expires_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'expires_at') AND OLD.kind='ATTACH' AND OLD.erased_at IS NULL
    AND NEW.expires_at > OLD.expires_at AND OLD.expires_at > clock_timestamp()
    AND NEW.expires_at <= (SELECT a.expires_at FROM public.artwork_assets a WHERE a.asset_id=OLD.asset_id)
    AND current_user::text = (SELECT pg_get_userbyid(c.relowner)::text FROM pg_class c WHERE c.oid='public.purchase_artwork_events'::regclass) THEN
   RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-'asset_id'-'placement_id'-'group_index'-'erased_at') IS DISTINCT FROM (to_jsonb(OLD)-'asset_id'-'placement_id'-'group_index'-'erased_at') OR
    OLD.kind<>'ATTACH' OR OLD.erased_at IS NOT NULL OR NEW.erased_at IS NULL OR NEW.asset_id IS NOT NULL OR NEW.placement_id IS NOT NULL OR NEW.group_index IS NOT NULL THEN
  RAISE EXCEPTION 'artwork event is append-only except private erasure' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END; $$;

-- Extends one recorded order's live production detail: its design payloads to their collection plus
-- six months; each USABLE artwork it references (signed design or attachment) to its own collection
-- plus six months, never past the order's design; live attachment links to their asset's deadline.
-- Expired, erased, DELETING or foreign-shop records are never touched. Idempotent; returns rows changed.
CREATE FUNCTION public.retain_purchased_detail(p_purchase uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE at_time timestamptz:=clock_timestamp(); design_until timestamptz; shop text; changed integer:=0; n integer;
BEGIN
 UPDATE public.purchase_design_payloads SET expires_at=public.purchased_retention_deadline(collected_at)
  WHERE purchase_id=p_purchase AND erased_at IS NULL AND expires_at>at_time AND expires_at<public.purchased_retention_deadline(collected_at);
 GET DIAGNOSTICS n=ROW_COUNT; changed:=changed+n;
 SELECT max(p.expires_at),min(p.shop_id) INTO design_until,shop FROM public.purchase_design_payloads p
  WHERE p.purchase_id=p_purchase AND p.erased_at IS NULL AND p.expires_at>at_time;
 IF design_until IS NULL THEN RETURN changed; END IF;
 UPDATE public.artwork_assets a SET expires_at=least(public.purchased_retention_deadline(a.collected_at),design_until),updated_at=at_time
  WHERE a.shop_id=shop AND a.state='USABLE' AND a.expires_at>at_time
   AND a.expires_at<least(public.purchased_retention_deadline(a.collected_at),design_until)
   AND a.asset_id IN (
    SELECT r.asset_id FROM public.purchase_design_payloads p CROSS JOIN LATERAL public.customer_privacy_payload_assets(p.payload->'request') r
     WHERE p.purchase_id=p_purchase AND p.erased_at IS NULL AND p.expires_at>at_time
    UNION SELECT e.asset_id FROM public.purchase_artwork_events e
     WHERE e.purchase_id=p_purchase AND e.kind='ATTACH' AND e.erased_at IS NULL AND e.expires_at>at_time);
 GET DIAGNOSTICS n=ROW_COUNT; changed:=changed+n;
 UPDATE public.purchase_artwork_events e SET expires_at=a.expires_at FROM public.artwork_assets a
  WHERE e.purchase_id=p_purchase AND e.kind='ATTACH' AND e.erased_at IS NULL AND e.expires_at>at_time
   AND a.asset_id=e.asset_id AND a.shop_id=e.shop_id AND a.state='USABLE' AND a.expires_at>e.expires_at;
 GET DIAGNOSTICS n=ROW_COUNT; changed:=changed+n;
 RETURN changed;
END $$;
REVOKE ALL ON FUNCTION public.retain_purchased_detail(uuid) FROM PUBLIC;

-- Recording an order's design extends it in the same transaction. Named to fire after the
-- customer_private_* erasure fences.
CREATE FUNCTION public.retain_purchased_design() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.retain_purchased_detail(NEW.purchase_id);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.retain_purchased_design() FROM PUBLIC;
CREATE TRIGGER retain_purchased_design AFTER INSERT ON public.purchase_design_payloads FOR EACH ROW
 WHEN (NEW.payload IS NOT NULL) EXECUTE FUNCTION public.retain_purchased_design();
-- Attaching artwork to a recorded order (merchant replacement or customer link) extends that asset and
-- the new attachment only, so an order's attachment history costs one row each.
CREATE FUNCTION public.retain_purchased_attachment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE at_time timestamptz:=clock_timestamp(); design_until timestamptz; kept timestamptz;
BEGIN
 IF NEW.erased_at IS NOT NULL OR NEW.expires_at<=at_time THEN RETURN NEW; END IF;
 SELECT max(p.expires_at) INTO design_until FROM public.purchase_design_payloads p
  WHERE p.purchase_id=NEW.purchase_id AND p.erased_at IS NULL AND p.expires_at>at_time;
 IF design_until IS NULL THEN RETURN NEW; END IF;
 UPDATE public.artwork_assets a SET expires_at=least(public.purchased_retention_deadline(a.collected_at),design_until),updated_at=at_time
  WHERE a.asset_id=NEW.asset_id AND a.shop_id=NEW.shop_id AND a.state='USABLE' AND a.expires_at>at_time
   AND a.expires_at<least(public.purchased_retention_deadline(a.collected_at),design_until);
 SELECT a.expires_at INTO kept FROM public.artwork_assets a WHERE a.asset_id=NEW.asset_id AND a.shop_id=NEW.shop_id AND a.state='USABLE';
 IF kept>NEW.expires_at THEN NEW.expires_at:=kept; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.retain_purchased_attachment() FROM PUBLIC;
CREATE TRIGGER retain_purchased_attachment BEFORE INSERT ON public.purchase_artwork_events FOR EACH ROW
 WHEN (NEW.kind='ATTACH') EXECUTE FUNCTION public.retain_purchased_attachment();

-- Backfill: orders already recorded whose design is still live. That set is bounded by the old 7-day
-- deadlines; each purchase is processed once and a re-run changes nothing.
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT DISTINCT purchase_id FROM public.purchase_design_payloads WHERE erased_at IS NULL AND expires_at>clock_timestamp() ORDER BY purchase_id LOOP
  PERFORM public.retain_purchased_detail(item.purchase_id);
 END LOOP;
END $$;

-- migrate:down
-- Extended deadlines stay (shortening could delete a recorded order's artwork early); the older
-- image's guards and 7-day asset CHECK cannot hold them, so down refuses while any remain.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.artwork_assets WHERE expires_at>collected_at+interval '7 days') THEN
  RAISE EXCEPTION 'purchased artwork retention is in use; down migration refused' USING ERRCODE='check_violation';
 END IF;
END $$;
DROP TRIGGER retain_purchased_attachment ON public.purchase_artwork_events;
DROP TRIGGER retain_purchased_design ON public.purchase_design_payloads;
DROP FUNCTION public.retain_purchased_attachment(),public.retain_purchased_design();
DROP FUNCTION public.retain_purchased_detail(uuid);
CREATE OR REPLACE FUNCTION public.guard_purchase_artwork_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-'asset_id'-'placement_id'-'group_index'-'erased_at') IS DISTINCT FROM (to_jsonb(OLD)-'asset_id'-'placement_id'-'group_index'-'erased_at') OR
    OLD.kind<>'ATTACH' OR OLD.erased_at IS NOT NULL OR NEW.erased_at IS NULL OR NEW.asset_id IS NOT NULL OR NEW.placement_id IS NOT NULL OR NEW.group_index IS NOT NULL THEN
  RAISE EXCEPTION 'artwork event is append-only except private erasure' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.guard_purchase_payload() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-'payload'-'erased_at') IS DISTINCT FROM (to_jsonb(OLD)-'payload'-'erased_at') OR
    OLD.erased_at IS NOT NULL OR NEW.payload IS NOT NULL OR NEW.erased_at IS NULL THEN
   RAISE EXCEPTION 'purchase payload may only become an erasure tombstone' USING ERRCODE='check_violation';
 END IF; RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.guard_artwork_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.asset_id,NEW.shop_id,NEW.installation_generation,NEW.declared_mime,NEW.declared_bytes,
         NEW.quarantine_key,NEW.original_key,NEW.preview_key,NEW.collected_at,NEW.upload_until,NEW.expires_at)
     IS DISTINCT FROM
     ROW(OLD.asset_id,OLD.shop_id,OLD.installation_generation,OLD.declared_mime,OLD.declared_bytes,
         OLD.quarantine_key,OLD.original_key,OLD.preview_key,OLD.collected_at,OLD.upload_until,OLD.expires_at) THEN
    RAISE EXCEPTION 'artwork identity and original retention deadline are immutable' USING ERRCODE='check_violation';
  END IF;
  IF OLD.manifest IS NOT NULL AND NEW.manifest IS DISTINCT FROM OLD.manifest AND NEW.state <> 'DELETED' THEN
    RAISE EXCEPTION 'artwork manifest is immutable' USING ERRCODE='check_violation';
  END IF;
  IF NEW.owner_hash IS DISTINCT FROM OLD.owner_hash AND NOT (NEW.state='DELETED' AND NEW.owner_hash IS NULL) THEN
    RAISE EXCEPTION 'artwork owner is immutable' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER artwork_initial_retention_guard ON public.artwork_assets;
DROP FUNCTION public.guard_artwork_initial_retention();
ALTER TABLE public.artwork_assets
 DROP CONSTRAINT artwork_assets_retention_check,
 ADD CONSTRAINT artwork_assets_check4 CHECK (expires_at > collected_at AND expires_at <= collected_at + interval '7 days');
DROP FUNCTION public.purchased_retention_deadline(timestamptz);
