# Principal review packet — M0-014R

## Identity

Repository: Optidigi/insignia. Existing draft PR:
https://github.com/Optidigi/insignia/pull/19. Reviewed original base and
effective merge base: 7222a96ff2b0408d0fbfe0803835d24acfd463b7.
Principal changes-requested head: 317a4030032b565053b2a4b8032803246ba39ed7.
The final corrected head and CI runs are recorded in the PR body after push;
putting that head in this commit would change it. Principal re-review is
required. PR #19 remains unmerged.

## Outcome and scope

The CartLine-only canonical /0 defect is corrected and bound to new current
M0-014 Function artifacts. The small normal-storefront economic, checkout
enforcement and native lifecycle observations succeeded. Actual 200-line
Large-variant carts stopped at a 51st Large Ajax line with HTTP 422; the
platform cause is undetermined. Local 200-line matrix results are separate.
No v2 wire, source in older slices, v1.3 plan/ledger or historical stopped-run
record changed. Only existing app, store, products, variants and Shop
location were used. No billing or legacy staging resource was touched.

## Acceptance evidence

| Criterion | Actual check | Result | Evidence |
|---|---|---|---|
| Canonical /0 with strict negative controls | Current M0-014 source, native Rust and 110-row final-Wasm matrix via spikes/m0-014/scripts/check-local.sh | PASS local | [R-run record](evidence/m0-014r-cartline-and-checkout.md), [matrix](../../spikes/m0-014/evidence/m0-014r/local/current-artifact-matrix.json) |
| Corrected uploaded inputs | Pinned CLI build; decoded dev bundle compared to final artifacts | PASS observed | [R-run record](evidence/m0-014r-cartline-and-checkout.md); platform storage hash unavailable |
| Checkout amount and independent rejection | Shared normal storefront and direct Transform/Validation logs | PASS bounded live | [Sanitized log/hash index](../../spikes/m0-014/evidence/m0-014r/live/live-observations.json) |
| Actual 200-line native carts | Ajax attempts on existing Large variant | BLOCKED | 51st Large returned HTTP 422 in both shapes; no 200-line checkout claim |
| Single order and lifecycle | Native Bogus payment, fulfillment, Return, two calculated refunds, stock readback | PARTIAL: money/restock observed; explicit CANCEL unavailable | [R-run record](evidence/m0-014r-cartline-and-checkout.md); one order/four units used |
| Owned cleanup | Fixed-target Admin API and native Payments reload | PASS observed | Archived fixtures, null owned metadata, no active Functions, 64/200/8 stock, inactive test gateway; stopped preview record retained |

The direct raw Shopify Function logs, diagnostic carts, API readbacks and
operator register are outside Git with mode 0600. The tracked evidence
contains selected sanitized direct Function inputs/outputs, Ajax role/member
mapping, observations and SHA-256 pointers, with no raw session, credential
or buyer contact detail. Actual CHECKOUT_COMPLETION Validation
read CartLine /0, /1 and /2 and returned no errors. The original failed
M0-014 receipt remains separate.

## Local pre-review

Fresh restricted Spec and security reviews of the final pre-live source
commit found no blocking implementation defect. Earlier positional-role and
query-size findings were fixed and retested. The read-only Spec reviewer
could not rerun path isolation under EROFS; the integrator ran the full
check on the same source. A later fixed-head Spec reviewer found the live
200-line and explicit CANCEL obligations unproved, and raw R-run receipts
outside its sandbox; selected sanitized direct captures are now tracked.
The fixed-head security reviewer found one medium fixture test-integrity
limit: coherent swapping of same-variant/one-unit roles in both captures
can switch the member assignment before signing. A regression and the
actual Ajax role/member mapping now record that limitation; neither the
role nor this fixture test proves buyer intent independently. Exact signed
member/economic verification is unchanged. Final-head CI and reviewer
closure are reported in the PR body; local review is not principal approval.

## Compatibility and limits

CartLine ID grammar alone admits canonical /0. Variant and market IDs,
signature/whole-set verification, exact pre-discount money, policy,
quantities, capacity limits and the v2 wire are unchanged. The additional
fixture role projection distinguishes actual target-local IDs without
making roles authoritative signed data. The 200-line live boundary and
native Cancel order event remain unproved. The return reason displayed
“Changed my mind” before submission but “Color” on the receipt; the economic,
line-selection and stock receipts were verified separately. Shopify
retains the stopped development preview/grants as a documented holding
state. No complete G1–G8 result, protocol/capacity adoption or M1 start is
claimed.

## Principal decision

Pending external principal review of the final PR base/head. No native
approval is manufactured; no merge or next package is authorized.
