-- migrate:up
-- Immutable M5 intents cannot be resumed under a later shop installation.
ALTER TABLE config_revision_presentation
  ADD COLUMN source_installation_generation bigint CHECK (source_installation_generation > 0);

-- migrate:down
ALTER TABLE config_revision_presentation DROP COLUMN source_installation_generation;
