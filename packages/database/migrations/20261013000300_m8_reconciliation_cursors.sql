-- migrate:up
CREATE TABLE purchase_reconciliation_cursors (
 shop_id text NOT NULL, installation_generation bigint NOT NULL,
 watermark timestamptz NOT NULL DEFAULT clock_timestamp()-interval '60 days',
 window_since timestamptz, window_until timestamptz, page_cursor text,
 claim_token uuid, claim_until timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_error_class text,
 PRIMARY KEY(shop_id,installation_generation),
 FOREIGN KEY(shop_id,installation_generation) REFERENCES installation_generations(shop_id,generation),
 CHECK((window_since IS NULL)=(window_until IS NULL)),
 CHECK(window_since IS NULL OR window_since<=window_until),
 CHECK(page_cursor IS NULL OR octet_length(page_cursor)<=1024),
 CHECK((claim_token IS NULL)=(claim_until IS NULL))
);
-- migrate:down
DROP TABLE purchase_reconciliation_cursors;
