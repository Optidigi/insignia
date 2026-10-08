-- migrate:up
-- Schema/operator credential owns this relation; the normal web role only reads.
CREATE TABLE trusted_release_records (
  record_seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  record_id text PRIMARY KEY CHECK (record_id ~ '^[A-Za-z0-9][A-Za-z0-9:/._-]{0,255}$'),
  shop_id text NOT NULL,
  installation_generation bigint NOT NULL CHECK (installation_generation > 0),
  app_client_id text NOT NULL CHECK (app_client_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  active_app_version_ref text NOT NULL CHECK (active_app_version_ref ~ '^[A-Za-z0-9][A-Za-z0-9:/._-]{0,255}$'),
  expected_build jsonb NOT NULL CHECK (jsonb_typeof(expected_build) = 'object'),
  trusted_record jsonb NOT NULL CHECK (jsonb_typeof(trusted_record) = 'object'),
  active_version_observed_at timestamptz NOT NULL CHECK (isfinite(active_version_observed_at)),
  active_version_evidence_sha256 text NOT NULL CHECK (active_version_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (shop_id, installation_generation) REFERENCES installation_generations(shop_id, generation),
  CHECK (active_version_observed_at <= created_at),
  CHECK (coalesce(trusted_record->>'version', '') = 'm5-trusted-release-v1'),
  CHECK (coalesce(trusted_record->>'recordId', '') = record_id),
  CHECK (coalesce(trusted_record->>'activeAppVersionRef', '') = active_app_version_ref),
  CHECK (coalesce(trusted_record->'attestation'->>'evidenceKind', '') = 'RELEASE_BOUND'),
  CHECK (coalesce(trusted_record->'attestation'->>'appVersionRef', '') = active_app_version_ref),
  CHECK (coalesce(trusted_record->'attestation'->>'shopId', '') = shop_id),
  CHECK (coalesce(trusted_record->'attestation'->>'installationGeneration', '') = installation_generation::text),
  CHECK (coalesce(trusted_record->'attestation'->>'appClientId', '') = app_client_id),
  CHECK ((trusted_record->'attestation'->>'observedAt')::timestamptz IS NOT DISTINCT FROM active_version_observed_at),
  CHECK (coalesce(expected_build->>'appVersionRef', '') = active_app_version_ref),
  CHECK (coalesce(expected_build->>'shopId', '') = shop_id),
  CHECK (coalesce(expected_build->>'installationGeneration', '') = installation_generation::text),
  CHECK (coalesce(expected_build->>'appClientId', '') = app_client_id)
);
CREATE INDEX trusted_release_scope_order ON trusted_release_records(shop_id, installation_generation, app_client_id, record_seq DESC);
CREATE INDEX trusted_release_active_observation ON trusted_release_records(app_client_id, active_version_observed_at DESC);

CREATE FUNCTION forbid_trusted_release_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trusted release evidence is append-only' USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER trusted_release_no_rewrite BEFORE UPDATE OR DELETE ON trusted_release_records
  FOR EACH ROW EXECUTE FUNCTION forbid_trusted_release_rewrite();
CREATE TRIGGER trusted_release_no_truncate BEFORE TRUNCATE ON trusted_release_records
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_trusted_release_rewrite();

REVOKE ALL ON trusted_release_records FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'insignia_runtime') THEN
    REVOKE ALL ON trusted_release_records FROM insignia_runtime;
    GRANT SELECT ON trusted_release_records TO insignia_runtime;
  END IF;
END;
$$;
-- A separately authorized operator grants INSERT to its dedicated release credential.
-- No release record, installation or runtime provisioning is performed by this migration.

-- migrate:down
-- Disposable local/CI schema rehearsal only. Production rollback is web-only;
-- removing historical trusted evidence requires separate authority.
DROP TABLE trusted_release_records;
DROP FUNCTION forbid_trusted_release_rewrite();
