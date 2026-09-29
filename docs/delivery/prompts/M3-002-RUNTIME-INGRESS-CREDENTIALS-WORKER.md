# M3-002 — verified ingress, credential lifecycle and durable worker runtime

## Status

Authorized only after the exact approved normal merge of PR #22.

This slice is intended to finish the **local/off-store M3 runtime skeleton**. Final M3 acceptance still belongs to principal review of the resulting PR.

No live Shopify/provider call, subscription mutation, preview or deployment is authorized.

## Current platform constraints

Reconfirm current provider/library documentation at implementation time and record the exact versions used.

- Public Shopify apps calling the GraphQL Admin API must use expiring offline access tokens by 1 January 2027. Store and honor provider-returned expiry fields; do not hard-code token lifetime.
- Background work refreshes expiring offline access through the stored refresh token.
- A refresh timeout/network/5xx may be retried with the same refresh token; persist the returned replacement pair atomically and never advance stored refresh authority before that pair is durable.
- HTTPS webhooks are authenticated with HMAC-SHA256 over the exact raw request body using the app client secret.
- `X-Shopify-Webhook-Id` is the delivery identity used for duplicate handling.
- Header names are case-insensitive.
- Use **pg-boss 12.35.0 exactly** for this slice unless implementation-time research identifies a newer stable release and records why it should replace this pin. pg-boss owns its own schema/version procedure; dbmate must not manage pg-boss tables.

## Goal

Complete this durable path:

```text
verified raw Shopify delivery
        ↓
durable identity-preserving inbox row
        ↓
idempotent pg-boss job
        ↓
transactional application processing
        ↓
durable business/outbox/install facts

stored encrypted offline credential pair
        ↓
serialized durable refresh claim
        ↓
Shopify refresh transport
        ↓
atomic replacement pair
```

The result must survive duplicate delivery, reinstall, worker crash, queue retry, refresh-response loss and process restart without losing acknowledged facts or exposing credentials.

## 1. Package/workspace shape

Create concrete code only where needed:

```text
packages/shopify/
  webhook verification/header normalization
  expiring offline refresh HTTP transport

packages/application/
  verified ingress/use-case ports
  credential lifecycle / refresh orchestration
  installation deactivation

packages/database/
  M3-002 migration(s)
  safe facade extensions only

packages/observability/
  Pino logger/redaction
  prom-client metrics

apps/web/
  raw Shopify webhook endpoint

apps/worker/
  pg-boss runtime and handlers
```

Only `packages/shopify` may import the Shopify SDK if one is actually introduced. It is not required for this slice.

Preserve the opaque database facade. No application/web/worker code receives raw Kysely capability.

## 2. Raw Shopify webhook ingress

Add one Astro server endpoint, suggested path:

```text
POST /api/webhooks/shopify
```

The path is not externally committed until deployment/subscription work, but endpoint behavior is production code.

### Raw body

Read bytes with a hard stream bound. Do not parse JSON/text before HMAC verification. A lying or absent `Content-Length` must not bypass the actual byte limit.

The HTTP limit must not exceed the M3-001 durable 8 MiB payload limit.

### Trusted headers

Parse/bound at least:

- `X-Shopify-Hmac-Sha256`
- `X-Shopify-Shop-Domain`
- `X-Shopify-Topic`
- `X-Shopify-API-Version`
- `X-Shopify-Webhook-Id`
- `X-Shopify-Triggered-At`
- `X-Shopify-Event-Id` when present
- `X-Shopify-Name` when present

Treat names case-insensitively. Normalize and validate a `*.myshopify.com` source domain. Do not over-constrain provider IDs to UUID syntax unless the provider contract guarantees that.

### HMAC

Verify HMAC-SHA256 over exact raw bytes with constant-time comparison after length validation.

Support an injected active client-secret ring for explicit current/previous secret overlap. Client secrets remain process configuration and are never stored in the app DB.

Never log HMAC, raw body, or client-secret material.

### Acknowledgement rule

Return 2xx only after:

1. durable inbox identity/body is committed; and
2. its pg-boss processing job is confirmed enqueued or already exists for that same inbox identity.

If DB commit succeeds but queue enqueue fails, return retryable 5xx. The provider retry must reuse the same durable inbox row and retry queue handoff.

Invalid HMAC or invalid required trusted headers persist nothing.

Same provider delivery identity with different raw payload fails closed; never acknowledge it as a harmless duplicate.

Use the durable inbox UUID as the pg-boss job ID when supported. If a retry encounters an existing job, verify queue/identity data before treating it as success.

A duplicate whose inbox processing is already complete returns success without recreating a business fact.

## 3. Identity-preserving unresolved inbox resolution

Close the existing M3-002 obligation.

A HMAC-valid webhook may name a Shopify domain before a local active shop row exists. It may be stored unresolved, but **one provider delivery remains one durable inbox identity for its entire life**.

Add a stable provider/source identity that survives:

```text
unresolved shop → resolved shop → current installation generation
```

A globally unique Shopify delivery key or equivalent identity table is acceptable.

Do not solve this by inserting a second resolved inbox row.

Persist only bounded trusted routing metadata, not arbitrary request headers.

### Required race tests

Using independent PostgreSQL connections:

1. unknown-shop webhook creates one unresolved row;
2. exact replay while unresolved returns same row;
3. shop/install resolution races another replay;
4. final state contains exactly one row bound to shop/generation;
5. exact replay after resolution returns same row;
6. conflicting payload for same provider identity is rejected;
7. reinstall never turns one old delivery into a new business fact.

## 4. Installation deactivation / uninstall fencing

Add a scoped operation to deactivate the active installation generation.

A signed `app/uninstalled` webhook must process without requiring a working Admin API token.

When uninstall processing commits:

- active generation becomes deactivated;
- credentials for that generation become unusable;
- generation-bound outbox work cannot be claimed/delivered;
- generation-bound publication activation becomes stale/ineligible;
- historical configs/revisions/economics remain;
- reinstall creates the next generation.

Update SQL triggers/repository guards where necessary so numeric `current_generation` alone is not treated as proof of active installation.

Do not perform token refresh before accepting/processing uninstall.

## 5. Expiring offline credential persistence

Add a tenant + installation-generation scoped credential record.

Persist metadata such as:

- credential schema/version;
- access expiry;
- refresh expiry;
- provider-returned scopes where present;
- credential version;
- state: active / refresh-in-progress / reauth-required / revoked (or equivalent);
- wrapping-key ID;
- durable refresh claim/lease metadata.

### Encryption at rest

Access and refresh token plaintext must never be stored.

Use a versioned authenticated-encryption envelope, preferably AES-256-GCM:

- fresh random nonce per value;
- associated data binds shop ID, installation generation, credential version and token kind;
- wrapping/encryption key comes from process configuration;
- DB stores key ID plus ciphertext/nonce/tag material;
- no key bytes in DB.

Missing wrapping key fails closed with a typed operational error. Tampered ciphertext/AAD fails authentication.

Tests must query raw DB columns and prove known synthetic token plaintext is absent.

Do not log ciphertext as a substitute for plaintext.

## 6. Credential acquisition boundary

Do not implement live OAuth authorization/token exchange in this slice.

Provide an application operation that can atomically install a validated expiring offline token pair supplied by a future authentication adapter.

Reject wrong/stale/deactivated generation, malformed token pair, nonsensical/expired lifetimes and unsupported schema.

No production API client may receive credentials for a deactivated generation.

## 7. Serialized refresh workflow

Implement durable refresh claim/CAS so concurrent workers cannot race one shop's refresh chain.

Do not keep an application DB transaction open during network I/O.

A suitable algorithm:

1. inspect/lock current credential using DB time;
2. return usable access token if still safely valid;
3. otherwise acquire a bounded refresh claim tied to credential version;
4. decrypt current refresh token;
5. commit/release DB transaction;
6. call Shopify refresh transport;
7. atomically persist replacement pair only if shop/generation/version/claim still match;
8. bump credential version and release claim.

A stale response after a newer refresh must never roll credentials backward.

Read provider-returned lifetimes rather than hard-coding them.

### Lost response

Test:

- provider accepts refresh and rotates;
- client loses response before persistence;
- DB still contains old pair;
- retry uses same old refresh token;
- fake provider returns recoverable replacement pair;
- exactly that pair is atomically persisted.

Never persist replacement refresh authority before the complete pair is durable.

### Error classes

Distinguish at least:

- network/timeout;
- 429;
- transient 5xx;
- malformed success body;
- terminal invalid/expired refresh token (`401 invalid_request` class);
- stale/inactive installation.

Transient errors remain retryable. Terminal refresh rejection marks reauthentication required.

No live provider calls.

## 8. Shopify refresh HTTP adapter

Implement production transport in `packages/shopify` behind injectable HTTP/fetch.

Production target:

```text
POST https://{shop}.myshopify.com/admin/oauth/access_token
```

Use the refresh-token grant and configured app client credentials.

Validate the complete expected expiring-offline token pair/lifetime response; HTTP 2xx alone is not success.

Tests use a local/fake HTTP transport only.

Do not read owner secret files.

## 9. pg-boss runtime

Pin pg-boss exactly as decided above. Its schema is separate from dbmate-managed application migrations.

On PostgreSQL 18 CI:

- start pg-boss;
- allow its own schema initialization/migration;
- stop/restart successfully;
- record package/schema version.

Use explicit queue names, at minimum:

```text
insignia.shopify-webhook.v1
insignia.token-refresh.v1
```

Job payloads contain IDs/bounded metadata only—never raw webhook payloads or credentials.

### Webhook worker

Use pg-boss worker/attempt semantics; never mutate pg-boss tables manually.

Worker invokes the durable application inbox transaction so business mutation + inbox processed marker commit together. Crash/throw rolls both back; retry cannot duplicate the tested business fact.

Implement only the M3 installation lifecycle handler needed for `app/uninstalled`. Other Shopify topics may remain durably pending/unhandled; do not invent M4/M8 business logic.

### Refresh worker

Jobs identify shop/generation only and invoke the serialized refresh use case. Duplicate/concurrent jobs must still produce one forward-moving credential chain.

### HTTP/queue retry cases

Test:

- inbox commit succeeds; pg-boss enqueue fails → HTTP 5xx;
- exact provider retry returns same inbox ID;
- enqueue succeeds or is already present;
- route returns 2xx;
- worker processes once.

Also simulate response loss after successful enqueue: provider retry must not create a second business fact.

## 10. Observability

Create `packages/observability` using pinned stable Pino and prom-client versions.

### Logging

Mandatory redaction covers at least:

- authorization headers;
- app client secrets;
- HMAC;
- access tokens;
- refresh tokens;
- raw webhook body/payload;
- wrapping/encryption keys.

Logs may include bounded internal IDs/event type/error class when useful.

Never log merchant/customer payloads by default.

### Metrics

Add bounded metrics for at least:

- webhook received/duplicate/rejected/enqueue failure;
- inbox processing success/failure;
- pg-boss retry/failure;
- credential refresh success/transient/reauth-required;
- refresh claim contention;
- unresolved inbox resolution outcome/backlog.

Do not use shop ID/domain, webhook ID or other high-cardinality values as Prometheus labels.

Worker may expose metrics through its existing loopback HTTP server for this slice. Production exposure is later deployment work.

### Health

Preserve process liveness separately from durable readiness.

`durableReady: true` only after required DB, pg-boss and credential-key configuration is ready for enabled workers.

Health output exposes no secrets.

## 11. Configuration

Introduce explicit validated server configuration for concepts equivalent to:

- database/pool input;
- Shopify client ID;
- active Shopify client-secret ring;
- credential wrapping-key ring + current key ID;
- worker/queue settings.

Tests use synthetic values. Missing critical configuration fails startup with a non-secret diagnostic.

## 12. Boundaries

Preserve M1/M3-001 boundaries.

Only suitable server/composition code may reach database/shopify/observability adapters. Storefront, web islands, contracts and domain remain unable to reach secrets/server adapters.

No runtime package imports `spikes/`.

## 13. Required integration evidence

Use real PostgreSQL 18.

### Webhook

- correct raw HMAC accepted;
- one-byte body mutation rejected;
- wrong/missing HMAC rejected without inbox row;
- case-insensitive headers;
- body-size bound;
- exact duplicate before/after resolution;
- conflicting same delivery identity;
- unknown-shop resolution race;
- enqueue failure then provider retry;
- enqueue success then response-loss retry;
- out-of-order delivery durability.

### Uninstall

- signed uninstall works with no usable Admin token;
- current generation deactivates;
- credentials unavailable;
- old generation outbox cannot claim;
- old publication cannot activate;
- reinstall uses next generation.

### Credential crypto

- plaintext absent from raw DB;
- encrypt/decrypt;
- tamper/AAD mismatch;
- missing wrapping key;
- stale/deactivated generation.

### Refresh

- concurrent refresh jobs;
- successful rotation;
- lost response + same-old-token recovery;
- transient retry;
- terminal invalid refresh → reauth required;
- stale response cannot overwrite newer version.

### pg-boss

- version/schema recorded;
- startup/restart;
- worker retry after throw;
- current attempt/claim fencing;
- single webhook business mutation;
- graceful shutdown.

### Observability

- secret redaction;
- no raw payload logging;
- bounded metric labels;
- metrics reflect synthetic success/failure paths.

## 14. CI

Add/extend CI without weakening existing workflows.

Final-head CI must run:

- frozen pnpm install;
- dbmate app migrations;
- pg-boss schema startup;
- build/style/boundary/secret checks;
- M1/M2 tests;
- all M3-001 DB tests;
- M3-002 DB/HTTP/queue/credential tests;
- Rust/Function regressions;
- browser tests;
- historical integrity.

Pin Actions by commit.

## 15. Work split

Use actual `sol-6-high`.

Up to two non-overlapping writers are authorized.

### Writer A — Shopify ingress/credentials

Own `packages/shopify`, HMAC/header parsing, refresh HTTP transport, application credential/ingress use cases and focused tests.

Do not own root lockfile, DB migrations or CI.

### Writer B — worker/observability

Own pg-boss runtime, worker handlers, Pino/prom-client package, worker health/metrics and focused tests.

Do not own root lockfile, DB migrations or CI.

### Integrator

Own DB migration/schema changes, safe durable-core extensions, shop-null resolution, uninstall fences, shared config, root dependencies/lockfile, Astro webhook route, PostgreSQL/pg-boss CI and cross-workstream race/crash tests.

Use fresh read-only Spec/correctness and Standards/security reviewers on final integrated code.

## 16. Out of scope

Do not implement live OAuth/token exchange, live token refresh, webhook subscription creation, Admin catalog/Markets/FX reads, quote signing, Function key rollout, publication projection/remote writes, App Pricing, order snapshot handlers, artwork/R2 or public deployment.

No Shopify app/store mutation.

## 17. Acceptance

M3-002 is principal-reviewable when:

1. verified raw webhook → durable inbox → pg-boss → transactional processing is proven;
2. 2xx implies durable inbox + confirmed queue handoff;
3. retry cannot duplicate the tested business fact;
4. unresolved delivery identity survives in-place resolution;
5. uninstall fences current generation and generation-bound work;
6. token plaintext is encrypted at rest and absent from logs;
7. missing wrapping key fails closed;
8. refresh concurrency + lost-response recovery are proven;
9. terminal refresh failure becomes reauth-required;
10. pg-boss owns only its separate schema and restarts on PostgreSQL 18;
11. logging/metrics are useful and secret-safe;
12. all previous M1–M3-001 checks stay green;
13. fresh reviewers have no unresolved material finding.

If accepted, the principal may declare the local/off-store M3 skeleton complete and decide M4 entry.

## Stop conditions

Return for principal direction if current Shopify refresh semantics materially conflict with this flow, unresolved inbox identity cannot be made stable without replacing an accepted M3-001 invariant, pg-boss cannot supply safe attempt/retry semantics, a live provider call becomes necessary, or encryption requires an external KMS decision beyond the injected key-ring abstraction.

Ordinary implementation/test/review fixes remain in scope.

## Handoff

Return one integrated PR with exact refs, migrations/schema, dependency versions, webhook contract, stable delivery identity, credential-envelope version, refresh/lease algorithm, pg-boss package/schema/queues, uninstall results, PostgreSQL/HTTP/queue evidence, observability checks, final-head workflows/artifacts, reviewer dispositions, and confirmation that no authenticated external resource was touched.

Stop for principal review.

No merge, M4, gate pass, production protocol adoption or deployment is authorized.
