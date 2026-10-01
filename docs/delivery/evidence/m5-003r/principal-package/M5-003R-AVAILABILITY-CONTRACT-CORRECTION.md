# M5-003R — availability observation and product-status correction

## Outcome and authority

Correct the two findings in the accompanying `PR-029-principal-review.md` on **existing PR #29**. Return one corrected, fully reviewed candidate. This is a local/off-store correction, not a new milestone or successor implementation slice.

Execution begins when the owner forwards `OWNER-LAUNCH.txt` with this package. That launch authorizes the described local source/tests/docs changes and updates to the existing PR only. The external principal verdict remains CHANGES_REQUESTED until rereview.

Baseline: repository `Optidigi/insignia`; branch `feat/m5-003-activation-admission`; base/effective merge base `8a84ddeaf277368852d224915abe6d4a93a3d8a4`; reviewed head `a426719e5350f61ecb5620f6c90ab7a0e365e66b`; tree `6b60ec923a3601584e05c76fcce362a9c0534d88`.

Use actual **GPT-6.1-sol / high** for the orchestrator, any writer, and both fresh reviewers. Use the already proven project-local tooling and restricted review sessions. One implementation writer is sufficient; no new orchestration framework or broad preflight.

## 1. Resume the exact work

Verify current remote main, PR state, base/head/tree, merge base and local worktree. Preserve legitimate newer work. If refs differ, classify the delta and return for principal direction before rebasing, overwriting or executing this stale correction against a different candidate. Do not create a new PR or force-push.

Read `AGENTS.md`, `docs/architecture/decision-ledger.md`, the current delivery state and operating model, the M5-003 brief/report, the external principal verdict, and relevant plan publication/activation sections. Keep the v1.4 economic/protocol decisions and prior principal dispositions intact.

Use the repository-pinned skills under `.agents/skills`: `diagnosing-bugs` for reproductions, `tdd` plus its tests/mocking references for behavioral corrections, `code-review` for independent Spec and Standards/security reviews, `writing-for-agents` for delivery documentation, and `handoff` for context transfer. These are the previously installed mattpocock skills; reuse their recorded versions rather than silently replacing them from upstream. Their default interviews, commits or orchestration rules cannot override this brief. The seams below are preauthorized; no repeated seam/product interview is required. `grilling` is only for a genuinely new material decision returned to the owner.

Completion: the reviewed source and authority are identified, and no unrelated work has been discarded.

## 2. Correct R1 through the real observation/admission seam

Start with the complete Shopify availability port and the actual scoped production publication interface. Use synthetic HTTP and an injected clock; PostgreSQL integration uses an isolated real PostgreSQL 18 database.

Add a failing regression in which a correct held-product response is captured, then its delivery/body consumption or post-response credential work exceeds `maxObservationAgeMs` while remaining inside the transport timeout. The public publication advance must not dispatch a policy/metafield write on that stale admission. Test the adapter's timing directly as well; the principal's extracted callback is diagnostic evidence, not the committed regression seam.

Implement the smallest coherent timing contract:

- Retain a conservative freshness origin captured before the relevant provider observation/I/O. Arrival or later credential checks cannot renew it.
- Distinguish observation origin from receipt/completion where needed. A legitimate provider `updatedAt` occurring during the request must not be falsely rejected as a future value just because it exceeds request start.
- Carry the timing contract through snapshot/observe, durable evidence, admission and recovery consumers. Inspect acquisition/restoration readbacks for the same mistake; fix the same underlying normalization defect without inventing a new mutation-authority system.
- Preserve existing finite budgets, future/reversed-time rejection and exact boundary behavior. A longer timeout, a fresh timestamp on old data, or a fixed sleep is not a fix.

Regressions must include immediate/within-budget success, over-budget delay rejection, delayed body and post-response-check cases, legitimate mid-request provider timestamps, and appropriate malformed/future/reversed-time controls. Use deterministic clocks rather than waiting for real calendar dates. Existing midnight and unsettled-restoration regressions must remain valid.

Completion: old source is red for the actual stale-admission behavior; corrected public seams are green, and stale evidence causes zero publication writes/activation in the integration case.

## 3. Correct R2 without changing merchant visibility

Verify the current/pinned Shopify status contract using primary API/schema material. Handle UNLISTED as a valid provider value in the hold adapter, its normalized/persisted representation and the directly interacting catalog/Admin DTOs.

Preserve enough typed information to restore the original status exactly. The implementation must distinguish UNLISTED from ordinary ACTIVE and from DRAFT. Keep Shopify-specific enum conversion inside the adapter. Do not obtain passing tests by making an unlisted product discoverable.

Required public-seam tests:

- Catalog list/detail accept an otherwise valid unlisted product. A mixed ACTIVE/UNLISTED page does not become a whole-page provider failure; normal bounded pagination remains unchanged.
- UNLISTED → held DRAFT → restored UNLISTED is represented losslessly using synthetic transport and, where the normalized shape is persisted, real PostgreSQL read/restart coverage.
- Original ACTIVE, DRAFT and ARCHIVED behavior remains intact.
- Merchant status/visibility changes while held still become conflict/operator state; unknown statuses still fail closed.
- Replace the current “UNLISTED is unknown” negative case with a genuinely unsupported value. Retain the original negative assumption in historical review evidence rather than claiming it was correct.

This extends correct parsing/restoration of a legal existing status, not storefront/cart scope. No live status change is authorized.

Completion: both the legal-value rejection and catalog consequence are covered by red/green tests, and restoration cannot silently broaden visibility.

## 4. Bound changes and preserve contracts

Expected ownership: `packages/shopify` availability/catalog adapters and tests; application availability contracts/consumers; necessary database and Admin DTO/read-model changes; focused integration tests; existing CI and delivery records.

The integrator owns shared contracts, lockfile, migration ordering and CI. Change only the new unmerged M5 migration if genuinely needed. Preserve all already-merged migrations, historical evidence and issued-protocol fixtures. Explain any persisted-shape/version impact; no silent reinterpretation of historical records.

Keep the current source-side release/recovery trust boundaries, no default production authority, admission classifier, exact effective pointers, tenant/install/key/epoch fences, immutable activation/resolution evidence and one-use restoration dispatch. Do not change M2 pricing, v2 wire/Function behavior, commercial policy or required-product semantics. No unrelated refactor, framework change or evidence framework.

## 5. Verify and obtain fresh review

Use actual current workspace scripts. Run the complete pinned root suite, full real-PostgreSQL suite and relevant HTTP/Admin/worker tests without converting required tests to skips. Retain 100/100 geometry publication stress with no retries, the missing-renderer negative control, boundary/secret checks and migration rehearsal where affected. Re-run the existing large-history query-plan proof if a changed schema/query/read seam affects it; otherwise bind its preserved evidence explicitly.

Both fresh independent read-only reviewers must inspect the **full corrected PR and interacting seams**, not just the final delta. Require actual GPT-6.1-sol/high with recorded launch controls. Resolve material findings and obtain fresh rereview on corrected source. Local review is not principal approval.

After the last commit, require all applicable exact-head GitHub workflows to complete successfully. Preserve any initial failure and explain the correction; no blind reruns or retry masking. Record exact head/tree/effective base in the PR body/comment rather than adding a self-referential commit.

## 6. Deliver and stop

Import the supplied external principal verdict as an attributed record, normally `docs/delivery/PR-029-principal-review.md`, and the correction brief under `docs/delivery/prompts/`. Point AGENTS/current state to this correction without rewriting historical permissions. Do not claim the verdict was posted natively.

Return the existing PR with corrected refs; findings-to-tests closure; red/green evidence; timing/status contract and persistence impact; full-source reviewer reports/model evidence; final-head CI; worktree/process disposition; and the still-open live/release/G7 obligations. Keep the state update short and link history instead of duplicating it.

**Stop for principal rereview.** No merge, successor PR/slice, M6/M7, Shopify CLI/provider/credential operation, preview, product/metafield mutation, deployment, release, production activation, paid service, gate pass or launch. Public documentation/GitHub reads, dependency retrieval and the local testing/PR updates specified here are allowed. Do not change the retained dev grants, billing fixtures, previews, orders or shared host configuration.
