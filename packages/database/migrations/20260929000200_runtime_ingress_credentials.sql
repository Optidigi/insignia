-- migrate:up
-- Shopify's delivery ID is stable across unresolved and installed states.
-- Keep the original inbox UUID while routing metadata remains separately bounded.
ALTER TABLE shops ADD COLUMN shopify_shop_id text UNIQUE
  CHECK (shopify_shop_id IS NULL OR shopify_shop_id ~ '^[1-9][0-9]{0,19}$');
CREATE TABLE shopify_webhook_deliveries (
  inbox_id uuid PRIMARY KEY REFERENCES inbox_messages(id) ON DELETE CASCADE,
  shop_domain text NOT NULL CHECK (length(shop_domain) BETWEEN 16 AND 253 AND shop_domain = lower(shop_domain)
    AND shop_domain LIKE '%.myshopify.com'),
  delivery_id text NOT NULL CHECK (length(delivery_id) BETWEEN 1 AND 256),
  topic text NOT NULL CHECK (length(topic) BETWEEN 1 AND 128),
  api_version text NOT NULL CHECK (length(api_version) BETWEEN 1 AND 32),
  triggered_at timestamptz NOT NULL,
  event_id text CHECK (event_id IS NULL OR length(event_id) BETWEEN 1 AND 256),
  webhook_name text CHECK (webhook_name IS NULL OR length(webhook_name) BETWEEN 1 AND 128),
  UNIQUE (shop_domain, delivery_id)
);
CREATE INDEX shopify_webhook_unresolved_idx ON shopify_webhook_deliveries(shop_domain, inbox_id);

CREATE TABLE shop_credentials (
  shop_id text NOT NULL,
  installation_generation bigint NOT NULL,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  credential_version bigint NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  state text NOT NULL CHECK (state IN ('active', 'refresh-in-progress', 'reauth-required', 'revoked')),
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  scopes text,
  wrapping_key_id text NOT NULL CHECK (wrapping_key_id <> ''),
  access_envelope jsonb,
  refresh_envelope jsonb,
  refresh_claim_id uuid,
  refresh_claim_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (shop_id, installation_generation),
  FOREIGN KEY (shop_id, installation_generation) REFERENCES installation_generations(shop_id, generation),
  CHECK ((refresh_claim_id IS NULL) = (refresh_claim_until IS NULL)),
  CHECK ((state = 'refresh-in-progress') = (refresh_claim_id IS NOT NULL)),
  CHECK (state IN ('reauth-required', 'revoked') OR (access_envelope IS NOT NULL AND refresh_envelope IS NOT NULL))
);

-- A numerically current generation is insufficient after uninstall.
CREATE FUNCTION reject_inactive_generation_work() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'publication_operations' THEN
    IF NEW.status = 'activated' AND OLD.status IS DISTINCT FROM NEW.status AND NOT EXISTS (
      SELECT 1 FROM installation_generations i
      JOIN shops s ON s.shop_id = i.shop_id AND s.current_generation = i.generation
      WHERE i.shop_id = NEW.shop_id AND i.generation = NEW.installation_generation
        AND i.deactivated_at IS NULL
    ) THEN
      RAISE EXCEPTION 'inactive installation cannot activate publication' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'product_configs' THEN
    IF NEW.effective_operation_id IS NOT NULL AND
       OLD.effective_operation_id IS DISTINCT FROM NEW.effective_operation_id AND NOT EXISTS (
      SELECT 1 FROM publication_operations op
      JOIN installation_generations i ON i.shop_id = op.shop_id AND i.generation = op.installation_generation
      JOIN shops s ON s.shop_id = i.shop_id AND s.current_generation = i.generation
      WHERE op.shop_id = NEW.shop_id AND op.config_id = NEW.config_id
        AND op.operation_id = NEW.effective_operation_id AND i.deactivated_at IS NULL
    ) THEN
      RAISE EXCEPTION 'inactive installation cannot become effective' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'outbox_events' THEN
    IF NEW.installation_generation IS NOT NULL AND
       (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM NEW.state) AND NOT EXISTS (
      SELECT 1 FROM installation_generations i
      JOIN shops s ON s.shop_id = i.shop_id AND s.current_generation = i.generation
      WHERE i.shop_id = NEW.shop_id AND i.generation = NEW.installation_generation
        AND i.deactivated_at IS NULL
    ) THEN
      RAISE EXCEPTION 'inactive installation cannot enqueue or claim work' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER publication_active_installation_guard BEFORE UPDATE ON publication_operations
  FOR EACH ROW EXECUTE FUNCTION reject_inactive_generation_work();
CREATE TRIGGER effective_active_installation_guard BEFORE UPDATE ON product_configs
  FOR EACH ROW EXECUTE FUNCTION reject_inactive_generation_work();
CREATE TRIGGER outbox_active_installation_guard BEFORE INSERT OR UPDATE ON outbox_events
  FOR EACH ROW EXECUTE FUNCTION reject_inactive_generation_work();

-- Clearing an effective pointer during uninstall is safe even though the
-- numeric current generation remains unchanged until the next installation.
CREATE OR REPLACE FUNCTION enforce_effective_activation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE op publication_operations%ROWTYPE;
DECLARE current_installation bigint;
BEGIN
  IF NEW.publication_sequence < OLD.publication_sequence THEN
    RAISE EXCEPTION 'publication sequence cannot decrease' USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.effective_revision_id, OLD.effective_operation_id)
     IS DISTINCT FROM (NEW.effective_revision_id, NEW.effective_operation_id) THEN
    SELECT current_generation INTO current_installation FROM shops WHERE shop_id = NEW.shop_id;
    IF NEW.effective_revision_id IS NULL AND NEW.effective_operation_id IS NULL AND
       OLD.effective_operation_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM publication_operations old_op
         JOIN installation_generations i ON i.shop_id = old_op.shop_id
           AND i.generation = old_op.installation_generation
         WHERE old_op.shop_id = NEW.shop_id AND old_op.config_id = NEW.config_id
           AND old_op.operation_id = OLD.effective_operation_id
           AND (old_op.installation_generation <> current_installation OR i.deactivated_at IS NOT NULL)
       ) THEN
      RETURN NEW;
    END IF;
    SELECT * INTO op FROM publication_operations
      WHERE shop_id = NEW.shop_id AND config_id = NEW.config_id
        AND operation_id = NEW.effective_operation_id;
    IF NOT FOUND OR NEW.effective_revision_id IS DISTINCT FROM op.revision_id
       OR op.status <> 'activated'
       OR op.installation_generation <> current_installation
       OR op.operation_sequence <> NEW.publication_sequence
       OR op.observed_projection IS DISTINCT FROM op.expected_projection
       OR op.observed_projection_digest IS DISTINCT FROM op.expected_projection_digest THEN
      RAISE EXCEPTION 'publication activation preconditions not met' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- migrate:down
CREATE OR REPLACE FUNCTION enforce_effective_activation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE op publication_operations%ROWTYPE;
DECLARE current_installation bigint;
BEGIN
  IF NEW.publication_sequence < OLD.publication_sequence THEN
    RAISE EXCEPTION 'publication sequence cannot decrease' USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.effective_revision_id, OLD.effective_operation_id)
     IS DISTINCT FROM (NEW.effective_revision_id, NEW.effective_operation_id) THEN
    SELECT current_generation INTO current_installation FROM shops WHERE shop_id = NEW.shop_id;
    IF NEW.effective_revision_id IS NULL AND NEW.effective_operation_id IS NULL AND
       OLD.effective_operation_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM publication_operations old_op
         WHERE old_op.shop_id = NEW.shop_id AND old_op.config_id = NEW.config_id
           AND old_op.operation_id = OLD.effective_operation_id
           AND old_op.installation_generation <> current_installation
       ) THEN
      RETURN NEW;
    END IF;
    SELECT * INTO op FROM publication_operations
      WHERE shop_id = NEW.shop_id AND config_id = NEW.config_id
        AND operation_id = NEW.effective_operation_id;
    IF NOT FOUND OR NEW.effective_revision_id IS DISTINCT FROM op.revision_id
       OR op.status <> 'activated'
       OR op.installation_generation <> current_installation
       OR op.operation_sequence <> NEW.publication_sequence
       OR op.observed_projection IS DISTINCT FROM op.expected_projection
       OR op.observed_projection_digest IS DISTINCT FROM op.expected_projection_digest THEN
      RAISE EXCEPTION 'publication activation preconditions not met' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER outbox_active_installation_guard ON outbox_events;
DROP TRIGGER effective_active_installation_guard ON product_configs;
DROP TRIGGER publication_active_installation_guard ON publication_operations;
DROP FUNCTION reject_inactive_generation_work();
DROP TABLE shop_credentials;
DROP TABLE shopify_webhook_deliveries;
ALTER TABLE shops DROP COLUMN shopify_shop_id;
