**Round 3: NOT CLEAR — one unresolved P2 Spec finding.** No independent material Standards finding.

Verified BASE `4bba14fb4415815557ffa5f1e600427a62128489`, HEAD `316419d10781f316a8b21b9296803cada5c81aa0`, tree `58a92c830390be03ea5b84531cd3b9feb9e8d84e`. Working tree was clean.

Comparison: `git diff 4bba14fb4415815557ffa5f1e600427a62128489...316419d10781f316a8b21b9296803cada5c81aa0`.

Actual commit subjects:

- `12c422b feat(m5-017): version availability holds with direct effective anchors and one-shot rehold`
- `2dde06d fix(m5-017): close review findings before live source freeze`
- `316419d fix(m5-017): fence original hold authority and require all applicable CI`

## Standards

No unresolved material finding on this axis. I inspected the documented architecture, delivery rules, version boundaries, migration ordering, immutable audit enforcement and harness controls.

Git comparison confirms the original v1/v2 contracts, adapters, adapter tests, migrations and M5-016 harness are unchanged. I also inspected the modified shared activation/recovery paths and their historical compatibility branches.

## Spec

**P2 — An unheld original-DRAFT incident with a retained scheduled acquisition ACK can still produce successful observation/restoration.**

Locations: [adapter validation](/home/serveradmin/insignia-m5-017-worktree/packages/shopify/src/availability-hold-v3.ts:445), [observe fallback](/home/serveradmin/insignia-m5-017-worktree/packages/shopify/src/availability-hold-v3.ts:470), [restore fallback](/home/serveradmin/insignia-m5-017-worktree/packages/shopify/src/availability-hold-v3.ts:561), and [SQL success validation](/home/serveradmin/insignia-m5-017-worktree/packages/database/migrations/20261007000100_m5_availability_v3.sql:107).

The brief requires visible scheduled/staged publication to “fail closed” and “never claim v3 success” ([§9](/home/serveradmin/insignia-m5-017-worktree/docs/delivery/prompts/M5-017-AVAILABILITY-HOLD-V3.md:202)).

Concrete source-derived scenario:

1. Persist a structurally valid, held-safe original DRAFT snapshot, `held:null`, and an exact-scope/product DRAFT acquisition ACK containing an unpublished future publication record.
2. A fresh adapter’s `observe` or `restore` receives a clean DRAFT readback matching the original.
3. Validation checks `availabilityV3OwnedHeld` only when `hold.held` exists. With `held:null`, it accepts the ACK structurally without checking its schedule.
4. Both methods substitute `before` for the missing owned receipt. `observe` returns `HELD`; `restore` returns `RESTORED` through the no-write DRAFT branch.

SQL has the corresponding gap: ACK qualification is conditional on non-null `held`. With a valid restoration claim and `RESTORED` receipt containing `current=before` and `acknowledgement:null`, `m5_v3_hold` accepts this unheld record despite its retained scheduled acquisition ACK.

The normal coordinator requires an owned held receipt, and publication admission rejects the promoted invalid hold. Therefore this finding concerns adapter/persisted-evidence correctness; I did **not** establish a normal activation bypass.

**Smallest correction:** before adapter observation/restoration transport, reject retained acquisition ACKs without an owned held receipt, matching the existing acquire fence. Require automatic SQL success receipts to satisfy the same ownership/ACK qualification while continuing to admit unheld incident records.

**Regression:** use a safe original DRAFT with `held:null` and scheduled acquisition ACK. Fresh `observe` and `restore` must deny success before transport. SQL should accept the incident alone and reject its automatic `RESTORED` receipt. I did not execute this reproduction.

I found no additional material issue in acquisition claims, one-shot compensation, crash/replay handling, anchor inclusion, deadlines, freshness, tenant fences, accounting or the eleven-workflow source gate. The staged-snapshot SQL scenario mentioned during review was withdrawn: `m5_v3_same` correctly rejects it.

I inspected complete changed implementation, migration, tests, web integration, guarded harness and relevant historical interactions—not only hunks. I read both prior review rounds/settings, responses, original red receipts, neutral failures and specified green logs. Original failures remain failures: root-first stopped at the architecture-history check; original runtime CI failed two v2 web integrations. Recorded 23-test harness, 208-test adapter and focused SQL/web greens are historical evidence, not my executions or exact-head/live qualification.

Executed only read-only Git, source and evidence inspection; no tests, database operations, mutations, credentials, network or delegation. Model/effort launch metadata was not independently exposed to me.

**Totals: Standards 0 material findings; Spec 1 P2. Exact-head qualification remains pending, live is NOT_RUN, and principal approval remains external and ungranted.**