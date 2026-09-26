# M0-006 — live whole-quote carrier and checkout-economics experiment

**One integrated outcome package.** Start only after the owner sends the accompanying explicit permission and reviewed PR #8 is normally merged. Retain the v2 prototype exception; no production protocol adoption follows.

## Outcome and authority

Determine whether the M0-005 shared envelope and compact records survive the actual supported purchase path, materialize the exact allocated price, and let an independent Validation Function reject economically invalid checkout while leaving cart repair usable.

Read `AGENTS.md`, the current delivery state, `PR-008-principal-review.md`, this prompt, the M0-005 contract/proposal/source and the relevant plan sections on pricing, authorization, cart integration and failure policy. Follow the pinned `writing-for-agents`, `tdd`, `diagnosing-bugs` and `code-review` skills when applicable. The principal retains architecture, acceptance criteria, gate adjudication and review of every PR. Local reviews do not replace it.

Use actual `gpt-6-sol` / high. Reuse established tooling and restricted delegates; no general preflight. Up to two non-overlapping implementation writers/worktrees, one integrator, fresh Spec and Standards/security reviewers, and **exactly one staging operator**. Complete ordinary in-scope test/fix/review loops locally. A missing native-subagent facility uses the established separate restricted-session fallback.

## 1. Start from the reviewed checkpoint

Verify PR #8 target `main`, base/effective merge base `878c9b9b58cc7aeae81b2393847eb18ef91e2540`, head `eb1abc3b1828d3aa5e6b99cc785f5e25f2839ffa`, external principal approval and applicable successful CI. Use the owner's normal-merge permission only for these exact inputs; otherwise report changed refs. Verify the actual remote merge and branch from updated main.

Keep the approved architecture plan/ledger, M0-004 and M0-005 sources and all historical receipts unchanged. Put the continuation harness/evidence under `spikes/m0-006/`; reuse M0-005 issuer/core by explicit imports or a recorded source-identical copy. The new adapter may use dedicated M0-006 metadata keys, fixture allowlisting, safe diagnostic projections and narrowly justified input mapping changes. No signature/domain/layout change, alternative carrier architecture, custom price workaround or production app scaffold.

Completion: branch ancestry, exact imported source hashes and bounded internal tasks recorded. Do not open a docs-only checkpoint PR before the outcome.

## 2. Prepare only the existing staging resources

Verify the actual existing `insignia` app/client binding from its established local configuration and `insignia-staging.myshopify.com` before any mutation. Reuse the authenticated shared Admin browser and designated Shop location, not another store or app.

| Resource | Identity |
|---|---|
| Fixture product | `gid://shopify/Product/10294344482974` |
| Fixture handle | `insignia-m0-001-fixture-20260924` |
| Black / Small | `gid://shopify/ProductVariant/50529053343902` |
| Black / Medium | `gid://shopify/ProductVariant/50529054163102` |
| Shop location | `gid://shopify/Location/89465290910` |

**Orders #1001–#1004, their fulfillments/refunds and existing commitments are read-only.** Snapshot relevant current resources and protected history. Last retained stock was Small available/committed/on-hand 5/2/7 and Medium 8/2/10; read current stock rather than assuming those values. Use existing uncommitted stock. No seed, manual adjustment or unrelated fixture creation.

The owner's envelope permits temporary fixture activation/publication, one owned development Transform and Validation, their documented creation/update/deletion and the existing app's development preview. Verify no collision with another owned/unowned active experiment. Preserve password protection. Do not select distribution, create an app/store, run a released deployment, or touch production.

Generate a fresh ephemeral Ed25519 keypair locally for this run, using the maintained issuer. Publish only its public key in an app-owned test registry with generation/epoch and explicit admission windows. Never activate the publicly known RFC fixture private key in the store. Do not commit private keys, credentials or session exports. Derive shop date, country/market and USD context from independent live reads/Function input, not the signed claim itself.

App-owned fixture policy and public-config metafields may be created/updated/restored for this experiment. Prefer dedicated M0-006 keys to avoid conflicting with older experiments. Snapshot exact prior values and record app ownership. Use the existing scopes plus `read_validations` / `write_validations` only when needed. Normal owner-approved installation reauthorization for these named scopes is allowed. Determine existing owner-type scope requirements from the pinned API; any additional scope requires a precise owner action, not silent expansion.

Explicitly enable the test Validation with runtime `blockOnFailure=true`; also use `blockOnFailure=true` for the owned Transform. Read back active status and function identity. A successful creation response without enabled checkout enforcement is insufficient. Set a trusted **ten-bucket maximum for this experiment only**, and prove small live-output bounds locally. It is not a merchant-facing cap. Oversized sets must reject without partial application; keep the historical 64-bucket failure intact.

The built-in Shopify Test/Bogus payment provider must be positively verified active before test payment. The owner's permission includes activating that built-in provider only if no real provider needs disabling/reconfiguration. Real providers, payout settings and real-payment modes remain untouched. If there is a conflict, stop payment-dependent work and finish safe independent checks.

Completion: named resources, snapshots, ephemeral public registry, active Function identities/settings and available stock are evidenced. If a documented dev-preview route is unavailable, return its exact error with the completed local harness; do not change distribution to make it work.

## 3. Test propagation, negative cases and cart repair before payment

Use the preferred unchanged `_insignia_quote_v2` shared envelope and `_insignia_member_v2` line records. Inspect the actual 208/30-character values and decoded statements across Ajax/cart, Transform input/output, checkout Validation input/output and, later, order attributes/lines. Use a guest customer storefront session distinct from merchant Admin authentication. Byte hashes or exact synthetic values are acceptable; exclude customer-identifying data and browser secrets from committed receipts.

Use Shopify's supported Function execution input/output facilities and public cart/order reads. Exact private Admin HTTP interception is unnecessary. A synthetic projection or our own emitted marker is not evidence that checkout received or enforced the value. Capture actual native/Shopify errors and provenance. An unavailable read leaves that specific proposition unproved, not a made-up PASS.

Exercise these cases without successful payment:

| Case | Required observation |
|---|---|
| Complete allocated quote | Same real variants/quantities; exact shared statement available to each target; intended pre-discount price independently visible. |
| Header missing/corrupt, member missing/duplicate/changed, quantity changed | Invalid complete set cannot complete checkout. No partial successful materialization. |
| Valid envelope, altered materialized economics | Temporarily remove/disable only the owned Transform while keeping the valid Validation active; base-price merchandise under a higher signed price must be rejected. Reactivate the owned Transform afterward. |
| Required fixture, all carriers removed | Known required policy independently arrives and unsigned checkout rejects. |
| Optional plain fixture | Unsigned plain purchase path remains usable without an orphan envelope. |
| Expired/future-window authorization or revoked test key | Reject at checkout, with independent date/registry evidence. A renewed complete set may repair it. |
| Replacing quote across non-atomic cart updates | Temporary incomplete states stay repairable; checkout only succeeds with the complete replacement. |
| Clear customized cart / remove last customized line | Explicitly remove the stale shared envelope as well as member lines, then verify an ordinary cart is not stranded. `cart/clear.js` alone does not clear cart attributes. |

Capture parent/group/child representations explicitly and count physical merchandise exactly once. A normalization adjustment is allowed only when demonstrated by retained real input and regression tests; do not merely drop inconvenient rows. Use actual cart-line keys/indexes for duplicate variants, not variant ID alone. The known-required test and mixed optional/plain positive test are separate policy phases; a single product's policy applies to all its variants. Never treat the missing-policy allow case as proof that required customization is safe. The **missing required-policy projection remains an open G6 deployment blocker**; record current input and a proposed safe publication/rollout obligation, not an improvised all-products-required rule.

Distinguish conventional Cart → Checkout, cart-based express options, and product-page Buy Now. Test available relevant accelerated entry without creating extra paid orders. Record whether it preserves the complete accepted cart, starts a new session or drops the envelope. Carrier loss that safely blocks is an integrity result, not a compatibility PASS. Do not require customer login to hide a guest-path failure. If an accelerated route needs a real wallet/payment setup unavailable here, record it untested rather than alter payments. Read-only public research can contextualize a failure; user reports are not proof of current behavior on this store.

Completion: an explicit matrix of observed inputs, expected/actual result, supported checkout step and evidence links. A true economic or carrier mismatch stops that dependent path. Continue already-authorized independent local checks; no architecture substitution to force success.

## 4. Complete at most two successful Bogus orders, seven units total

These are maximums, not a quota. Count any unexpectedly successful invalid test against the same limit and stop the failed path. Before each payment, verify exact cart composition, intended quote, independent validation, active test-only gateway and no concurrent staging operator.

**Order A — allocated plus plain:** three customized Small units with accepted merchandise 90.00 plus setup 1.00, allocated as two units at USD30.33 and one at USD30.34; plus one plain Medium at USD20.00. Four physical units; USD111.00 pre-discount merchandise. Preserve the actual issuer's canonical bucket indexes rather than assuming which remainder bucket comes first.

After its order appears, correlate shared quote/set and each compact member with actual order lines, real variants, quantities and price buckets. Inspect current tax/shipping separately; do not force a grand total by changing tax or shipping settings. Prove exact monetary and identity totals from the order, not only the browser.

Use native Admin calculated cancellation/refund/restock on this **new** order to restore its stock before Order B. A scoped native partial bucket refund may be used to verify its calculated price, followed by the remaining native cancellation/refund, but no manually entered refund amount or stock correction. Verify direct refund-line identities, returned stock and unchanged protected commitments. If native grouping prevents the intended operation, preserve that fact and stop dependent order work.

**Order B — discount interaction, conditional:** only after A and the prerequisite integrity cases pass. Three customized Small units with the same USD91.00 pre-discount allocation. Create at most one temporary native **10% product discount code restricted to this fixture product**, with no other discount combinations. Inspect Validation's actual lexical amounts under the discount before payment. Expected merchandise discount USD9.10 and net merchandise USD81.90; tax/shipping recorded separately. This is one limited G4 observation, not a general Markets/discount qualification.

Use native Admin for the fixture discount so no discount write scope is implicitly added. Do not alter any existing discount. Remove/deactivate only the newly created code during cleanup. A discount-related Validation mismatch is a test result: do not disable validation, alter the signed pre-discount price or fabricate a different observed-price field. A narrowly supported adapter-field correction is allowed only with actual input evidence, explicit semantic rationale and a regression, not a changed acceptance definition.

Capture order B's shared/member carriers, actual discounts, real quantities/prices and direct native calculated cancellation/refund/restock. Leave new orders as auditable test records, not deleted evidence. All orders remain test-only. No paid shipping labels or real payments.

Completion: positive order(s) are backed by cart, Function, order, refund and stock evidence, or the first precise failure is retained. Never repeat completed successful tests solely to obtain cosmetic screenshots.

## 5. Cleanup, integrated checks and handoff

Cleanup is permitted on success or failure: disable/delete the owned Validation and Transform before removing their test config, stop/clean the owned preview, revoke/remove the ephemeral public registry and private key material, restore prior metadata, remove the new discount, unpublish/archive the fixture, and clear the experiment's cart carriers. Preserve any unexpected failed order state when necessary for diagnosis and explicitly report it. Do not mutate old orders #1001–#1004 to make stock match a desired total. Retain existing app installation; document any approved scope additions rather than silently uninstall or revoke unrelated access.

Bind measurements and run inputs to exact source/query/Wasm artifacts. Capture the actual build used by preview; if the CLI rebuilds it, record and test that result rather than attaching another artifact's hash. Add raw live projections with clearly documented sanitization, reproducible local regressions and bounded manifest checks to CI. Retain success and failure receipts. Local/CI byte differences are qualified, not hidden.

Return **one integrated PR** with the principal review recorded in delivery state, commands, final refs/CI/artifact IDs, permission use/residues, local Spec and Standards/security findings and dispositions. Include an adoption-readiness matrix: carrier, guest/accelerated routes, actual price semantics, fail-closed cases, known-required versus missing-policy distinction, key rollout and output admission. Recommend the next decision from evidence.

The 64-bucket stress failure is still open, but solving that exact case is not a prerequisite for this bounded experiment. No live v1 offers exist to migrate: do not build a legacy migration or dual-version acceptance system. Keep production adoption and any plan/ledger amendment for a separate principal/owner decision. No full gate pass, merchant cap, M1, released deployment, next-PR merge or subsequent workstream is authorized.

## Source pointers

Use the pinned schema and actual observed behavior together; retrieve current official documentation when interpreting mutable platform behavior.
- Function lifecycle, input/output and limits: https://shopify.dev/docs/api/functions/2026-07
- Function execution capture/replay: https://shopify.dev/docs/apps/build/functions/test-debug-functions
- Validation installation and default-disabled/runtime-failure options: https://shopify.dev/docs/api/admin-graphql/latest/mutations/validationCreate and https://shopify.dev/docs/api/admin-graphql/latest/input-objects/ValidationCreateInput
- Ajax cart attributes, duplicate-line updates and clearing: https://shopify.dev/docs/api/ajax/reference/cart
- First-hand accelerated carrier-loss report, as a test lead only: https://community.shopify.dev/t/function-input-cart-attribute-doesnt-map-to-the-ajax-cart-attributes/13794
