# M3-001 — PostgreSQL persistence, tenant fencing and durable transaction core

## Status

Authorized after the exact approved merge of PR #21.

This is the **first M3 slice**, not complete M3 acceptance.

It establishes the durable database/application core on which later Shopify
credential, webhook, worker/pg-boss and provider adapters can safely depend.

No authenticated Shopify/provider operation is part of this package.

## Goal

Persist new-system merchant configuration and durable application work with
strong tenant isolation, idempotency and publication fencing.

The outcome must prove with real PostgreSQL 18 tests that:

1. one shop cannot read or mutate another shop's records through production repositories;
2. one ProductConfig exists per `(shop, product)`;
3. mutable drafts use optimistic concurrency;
4. published revisions are immutable and content-hash-bound;
5. publication requests cannot activate out of order or across installation generations;
6. business mutations and outbox records commit atomically;
7. duplicate commands/inbox events do not duplicate business facts;
8. claimed durable work can recover after process failure without losing committed facts.

## Explicit M3 sequencing

M3-001 owns:
- application transaction boundary;
- PostgreSQL/dbmate foundation;
- tenant/shop and installation-generation records;
- ProductConfig draft/revision persistence;
- immutable revision content hashing;
- publication operation journal/fencing/activation state;
- command idempotency;
- durable inbox/outbox tables and repository semantics;
- retention/deletion metadata needed for payload-bearing records;
- real PostgreSQL concurrency/recovery tests.

A later principal-authorized M3 slice owns:
- raw HTTP webhook ingress/HMAC;
- Shopify credential encryption/rotation and refresh transport;
- pg-boss worker integration and dispatcher runtime;
- Pino/prom-client production wiring;
- provider-specific delivery.

Do not implement those later surfaces merely to claim all of M3 in this PR.

## Stack constraints

Use the locked stack:

- PostgreSQL 18.
- `pg` PostgreSQL driver.
- Kysely as the typed query layer.
- dbmate SQL migrations as the **only application migration system**.
- Strict TypeScript / Node 24.
- Vitest for application/database tests.

Research and pin exact compatible dependency versions in the lockfile.
Do not add Prisma, Drizzle, an ORM migration runner, SQLite compatibility
layers, or an in-memory database that substitutes for PostgreSQL behavior.

`pg-boss` stays deferred to the next M3 slice.

## Package shape

Create only concrete packages needed for this result.

Suggested shape:

```text
packages/application/
  src/transactions/
  src/config/
  src/publication/
  src/idempotency/
  src/delivery/

packages/database/
  migrations/
  src/client/
  src/repositories/
  src/transactions/
  test/

packages/contracts/
  # extend only if a durable command/event DTO genuinely crosses boundaries
```

Application defines use cases/ports.

Database implements those ports.

Domain does not import database/application/framework code.

Do not place SQL in `apps/web` or `apps/worker`.

## PostgreSQL test environment

Tests must run against **real PostgreSQL 18**, not mocks.

Prefer an ephemeral local container/process for developer runs and a PostgreSQL
18 service in final-head GitHub Actions.

This authorization permits project-scoped ephemeral test containers and public
PostgreSQL test images/dependencies.

Do not install or reconfigure system-wide PostgreSQL packages on the host.
Do not persist test DB state outside the project test lifecycle.

If the local host cannot run the selected ephemeral approach, use CI as the
authoritative clean PostgreSQL run and document the local limitation rather
than changing host security/configuration.

## Core tenant/install model

Introduce stable internal IDs separate from Shopify external identifiers.

At minimum model:

### Shop / tenant

- internal `shop_id`;
- normalized Shopify shop identity/domain as an external attribute;
- lifecycle timestamps/state as needed;
- no globally unscoped production repository methods.

### Installation generation

Every reinstall/new installation generation for one shop receives a monotonically
increasing durable generation or equivalent fenced identity.

Keep historical generations.

At minimum capture:
- shop;
- generation;
- created/activated/deactivated timestamps/state;
- external installation identity when supplied;
- no credential/token bytes in plaintext fields.

A new generation must not silently reuse mutable work belonging to an old
generation where generation fencing is required.

## ProductConfig persistence

Enforce the locked rule:

> One ProductConfig per Shopify product per shop.

Use a database unique constraint on the tenant-scoped external product identity.

### Mutable draft

Persist:
- config identity;
- schema version;
- validated serialized draft value;
- optimistic `draft_version`;
- updated timestamp;
- actor/reference metadata only where it is already known and non-PII.

Draft writes require compare-and-swap semantics.

Two writers using the same prior draft version:
- exactly one succeeds;
- the other receives an explicit conflict;
- no lost update.

### Immutable revision

Publishing locally creates a new immutable revision row containing:
- config ID/shop ID;
- serialized version;
- immutable validated published value;
- content hash;
- creation metadata.

The database/application boundary—not an untrusted caller—computes and stores
the revision content hash.

Define the hashing bytes deterministically.

Use a stable canonical JSON serializer or explicit canonical byte representation
owned outside pure domain if required. Document exactly whether array order is
semantic or normalized.

A caller-supplied `revisionContentHash` may be compared against the computed
value where needed, but must never be accepted as the authority for persisted
immutable content.

After creation:
- revision payload cannot update;
- content hash cannot update;
- config identity cannot update.

Enforce this with repository API plus a database constraint/trigger or another
database-enforced immutable mechanism that is actually tested.

## Publication operation journal / Option A fencing

M3-001 must create the durable local state needed by the approved Option A
publication contract without making Shopify writes.

Distinguish at least:

1. immutable revision exists;
2. publication requested;
3. remote write acknowledged;
4. exact remote observation/readback recorded;
5. application activation committed;
6. failed/superseded state.

Names can differ, but the distinctions must remain.

Each publication operation must bind:
- shop;
- current installation generation;
- ProductConfig;
- revision;
- monotonically fenced operation sequence/token;
- desired policy/readiness projection digest or equivalent;
- requested timestamp;
- observed remote evidence fields where later adapters will write them;
- activation/supersession/failure state.

### Activation invariant

`ProductConfig.effective_revision_id` (or equivalent effective pointer) must
change only when an activation transaction proves all local preconditions:

- operation belongs to the current installation generation;
- operation is the latest non-superseded operation for that config;
- observed remote state exactly matches the operation's expected projection;
- operation has not failed/superseded;
- revision still belongs to the same config/shop;
- activation is idempotent.

An older delayed publication operation must never overwrite a newer effective
revision.

A prior installation generation must never activate after a reinstall.

Do not fake Shopify propagation. This state machine only persists and enforces
the local side of the future contract.

## Command idempotency

Provide a transactionally durable command/idempotency facility.

At minimum bind:
- shop/tenant;
- command namespace/type;
- caller-supplied idempotency key;
- request/input digest;
- completion status/result reference or failure class;
- timestamps.

Required behavior:

- first command with `(shop, namespace, key)` executes;
- exact duplicate returns/reuses the durable result;
- same key with a different request digest rejects;
- concurrent identical attempts produce one business mutation;
- failed-before-commit attempts can retry;
- no cross-shop collision.

Do not cache idempotency only in process memory.

## Durable inbox

Create a generic durable inbox repository/table for future webhook/provider
messages.

At minimum support:
- source namespace;
- stable external delivery/event ID when one exists;
- shop and installation generation when resolved;
- exact body/payload bytes or JSON as appropriate for future replay;
- payload SHA-256;
- received timestamp;
- processing state/attempt/error metadata;
- retention/purge deadline or explicit retention class.

Unique deduplication must prevent one external delivery from creating duplicate
business facts.

This slice does not add a public HTTP webhook route yet.

Tests may insert synthetic inbox deliveries through the application/repository
API.

## Transactional outbox

Create a generic business outbox written in the same PostgreSQL transaction as
the business fact that requires later delivery.

At minimum persist:
- immutable outbox event ID;
- shop;
- event type/schema version;
- aggregate/business reference;
- JSON-safe payload;
- dedupe/business key where relevant;
- occurred timestamp supplied explicitly by application;
- availability time;
- delivery state/attempt metadata;
- retention class/deadline where payload may contain personal data.

Required invariant:

> A transaction cannot commit the business mutation without its required outbox
> row, and an outbox row must not become visible for a rolled-back mutation.

Use database transactions, not best-effort sequential writes.

## Durable claiming / crash recovery

Implement database-level claiming semantics sufficient to prove recovery before
the later pg-boss runtime is attached.

Use PostgreSQL locking semantics such as `FOR UPDATE SKIP LOCKED`, durable leases,
or an equally explicit approach.

Required tests:

- two workers cannot both own one currently leased item;
- abandoned/expired claim becomes available again;
- crash/connection loss after business commit but before delivery acknowledgement
  does not lose the outbox fact;
- a retry may re-attempt delivery, but idempotency/dedupe identity remains stable;
- acknowledging a claim is idempotent;
- processing order must not be assumed globally unless explicitly guaranteed.

Do not implement a custom general-purpose queue framework.

The later M3 worker slice may map these durable records to pg-boss.

## Retention/deletion metadata

Start retention metadata now for tables that can contain raw external payloads
or identifying customization data.

At minimum:
- collection timestamp;
- retention class;
- purge-after timestamp where applicable;
- deletion/erasure state if a future asynchronous purge is required.

Do not apply an arbitrary six-month rule to immutable financial/economic facts
that are allowed to persist separately.

Do not add buyer artwork tables yet.

## Repository API / tenant safety

Production repository operations must require explicit tenant/shop scope.

Avoid APIs like:
- `getConfig(id)` with no shop;
- `findRevision(id)` with no tenant;
- unscoped arbitrary query exposure to application code.

Prefer signatures equivalent to:

```ts
repo.getConfig(shopId, configId)
repo.getRevision(shopId, revisionId)
```

and tenant-qualified composite foreign keys where practical.

### Required cross-tenant tests

With Shop A and Shop B:

- same external product ID may exist independently for both shops;
- A cannot read B's draft/revision through repository methods;
- A cannot activate B's revision;
- A cannot claim B's command result using A's scope;
- tenant-mismatched foreign references fail at the database layer where possible.

## Migration requirements

Use dbmate SQL files as the one application migration authority.

Tests must prove:

1. empty PostgreSQL 18 -> latest succeeds;
2. migrations are repeatable/idempotent under dbmate's normal model;
3. expected constraints/indexes exist;
4. rollback/down migration is implemented where safe and project policy expects it,
   or explicitly explain irreversible data-shape choices before merge;
5. no Kysely migration runner exists.

Do not promise compatibility with legacy Insignia data.

## M2 schema/version compatibility

Persist explicit schema versions introduced by M2.

Do not deserialize arbitrary unknown future versions into current domain objects.

Repositories should return raw/versioned persistence DTOs to an application
reader that invokes the proper contracts/domain validation.

No silent coercion of old/future serialized versions.

## Tests

The final PR must contain real PostgreSQL tests covering at minimum:

### Tenant/config
- one ProductConfig per `(shop, external product)`;
- same external product independently permitted in another shop;
- draft CAS race;
- immutable revision enforcement;
- computed content hash stability and mismatch rejection;
- effective revision changes only through the fenced activation path.

### Publication fencing
- publication A then newer B;
- late A acknowledgement/observation cannot activate over B;
- B can activate after exact observation;
- duplicate B activation is idempotent;
- reinstall generation N+1 fences generation N.

### Idempotency
- duplicate sequential command;
- concurrent duplicate command;
- same key/different digest rejection;
- cross-tenant separation;
- rollback then retry.

### Inbox/outbox
- duplicate inbox delivery;
- out-of-order synthetic deliveries remain individually durable;
- business fact + outbox atomic commit;
- rollback leaves neither;
- concurrent claim exclusion;
- expired claim recovery;
- acknowledge/retry stability.

### Failure/race
Use actual independent PostgreSQL connections for race tests rather than
serially simulating concurrency inside one transaction.

## CI

Extend the repository's existing checks.

Add a final-head PostgreSQL 18 CI service/harness and a bounded database test
job or integrate it cleanly into the foundation job.

A clean checkout must prove:
- frozen pnpm install;
- dbmate migration from empty DB;
- type/build/style;
- domain/contracts existing tests;
- database/application tests;
- boundary/secret checks;
- existing Rust/Function regressions;
- browser/historical checks.

Do not weaken prior checks to make database CI fit.

Pin GitHub Actions by commit as existing workflows do.

## Security / observability constraints

Database error logging in tests/source must not print secrets or raw webhook
payloads.

Do not persist authentication secrets introduced only for tests.

No plaintext merchant access token schema.

No dynamic SQL from tenant-controlled identifiers.

Use parameterized Kysely/pg access.

## Work method

Use actual `sol-6-high`.

Up to two non-overlapping restricted writers are authorized.

Recommended split:

### Writer A — schema/database
Own:
- dbmate migrations;
- database package/client;
- tenant/config/draft/revision repositories;
- publication journal/fencing persistence;
- PostgreSQL test fixtures.

### Writer B — application durability
Own:
- transaction/use-case ports;
- command idempotency;
- inbox/outbox application semantics;
- claim/ack recovery contracts and tests.

### Integrator
Own:
- shared IDs/interfaces;
- package exports;
- root dependencies/lockfile;
- PostgreSQL CI harness;
- cross-package integration tests;
- docs/review fixes.

Writers must not independently edit shared root manifests/lockfiles.

Use fresh read-only Spec/correctness and Standards/security reviewers on the
integrated final code.

## Acceptance

M3-001 is acceptable when:

1. real PostgreSQL 18 clean migrations pass;
2. tenant-scoped repository tests demonstrate no cross-shop access;
3. draft CAS race is observed correctly;
4. revision content hash is computed by trusted code and immutable in DB;
5. Option A local publication journal prevents stale/generation-crossing activation;
6. command retries are durably idempotent;
7. business mutation + outbox atomicity is proven;
8. duplicate inbox deliveries cannot duplicate the tested business fact;
9. concurrent claims and crash/retry recovery are proven with real DB connections;
10. payload-bearing rows carry explicit retention metadata;
11. the complete prior root suite remains green;
12. fresh reviewers report no unresolved material defect.

M3 remains incomplete after this slice: credential rotation, raw webhook HTTP
ingress and pg-boss runtime remain for a later authorization.

## Stop conditions

Return for principal direction if:
- a locked ProductConfig/publication invariant cannot be represented cleanly;
- database constraints require changing M2 serialized semantics;
- the only viable design requires unsafe unscoped tenant access;
- an external Shopify/provider call becomes necessary.

Ordinary implementation bugs, migration corrections, race-test fixes and local
review findings remain in scope to fix before returning.

## Handoff

Return one integrated PR with:

- base/head/effective merge base;
- migration list and schema overview;
- exact dependency versions added;
- PostgreSQL 18 harness used locally/CI;
- CAS/fencing/idempotency/inbox/outbox race results;
- content-hash canonicalization definition;
- retention metadata introduced;
- clean/frozen root commands;
- final-head workflow IDs/artifacts;
- fresh reviewer dispositions;
- confirmation that no authenticated external resource was touched.

Stop for principal review.

No M3-001 merge, M3-002/M4 start, gate pass, v2 adoption or production resource
operation is authorized.
