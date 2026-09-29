# PR #19 — principal review

**Verdict: CHANGES_REQUESTED.** Reviewed 29 September 2026. Continue this draft PR; do not merge it or open a successor simply to carry the correction.

## Binding

| Field | Value |
|---|---|
| Repository | Optidigi/insignia |
| PR | 19 |
| Base / reported effective merge base | 7222a96ff2b0408d0fbfe0803835d24acfd463b7 |
| Reviewed head | 317a4030032b565053b2a4b8032803246ba39ed7 |
| Head tree | d3eea0b9fe0421b8131a88cd36ed5af29375dc37 |
| CI synthetic merge | a18b4b3e064866dc72d72a8329e342c8b879517d |

GitHub reports the PR open, draft and unmerged. The synthetic merge has the reported base and reviewed head as parents, with the same tree as the reviewed head. The principal's native REQUEST_CHANGES submission anchored to this head returned HTTP 403, “Resource not accessible by integration”; it was not posted. This file and the chat verdict are the external review, not a native GitHub review.

## R1 — valid target-local zero CartLine rejected by the frozen Function

**Priority: high for completing this checkout path. Classification: IMPLEMENTATION DETAIL / concrete adapter defect, not a new product decision.**

`spikes/m0-014/rust/capacity.rs::cart_line_id_ok` accepts positive decimal suffixes or a bounded UUID form, but rejects `gid://shopify/CartLine/0` through `bytes[0] != b'0'`. Its unit test expressly expects that rejection. `rust/validation/src/main.rs` applies the guard to marked lines during checkout. Its `CART_INTERACTION` branch returns before enforcement.

The recorded native Validation event at 21:43:48 UTC contains `/0`, `/1`, `/2`; the first line is customized. The later local differential is derived from a separately timestamped event at 21:46:41 UTC. It reports checkout-step rejection with native zero-based IDs and acceptance after changing only the local IDs to one-based values. These are distinct records; do not conflate their raw-event hashes or represent the simulated checkout step as a native checkout.

The TypeScript binder already accepts the observed zero-based representation. Updating that binder alone does not correct the executable. The unsupported positive-only assumption was inherited from the previously reviewed capacity prototype. The operator correctly stopped under the frozen-artifact instruction; the principal's previous bounded review did not establish this live ID grammar.

### Required correction

Admit canonical numeric zero in the M0-014 CartLine-only grammar while retaining the existing positive-numeric and UUID forms and byte bounds. Preserve and echo the actual Transform input ID; do not renumber incoming IDs or use them as durable customization identity. Do not generalize this change to ProductVariant/Market GIDs, quantities, signed member indices, or pricing. The signed wire format, strict Ed25519 verification, complete-set checks and all monetary/policy limits remain unchanged.

Add failing-then-passing regressions derived from the captured input at both `CHECKOUT_INTERACTION` and `CHECKOUT_COMPLETION`. Include UUID/positive numeric controls and malformed/wrong-kind/empty/oversized IDs; wrong variant, altered quantity or price, tampered/missing/duplicate members and required unsigned merchandise must still reject. A nonempty `CART_INTERACTION` test alone is not enforcement evidence. Preserve ordinary-cart repair.

Use the actual locally retained inputs to create a reproducible minimized, sanitized fixture and its documented transformations. The committed summary currently omits the complete signed inputs, so the principal has not independently replayed that differential. Do not invent missing source bytes or call a reconstruction an exact raw capture.

### Build/test correction is part of R1 closure

`spikes/m0-014/scripts/check-local.sh` presently compares the copied source to M0-013, runs native tests from M0-013, and installs/replays the old pinned binaries. The resumed path must build and test the corrected M0-014 source and bind its final uploaded binaries. Updating Rust without updating this wiring would leave the defective deployed executable in use.

Keep M0-013 source, old binaries, original negative tests and prior receipts intact as historical evidence. Add a new M0-014 corrected artifact profile and measurements; do not overwrite old observations or label new counters with old Wasm hashes. Recheck exact money, 10+190 and 32+168 shapes, 33-bucket rejection and the bounded 10,000-unit case against the exact corrected executable. Preserve the original v2 vectors.

## Accepted observations and limits

The summarized Ajax preview cart is arithmetically consistent: one unit at 30.34, two at 30.33 and one ordinary unit at 20.00, all the same real variant, for 111.00 USD. Transform's recorded two expansions and Validation's cart-interaction arrival are useful native-preview observations. They are not a normal storefront checkout, a validation pass at checkout, an order or a lifecycle result.

The reported cleanup left the two fixtures archived/unpublished, five temporary metadata values and owned shop Function objects removed, inventory at 64/200/8 with zero committed, and the test gateway deactivated. The cart-clear result is operator-reported without its full retained receipt. The stopped preview and development grants remain a disclosed holding state. The principal did not requery Shopify.

The owner's latest message confirms access to the real development storefront home page. That supersedes the earlier access uncertainty for resuming the test, without rewriting the historical password interruption. No further password, app registration or provider credential request is currently justified. Reuse the session, and request human action only on an observed new authentication failure.

The narrow G6 timing clarification matches the prior sequencing direction. No additional architecture/ledger amendment is needed for this CartLine correction. Whole-quote v2, merchant capacity and complete gate acceptance remain provisional.

## Verification performed

Read the current PR metadata/change inventory; execution narrative and resource manifest; CartLine guard and checkout enforcement path; TypeScript binder, fixture issuer and CLI bridge; summarized cart/Function records; local differential; build/check script; the architecture clarification; and the actual final-head M0-014 CI job log.

All eight head-associated workflows succeeded. The actual M0-014 job is **36491661005 / local-candidate**, job **109161467815**. Run 36491661129 is M0-007, despite one inconsistent label in the PR body. The log reports 9 M0-014 TypeScript tests, retained 10+9 TypeScript checks, 13/18/21 historical native Rust tests, 152 historical replays and 88 exact pinned-candidate replays. These tests do not close R1.

An independent Python arithmetic check verified the copied summarized cart against Git blob `47cbe53ead08a07f2e2296cace707514ea932931`, then checked line multiplication, four units, 9,100 customized minor units, 2,000 ordinary minor units and 11,100 total. This is not signature verification or native replay.

**Not performed here:** Rust/Wasm execution, source rebuild, instruction/stack measurement, live Shopify/browser operations, cryptographic verification of the omitted live tokens, independent hashing of every receipt, or full review of all 82 files. This is a targeted changes-requested review, not an overall passing implementation verdict.

## Direction

Complete R1 and the original outcome within existing PR #19 as M0-014R. The accompanying owner launch authorizes local corrections first and then conditional resumption on the same existing fixtures, after fresh local Spec/security review and artifact-bound tests. No interim principal roundtrip is required solely for this already-defined adapter correction; a materially different protocol, economic, permission or resource requirement still returns for direction.

No merge is approved. The final integrated correction/evidence PR returns for principal review before any gate or M1 decision.

## Source pointers

All repository paths above refer to the reviewed head in the binding table. Current public sources checked:

- Shopify Cart and Checkout Validation reference: https://shopify.dev/docs/api/functions/2026-07/cart-and-checkout-validation (redirected to latest, labelled 2026-07 when read). Distinguishes buyer-journey steps; does not specify a strictly positive CartLine suffix.
- GraphQL ID scalar: https://spec.graphql.org/September2025/#sec-ID. String-serialized identifiers do not imply a positive database integer.

The exact zero-based observation comes from this PR's captured-event summary, not an assertion that every Shopify surface always uses the same ID representation.
