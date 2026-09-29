# M0-014R — CartLine correction and completion of the original public-app proof

Principal-issued 29 September 2026. Execute only after the owner sends the accompanying authorization. Continue **existing draft PR #19**; this is not a new milestone or successor PR. The original M0-014 brief is included under `reference/` and is also in the repository. This document overrides only the frozen-candidate restriction and restart/resource directions specified below; all other original economic, safety and governance limits remain.

## Outcome

Fix the known target-local `/0` incompatibility, establish agreement between the issuer and the actual corrected Functions, and complete the previously stopped M0-014 checkout/enforcement/capacity/native-lifecycle proof. Return one integrated PR for principal review. Preserve the failed run as historical evidence.

## 1. Correct and test locally

Start from the current PR branch. Reviewed base `7222a96ff2b0408d0fbfe0803835d24acfd463b7`; reviewed head `317a4030032b565053b2a4b8032803246ba39ed7`. Verify refs/worktree and preserve legitimate newer work. No merge, force-push, branch replacement or successor PR.

Read PR-019-principal-review.md, the original M0-014 prompt, current AGENTS/ledger/operating model and the retained native/local-differential records. Use the established writing-for-agents, TDD and diagnosing/review skills at their relevant steps; reuse existing tooling rather than initiating general preflight.

Create a minimized replay fixture from the actual operator-held signed Validation input. Preserve the original event and sanitized input hashes, public verification configuration, quotes/members, amounts, localization and IDs. Explain any redaction and modified buyer-journey step. No private key, browser token or session export belongs in the PR. A synthetic replacement where original bytes are unavailable must be labelled synthetic.

Correct `spikes/m0-014/rust/capacity.rs` and any directly necessary M0-014 call sites: admit `gid://shopify/CartLine/0`, the existing canonical positive decimal suffixes and UUID shape within current widths. Update the new candidate's wrong zero-rejection expectation. Keep empty, malformed, wrong-kind, over-width and unsupported noncanonical forms rejected. Align the TS binder and Rust profile. Distinguish these target-local IDs from real variant identity and signed member indices; Transform must echo its actual input ID unchanged. No +1 remapping, cross-target ID equality, or global relaxation of `parse_gid_suffix`.

Keep the existing v2 wire, Ed25519 verification, complete-set integrity, real variants, one-child expansion, exact pre-discount prices, policy rules, CART_INTERACTION repair behavior and experimental 32/200/10,000 limits.

Required executable controls:
- Valid `/0` signed input at both checkout journey steps passes the corrected full Validation target; old executable still reproduces the recorded rejection. Positive numeric and UUID controls remain valid.
- At those same enforcement steps, wrong observed price/quantity/variant, invalid/missing/duplicate members, unsigned required merchandise and bad key/context still reject. Moving to `/0` cannot bypass economic verification.
- Reordering target-local lines preserves complete-set economics, not accidental positional identity. The operator's same-variant/same-quantity mapping is not independent proof of buyer intent; retain explicit fixture-role/member evidence from actual cart properties before and after application. A new query field is unnecessary unless needed for an unambiguous test; any such change must remain bounded and be measured.
- A rejected proposal does not sign; 33 buckets still reject; ordinary-line repair remains possible.

Done: red/green regression through the full target(s), rather than only a grammar helper or TS test.

## 2. Build the executable that will actually run

The former M0-014 build copied PR #18 Wasm and ran M0-013 native source tests. Replace that *current-candidate* wiring with an explicit build/test path for corrected M0-014 source. Keep old source comparison and pinned-binary replay as separately named historical checks where useful; do not remove historical evidence to make current checks green.

Record the narrow source delta, toolchain, query/schema and build options, raw/final Wasm hashes. Account for trampoline and `wasm_opt`; bind the preview bundle to the final tested upload input. If only Validation needs a rebuilt artifact, preserve an unchanged Transform hash honestly; rebuilding both is allowed when the shared helper changes both.

Run the current full regression matrix against corrected binaries, including the captured-input-derived fixture, 10+190 and 32+168 with zero-based Validation IDs, 33-bucket guard, exact allocation/scalars, bounded large physical quantity and negative controls. Retain new per-artifact counters and old failed rows separately. A local checkout replay is not a live checkout. Missing stack telemetry stays unknown.

Run fresh restricted Spec and security reviews and resolve ordinary findings locally. Freeze a clean source commit before live mutation. Correctness and resource regressions must be resolved within the unchanged contract; a material mechanism change or failure stops the live branch and returns for principal direction.

Done: tested corrected upload artifacts and pre-live review dispositions. Once this holds, the owner's conditional live authorization applies without a separate paperwork-only review round.

## 3. Resume the existing isolated resources

Use exactly the existing app/store/installation:

| Resource | Identity |
|---|---|
| App / OAuth client | 429028933633 / 1443cf6d03d39edae7c101a943c5c684 |
| Partner / Dev organizations | 4697030 / 200969036 |
| Store / Shop | insignia-rewrite-dev.myshopify.com / 105501393179 |
| Installation | 1054356963611 |
| Optional Product A | 10485042479387 |
| Small / Large variants | 54061591232795 / 54061591265563 |
| Required Product B / variant | 10485042839835 / 54061592281371 |
| Existing Shop location | 120998986011 |

Recheck live identity, current counts and package ownership. Reuse those archived fixtures; **zero new products, variants or locations** are authorized. Initial stock was already seeded once. **No inventory seed, reset, compensation or other manual stock write** is authorized. Expected last state is 64/200/8 available/on-hand, zero committed. Stop commerce on unexplained stock/order state rather than repairing counts.

The owner's latest report says Admin and the real storefront are signed in. Reuse the shared session. Verify access through the normal store domain without exposing credentials; ask for human login only on an actual new session/access failure. A staff product-preview domain cannot substitute for buyer checkout evidence. Do not repeat app registration, Partner access or the Admin synthetic Save demonstration.

Reauthorize only if needed within the ORIGINAL M0-014 scope ceiling, preserving current grants. Necessary non-identifying order/fulfillment reads may use the originally permitted scopes. No new permission class is approved. Protected-data needs outside the original selection boundary stop that branch.

Temporarily restore package-owned config/product anchors and the owned Transform/Validation objects, explicitly `blockOnFailure=true` and Validation enabled, using the corrected artifacts. Verify each object belongs to this app; preserve unrelated state. Generate a fresh ephemeral keypair outside Git because the prior private key was deleted. Bind current generation, epoch, country/market, currency and shop-local date. Expired historical carriers remain historical.

Re-publish only the same fixtures after bounded staging setup. Preserve storefront password protection. Fixture-level observed projection is not a production atomic publication proof.

The built-in test gateway was deactivated on cleanup. Reactivating ONLY that test provider is permitted for this run if it does not change any real-provider settings. Record its starting state and restore the run-owned change on cleanup. No real payment, account-level payment setup or App Pricing operation.

Done: actual fixture visibility on the normal storefront, real Function projection and current failure flags, no purchased units yet.

## 4. Finish the original tests, not new ones

Use fresh current context and one active synthetic cart at a time. Complete original M0-014 sections 3–4:

1. Small positive on the NORMAL storefront: 2 customized Small units at 30.33, 1 at 30.34 and 1 ordinary at 20.00, 111.00 pre-discount in the recorded supported currency. Capture an actual Validation checkout-step invocation and result. CART_INTERACTION alone is insufficient.
2. Before payment, demonstrate correct signed terms at base prices reject while only the owned Transform is removed and Validation remains active. Restore it. Check missing/altered member, required unsigned merchandise and invalid-line removal/orphan-envelope repair. No price adjustment or one-cent tolerance.
3. Unpaid actual 10+190 and 32+168 carts: record real line counts, actual Function inputs/outputs and checkout-step Validation where observable. If Shopify merges lines, report the actual count rather than calling it 200. Retain the local 33-bucket pre-sign rejection. Clear the large carts before payment.
4. One small native Bogus purchase and original lifecycle: exactly one intended customized unit partially fulfilled, immediate receipt/inventory check, native calculated refund/RETURN restock for that fulfilled unit, then native calculated cancellation/refund/CANCEL restock for the three remaining unfulfilled units. Stop on ambiguity, unintended fulfillment or mismatching economic result; do not compensate by manual inventory/refund edits.

**The cumulative M0-014 + M0-014R ceiling stays ONE successful new order and FOUR purchased units.** Recorded consumption is zero; verify before any payment retry. An uncertain payment result requires order lookup, not another blind attempt. Only this run's new order may be fulfilled, refunded or cancelled. Historical orders and billing fixtures are untouched. Taxes/shipping are recorded separately; no new discount, Markets, tax or shipping configuration is authorized.

A genuinely different platform failure stops dependent commerce. Ordinary local implementation/test corrections within the approved CartLine contract may be completed locally. Full gate adoption, M1 and a new materialization mechanism remain principal decisions.

## 5. Cleanup and return the same PR

Clear run-owned carts and quote carriers; retain a sanitized final read where available. Unpublish/archive only the reused fixtures before deleting their temporary policy. Remove run-owned active Function objects and metadata, delete the fresh private key and stop only the run's preview/processes. Preserve an accurately documented stopped preview/grant holding state; do not run an app-dev-clean/uninstall/reinstall loop. Restore only the test-gateway change made by this continuation. Reconcile stock through actual native lifecycle receipts; never reset it.

Keep original stopped-run records append-only and add an R-run directory with exact source/binary/time/provenance. Refresh current status pointers, but do not relabel the original preview or simulated checkout as successful native checkout. Preserve v1.3 plan/ledger and the existing authorized G6 clarification; no further decision amendment.

Run final-head CI and fresh reviews of corrections/evidence, push existing PR #19 and return actual refs, R1 closure, exact artifacts, local-versus-live outcomes and final resource state. Mark ready for review only with an accurate outcome; leave it draft on unresolved blocking failure. **No merge, gate pass, production protocol/capacity adoption or M1 start.**

Execution: established actual sol-6-high route, at most two restricted non-overlapping writers, one integrator, fresh Spec/security reviewers, and exactly one Shopify operator. The principal retains direction and final review; the user retains merge and out-of-envelope resource authority.
