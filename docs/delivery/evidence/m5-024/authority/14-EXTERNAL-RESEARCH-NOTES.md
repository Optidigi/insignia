# Current external research pointers — not substitutes for pinned source/actual tests

These are public background references verified during preparation. Treat repository pins and controlled tests as stronger than current generic web documentation for exact Insignia behavior.

## pg-boss schema lifecycle

- https://pgboss.io/install — pg-boss ordinarily creates dedicated `pgboss` schema, which requires CREATE rights unless DBA-managed installation/migration is used.
- https://pgboss.io/cli — reviewed output/migration plans and dry-run commands can support a narrowly owned schema installer.
- https://pgboss.io/api/constructor — modern constructor describes `migrate` and `createSchema` options that may help limit runtime DDL; **do not assume the running pinned `pg-boss@12.35.0` supports/behaves exactly as the latest docs without checking its installed source, types and isolated PostgreSQL execution**.
- Source `apps/worker/src/runtime.ts` currently uses `new PgBoss({connectionString, schema})` and `boss.start()/createQueue`, so production starting before a reviewed schema plan could try implicit DDL. This is a required qualification gap, not permission for broad runtime CREATE.

## Shopify webhook signature and header trust

- https://shopify.dev/docs/apps/build/webhooks/verify-deliveries — HTTPS HMAC is computed over the **raw request body** using app client secret.
- https://shopify.dev/docs/apps/build/webhooks/delivery-structure — `X-Shopify-Triggered-At`, topic, shop domain and delivery ID are separate delivery headers. They are not part of that raw-body HMAC computation.
- Current Insignia `packages/shopify/src/webhook.ts` verifies raw-body HMAC then uses normalized metadata. `packages/database/src/repositories/shopify-webhooks.ts` compares trusted/signed Shop payload identity and separate `triggered_at` in generation ordering. Qualify captured-body/altered-header replay as a **test hypothesis**, not a confirmed exploit. Review actual trust and replay constraints before altering the accepted source.

No public documentation can supply owner production credentials, Shopify app version equality, actual webhook-secret parity or installed pg-boss schema readiness.
