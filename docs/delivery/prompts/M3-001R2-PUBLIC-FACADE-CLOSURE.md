# M3-001R2 — public durable-core facade closure

## Scope

Continue existing PR #22 only.

The raw Kysely leak is already closed. Do not redesign that correction.

Do not alter the database schema or start M3-002.

## A — keep publication staging internal

Remove publication staging from public `DurableCore`.

The package root must not allow:

```ts
const core = createDurableCore(pool)
await core.publication.stageIntent(...)
```

until a later reviewed projection/readiness builder exists.

Preserve internal `stagePublicationIntent` and its atomic revision/operation/
outbox PostgreSQL tests through internal/test-only access.

Add negative public compiler/export coverage proving publication staging is not
available from the root facade.

Do not change publication journal schema, sequence fencing or Option A state
semantics.

## B — allow safe root, forbid internals

Refine the database-internals dependency rule so a legitimate server-side
consumer can import:

```ts
import { createDurableCore } from '@insignia/database'
```

while relative/deep imports into `packages/database/src/**`,
`packages/database/dist/**`, or package subpaths remain forbidden.

Add a positive fixture to the normal `check:boundaries` path.

The positive fixture must live in a server/composition location where database
access is architecturally valid, not a browser/storefront island.

Keep all current negative raw-query/export probes and browser bans.

## Preserve

Preserve:
- opaque lifetime/cross-core transaction behavior;
- scoped tenant/config APIs;
- all 25 PostgreSQL behaviors;
- command+outbox atomicity;
- draft CAS;
- immutable revision hash;
- publication persistence/fencing;
- inbox/outbox retention and recovery;
- M1/M2/Rust/Function/browser/history checks.

## Review / external boundary

Use actual `sol-6-high`, one writer/integrator, and fresh read-only
Spec/correctness and Standards/security rereviews.

Pure local/off-store only. No authenticated external operations.

## Return

Update existing PR #22 with exact new head/tree, proof public publication
staging is unavailable, positive safe-root import evidence, retained negative
internal/raw-query evidence, PostgreSQL test count, final-head workflows and
review dispositions.

Stop for principal review.

No merge or M3-002/M4 work is authorized.
