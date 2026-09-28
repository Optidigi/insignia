# M0-010R — billing contract-boundary corrections

**One local correction pass on existing PR #13.** Principal verdict is CHANGES_REQUESTED on head `fc6159664a829962983a33cdfe5c415645aee29e`, base/effective merge base `31484d328ec401a30994d073518b11eb67777433`. No merge or successor package.

## Outcome

Close R1/R2 from `PR-013-principal-review.md` with executable provider-to-application regressions, preserve the valid local billing behavior, and return the existing PR at a new reviewed head. This is not a product decision, live billing run or a redesign of subscriptions.

Read AGENTS, current delivery state, operating model, the original M0-010 prompt and this principal review. Use the pinned tdd, diagnosing-bugs, code-review, writing-for-agents and handoff skills. Current repository configuration supplies build commands and model launch settings; do not start a general preflight. Use actual gpt-6-sol/high, at most two restricted non-overlapping writers, one integrator, fresh Spec and security reviews. Complete ordinary in-scope fix/test/review iterations locally.

## 1. Verify and reproduce

Verify actual PR/base/head/worktree state before editing. Preserve legitimate newer work; report any changed review binding. Remain on `spike/m0-010-hybrid-billing`; no force-push or successor PR.

Run the attached `reproduction/reproduce.mjs` against the COMPLETE checkout using pinned Node 24.21.0:

```sh
node /path/to/handoff/reproduction/reproduce.mjs /path/to/insignia
```

The included default principal run used byte-identical partner/time files plus an explicitly reduced entitlement-method excerpt under Node 22.16.0. Prefer the repository-module mode. Its successful exit deliberately asserts that the pre-fix defects exist; after correction it should fail those diagnostic assertions. Add ordinary regressions that assert the correct outcomes to committed tests. A different pinned-runtime result must be investigated and evidenced, not ignored.

Completion: preserve the actual pre-fix results and committed failing regression cases that exercise real parser/normalizer/use-case boundaries.

## 2. R1 — current-entitlement validity ceiling

Carry a known scheduled cancellation's exact cycle end through `currentHistory`. At the known boundary or later, stale active evidence must not authorize a new action. Fetch/refuse/pending until authoritative replacement state is available; do not infer the outcome of an unseen cancellation reversal or renewal.

Use a read at 23:59, cancellation at 00:00, and decisions before, at and after 00:00 while still inside the freshness interval. Include the same provider observation without scheduled cancellation as a control, and check pending-plan and trial boundaries. Preserve the distinction between snapshot age, known effective boundary, current entitlement and complete historical coverage.

Do not fabricate post-trial history, retroactively reclassify waived/inactive usage, change three-day buyer authorization semantics or introduce billing-triggered quote revocation. Correcting the normalization may be enough; no general new temporal framework is required.

Completion: parser → normalizer → BillingApplication/BillingProof tests fail on the reviewed source, pass after correction, and cannot return ALLOW from the old snapshot after its known cancellation ceiling.

## 3. R2 — full supported tier shape

Validate `PriceTier.amount` independently from `amountPerUnit` for both graduated bands. The current scoped tariff supports an included zero-cost band followed by per-unit overage, not tier flat charges. Require exact decimal zero for each tier flat amount, while preserving the documented string precision for valid fractional overage unit rates.

Test each tier with zero in accepted canonical decimal forms, nonzero positive, negative, malformed string, null and absent values. A nonzero/malformed/missing flat amount must not normalize to a supported free-band ACTIVE observation. Retain a positive `amountPerUnit: "0.005"` case and demonstrate that unsupported tariff results cannot enter the current-entitlement path.

Use maintained exact string/integer parsing; no floating-point monetary comparison, rounding tolerance, fee compensation or expansion of real commercial tariff choices. Full catalogue/price binding remains explicitly unverified until the live contract integration.

Completion: both offending fields are checked, incorrect fixtures are rejected at the boundary, legitimate current fixture behavior still passes, and the contract documents the actually supported shape.

## 4. Integrated verification and handoff

Run clean frozen install, strict TypeScript and the complete local suite. Retain the order-level, trial, immutable timestamp/key, reinstall/idempotency, timeout, 202, allowance and aggregate-only regressions. Run unchanged architecture/history checks. Preserve the original test findings and add corrective evidence rather than rewriting old observations.

Obtain fresh read-only Spec and Standards/security review of the integrated result and record every finding/disposition. Re-run applicable CI on the final pushed head; give the principal exact base/head/merge-base and links. Existing passing tests are not a substitute for the new boundary regressions.

Return the updated PR #13, a short R1/R2 closure table, precise reproduction/test commands and results, final-head CI and remaining live limitations. Stop for principal review. Do not merge or start a next package.

## Permission boundary

This package is off-store. Local code, fixtures, public primary-documentation research, project-local dependencies and CI are allowed. No credentials, Partner/Admin/App Events call, Dashboard mutation, plan/meter/contract selection, billing event, order, inventory, preview command, released app configuration or host escalation.

Keep the v1.2 plan/ledger, historical records, approved business model, stopped M0-009 preview/grants and orders #1001–#1006 unchanged. Whole-quote v2 remains provisional; publication/fencing and G7 follow-ups remain outside this billing correction. No gate pass or M1 authorization follows.
