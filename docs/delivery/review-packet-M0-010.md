# Principal review packet — M0-010

## Identity and authorization

Repository: `Optidigi/insignia`. Branch: `spike/m0-010-hybrid-billing`. Base and effective merge base: `31484d328ec401a30994d073518b11eb67777433`. The PR URL, immutable final head and final-head CI are recorded in the PR body after publication, so this committed packet does not contain a moving self-reference.

The attributed [external PR #12 approval](PR-012-principal-review.md) covered base/effective merge base `85282155631d6ab8048d65a3d2ca8ab050c76c06` and head `5596c34a31ea603cd897ceea280192d09bc24c99`, with passing workflows `36341328223` and `36341328190`. The owner explicitly authorized its normal merge and this M0-010 package. Remote merge `31484d328ec401a30994d073518b11eb67777433` has those parents and the approved head tree. No native approval was fabricated.

## Outcome and scope

`spikes/m0-010` holds the isolated strict-TypeScript local G8 proof: 2026-07 provider request/response fixtures, three **synthetic** plan fixtures, verified-history and purchase interfaces, current feature entitlement, one first-full-paid usage unit per customized non-test order, stable idempotency/outbox, fake App Events transport, bounded retry and aggregate-only reconciliation. The [contract matrix](../../spikes/m0-010/provider-contract.md) distinguishes documented API behavior from fake simulation and unknown existing-app capabilities. The [evidence](../../spikes/m0-010/evidence/README.md) gives actual commands/results and limits. A scoped workflow, prompt, PR #12 external review and operational pointers are included. No G7 editor code, historical source or architecture decision changed.

## Acceptance evidence

| Criterion | Actual command/procedure | Result and limit |
|---|---|---|
| Exact predecessor | `gh pr view 12`; `git show --format='%H%n%P%n%T' --no-patch 31484d...` | PASS: merged PR #12 at its reviewed base/head; merge tree equals approved head tree. |
| Local behavior and types | `cd spikes/m0-010 && corepack pnpm check` | PASS: strict TypeScript, 31 Node tests, 0 failures on Node 24.21.0. All provider responses and amounts are synthetic. |
| Architecture and historical integrity | `python3 -B spikes/m0-007/scripts/check-history.py` | PASS: v1.2 plan/ledger hashes and 41 prior sources/120 receipts unchanged. |
| Provider capability | Versioned Shopify Partner API/App Events primary docs and synthetic parser/encoder tests | DOCUMENTED/LOCAL: no authenticated provider request or billed App Event. Existing-app public eligibility, credential access and no-charge plan availability unverified. |
| Live billing and cleanup | No Shopify command or merchant-authenticated call in M0-010 | NOT_RUN by scope: no charge, plan, meter, contract, event, order or store mutation; stopped M0-009 preview remains temporary residue. |
| Final-head CI | Scoped `.github/workflows/m0-010-billing-local.yml` | Record actual run IDs/results in PR body after publication. |

## Local pre-review and dispositions

One orchestrator implemented and integrated the work. One independent read-only scout researched provider contracts. Fresh read-only Spec and Standards/security sessions reviewed the integrated candidate; both re-reviewed corrections and reported no remaining concrete issue. Neither local role is principal approval.

Spec review first found that documented Shopify `Z` timestamps were rejected, inactive intervals without evidence became terminally unbillable, second-tier/currency structure was unchecked, and concurrent qualification plus post-payment lifecycle tests were missing. Corrections normalized provider timestamps, required evidence for inactive history, validated currency/tier shape while retaining documented three-decimal unit rates, and added public-seam regressions. A later pass found missing app identity in submission-window/aggregate observations and the historical event response. The 2026-07 queries now select `activeSubscription.app.id` and historical `subject ... on AppReference { id }`; both parsers and local observations enforce app/shop identity with negative fixtures. The final Spec re-review found no remaining concrete defect.

Standards/security review found that aggregate cost was ignored, future timestamps could be dispatched, local idempotency keys were dictionary-derivable from order IDs, and a key-generation failure could leave a billable fact without an outbox. Corrections compare fake quantity **and** checked integer cost, defer too-future occurrences without changing time, generate a random opaque key once, and prepare/validate the outbox before inserting either record. A documented `$0.005` provider unit amount is accepted as a raw decimal string, while fake money remains integer cents. The security re-review found no remaining concrete issue. Production durability, fractional provider arithmetic and real billing remain explicit later proof, not resolved by local review.

## Compatibility, safety and remaining proof

No existing Function, token, policy representation, schema, pricing mechanism, buyer order or accepted offer changed. Synthetic test plan names, feature names, included-unit counts and cents are not product decisions. The local seam cannot issue/revoke old buyer authorizations; it gates only new merchant actions. `(shop, external order, event kind)` and an opaque stable 64-character provider key model uniqueness, but production must atomically persist purchase qualification plus outbox with a database constraint. Browser ID tokens, Admin tokens, Partner API credentials and App Events credentials remain separate; none was exported or added. Event attributes contain only `value:1`.

Full paid-order verification, complete Partner history/effective trial reconstruction, real existing-app App Pricing and no-charge eligibility, authenticated credential setup, delivery/async billing observation and operator reconciliation remain untested. HTTP 202 and aggregate equality are insufficient to claim an individual charge. G7 alternate-staff/cookie/browser proof, grant-cache invalidation and save recovery remain open. The accepted stopped-preview residue and restored existing grants were untouched. Option A publication/fencing and v2 adoption remain separate unresolved work; no G8 or overall gate pass is requested.

## Proposed separate no-charge live G8 envelope — proposal only

After principal and owner approval in a later package: verify the existing app's public-app/App Pricing eligibility and Partner organization ownership of the existing development store; inspect actual no-charge test availability and configured plan/meter without selecting them during this PR; establish approved Partner API and App Events credentials through a secure route. A future narrowly scoped run could activate only an explicitly designated $0 test plan/contract, submit a bounded number of synthetic `value:1` App Events with stable keys, compare actual subscription history, App Events Dashboard logs and cycle totals, exercise failure/retry where safe, then clean only run-owned resources. Such synthetic submissions would test transport/count, **not** prove an independently verified first-paid non-test order or real-price invoice math. Those need separate authorized evidence. No part of this proposal authorizes those actions now.

## Principal decision — principal completes externally

Verdict: PENDING. Bound PR/base/head: PENDING actual PR and final refs. Gate result: NONE requested. Further authorization: NONE.
