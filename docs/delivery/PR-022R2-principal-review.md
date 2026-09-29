# PR #22 principal rereview — APPROVED

## Binding

- Repository: `Optidigi/insignia`
- PR: `#22`
- Base/effective merge base: `3feb3e5563bc4bd07f60a0b299aefb99ce37ff37`
- Approved head: `403b589b8d4e76c3b10d34206de43207d6fbd2a4`
- Approved tree: `bcfa1e98ef1b7bcd68f997570ecc90af2ef512a8`
- Synthetic merge: `8ed3f732d381aca1b33a5fc5eed391a617311b96`
- Synthetic merge parents: exact base + approved head
- Synthetic merge tree: exact approved tree

This supersedes the prior CHANGES_REQUESTED verdicts for PR #22.

The native GitHub APPROVE attempt returned HTTP 403 and was not posted. This file is the external principal verdict.

## Closure

The two remaining M3-001R2 facade findings are closed.

### Publication staging is internal again

`DurableCore` contains no publication staging capability. The package root does not export `stagePublicationIntent`, and compiler probes reject both a direct root import and `core.publication`.

The existing internal atomic revision + publication operation + outbox implementation and PostgreSQL test remain intact. Production publication remains unavailable until a later reviewed projection/readiness builder exists.

### Safe package root is usable; internals remain blocked

A server-side worker fixture resolves `@insignia/database` to the package root, passes dependency-cruiser, compiles under worker TypeScript settings, and imports `createDurableCore` successfully at runtime.

Relative source/build root imports and all deeper database internals remain blocked. Browser-to-database bans remain. The public facade still uses an opaque, lifetime-bound transaction handle and exposes no raw Kysely executor/transaction capability.

## M3-001 acceptance

M3-001 is accepted at its intended persistence/durable-core scope:

- PostgreSQL 18 application schema via dbmate only;
- tenant/install-generation records;
- one ProductConfig per shop/product;
- draft CAS;
- immutable validated revision storage with trusted canonical SHA-256;
- local Option A publication journal/fencing state;
- command idempotency;
- durable inbox/outbox and lease recovery;
- payload retention metadata;
- executable tenant/database boundaries;
- safe public database facade.

M3 itself is not complete yet. Verified webhook ingress, credential/token lifecycle, pg-boss runtime, observability and the shop-null inbox resolution contract remain M3-002 work.

## Final-head verification

All nine final-head workflows succeeded.

PostgreSQL run `36604621975` used PostgreSQL 18.6 and passed 25/25 database tests. The migration applied from empty, repeated without reapplying, rolled back and reapplied.

Boundary output records 49 real modules, 16 rejected source fixtures, 14 rejected database-API compiler probes, four rejected runtime deep imports, and a positive safe-root import.

Foundation run `36604622097` passed the pinned root suite and uploaded its artifact on the exact synthetic merge.

No authenticated Shopify/provider operation occurred.

No complete gate, production whole-quote protocol or M3 completion is accepted by this review alone.
