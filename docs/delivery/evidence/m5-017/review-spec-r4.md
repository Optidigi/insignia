Fresh round4 conclusion: **no unresolved material finding** on either axis at the pinned source. This is a read-only review verdict; principal approval remains external and ungranted.

Verified refs:

- BASE: `4bba14fb4415815557ffa5f1e600427a62128489`
- HEAD: `b06cc057782513f9401b830fbf647405fa50dfbd`
- Tree: `0cb88d7a96b2e0c9e37ccb1e57a45437490f1988`

Comparison used:

```text
git diff 4bba14fb4415815557ffa5f1e600427a62128489...b06cc057782513f9401b830fbf647405fa50dfbd
```

Actual commit subjects:

```text
12c422b feat(m5-017): version availability holds with direct effective anchors and one-shot rehold
2dde06d fix(m5-017): close review findings before live source freeze
316419d fix(m5-017): fence original hold authority and require all applicable CI
b06cc05 fix(m5-017): deny unheld incident ACK adoption and successful SQL receipts
```

## Standards

**No unresolved material finding.**

I inspected the full resulting affected implementation, migration, tests and harness sources, including application activation/availability/recovery, Shopify v3 and historical adapters, database repositories and migrations, web activation integration, root scripts/history verifier, and interacting publication admission paths. I also examined the old M5-016 timing, identity and dispatch-accounting protections.

The implementation preserves the documented application/adapter/persistence boundaries and explicit version contracts. Historical v1/v2 contracts, adapters, tests, migrations and old guarded operators have no changes in the pinned diff. The new migration retains their predicates while adding v3 validation, immutable audit handling and downgrade refusal.

I found no material documented-standard breach or actionable baseline smell.

## Spec

**No unresolved material finding.**

I compared the implementation with the unchanged M5-017 brief, principal entry approval, relevant architecture sections and prior adjudication reports. The review covered direct anchor inclusion/capabilities, effective semantics, visible schedules, acquire/observe/restore, one-shot compensation, crash/replay behavior, SQL equivalence, trusted recovery, tenant fences, freshness/deadlines, and guarded lifecycle accounting.

The earlier objections are addressed in the resulting source:

- Actual web integration fixtures use v3. ACK-only schedules prevent successful acquire, restore and qualified rehold outcomes while retaining incident evidence.
- Scheduled original snapshots and unsafe original-DRAFT snapshots cannot establish held authority.
- Any retained acquisition ACK without a held snapshot produces pre-transport conflict in observe/restore. Coordinator admission denies adoption before observation; SQL rejects successful `RESTORED`/`REHELD_CONFLICT` receipts with null held evidence. Legitimate ACK-free, held-safe original-DRAFT behavior remains available.
- Ambiguous writes cannot authorize replay or automatic cleanup. Conditional compensation requires settled restore evidence and is reserved once; its ambiguity retains pending incident audit.
- Final guarded dispatch rechecks authority after gate/fsync/accounting work, including request and mode deadlines, ownership/identity freshness and token expiry. Conservative monotonic origins prevent response completion or wall-clock rollback from renewing authority.
- Reported identity/grant contradictions poison authority before malformed, HTTP-error or GraphQL-error projections can permit later cleanup.
- The gate requires all eleven unique natural exact-source attempt-1 workflows, source/build binding and two independently bound review records before credentials.

The withdrawn staged-original SQL concern was not counted as a new correction or unresolved defect.

I read the round1–round3 reports/settings, responses, encoded original red receipts and relevant neutral failure/green logs. The original behavioral failures, harness import failure, first root history-hash failure and failed first runtime CI remain **failures**. Earlier green checks do not override prior NOT_CLEAR reviews or establish exact-b06 validation.

Only read-only Git/file inspection and evidence parsing/hash comparisons were executed. **No tests, builds, database operations, network/provider/browser access, credential access, edits, delegation or mutations were performed.** Exact-head qualification remains pending; live is NOT_RUN and the canonical run is absent. Mocks establish no live gate evidence. This session’s actual model/effort must be attested separately through host launch metadata.

**Findings: Standards 0; Spec 0; no worst issue on either axis.**