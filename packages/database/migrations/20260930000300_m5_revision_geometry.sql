-- migrate:up
-- Geometry is an immutable companion to the frozen M2 economic revision value.
CREATE TABLE config_revision_geometry (
  shop_id text NOT NULL,
  config_id text NOT NULL,
  revision_id text NOT NULL,
  schema_version text NOT NULL CHECK (schema_version <> ''),
  mode text NOT NULL CHECK (mode IN ('required', 'optional')),
  geometry_value jsonb NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, revision_id),
  FOREIGN KEY (shop_id, config_id, revision_id)
    REFERENCES config_revisions (shop_id, config_id, revision_id)
);
CREATE TRIGGER config_revision_geometry_immutable BEFORE UPDATE OR DELETE ON config_revision_geometry
  FOR EACH ROW EXECUTE FUNCTION reject_revision_mutation();

-- migrate:down
DROP TABLE config_revision_geometry;
