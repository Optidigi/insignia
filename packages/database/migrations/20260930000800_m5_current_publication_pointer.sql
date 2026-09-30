-- migrate:up
-- The mutable config pointer keeps current-intent reads constant in publication history.
-- Revision, geometry, presentation and completed command records remain immutable.
CREATE TABLE m5_current_publication_pointer (
  shop_id text NOT NULL,
  config_id text NOT NULL,
  revision_id text NOT NULL,
  installation_generation bigint NOT NULL CHECK (installation_generation > 0),
  source_draft_version bigint NOT NULL CHECK (source_draft_version > 0),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, config_id),
  FOREIGN KEY (shop_id, config_id, revision_id)
    REFERENCES config_revisions (shop_id, config_id, revision_id)
);
CREATE INDEX m5_current_publication_progress_idx
  ON publication_operations (shop_id, config_id, installation_generation, operation_sequence DESC);

-- migrate:down
DROP INDEX m5_current_publication_progress_idx;
DROP TABLE m5_current_publication_pointer;
