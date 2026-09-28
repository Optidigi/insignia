# Principal review packet — M0-010R on PR #13

## Identity and authorization

Repository and PR: `Optidigi/insignia` [#13](https://github.com/Optidigi/insignia/pull/13). Branch: `spike/m0-010-hybrid-billing`. Base and effective merge base: `31484d328ec401a30994d073518b11eb67777433`. The old reviewed head was `fc6159664a829962983a33cdfe5c415645aee29e`; the new final head and final-head CI belong in the PR body after the final push.

The attributed [principal review](PR-013-principal-review.md) returned **CHANGES_REQUESTED** at those old refs. Native REQUEST_CHANGES failed HTTP 403 and none was posted. The owner authorized this correction on the **existing PR only**. No merge or successor PR is authorized.

## Outcome and scope

R1 and R2 are corrected in `spikes/m0-010/src/partner.ts` with failing-then-passing tests through the parser, normalizer and public application decision. [Evidence](../../spikes/m0-010/evidence/m0-010r/README.md) retains the full-module Node 24 defect reproduction, red test output, post-fix results and remaining limitations. The [provider contract](../../spikes/m0-010/provider-contract.md) now states the known current-authority ceiling and both-tier zero-flat-amount requirement. The principal review, correction prompt and this operational pointer are included. The implementation plan, ledger, earlier source/evidence and M0-009 preview/grants are unchanged.

## Acceptance evidence

| Criterion | Actual procedure | Result / limit |
|---|---|---|
| Reviewed state | `gh pr view 13`, `git fetch`, `git merge-base`, clean worktree | PASS: OPEN at exact old reviewed base/head before editing. |
| Original R1/R2 | `node spikes/m0-010/evidence/m0-010r/principal-reproduce.mjs /home/serveradmin/insignia-m0-010r-baseline` on Node 24.21.0 | PASS **defect reproduction**, exit 0. Full-module R1 and twelve R2 cases saved as JSON. |
| Red regressions | `node --test test/application.test.ts` in a detached copy of the old head with new test file | EXPECTED FAIL, exit 1: both R1 and R2 public-seam tests fail for the named defects. Original test file restored. |
| Clean local verification | `cd spikes/m0-010 && corepack pnpm install --frozen-lockfile && corepack pnpm check` on Node 24.21.0/pnpm 12.6.0 | PASS: frozen lockfile, strict TypeScript and 34 local tests; 31 existing tests retained. Synthetic provider fixtures only. |
| Old diagnostic after correction | Same principal script against corrected checkout | EXPECTED FAIL, exit 1 at its old `until === null` assertion, now exact `00:00` boundary. R2 closure is in the committed public-seam table test. |
| Historical integrity | `python3 -B spikes/m0-007/scripts/check-history.py` | PASS: v1.2 plan `8bb45ac9e2834bf047824a2e3dda4da7f76692bae685f6657da7b3ab03d0b145`, ledger `97ebb79ddc53000c53c46218ba8c83a5ba2279720ed07ff50809706b4f1a800a`; 41 earlier sources and 120 receipts unchanged. |
| Final-head CI | Existing M0-010, M0-009 and M0-008 workflows | Record exact run IDs and final-head results in PR body. |

## Local pre-review and dispositions

One orchestrator owns the correction and integration. Fresh independent read-only Spec and Standards/security reviews examined the integrated candidate. Local review is not principal approval.

Spec: The reviewer found that a parser-accepted `pendingUpdate: { items: [] }` left current authority unbounded after cycle end. An added public-seam test failed on the candidate (`ACTIVE` versus `UNKNOWN_CONTRACT`); the parser now returns `UNKNOWN_CONTRACT` and the application returns `PENDING_VERIFY`. The reviewer also requested clean frozen-install and history results; both are recorded above. Focused re-review passed. Final-head CI remains pending until GitHub completes the workflows.

Standards/security: The reviewer independently identified the same conditional empty-item pending-update gap, and found no other standards or security violation in R1/R2. The correction and regression above resolve the accepted-input edge without assuming the provider emits that state. Focused re-review passed strict TypeScript, all 34 tests, history and staged-diff checks. It also noted two unstaged documentation edits; the final integrated diff includes them. No live provider behavior was verified.

## Compatibility, safety and limits

Known cancellation, pending-plan and trial boundaries cap reuse of a *current* observation for new actions. An empty pending-update item list is rejected as an unknown contract. At/after a boundary, `PENDING_VERIFY` requires authoritative replacement; the code does not infer cancellation completion, renewal, trial billing or a historical interval. The full-price tariff still requires two graduated bands and preserves a fractional `0.005` per-unit rate; both flat amounts are exact decimal zero. Existing first-paid qualification, trial waiver, stable idempotency, 202 transport-only and aggregate-only semantics remain covered by the complete suite.

No merchant-authenticated API, credential, plan/meter/contract, billing event, order, inventory, preview or released-configuration action occurred. Orders #1001–#1006 and the stopped preview/grants were untouched. Real provider access, production durability and G8 acceptance remain outside this correction.

## Principal decision — principal completes externally

Verdict: PENDING. Bound PR/base/head: PENDING new reviewed head. Gate result: NONE requested. Further authorization: NONE.
