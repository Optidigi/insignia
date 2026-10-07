**Round 3: NOT CLEAR — one unresolved material finding.**

Verified BASE `4bba14fb4415815557ffa5f1e600427a62128489`, HEAD `316419d10781f316a8b21b9296803cada5c81aa0`, tree `58a92c830390be03ea5b84531cd3b9feb9e8d84e`; working tree clean.

Actual commit subjects:

- `12c422b feat(m5-017): version availability holds with direct effective anchors and one-shot rehold`
- `2dde06d fix(m5-017): close review findings before live source freeze`
- `316419d fix(m5-017): fence original hold authority and require all applicable CI`

Executed comparison:

```sh
git diff 4bba14fb4415815557ffa5f1e600427a62128489...316419d10781f316a8b21b9296803cada5c81aa0
```

## Standards

No additional unresolved material documented-standard or Fowler-baseline finding. The eleven-workflow gate now requires all applicable exact-source, attempt-one successes.

The trust-boundary defect below is reported under Spec because it directly violates the availability contract.

## Spec

**P2 — An unheld original-DRAFT incident can regain success through `observe` and `restore`, despite retained scheduled acquisition evidence.**

[Adapter validation:445](/home/serveradmin/insignia-m5-017-worktree/packages/shopify/src/availability-hold-v3.ts:445) applies `availabilityV3OwnedHeld` only when `hold.held` exists. With `held:null`, acquisition ACK validation remains structural and does not require schedule qualification.

[Observation:470](/home/serveradmin/insignia-m5-017-worktree/packages/shopify/src/availability-hold-v3.ts:470) then falls back to `before` for original DRAFT and can return `HELD`. [Restoration:561](/home/serveradmin/insignia-m5-017-worktree/packages/shopify/src/availability-hold-v3.ts:561) uses the same fallback and returns `RESTORED` at line 570.

Requirement: M5-017 §9 says visible scheduled/staged publication must **“fail closed”** and **“never claim v3 success.”** Section 6 also prohibits attribution of an ambiguous acquisition from later matching status.

Concrete counterexample, established by source inspection—not executed:

1. `before` is a valid, held-safe original DRAFT.
2. The persisted incident has `held:null` and an exact-scope/product DRAFT acquisition ACK containing structurally valid staged publication evidence.
3. A fresh provider read reports clean DRAFT matching `before`.
4. Validation skips owned-hold qualification. `observe` dispatches reads and returns `HELD`; `restore(scope, hold, before)` dispatches reads and returns `RESTORED`.

The SQL predicate has the corresponding receipt gap. [Migration:115](/home/serveradmin/insignia-m5-017-worktree/packages/database/migrations/20261007000100_m5_availability_v3.sql:115) accepts `RESTORED` for original DRAFT based on matching current availability, without requiring a successful owned held snapshot or qualified acquisition ACK. Adding a valid restoration claim and that receipt therefore passes the predicate’s checks.

Normal coordinator/publication ownership checks limit downstream impact; this finding does **not** demonstrate successful production activation. It does demonstrate incorrect adapter success and admissible successful restoration evidence.

Smallest correction: reject retained acquisition ACKs without an owned held receipt before fresh `observe`/`restore` transport, while preserving legitimate ACK-free original-DRAFT handling. Require qualified ownership for automatic SQL restoration success, retaining unheld conflict/pending incidents.

Add regressions for **`held:null` original DRAFT with a scheduled ACK**, asserting zero provider requests from fresh observation/restoration and SQL rejection of successful restoration. Existing corrections test scheduled ACKs with `held` present; the null-held regression tests acquisition only.

## Inspection and execution

Inspected complete changed implementation, migration, tests and guarded harness source; interacting activation/publication, web composition and recovery paths; required authority documents and historical reports; original v1/v2 contracts/adapters/migrations; prior round-one/two reports, settings, responses, encoded red receipts and neutral failure/green logs.

Executed only local read-only Git, source/log inspection and evidence parsing. **No tests, builds, database operations, credentials, network/provider/browser operations, mutations or delegation.**

Original red observations, the first root architecture-hash failure and original runtime CI failure remain failures. Supplied green logs report harness **23**, adapters **208**, focused SQL **2** and web integrations **2** passing; these are inspected evidence, not my execution. Historical v1/v2 source comparisons are unchanged.

Current exact-head checks/CI remain pending under the supplied checkpoint. Source/build are not frozen. Live is **NOT_RUN**; the canonical run directory is absent. Principal approval remains external and ungranted.

**Totals: Standards—0 additional material findings; Spec—1 finding, worst P2.**