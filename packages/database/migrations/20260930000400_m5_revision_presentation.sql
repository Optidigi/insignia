-- migrate:up
-- Presentation names are immutable metadata beside, never inside, M2 economic revision JSON.
CREATE TABLE config_revision_presentation (
  shop_id text NOT NULL,
  config_id text NOT NULL,
  revision_id text NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = 'm5-presentation-v1'),
  presentation_value jsonb NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, revision_id),
  FOREIGN KEY (shop_id, config_id, revision_id)
    REFERENCES config_revisions (shop_id, config_id, revision_id)
);
CREATE TRIGGER config_revision_presentation_immutable BEFORE UPDATE OR DELETE ON config_revision_presentation
  FOR EACH ROW EXECUTE FUNCTION reject_revision_mutation();

-- migrate:down
DROP TABLE config_revision_presentation;
