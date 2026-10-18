-- migrate:up
-- A destination is a private capability transmitted exclusively to the Admin
-- API APP_UNINSTALLED subscription. Generic webhook headers remain untrusted.
CREATE TABLE uninstall_destinations (
 capability_digest text PRIMARY KEY CHECK(capability_digest ~ '^[a-f0-9]{64}$'),
 shop_id text NOT NULL,
 installation_generation bigint NOT NULL,
 external_installation_id text NOT NULL CHECK(external_installation_id ~ '^gid://shopify/AppInstallation/[1-9][0-9]*$'),
 state text NOT NULL CHECK(state IN ('prepared','dispatched','registered','rejected','retired')),
 subscription_id text CHECK(subscription_id ~ '^gid://shopify/WebhookSubscription/[1-9][0-9]*$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 dispatched_at timestamptz,
 registered_at timestamptz,
 FOREIGN KEY(shop_id,installation_generation) REFERENCES installation_generations(shop_id,generation),
 CHECK((state='prepared')=(dispatched_at IS NULL)),
 CHECK((state IN ('registered','retired'))=(subscription_id IS NOT NULL AND registered_at IS NOT NULL))
);
CREATE TABLE uninstall_delivery_authority (
 inbox_id uuid PRIMARY KEY REFERENCES inbox_messages(id),
 capability_digest text NOT NULL REFERENCES uninstall_destinations(capability_digest),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE uninstall_destination_events (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 capability_digest text NOT NULL REFERENCES uninstall_destinations(capability_digest),
 previous_state text NOT NULL, next_state text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON uninstall_destinations,uninstall_delivery_authority,uninstall_destination_events FROM PUBLIC;
CREATE TRIGGER uninstall_destination_events_immutable BEFORE UPDATE OR DELETE ON uninstall_destination_events
 FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE TRIGGER uninstall_authority_immutable BEFORE UPDATE OR DELETE ON uninstall_delivery_authority
 FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE FUNCTION guard_uninstall_destination() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
REVOKE ALL ON FUNCTION guard_uninstall_destination() FROM PUBLIC;
CREATE TRIGGER uninstall_destination_guard BEFORE UPDATE OR DELETE ON uninstall_destinations
 FOR EACH ROW EXECUTE FUNCTION guard_uninstall_destination();

-- migrate:down
DROP TABLE uninstall_destination_events;
DROP TABLE uninstall_delivery_authority;
DROP TABLE uninstall_destinations;
DROP FUNCTION guard_uninstall_destination();
