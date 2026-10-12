-- migrate:up
ALTER TABLE cart_applications ADD CONSTRAINT cart_applications_scoped_identity UNIQUE(shop_id,installation_generation,session_id,application_id);
CREATE TABLE buyer_commands (
 shop_id text NOT NULL,installation_generation bigint NOT NULL,session_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('accept','renew')),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128),
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 application_id uuid,created_at timestamptz NOT NULL,
 PRIMARY KEY(session_id,kind,idempotency_key),
 FOREIGN KEY(shop_id,installation_generation,session_id) REFERENCES buyer_sessions(shop_id,installation_generation,session_id) ON DELETE CASCADE,
 FOREIGN KEY(shop_id,installation_generation,session_id,application_id) REFERENCES cart_applications(shop_id,installation_generation,session_id,application_id)
);
CREATE FUNCTION guard_buyer_command_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.shop_id,NEW.installation_generation,NEW.session_id,NEW.kind,NEW.idempotency_key,NEW.request_digest,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.shop_id,OLD.installation_generation,OLD.session_id,OLD.kind,OLD.idempotency_key,OLD.request_digest,OLD.created_at)
    OR (OLD.application_id IS NOT NULL AND NEW.application_id IS DISTINCT FROM OLD.application_id) THEN
  RAISE EXCEPTION 'buyer command identity and completed application are immutable' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER buyer_command_identity BEFORE UPDATE ON buyer_commands FOR EACH ROW EXECUTE FUNCTION guard_buyer_command_identity();
-- migrate:down
DROP TABLE buyer_commands;
DROP FUNCTION guard_buyer_command_identity();
ALTER TABLE cart_applications DROP CONSTRAINT cart_applications_scoped_identity;
