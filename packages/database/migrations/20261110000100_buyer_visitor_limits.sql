-- migrate:up
-- One visitor must not exhaust a shop's buyer capacity. Shop-wide session issuance rises to a
-- safety ceiling, and a session that never holds a design or proposal lives 24 hours.
ALTER TABLE buyer_admission DROP CONSTRAINT buyer_admission_issued_check;
ALTER TABLE buyer_admission ADD CONSTRAINT buyer_admission_issued_check CHECK(issued BETWEEN 0 AND 600);
-- grant_expires_at is the capability lifetime. A session starts with a shorter expires_at and is
-- extended exactly once, to its grant, when it first stores a design or proposal. NULL (rows
-- written before this migration or by an older writer) means expires_at is already the grant.
ALTER TABLE buyer_sessions ADD COLUMN grant_expires_at timestamptz;
ALTER TABLE buyer_sessions ADD CONSTRAINT buyer_sessions_grant_check CHECK(grant_expires_at IS NULL OR
  (expires_at <= grant_expires_at AND grant_expires_at <= created_at + interval '7 days'));
-- Issuance counts a shop's live sessions against its ceiling.
CREATE INDEX buyer_sessions_tenant_expiry ON buyer_sessions(shop_id,installation_generation,expires_at);
CREATE OR REPLACE FUNCTION buyer_session_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.session_id,NEW.shop_id,NEW.installation_generation,NEW.owner_hash,NEW.created_at,NEW.grant_expires_at) IS DISTINCT FROM ROW(OLD.session_id,OLD.shop_id,OLD.installation_generation,OLD.owner_hash,OLD.created_at,OLD.grant_expires_at)
  OR (NEW.expires_at IS DISTINCT FROM OLD.expires_at AND NOT (OLD.grant_expires_at IS NOT NULL AND NEW.expires_at = OLD.grant_expires_at AND OLD.expires_at < OLD.grant_expires_at)) THEN
  RAISE EXCEPTION 'buyer session identity and expiry are immutable' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END; $$;
-- migrate:down
CREATE OR REPLACE FUNCTION buyer_session_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.session_id,NEW.shop_id,NEW.installation_generation,NEW.owner_hash,NEW.created_at,NEW.expires_at) IS DISTINCT FROM ROW(OLD.session_id,OLD.shop_id,OLD.installation_generation,OLD.owner_hash,OLD.created_at,OLD.expires_at) THEN RAISE EXCEPTION 'buyer session identity and expiry are immutable' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END; $$;
DROP INDEX buyer_sessions_tenant_expiry;
ALTER TABLE buyer_sessions DROP CONSTRAINT buyer_sessions_grant_check;
ALTER TABLE buyer_sessions DROP COLUMN grant_expires_at;
UPDATE buyer_admission SET issued=LEAST(issued,60);
ALTER TABLE buyer_admission DROP CONSTRAINT buyer_admission_issued_check;
ALTER TABLE buyer_admission ADD CONSTRAINT buyer_admission_issued_check CHECK(issued BETWEEN 0 AND 60);
