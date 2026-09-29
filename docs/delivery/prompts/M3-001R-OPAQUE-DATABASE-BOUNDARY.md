# M3-001R — opaque database capability boundary

## Scope

Continue existing PR #22 only.

Do not create a successor PR and do not merge.

The sole principal blocker is production exposure of raw Kysely
database/transaction capabilities outside `packages/database`.

## Goal

Preserve the durable PostgreSQL implementation while making it impossible for
normal application/use-case code to bypass tenant-scoped repositories through
the public package API or transaction callback.

## Required behavior

### Application transaction capability

Replace `TransactionRunner<Transaction<Database>>` as a production-facing
surface with an opaque transaction/unit-of-work capability.

Application code may:
- pass the handle into declared repository ports;
- compose multiple repository operations atomically;
- execute command + required outbox atomically.

Application code must not be able to call:
- `selectFrom`
- `insertInto`
- `updateTable`
- arbitrary SQL/Kysely operations
- the internal database table map

The actual Kysely transaction remains private to the database adapter.

### Public database package

Remove raw executor/table types and raw Kysely construction from the public
`@insignia/database` root API.

A safe public bootstrap such as `createDurableCore(pool)` is allowed if it
returns scoped services/repos plus lifecycle/shutdown and never the raw Kysely
client.

Do not publicly export:
- `Database`
- `DatabaseExecutor`
- raw `createDatabase`
- raw `withTransaction`
- concrete `Transaction<Database>` callbacks

Internal implementation and tests may continue importing those symbols through
relative paths inside `packages/database`.

### Repositories

Production-facing repository/service calls stay tenant-scoped.

Do not loosen shop/config/revision/generation/publication/idempotency/outbox
checks.

## Mandatory negative checks

Normal CI must prove:

1. `import { createDatabase } from '@insignia/database'` fails;
2. `import type { DatabaseExecutor } from '@insignia/database'` fails;
3. an application callback cannot compile `tx.insertInto(...)` or
   `tx.selectFrom(...)`;
4. `@insignia/database/src/client/database` remains unavailable;
5. relative application imports of database internals fail a boundary check
   if that bypass is possible in the workspace.

Use actual compiler/package-export/dependency checks, not documentation only.

## Required positive checks

Prove the opaque capability still supports:

- command + business mutation + outbox in one transaction;
- command replay/digest conflict;
- publication-intent revision/operation/outbox atomicity;
- tenant/config operations;
- inbox processing transaction;
- outbox insertion.

Rewrite direct-transaction business tests to use tenant-scoped repository
operations. Add at least one real PostgreSQL test showing an application command
atomically mutates through a scoped repository and creates its outbox without
receiving a Kysely transaction.

## PostgreSQL regression

Run the entire existing PostgreSQL 18 suite and preserve all current behaviors.

## Future inbox obligation

Do not add raw ingress in this correction.

Record that M3-002 must resolve any shop-null delivery in place, or through an
equivalent identity-preserving transaction, rather than inserting a second
resolved copy of the same external delivery.

No schema change is required now unless the current shape makes that future
invariant impossible.

## Review / CI

Use actual `sol-6-high`.

One writer/integrator is preferred for this bounded correction.

Run fresh read-only Spec/correctness and Standards/security rereviews.

Final-head checks must include frozen install, build/style, boundary negative
checks, PostgreSQL 18 migration/database tests, prior M1/M2 tests, Rust/Function
regressions, browser tests and historical integrity.

## External boundary

Pure local/off-store work only.

No authenticated Shopify/provider calls, secret-file reads, previews,
deployments, commerce/billing, R2, credential changes, host-security changes or
legacy operations.

## Return

Update existing PR #22 with exact new head/tree, public API diff, negative
raw-query/export evidence, PostgreSQL test results, final-head workflow IDs and
reviewer dispositions.

Stop for principal review.

No merge or M3-002/M4 work is authorized.
