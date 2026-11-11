-- migrate:up
-- Owner decision, 11 November 2026: at most 20 new buyer sessions per visitor address per hour,
-- on top of the shop ceilings. The address comes only from Cloudflare's X-Insignia-Client-Chain
-- and is stored only as a keyed HMAC (IPv6 as its /64), for at most one hour.
CREATE TABLE buyer_visitor_admission (
 shop_id text NOT NULL, installation_generation bigint NOT NULL,
 visitor_key bytea NOT NULL CHECK(octet_length(visitor_key)=32),
 window_at timestamptz NOT NULL, issued integer NOT NULL CHECK(issued BETWEEN 1 AND 20),
 PRIMARY KEY(shop_id,installation_generation,visitor_key),
 FOREIGN KEY(shop_id,installation_generation) REFERENCES installation_generations(shop_id,generation)
);
CREATE INDEX buyer_visitor_admission_window ON buyer_visitor_admission(window_at);
-- migrate:down
DROP TABLE buyer_visitor_admission;
