-- migrate:up
-- Owner decision, 11 November 2026: the app origin moved to app.insigniacustomizer.com. A per-shop
-- uninstall subscription on an earlier origin is deleted at Shopify and then recorded as
-- superseded. Unlike retired (a drift repair), superseded does not change the installation's
-- repair version, so the current capability stays stable. It is terminal and set only after
-- Shopify confirms the old subscription is gone, so no delivery can arrive for it.
ALTER TABLE uninstall_destinations DROP CONSTRAINT uninstall_destinations_state_check;
ALTER TABLE uninstall_destinations ADD CONSTRAINT uninstall_destinations_state_check
 CHECK(state IN ('prepared','dispatched','registered','rejected','retired','superseded'));
ALTER TABLE uninstall_destinations DROP CONSTRAINT uninstall_destinations_check1;
ALTER TABLE uninstall_destinations ADD CONSTRAINT uninstall_destinations_check1
 CHECK((state IN ('registered','retired','superseded'))=(subscription_id IS NOT NULL AND registered_at IS NOT NULL));
CREATE OR REPLACE FUNCTION guard_uninstall_destination() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR ROW(NEW.capability_digest,NEW.shop_id,NEW.installation_generation,NEW.external_installation_id,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.capability_digest,OLD.shop_id,OLD.installation_generation,OLD.external_installation_id,OLD.created_at)
  OR NOT ((OLD.state='prepared' AND NEW.state='dispatched') OR (OLD.state='dispatched' AND NEW.state IN ('registered','rejected'))
    OR (OLD.state='rejected' AND NEW.state='prepared') OR (OLD.state='registered' AND NEW.state IN ('retired','superseded')))
 THEN RAISE EXCEPTION 'immutable uninstall destination or invalid transition'; END IF;
 INSERT INTO public.uninstall_destination_events(capability_digest,previous_state,next_state)
  VALUES(OLD.capability_digest,OLD.state,NEW.state);
 RETURN NEW;
END $$;
-- migrate:down
CREATE OR REPLACE FUNCTION guard_uninstall_destination() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR ROW(NEW.capability_digest,NEW.shop_id,NEW.installation_generation,NEW.external_installation_id,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.capability_digest,OLD.shop_id,OLD.installation_generation,OLD.external_installation_id,OLD.created_at)
  OR NOT ((OLD.state='prepared' AND NEW.state='dispatched') OR (OLD.state='dispatched' AND NEW.state IN ('registered','rejected'))
    OR (OLD.state='rejected' AND NEW.state='prepared') OR (OLD.state='registered' AND NEW.state='retired'))
 THEN RAISE EXCEPTION 'immutable uninstall destination or invalid transition'; END IF;
 INSERT INTO public.uninstall_destination_events(capability_digest,previous_state,next_state)
  VALUES(OLD.capability_digest,OLD.state,NEW.state);
 RETURN NEW;
END $$;
ALTER TABLE uninstall_destinations DROP CONSTRAINT uninstall_destinations_check1;
ALTER TABLE uninstall_destinations ADD CONSTRAINT uninstall_destinations_check1
 CHECK((state IN ('registered','retired'))=(subscription_id IS NOT NULL AND registered_at IS NOT NULL));
ALTER TABLE uninstall_destinations DROP CONSTRAINT uninstall_destinations_state_check;
ALTER TABLE uninstall_destinations ADD CONSTRAINT uninstall_destinations_state_check
 CHECK(state IN ('prepared','dispatched','registered','rejected','retired'));
