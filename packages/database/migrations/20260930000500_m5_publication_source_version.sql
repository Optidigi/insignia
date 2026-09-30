-- migrate:up
-- The immutable publication companion remembers the draft version that produced
-- the request, so a browser without session storage can resume the same command
-- after newer draft edits. Existing local candidate rows remain nullable.
ALTER TABLE config_revision_presentation
  ADD COLUMN source_draft_version bigint CHECK (source_draft_version > 0);

-- migrate:down
ALTER TABLE config_revision_presentation DROP COLUMN source_draft_version;
