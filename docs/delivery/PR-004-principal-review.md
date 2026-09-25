# Principal review — Insignia PR #4

Date: 25 September 2026. Principal: ChatGPT, Insignia Rewrite Project.

## Verdict and binding

**APPROVED — evidence and harness-continuation checkpoint only.**

- Repository: `Optidigi/insignia`, repository ID `1386102402`.
- PR: `https://github.com/Optidigi/insignia/pull/4`.
- Base and effective merge base: `523efa4e0248cb2c64ed846e0b37af0067f01d9c`.
- Reviewed head: `1bfe9a13357b9c49042627f68fcca9daec93b1f5`.

The reviewed change may be merged normally by the maintainer, or by the local agent after explicit owner delegation for this exact PR. Keep the reviewed head unchanged until merge. Approval is not a passed G1, proof of production non-Plus support, or approval of a different price-materialization architecture.

No merge-blocking repository defect was found in the inspected delta. The new files preserve a failed experiment instead of concealing it. The runtime Function, schema and original Wasm fixtures are unchanged; the app configuration adds only the two anticipated read scopes. G1 remains **IN_PROGRESS, blocked on the unresolved fulfillment observation**. G2–G8 remain NOT_RUN; dependent full-application work remains unauthorized.

## What the evidence establishes

The accepted Bogus test order is `#1001`, `gid://shopify/Order/7184619962526`, test=true, PAID, gateway bogus. It contains three distinct order lines and three distinct fulfillment-order line IDs:

| Role | Variant suffix | Order-line suffix | Fulfillment-order-line suffix | Quantity | Unit USD |
|---|---|---|---|---:|---:|
| Plain Small | 50529053343902 | 16953568723102 | 17215047270558 | 1 | 20 |
| Marked Small | 50529053343902 | 16953568788638 | 17215047303326 | 3 | 30 |
| Marked Medium | 50529054163102 | 16953568755870 | 17215047336094 | 2 | 30 |

The sum is six physical units and USD 170 merchandise, with zero recorded tax/shipping. Plain and marked Small share a variant, not an order-line or fulfillment-order-line identity. The marked lines retain their respective LineItemGroups and correlation attributes.

The captured fulfillment is `gid://shopify/Fulfillment/6511606562974`, created at `2026-09-24T23:46:59Z`. It includes one plain Small and one marked Small, total quantity two. This differs from the intended one-marked-Small action.

The pre-submit projection at `2026-09-24T23:46:53.137Z` is internally inconsistent for that intention: plain Small selected=false but quantity="1"; marked Small selected=true and quantity="1"; aggregate selectionLabel="2 items selected". The projection contains operator aliases rather than a complete control/line binding, and the reviewed receipts do not include the original outgoing fulfillment mutation request.

Therefore **the test failed its intended-selection acceptance criterion, but the cause is undetermined**. The evidence does not establish that Shopify received a request for one unit and added another, that lineExpand caused the mismatch, or that inventory was double-decremented. The recorded stock change is consistent with the two units actually fulfilled: Small changes from available/committed/on_hand 8/4/12 to 8/2/10; Medium remains 10/2/12.

Shopify's current native partial-fulfillment instructions direct the operator to enter the desired quantities. That makes control semantics, uncommitted UI state, projection/locator error and native UI grouping all hypotheses to examine before blaming backend fulfillment. Documentation is guidance, not proof of which hypothesis occurred here.

## Review performed and limits

Inspected live PR metadata and comparison (56 changed files); the request/evidence index and manifest structure; selected direct order, fulfillment, selection and inventory receipts; scope configuration; both new Python scripts; operational records; and actual GitHub Actions job output. Compared the original M0-002 task against the observed stop and cleanup behavior.

CI run `36076245450`, job `107887983544`, succeeded for this PR/head. It checked synthetic merge candidate `718a9171c228dee397d8ba6cef808f82e0d3de94` and logged formatting/clippy, two native tests, release Wasm build and eleven Wasm fixtures. **This job did not invoke the new 36-assertion Python receipt checker or all 44 manifest hashes.** Those remain separately reported local checks; their passing result means historical receipt consistency, not a passing fulfillment experiment.

Locally recomputed both supplied architecture-document hashes, compared them with the v1.1 archive and the published Git blob identities, and performed 14 arithmetic/identity checks on selected retrieved fields. See `PR-004-verification.json` for the exact scope. The plan and ledger are unchanged.

No live Shopify operation, browser action, full Rust/Wasm rerun, full 36-assertion receipt-checker rerun, or independent check of all 44 receipt hashes was performed by the principal. A container Git read failed DNS resolution, so repository review used the GitHub connector. The principal did not inspect an authenticated raw browser trace or validate the cart screenshot visually. None is claimed as independently executed.

## Required next-run corrections, not reasons to discard this evidence PR

1. **Pre-submit agreement.** A one-unit intention must not be submitted while the native form's effective quantities or aggregate indicate two. Add a regression that rejects the recorded one-selected/two-summary state. Check effective properties and quantity commit/blur behavior, not just an unchecked DOM attribute.
2. **Actual request correlation.** Capture a sanitized outgoing native fulfillment request, its operation/line mapping, and its response, alongside DOM state and post-action public API receipts. An operator-labelled JSON summary is not proof of the sent request. Do not assume native Admin's private request format equals the public fulfillmentCreate schema.
3. **Controlled comparison.** Compare duplicate plain-variant lines distinguished by inert properties with the same-variant expanded/plain mixture. Keep the price mechanism fixed. No custom fulfillment workaround, bundle dissolution, price changes or stock reset to manufacture a pass.
4. **Receipt automation.** Wire read-only receipt and manifest checks into the existing local/CI path in the next slice. Preserve the original recorded failure; a diagnostic result later may explain it but must not rewrite historical receipts into a pass.

## Preserved evidence and residues

Order #1001 and its fulfillment remain unchanged for diagnosis. Four units remain committed (two marked Small and two Medium) at Shop location. The owned transform/dev preview are removed; the fixture is archived/unpublished; the installation and justified nine scopes remain. Preserve password protection and unrelated resources. The next slice must re-read this baseline, not reseed inventory as though it were zero or reuse #1001 as a clean experiment.

## Next authorization

The companion `M0-003-fulfillment-selection-diagnosis.md` defines a bounded diagnostic continuation after the reviewed merge and explicit owner staging consent. It permits read-only examination of #1001 and controlled new tests; it does not permit altering #1001. A successful documented native flow may conditionally finish the already-planned development lifecycle, within the small order budget. A persistent mismatch stops dependent steps and returns a reproducer for principal adjudication.

Public-app/ordinary non-Plus qualification and other gates are still outstanding. A custom API fulfillment success would not substitute for the required native merchant experience; no such workaround is authorized here.

## Evidence sources

All repository sources below are at the reviewed head:

- `https://github.com/Optidigi/insignia/blob/1bfe9a13357b9c49042627f68fcca9daec93b1f5/spikes/m0-001/evidence/m0-002/README.md`
- `https://github.com/Optidigi/insignia/blob/1bfe9a13357b9c49042627f68fcca9daec93b1f5/spikes/m0-001/evidence/m0-002/order-A-accepted.json`
- `https://github.com/Optidigi/insignia/blob/1bfe9a13357b9c49042627f68fcca9daec93b1f5/spikes/m0-001/evidence/m0-002/fulfillment-A-partial-ui-before.json`
- `https://github.com/Optidigi/insignia/blob/1bfe9a13357b9c49042627f68fcca9daec93b1f5/spikes/m0-001/evidence/m0-002/fulfillment-A-response.json`
- `https://github.com/Optidigi/insignia/blob/1bfe9a13357b9c49042627f68fcca9daec93b1f5/spikes/m0-001/evidence/m0-002/after-partial-A.json`
- `https://github.com/Optidigi/insignia/blob/1bfe9a13357b9c49042627f68fcca9daec93b1f5/spikes/m0-001/scripts/check-m0-002-evidence.py`
- `https://github.com/Optidigi/insignia/actions/runs/36076245450`

Current primary references checked for diagnostic semantics:

- `https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/single-fulfillment`
- `https://shopify.dev/docs/api/admin-graphql/latest/mutations/fulfillmentCreate`
- `https://shopify.dev/docs/apps/build/orders-fulfillment/order-management-apps/build-fulfillment-solutions`
- `https://shopify.dev/docs/api/ajax/reference/cart`

These sources do not establish the cause of this observed incident. The native APPROVE submission at the reviewed head returned HTTP 403, `Resource not accessible by integration`; it was not posted. This file and the principal chat verdict are the external review, not a native GitHub approval. No fallback comment or merge was performed.
