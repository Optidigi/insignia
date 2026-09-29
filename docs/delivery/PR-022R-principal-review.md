# PR #22 principal rereview — CHANGES_REQUESTED

## Binding

- Repository: `Optidigi/insignia`
- PR: `#22`
- Base/effective merge base: `3feb3e5563bc4bd07f60a0b299aefb99ce37ff37`
- Reviewed head: `447f0cb771d844c2a63c4ada5f38f463b2e7b035`
- Reviewed tree: `b1e14c6007651ad5fd74a9b012a5db232c81d057`
- Synthetic merge: `59c6b1a1eb47904f7e2455d8c0595cdff93b7068`
- Synthetic merge parents: exact base + reviewed head
- Synthetic merge tree: exact reviewed tree

The native GitHub REQUEST_CHANGES attempt returned HTTP 403 and was not posted.
This file is the external principal verdict.

## Prior blocker closure

The prior raw Kysely capability leak is closed.

The corrected public database surface:
- exposes `createDurableCore(pool)` rather than `Kysely<Database>`;
- uses a nominal opaque `DurableTransaction`;
- resolves handles through a private per-core WeakMap;
- invalidates handles after the transaction callback;
- rejects cross-core handles;
- no longer exports `Database`, `DatabaseExecutor`, `createDatabase`,
  `withTransaction`, or `PgTransactionRunner` from the package root;
- adds compiler/package/deep-import probes for raw access.

PostgreSQL tests now exercise scoped config/outbox work through that facade.

## R1 — publication staging became public too early

`DurableCore` currently exposes `publication.stageIntent(...)`.

That method accepts caller-supplied `publishedValue` and `expectedProjection`
and internally calls the previously internal `stagePublicationIntent`.

This conflicts with the M3-001 safety boundary already recorded in the same
repository.

`packages/database/README.md` says publication interfaces are intentionally not
exported from the package root until a future reviewed projection builder
derives and verifies policy/readiness from the revision.

The M3-001 review packet repeats that standalone revision insertion and
publication interfaces stay out of the package root because this slice has no
reviewed projection builder.

The corrected review packet now simultaneously says publication intent is
available through the public facade. Those claims cannot both be true.

### Required correction

Keep the persistence/state-machine implementation and atomicity tests.

Do not expose publication staging through the public M3-001 package facade.

Keep `stagePublicationIntent` internal to `packages/database`, or expose it only
through a test/internal helper not reachable from the package root.

The later slice with a reviewed projection/readiness builder may introduce a
production publication use case deliberately.

Add a public compiler/export test proving `core.publication` /
`publication.stageIntent` is unavailable from public `DurableCore`.

## R2 — internal-import rule also blocks the safe root facade

The dependency-cruiser rule currently targets all
`packages/database/(src|dist)/` paths from outside the database package.

A normal import of `@insignia/database` resolves to the package root
`src/index.ts` or built `dist/index.js`, so the same rule also matches the
legitimate safe facade.

Current CI proves forbidden relative/deep internals fail, but does not prove a
normal application/composition module may import the safe root.

### Required correction

Distinguish:
- allowed: public `@insignia/database` root;
- forbidden: deep/relative database source/dist internals.

Add a positive normal boundary fixture from an appropriate server/composition
module proving `import { createDurableCore } from '@insignia/database'` passes.

Keep browser-to-database bans and all existing raw/deep negative probes.

## Evidence otherwise accepted

All nine final-head workflows passed.

PostgreSQL workflow `36599754372` used PostgreSQL 18.6 and passed 25/25 database
tests. Migration up/repeat/down/up passed.

The boundary job rejects nine raw API compiler probes and one runtime deep
import. Foundation workflow `36599754401` passed the full pinned root suite.

The host limitations are correctly disclosed and are not a blocker because CI
supplies PostgreSQL/Rust/browser evidence.

The M3-002 shop-null inbox identity obligation remains valid and non-blocking.

## Verdict

CHANGES_REQUESTED.

Keep PR #22 open and correct R1/R2 in the same PR.

No merge, M3-002, M4, gate pass, production v2 adoption or external resource
operation is authorized.
