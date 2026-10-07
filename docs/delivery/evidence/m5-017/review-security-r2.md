**Round 2: NOT CLEAR — two unresolved material findings.**

Verified BASE `4bba14fb4415815557ffa5f1e600427a62128489`, HEAD `2dde06d0f553508346153ebbcb8139937cc74e6f`, tree `1d39e18309585bc08073b1db09b4566e12729ff0`; worktree clean. Actual commit subjects:

- `12c422b feat(m5-017): version availability holds with direct effective anchors and one-shot rehold`
- `2dde06d fix(m5-017): close review findings before live source freeze`

Executed comparison:

```sh
git diff 4bba14fb4415815557ffa5f1e600427a62128489...2dde06d0f553508346153ebbcb8139937cc74e6f
```

## Standards

**P2 — The precredential gate omits an applicable workflow.**

[Binding:4](/home/serveradmin/insignia-m5-017-worktree/scripts/m5-017/binding.mjs:4) imports the historical ten-workflow list. [Binding:74](/home/serveradmin/insignia-m5-017-worktree/scripts/m5-017/binding.mjs:74) requires exactly that list.

Requirement: M5-017 §14, **“all applicable exact-source CI passes.”**

This slice changes `spikes/m0-007/scripts/check-history.py`, matching the [M0-007 workflow trigger:7](/home/serveradmin/insignia-m5-017-worktree/.github/workflows/m0-007-local.yml:7). The preserved original-source CI receipt confirms that workflow actually ran alongside the ten inherited workflows.

Concrete failure: ten listed workflows pass while **M0-007 policy and Function boundary checks** is pending or failing. A gate containing only those ten green receipts passes validation and can reach credential loading. Supplying all eleven receipts instead fails the length check. This is a future gate defect, separate from expected pending CI.

Smallest correction: define the eleven applicable workflows locally for M5-017, preserving historical lists. Add gate tests rejecting missing, pending, failed or wrong-head M0-007 evidence and accepting eleven exact-source, attempt-one successes.

No additional material Fowler-baseline smell finding.

## Spec

**P2 — A scheduled original snapshot can still establish automatic hold authority.**

[Availability validation:267](/home/serveradmin/insignia-m5-017-worktree/packages/application/src/publication/availability-v3.ts:267) requires the original `before` snapshot to be structurally valid, but does not require schedule absence. Consequently, `availabilityV3OwnedHeld` can return true for an original snapshot containing visible staged publication evidence. The [SQL held predicate:82](/home/serveradmin/insignia-m5-017-worktree/packages/database/migrations/20261007000100_m5_availability_v3.sql:82) has the same gap, allowing `m5_v3_hold` to admit that successful held record.

Requirement: M5-017 §2, **“Any visible scheduled/staged record makes the snapshot unqualified for automatic holding.”** Section 9 requires fail-closed behavior when present before acquire.

Concrete failure: a persisted v3 hold contains a valid staged record in `before`, a qualified DRAFT acquisition ACK, and a clean held snapshot with unchanged anchors. [Adapter validation:432](/home/serveradmin/insignia-m5-017-worktree/packages/shopify/src/availability-hold-v3.ts:432) accepts it; observation can return HELD, and [publication admission:101](/home/serveradmin/insignia-m5-017-worktree/packages/database/src/repositories/production-activation.ts:101) can establish publication authority. With a restoration claim, restoration also reaches the status mutation.

Normal new acquisition correctly rejects schedules. The activation-evidence constraint also rejects this original snapshot later. Those protections do not close the persisted-hold admission boundary.

Smallest correction: require a qualified original snapshot wherever a successful owned hold authorizes automatic work, including shared validation, adapter validation and SQL successful-hold admission. Preserve structurally valid failure observations as audit evidence. Add scheduled-original regressions for ownership, SQL admission, publication admission and observe/restore, requiring no automatic writes.

## Inspection and execution

Inspected full changed implementation, migration, tests and guarded harness source; interacting publication, activation, web and recovery paths; required authority documents and historical adjudications; original v1/v2 contracts/adapters/migrations; prior reports, settings, encoded red receipts and relevant failure/green logs. Git comparison confirmed the original v1/v2 contract, adapter, adapter-test and migration files are unchanged.

Executed **only read-only Git and source/log inspection commands**. No tests, builds, database operations, credentials, network/provider/browser operations, mutations or delegation.

The four prior defects and related identity poisoning have source corrections. Original red failures, the first root architecture-hash failure and original runtime CI failure remain failures. Inspected green logs are supplied evidence, not my execution or live qualification. The earlier second root pass does not establish current exact-head completion.

Standards: **1 finding, worst P2**. Spec: **1 finding, worst P2**. Exact-head checks/CI remain pending; live is **NOT_RUN**, canonical run absent. Principal approval remains external and ungranted.