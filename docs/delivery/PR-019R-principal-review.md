# PR #19 principal re-review — APPROVED

29 September 2026. External principal verdict, bound to Optidigi/insignia PR #19.

| Binding | Value |
|---|---|
| Base / effective merge base | `7222a96ff2b0408d0fbfe0803835d24acfd463b7` |
| Approved head | `f267b7b3bfae0090060d4f25aafa23e4c2d3cfb7` |
| Approved source tree | `0c80fe0c6b585648f2a3678ef80cf9b543bb0ed2` |
| CI synthetic merge | `24687e2e045e544e9f5a14284b9060251584460a` |

This supersedes CHANGES_REQUESTED at `317a4030032b565053b2a4b8032803246ba39ed7`. No merge-blocking defect found in the inspected correction and relevant integration. The native GitHub APPROVE attempt, explicitly bound to this head, returned HTTP 403, “Resource not accessible by integration”; it was not posted. This document is not a fabricated native review and does not bypass repository protections. No merge or Shopify operation was performed by the principal.

## Accepted result

The CartLine-only canonical `/0` correction is closed. The current M0-014 source is now built, tested, measured, and checked against the executable supplied to the development preview. Positive numeric/UUID forms, other identifier rules, signature/set integrity, exact money and bounds retain their independent rules. Source inspection plus final-head CI establishes the local regression at both checkout enforcement steps. The original rejection remains historical.

Accept the reported bounded Public/Draft Basic-dev checkout result: one four-unit purchase at USD111.00, direct checkout-step Validation success, independent wrong-price rejection with Transform absent, required-unsigned rejection, and repair to an ordinary optional checkout. Accept native partial fulfillment and USD30.33 plus USD80.67 refunds/restocks at **operator-observed** scope, with final reported stock 64/200/8 and zero committed. The order is `gid://shopify/Order/7487119458587` in `insignia-rewrite-dev.myshopify.com`; its display number #1001 is not the older staging order #1001.

This closes the adapter finding and provides the bounded public-app feasibility basis needed for M1 under v1.3. It does not complete every originally requested M0-014 test or any full G1–G8 gate.

## Adjudicated limitations

**Large cart:** the 51st Large failure is an add-to-cart rejection, not an observed 200-line Function execution or a demonstrated 50-line total-cart limit. The accepted Small 51st total line points toward a per-variant condition. Shopify documents an enabled-by-default per-variant add-to-cart limit, with a default/recommended 50 for low-history stores [S1,S2]. This is a strong explanation, not a live read of this store's setting. Before a later authorized large-cart test, read the actual setting. Any temporary change requires a scoped owner authorization, saved original value and restoration. Preserve tracking and oversell DENY; do not split acceptance, untrack stock, create inventory, or modify merchant stores to bypass the setting. Record this as an onboarding/support constraint for bulk orders.

**Cancellation:** Shopify documents that partially fulfilled orders cannot be cancelled directly and supports return/refund management instead [S3]. The original single-order prompt's expectation of a direct Cancel action after partial fulfillment was inappropriate. Accept the observed native refund/restock alternative for this run; do not relabel it a Cancel event. A supported cancellation test on an unfulfilled order remains a later lifecycle criterion, not a merge/M1 blocker. No additional order is authorized.

**Malformed member:** the live failure has a price confound. Credit it only as combined invalidity rejection, not an isolated signature/member test. The focused local negative controls are separate evidence. Isolate the live condition during later supported-path qualification.

**Fixture roles:** buyer-visible role labels and matching captures are not independent proof of buyer intent. The fixture binder is an operator test harness, not the production quote authority. Do not promote it to the real application. The production application must compute a complete proposed customization from validated domain/configuration and bind its accepted economics server-side.

**Retained historical signed quote:** retain the explicitly requested stopped-run exact replay as a narrowly scoped historical test artifact. It is neither a private signing key nor an authenticated Shopify session. The captured quote's calendar validity has not necessarily elapsed; removing the trusted configuration/Functions blocks the current route, whereas deleting a private key alone does not revoke a signed offer. Do not restore either run's old generation/public-key trust or reuse those offers. Keep future live carrier exports redacted; use conspicuous synthetic fixture keys in the new workspace. No claim of revocation/history rewrite is accepted.

**Resources and scope:** 32-bucket results remain experimental; 200-line live execution, stack high-water mark, larger-context guarantees, public production-merchant qualification, Option A activation, broad Markets/discount/tax coverage and complete billing/admin lifecycle are open. Existing 8.8M/16,000 thresholds are engineering targets, not the platform hard limits. The all-200-role 8,817,567 Validation row exceeds the engineering instruction target, not by itself the 11M platform ceiling. Do not erase that row. The minimal live case does not prove all controlled projections.

**Holding state:** accept reported fixture/metadata/Function/key/cart/test-gateway cleanup and the documented stopped preview/grants. No new cleanup loop is requested. The one successful order/four-unit budget is exhausted.

## Verification performed and limits

Inspected correction inventory, canonical guard, relevant full Validation logic and tests, role binder, current-source build/CLI wiring and measurement script, current report/packet, selected direct sanitized captures, and source-to-final comparison. Read the actual successful final M0-014 job log. It records 11 current TS tests, 13 authorization/19 Transform/25 Validation native tests, historical replays and 110 matrix rows (109 current, one historical), and comparisons of rebuilt bytes with retained final Wasm. All eight head-associated workflows succeeded. Note the PR-body labels for M0-007/M0-012 were swapped: actual workflow metadata maps run 36515244063 to M0-007 and 36515244064 to M0-012; both pass. This label error does not change the result.

The synthetic merge has the exact base/head parents and the head tree. The live pre-run source was `9c4e16b9162dbc5f4079c3b3112e5d47aea6e4ff`; later changes include evidence/tests and bootstrap/build verification adjustments. Core Function source and retained final binaries are unchanged in that comparison. Do not say every final file was deployed during the live run.

Independently reconstructed two sanitized receipt files and required their exact Git blob and SHA-256 identities before Python checks. Canonical 22-byte members decode to the expected variant, quantities and 3033/3034 unit minor prices. Completion arithmetic is 9100 customized + 2000 ordinary = 11100; the wrong-price read contains 8000 observed minor units and a cart error. These are separate invocations with different quote hashes, not a same-token differential.

No independent Rust/Wasm execution, resource measurements, signature verification of redacted quotes, browser operation, provider calls, or reads of the private order/refund/stock receipts occurred. Their hashes are pointers, not proof that the principal accessed those bytes. See `PR-019R-verification.json` and `verification/results.json`.

## Next authorization boundary

The principal permits **M1 workspace and architectural-boundary work only** as defined in `M1-ENTRY-DECISION.md` and `M1-001-WORKSPACE-AND-BOUNDARIES.md`, after the owner authorizes the exact merge and execution. No further M0 live operation is requested. Full gates, production protocol/capacity adoption, M2, commercial availability and rollout remain separate decisions.

## Sources

[S1] https://help.shopify.com/en/manual/checkout-settings/add-to-cart-limit
[S2] https://changelog.shopify.com/posts/new-add-to-cart-limit
[S3] https://help.shopify.com/en/manual/fulfillment/managing-orders/canceling-orders
Repository evidence: https://github.com/Optidigi/insignia/blob/f267b7b3bfae0090060d4f25aafa23e4c2d3cfb7/docs/delivery/evidence/m0-014r-cartline-and-checkout.md
Repository review packet: https://github.com/Optidigi/insignia/blob/f267b7b3bfae0090060d4f25aafa23e4c2d3cfb7/docs/delivery/review-packet-M0-014R.md
