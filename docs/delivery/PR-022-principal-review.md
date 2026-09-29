# PR #22 principal review — CHANGES_REQUESTED

## Review binding

- Repository: `Optidigi/insignia`
- PR: `#22`
- Base/effective merge base: `3feb3e5563bc4bd07f60a0b299aefb99ce37ff37`
- Reviewed head: `f5346bf07d6da082c6b034bd4d0523a45f217a22`
- Reviewed tree: `f58610af14cf8ae7f588c019a73e0c0160a47487`
- Synthetic merge: `09c127d0ac481a23d7277635adf438eaf9bbe713`
- Synthetic merge parents: exact base + reviewed head
- Synthetic merge tree: exact reviewed tree

The native GitHub REQUEST_CHANGES attempt returned HTTP 403 and was not posted.
This file is the external principal verdict.

## Blocking finding — raw Kysely transaction/executor escapes the tenant boundary

M3-001 explicitly requires production repository operations to require explicit
tenant/shop scope and explicitly says to avoid unscoped arbitrary query exposure
to application code.

The current production surface violates that requirement in two related ways.

### Public raw executor

`packages/database/src/index.ts` exports everything from
`./client/database.js`, which includes:

- `createDatabase(pool): Kysely<Database>`
- the `Database` table map
- `DatabaseExecutor = Kysely<Database> | Transaction<Database>`
- `withTransaction`

Because `packages/database/package.json` exposes only this root entrypoint,
these are public package capabilities.

A normal server/application consumer can therefore issue arbitrary unscoped
`selectFrom`, `insertInto`, or `updateTable` queries and bypass tenant-scoped
repositories.

### Raw transaction in application callbacks

`PgTransactionRunner` implements
`TransactionRunner<Transaction<Database>>`.

That means application callbacks receive a concrete Kysely transaction.
The current command integration tests demonstrate this directly by calling
`transaction.insertInto('product_configs')` from the application callback.

This is the exact bypass M3-001 was meant to prevent.

Database constraints still protect some invariants, but they do not protect
unscoped reads or every repository-level validation. Draft schema/value
validation, for example, lives in repository code and can be bypassed by raw
Kysely.

## Required correction

Keep the current PostgreSQL schema, migrations, repository implementations,
publication fencing, idempotency, delivery behavior and tests unless needed to
close this surface.

Replace the public raw database/transaction capability with an opaque,
capability-limited production boundary.

Acceptable designs include:

1. an opaque transaction handle passed back only to repository ports; or
2. a scoped unit-of-work exposing only declared repositories/capabilities.

The Kysely `Transaction<Database>` must remain internal to
`packages/database`.

The public `@insignia/database` root must not expose raw `Kysely<Database>`,
`Database`, `DatabaseExecutor`, `Transaction<Database>`, or a transaction
callback whose concrete value exposes arbitrary query methods.

A public bootstrap/factory is fine if it returns a safe adapter facade/runtime
instead of the raw Kysely client.

## Required negative tests

Add executable checks proving application/public consumers cannot:

1. import `createDatabase` or `DatabaseExecutor` from `@insignia/database`;
2. call `selectFrom` / `insertInto` on an application transaction callback;
3. deep-import database internals through package subpaths;
4. bypass tenant-scoped config/revision access through the production facade.

Where current tests use direct Kysely inside an application callback, rewrite
them to perform the same business mutation through a tenant-scoped repository.

## Preserve

The correction must preserve:

- PostgreSQL 18 migration up/repeat/down/up;
- one ProductConfig per shop/product;
- draft CAS race;
- immutable computed revision hashes;
- atomic revision + publication operation + outbox;
- sequence/install-generation publication fencing;
- durable command idempotency;
- inbox replay/stale-generation behavior;
- outbox atomicity, claim and acknowledgement fencing;
- payload size/retention rules;
- the complete prior M1/M2/Rust/Function/browser/history suite.

## Non-blocking future inbox note

The current schema can store unresolved `shop_id IS NULL` deliveries while
resolved uniqueness is installation-scoped. No raw ingress/resolution API
exists yet, and unresolved rows cannot be processed through the current
`processInbox(shopId, ...)` path, so this is not a current merge blocker.

Before M3 raw ingress supports unresolved deliveries, M3-002 must define an
identity-preserving resolution path. One external delivery must not survive as
both an unresolved row and a second resolved row that could later duplicate a
business fact.

## Evidence otherwise accepted

The reviewed head otherwise provides strong M3-001 evidence:

- one dbmate migration with the intended eight tables;
- tenant-qualified relational constraints;
- immutable revision trigger;
- publication sequence/generation/observation guards;
- command + required outbox atomicity;
- durable claims and lease-attempt fencing;
- database-controlled payload collection time;
- payload and retention ceilings;
- no authenticated external operation.

Final-head workflow `36589032556` ran PostgreSQL 18.6 and passed 23/23 database
tests. The migration started unapplied, applied, repeated without reapplying,
rolled back and reapplied.

All nine final-head workflows passed.

The final commit after closure-review code head `fa89fe3...` changes only one
test fixture.

## Verdict

CHANGES_REQUESTED.

Keep PR #22 open and fix this within the same PR.

No merge or later M3/M4 work is authorized.
