**Round6: NOT CLEAR. One confirmed P2 production defect remains. The sealed STOP handback is faithful; I found no additional material defect.**

Reviewed PR48 at:

- BASE `4bba14fb4415815557ffa5f1e600427a62128489`
- HEAD `2d0b5177add9b412a8e1f9c43309ae6af04f1e1e`
- Tree `73e516cec289ebd368d4d1e2607886fc285dd30f`

Executed comparison:

```text
git diff 4bba14fb4415815557ffa5f1e600427a62128489...2d0b5177add9b412a8e1f9c43309ae6af04f1e1e
```

Actual commit subjects:

```text
12c422b feat(m5-017): version availability holds with direct effective anchors and one-shot rehold
2dde06d fix(m5-017): close review findings before live source freeze
316419d fix(m5-017): fence original hold authority and require all applicable CI
b06cc05 fix(m5-017): deny unheld incident ACK adoption and successful SQL receipts
424e4af fix(m5-017): qualify every supplied restoration ACK before durable success
2d0b517 docs(m5-017): preserve STOPPED live ACK timing conflict and settled cleanup
```

## Standards

No unresolved material documented-standard breach or actionable baseline smell found.

I inspected complete affected implementation, migration, tests and guarded harness, plus interacting publication admission, tenant fences, trusted recovery and historical operator interfaces. Historical v1/v2 contracts, adapters and migrations remain byte-identical to BASE. Their explicit recovery dispatch and predicates retain historical meanings.

The earlier corrections are present across application, adapter and SQL: unsafe original states cannot establish held authority; acquisition ACKs without held evidence cannot regain authority; every supplied restoration ACK requires qualification before durable success; incidents retain their audit evidence. The harness rechecks freshness/deadlines after gate/fsync work, poisons contradictory identity/grants before projection errors, preserves known-unsent accounting and requires eleven applicable exact-source workflows.

## Spec

**P2 — A publication timestamp created during restoration is falsely classified as a future schedule.**

Locations:

- [availability-v3.ts:291](/home/serveradmin/insignia-m5-017-worktree/packages/application/src/publication/availability-v3.ts:291) qualifies ACK schedules against `observedAt`.
- [availability-hold-v3.ts:485](/home/serveradmin/insignia-m5-017-worktree/packages/shopify/src/availability-hold-v3.ts:485) captures that timestamp before dispatch; [line607](/home/serveradmin/insignia-m5-017-worktree/packages/shopify/src/availability-hold-v3.ts:607) converts an otherwise exact restoration into CONFLICT.
- [SQL:94](/home/serveradmin/insignia-m5-017-worktree/packages/database/migrations/20261007000100_m5_availability_v3.sql:94) repeats the request-start comparison. The coordinator uses the same qualification predicate.

The [brief:175](/home/serveradmin/insignia-m5-017-worktree/docs/delivery/prompts/M5-017-AVAILABILITY-HOLD-V3.md:175) explicitly permits: **“Publish dates/provider updatedAt may differ.”** RESTORED requires exact original status, effective membership, online-store booleans, anchors and no visible schedule.

The sealed live case proves the failure:

- ACK `observedAt`: `12:09:54.968Z`
- Published entry: `isPublished=true`, `publishDate=12:09:56.000Z`
- ACK `receivedAt`: `12:09:57.978Z`
- Complete readback restored the exact original effective set `[339456917787]`, anchors and online-store booleans, with no visible schedule.

The publication time falls inside the acknowledged write interval, yet the request-start comparison rejects it. The one-second ACK/readback `updatedAt` difference is diagnostic and is **not** the conflict cause.

The smallest proposed future correction separates conservative request-start freshness provenance from exact completion-time schedule evaluation, consistently across adapter/application/SQL. Regression coverage should accept this published-in-interval case while rejecting unpublished or genuinely future entries. That correction requires principal authorization; no post-live patch is requested here.

**STOP boundary:** The handback follows the brief’s requirement that a live production defect stops for principal correction. Raw `STOPPED/restore_not_exact` remains preserved. Compensation was reserved once but never dispatched because readback semantics matched. There was no retry or continuation. Independently settled writes and exact ownership/current-state checks permitted one ARCHIVED cleanup.

I verified nine canonical copies against their manifest, 0400 files/0500 directory, 96 supplemental artifact hashes and 51 historical canonical hashes. Of 3,460 frozen binding entries, only three permitted documentation files changed; the post-freeze Git diff contains docs/evidence only. Accounting records 38 invocations, five acknowledged writes, pending=null and zero prohibited mutations.

I inspected the required authority/history documents, rounds1–5 reports/settings/responses, original red receipts and neutral failure/green logs. Original root, runtime-CI and behavioral failures remain failures; prior clear reviews do not override the live defect.

**Executed:** read-only Git/file inspection, evidence parsing and hash comparisons only. No tests, builds, entrypoints, database operations, credentials, network/provider/browser operations, mutations or delegation. Requested model/effort was GPT-6.1-sol/high; I did not independently attest this session’s runtime.

Final-head CI is not established by this review. Principal approval remains external and ungranted.

**Totals: Standards 0 material findings; Spec 1 confirmed P2. No additional material finding.**