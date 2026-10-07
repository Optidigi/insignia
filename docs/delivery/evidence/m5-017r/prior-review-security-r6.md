**Source verdict: NOT CLEAR — one confirmed P2 remains.** The evidence handback faithfully preserves STOPPED/CLOSED/SEALED. I found no additional unresolved material defect.

Reviewed BASE `4bba14fb4415815557ffa5f1e600427a62128489` through HEAD `2d0b5177add9b412a8e1f9c43309ae6af04f1e1e`; HEAD tree matches `73e516cec289ebd368d4d1e2607886fc285dd30f`. Comparison used:

```text
git diff 4bba14fb4415815557ffa5f1e600427a62128489...2d0b5177add9b412a8e1f9c43309ae6af04f1e1e
```

Actual initial commit subjects are `12c422b feat(m5-017): version availability holds with direct effective anchors and one-shot rehold` and `2dde06d fix(m5-017): close review findings before live source freeze`.

## Standards

No additional unresolved material finding.

I inspected the full changed implementation, migration, tests and guarded harness, plus interacting publication, activation, recovery, web composition and historical v1/v2 source. This included malformed-data handling, identity/grant poisoning, transport confinement, deadlines and freshness, durable claims, mutation accounting, tenant/product fences and immutable SQL audit evidence. I applied the complete supplied smell baseline; no material heuristic objection warranted reporting.

Independent read-only checks confirmed:

- All **2,018 bound non-documentation source/build objects**, including symlink bindings, remain unchanged; all **96 supplemental artifacts** match.
- All **51 historical canonical files** match their bindings.
- All **nine sealed canonical files** match the committed copies and manifest; files are mode0400 and directory0500.
- All **20 original reviewer artifacts** match their neutral originals; all **31 encoded original receipts** match their hashes and original files.
- Original v1/v2 contracts, adapters and migrations remain byte-identical to BASE.

The raw register and qualification agree: 38 dispatches, five ACKNOWLEDGED writes, pending=null, zero compensation dispatches, and CLOSED. The reserved compensation slot is correctly distinguished from an attempt. Exact settled ownership/current state supported the single ARCHIVED cleanup; final visibility is zero. Only docs/evidence changed after frozen source `424e4af`.

## Spec

**P2 — request-start time falsely classifies a publication completed during restoration as future scheduling.**

The faulty comparison is [availability-v3.ts:135](/home/serveradmin/insignia-m5-017-worktree/packages/application/src/publication/availability-v3.ts:135), used by ACK qualification at [line291](/home/serveradmin/insignia-m5-017-worktree/packages/application/src/publication/availability-v3.ts:291). The adapter captures request-start `observedAt` at [availability-hold-v3.ts:485](/home/serveradmin/insignia-m5-017-worktree/packages/shopify/src/availability-hold-v3.ts:485), then chooses CONFLICT through that qualifier at [line607](/home/serveradmin/insignia-m5-017-worktree/packages/shopify/src/availability-hold-v3.ts:607). [SQL line94](/home/serveradmin/insignia-m5-017-worktree/packages/database/migrations/20261007000100_m5_availability_v3.sql:94) repeats the predicate.

The [brief §8](/home/serveradmin/insignia-m5-017-worktree/docs/delivery/prompts/M5-017-AVAILABILITY-HOLD-V3.md:166) requires original status, exact effective membership/presence, unchanged anchors and no visible schedule, explicitly stating: **“Publish dates/provider updatedAt may differ.”**

The actual live ACK reports `isPublished=true`, publishDate `12:09:56.000Z`, request start `12:09:54.968Z`, and receipt `12:09:57.978Z`. Publication occurred **1,032ms after start but 1,978ms before receipt**. Complete readback matches the original semantics without a visible schedule, yet the adapter returns CONFLICT. The coordinator consequently retains operator handling. The one-second ACK/readback `updatedAt` difference is not the cause.

The smallest future correction is to separate conservative request-start freshness provenance from exact completion-time ACK schedule evaluation, keeping coordinator and SQL predicates equivalent. Regression controls should cover publication inside the write interval, actual future dates, unpublished/staged records, and acquisition/compensation boundaries. **No post-live correction is authorized now.**

I rechecked all earlier objections and corrections; their original failures remain failures. Earlier green checks and round5 clear reviews do not erase this live defect.

I executed only read-only inspection, Git queries and static evidence/hash comparisons—no tests, builds, entrypoints, database/provider/browser/credential operations or agent spawning. Final-head CI remains unverified here; principal approval remains external and absent. Neither pending evidence nor this review grants merge or activation readiness.

Standards: **0 additional material findings**; Spec: **1 unresolved P2**.