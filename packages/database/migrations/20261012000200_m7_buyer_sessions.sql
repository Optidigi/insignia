-- migrate:up
CREATE TABLE buyer_admission (
 shop_id text NOT NULL, installation_generation bigint NOT NULL,
 window_at timestamptz NOT NULL, issued integer NOT NULL CHECK(issued BETWEEN 0 AND 60),
 PRIMARY KEY(shop_id,installation_generation),
 FOREIGN KEY(shop_id,installation_generation) REFERENCES installation_generations(shop_id,generation)
);
CREATE TABLE buyer_sessions (
 session_id uuid PRIMARY KEY, shop_id text NOT NULL, installation_generation bigint NOT NULL,
 owner_hash text NOT NULL CHECK(owner_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 write_window timestamptz NOT NULL, write_count integer NOT NULL DEFAULT 0 CHECK(write_count BETWEEN 0 AND 60),
 CHECK(expires_at > created_at AND expires_at <= created_at + interval '7 days'),
 UNIQUE(shop_id,installation_generation,owner_hash), UNIQUE(shop_id,installation_generation,session_id),
 FOREIGN KEY(shop_id,installation_generation) REFERENCES installation_generations(shop_id,generation)
);
CREATE INDEX buyer_sessions_expiry ON buyer_sessions(expires_at,session_id);
CREATE FUNCTION buyer_session_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.session_id,NEW.shop_id,NEW.installation_generation,NEW.owner_hash,NEW.created_at,NEW.expires_at) IS DISTINCT FROM ROW(OLD.session_id,OLD.shop_id,OLD.installation_generation,OLD.owner_hash,OLD.created_at,OLD.expires_at) THEN RAISE EXCEPTION 'buyer session identity and expiry are immutable' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER buyer_session_identity BEFORE UPDATE ON buyer_sessions FOR EACH ROW EXECUTE FUNCTION buyer_session_identity();
CREATE TABLE design_drafts (
 design_id uuid PRIMARY KEY,shop_id text NOT NULL,installation_generation bigint NOT NULL,session_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version BETWEEN 1 AND 2147483647),payload jsonb NOT NULL CHECK(octet_length(payload::text)<=131072),
 expires_at timestamptz NOT NULL,
 FOREIGN KEY(shop_id,installation_generation,session_id) REFERENCES buyer_sessions(shop_id,installation_generation,session_id) ON DELETE CASCADE
);
CREATE TABLE quote_proposals (
 proposal_id uuid PRIMARY KEY,shop_id text NOT NULL,installation_generation bigint NOT NULL,session_id uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),material_hash text NOT NULL CHECK(material_hash ~ '^[a-f0-9]{64}$'),
 desired_request jsonb NOT NULL CHECK(octet_length(desired_request::text)<=131072),candidate jsonb NOT NULL CHECK(octet_length(candidate::text)<=262144),
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 retain_private_until timestamptz NOT NULL,
 CHECK(expires_at > created_at AND expires_at <= created_at + interval '5 minutes'),
 CHECK(retain_private_until >= expires_at),
 FOREIGN KEY(shop_id,installation_generation,session_id) REFERENCES buyer_sessions(shop_id,installation_generation,session_id) ON DELETE CASCADE
);
CREATE INDEX quote_proposals_expiry ON quote_proposals(retain_private_until,proposal_id);
CREATE TRIGGER buyer_proposal_immutable BEFORE UPDATE ON quote_proposals FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE TABLE buyer_quote_ownership (
 shop_id text NOT NULL,installation_generation bigint NOT NULL,quote_id uuid NOT NULL,
 proposal_id uuid NOT NULL,owner_binding text NOT NULL CHECK(owner_binding ~ '^[a-f0-9]{64}$'),request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),created_at timestamptz NOT NULL,
 PRIMARY KEY(shop_id,installation_generation,quote_id),
 FOREIGN KEY(shop_id,installation_generation,quote_id) REFERENCES accepted_quotes(shop_id,installation_generation,quote_id)
);
CREATE TRIGGER buyer_quote_owner_immutable BEFORE UPDATE ON buyer_quote_ownership FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE TABLE cart_applications (
 application_id uuid PRIMARY KEY,shop_id text NOT NULL,installation_generation bigint NOT NULL,session_id uuid NOT NULL,quote_id uuid NOT NULL,
 expected_fingerprint text NOT NULL CHECK(expected_fingerprint ~ '^[a-f0-9]{64}$'),observed_fingerprint text CHECK(observed_fingerprint ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPLIED','REVIEW_REQUIRED')),created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 FOREIGN KEY(shop_id,installation_generation,session_id) REFERENCES buyer_sessions(shop_id,installation_generation,session_id) ON DELETE CASCADE,
 FOREIGN KEY(shop_id,installation_generation,quote_id) REFERENCES buyer_quote_ownership(shop_id,installation_generation,quote_id)
);
CREATE FUNCTION buyer_payload_deadline() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE deadline timestamptz;
BEGIN
 SELECT expires_at INTO deadline FROM buyer_sessions WHERE session_id=NEW.session_id AND shop_id=NEW.shop_id AND installation_generation=NEW.installation_generation;
 IF NEW.expires_at > deadline THEN RAISE EXCEPTION 'buyer payload cannot outlive session' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER buyer_design_deadline BEFORE INSERT OR UPDATE ON design_drafts FOR EACH ROW EXECUTE FUNCTION buyer_payload_deadline();
CREATE FUNCTION buyer_proposal_retention() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.retain_private_until > (SELECT expires_at FROM buyer_sessions WHERE session_id=NEW.session_id) THEN RAISE EXCEPTION 'proposal retention cannot outlive session' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER buyer_proposal_deadline BEFORE INSERT ON quote_proposals FOR EACH ROW EXECUTE FUNCTION buyer_payload_deadline();
CREATE TRIGGER buyer_proposal_retention BEFORE INSERT ON quote_proposals FOR EACH ROW EXECUTE FUNCTION buyer_proposal_retention();
CREATE TRIGGER buyer_application_deadline BEFORE INSERT OR UPDATE ON cart_applications FOR EACH ROW EXECUTE FUNCTION buyer_payload_deadline();
-- migrate:down
DROP TABLE cart_applications, buyer_quote_ownership, quote_proposals, design_drafts, buyer_sessions, buyer_admission;
DROP FUNCTION buyer_payload_deadline(),buyer_proposal_retention(),buyer_session_identity();
