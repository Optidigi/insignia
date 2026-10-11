-- migrate:up
-- Explicit privileged owner operations are independent authority, not webhook claims.
CREATE TABLE owner_lifecycle_decisions (
 decision_id uuid PRIMARY KEY,
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 app_client_id text NOT NULL,
 provider_shop_id text,
 shop_id text,
 installation_generation bigint,
 external_installation_id text,
 operation text NOT NULL CHECK(operation IN ('OWNER_DEACTIVATION','OWNER_RECEIPT_ERASURE')),
 authority text NOT NULL CHECK(authority='EXPLICIT_OWNER_REQUEST'),
 native_evidence_sha256 text NOT NULL CHECK(native_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((shop_id IS NULL AND installation_generation IS NULL AND external_installation_id IS NULL) OR (shop_id IS NOT NULL AND installation_generation IS NOT NULL AND installation_generation>0 AND external_installation_id IS NOT NULL)),
 FOREIGN KEY(shop_id,installation_generation) REFERENCES installation_generations(shop_id,generation)
);
REVOKE ALL ON owner_lifecycle_decisions FROM PUBLIC;
CREATE FUNCTION guard_owner_lifecycle_decisions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'owner lifecycle decisions are append-only' USING ERRCODE='check_violation'; END $$;
CREATE TRIGGER owner_lifecycle_decisions_immutable BEFORE UPDATE OR DELETE ON owner_lifecycle_decisions
 FOR EACH ROW EXECUTE FUNCTION guard_owner_lifecycle_decisions();
CREATE TRIGGER owner_lifecycle_decisions_no_truncate BEFORE TRUNCATE ON owner_lifecycle_decisions
 FOR EACH STATEMENT EXECUTE FUNCTION guard_owner_lifecycle_decisions();
-- migrate:down
LOCK TABLE owner_lifecycle_decisions IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM owner_lifecycle_decisions) THEN
 RAISE EXCEPTION 'owner lifecycle evidence prevents rollback' USING ERRCODE='check_violation';
END IF; END $$;
DROP TABLE owner_lifecycle_decisions;
DROP FUNCTION guard_owner_lifecycle_decisions();
