# PR #9 — principal review

Date: 26 September 2026. **Verdict: APPROVED — bounded live prototype/evidence checkpoint.**

Repository `Optidigi/insignia`; base/effective merge base `9f08c8ff6ee8a6a908b976c26f8435e4301308c5`; reviewed head `a0bfaa713839cb5ccc794e67e0085a51eb00f782`. Approval covers this head only. No merge, staging mutation, production adoption or gate closure was performed. GitHub native APPROVE submission returned HTTP 403 (`Resource not accessible by integration`); nothing was posted. This is the external principal verdict.

## Findings by review axis

**Specification:** No merge-blocking implementation deviation found in the inspected paths. The agent appropriately stopped Order B under the issued numerical expectation. Missing-policy safety and unavailable accelerated paths are disclosed rather than represented as successful tests. Those remain adoption dependencies.

**Standards/correctness/security:** No additional merge-blocking code defect found in the inspected new Function adapters, issuance utility, log projection and evidence checker. Both adapters reuse the M0-005 whole-quote verifier. The source ten-bucket ceiling is an experimental guard, not an adopted product limit. Validation checks independently observed pre-discount amounts and returns before enforcement on CART_INTERACTION to permit repair; this still needs the remaining journey-path qualification.

This review was performed by the principal. Separate local Spec/security reviews are supporting evidence, not principal subagents or substitutes for this verdict.

## Principal correction: native percentage discount expectation

The issued M0-006 expectation of USD9.10 discount and USD81.90 net was wrong for the tested native percentage-product-discount calculation. Shopify staff confirmed per-unit rounding down on 12 February 2026:
https://community.shopify.dev/t/inconsistent-cents-rounding-on-discounts-across-different-stores/28655/10

For the actual allocation:

| Quantity | Unit price | 10% before cent rounding | Native discount/unit | Line discount |
|---:|---:|---:|---:|---:|
| 2 | USD30.33 | USD3.033 | USD3.03 | USD6.06 |
| 1 | USD30.34 | USD3.034 | USD3.03 | USD3.03 |

Pre-discount merchandise is exactly USD91.00. Native discount is USD9.09 and native net merchandise is USD81.91. This is consistent with the retained observation and staff explanation. The primary staff example is in a discount-Function discussion; the actual native discount-code receipt supplies the evidence for this experiment. Do not generalize one fixture's rounding to all discount types, Markets or future API behavior.

**Adjudication: PASS_OBSERVED_SHOPIFY_ROUNDING for the recorded cart/checkout observation.** Discounted payment/order/refund was NOT_RUN. Preserve the original prompt, original expectation, mismatched-result receipt and operator halt. Append this correction; do not rewrite historical evidence.

This is not a one-cent tolerance. Insignia must still materialize exactly the accepted pre-discount price. Shopify owns subsequent discounts and their rounding. Validation is not required to reimplement Shopify's net-discount engine, and the fact that its selected subtotalAmount input remains pre-discount is consistent with its intended authority. Reproducing net discount allocations for display/audit is distinct from independently enforcing a signed pre-discount quote. Do not alter signed prices, inject a compensating penny, add a Discount Function, or relax exact pre-discount comparisons.

## Accepted observations

- The shared envelope/member carriers reached actual Transform and Validation inputs and the conventional guest order surface in the observed USD/US development-store case.
- Order #1005 purchased two Small units at USD30.33, one Small at USD30.34 and one plain Medium at USD20.00: four real variant units, USD111.00 merchandise. Actual order lines and group identifiers preserve the allocation.
- The retained native cancellation/refund uses the exact three order-line IDs, quantities and USD60.66 + USD30.34 + USD20.00 refund subtotals. Stock restoration is recorded separately.
- Actual Validation projections reject tested malformed/incomplete terms, known-required unsigned goods, revoked key and correctly signed terms when removal of Transform leaves incompatible base prices. This accepts the observed rejection, not every untested checkout path or runtime-failure scenario.
- Complete replacement repairs the observed non-atomic intermediate states. Product Buy Now drops the carrier and rejects under known-required policy; that is safe failure, not customized-path compatibility.

## Remaining adoption dependencies

Missing required-product policy, partial/stale publication, key/epoch rollout, expiry/last-line repair, unsupported/unavailable accelerated paths, other discount types/Markets/taxes, ordinary non-Plus/public-app qualification and usable production capacity remain open. The local 64-bucket output stress failure remains historical evidence. No overall G1–G6 pass, v2 protocol freeze or M1 readiness is granted.

Required-product enforcement cannot infer a missing fact from an unsigned line. Its projection/publication contract must distinguish unmanaged merchandise from broken managed-product state, identify the independent trust anchor, and explicitly address loss of that anchor. Redundant metadata, an eventual reconciliation promise, or a hard-coded fixture ID is not by itself a full fail-closed proof.

## Verification performed and limits

Read live PR metadata, complete changed-file inventory, current adapters, issuer, projection/checker scripts, key Function/order/refund receipts, outcome packet and actual CI job log. Verified the two-commit head ancestry and exact synthetic merge parents; head and CI merge tree are `66c06174d024cc319d4a56b055858e3206db2ee7`.

Downloaded artifact 10906476791 from run 36242951216. Independently verified archive SHA-256 `966a038b3a48904c04d76334926ae170690ab26f3f9f8011692b31cf864c19f2`, its manifest and both rebuilt executable hashes. Independent Python checks authenticate two explicitly transcribed receipt excerpts (discount and Transform-off), confirm signed USD91.00 economics, and distinguish correct pre-discount amounts from observed base prices. See `artifact-and-economics-verification.json` and its script.

CI shows six native tests per Function, builds, eight synthetic replays against the retained preview executable and 41-source/120-receipt manifest verification. Those are CI-executed checks; the principal did not rerun them. The downloadable CI artifact contains only the summary manifest and rebuilt binaries, not all source/receipt files or the historical live-preview binaries. No claim of full independent receipt hashing, Wasm execution, screenshot-pixel inspection or remote-byte attestation is made. Raw remote logs and the unfiltered preview bundle are withheld; their claimed hashes cannot be recomputed from the retained projections alone.

The approved planning files have unchanged Git blobs (`d3d7d9c155cdcdcc3b88aeaaa77eebb10d8a767d`, `3544e054bb52c11713b2bc1c96cdf6d7a2264936`), independently matched to saved local files. Their historical headings are not current progress reports; delivery state carries current status.

## Next work

Keep this head unchanged for normal owner-authorized merge. M0-007 is the proposed bounded continuation: required-policy publication/failure feasibility, missing cart/validity checks and at most one three-unit discounted Bogus order under the corrected native expectation. Preserve completed tests; no general preflight or repeated undiscounted Order A. The owner must explicitly authorize the attached launch. Prototype direction remains FURTHER_EVIDENCE.
