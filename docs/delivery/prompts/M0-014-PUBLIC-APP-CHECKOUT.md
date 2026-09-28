# M0-014 — bounded Public-app checkout proof

Principal-issued 28 September 2026. Execute only with the accompanying owner authorization. One integrated implementation/evidence PR after the exact approved PR #18 normal merge. This is a controlled development experiment, not a released deployment, production protocol/capacity adoption, complete gate PASS, or M1 start.

## Outcome and fixed scope

Demonstrate the M0-013 whole-quote candidate on the designated Public/Draft app: actual cart inputs and price materialization, independent wrong-price rejection, invalid-line repair, bounded high-line-count execution, and one small real-variant Bogus purchase followed by native partial fulfillment/refund/restock.

Use only these existing resources:
- App `gid://shopify/App/429028933633`, client `1443cf6d03d39edae7c101a943c5c684`.
- Optidigi Partner/Dev organizations `4697030` / `200969036`.
- `insignia-rewrite-dev.myshopify.com`, Shop `gid://shopify/Shop/105501393179`.
- Expected installation from prior evidence `gid://shopify/AppInstallation/1054356963611`; verify current binding before writes.

The previous experimental app/store, legacy merchant installations and their orders #1001–#1006 are outside this task. The retained billing draft, meter, effective-zero subscription and M0-012 run state are unchanged; zero App Events or token-only billing calls.

Read root AGENTS, current ledger/operating model, PR-018 principal review, M0-013 measurement report and the relevant M0-006/007 native evidence. Reuse the established CLI, browser, schema tools, strict key handling and fixed-input harness. Public docs/schema lookup and a missing optional MCP are not reasons for another general preflight.

## 1. Bind one candidate and review locally

Branch from verified remote main after PR #18's normal merge. Materialize the candidate under `spikes/m0-014/` or use explicit read-only imports from the frozen M0-013 source. Isolate the new app configuration and extension identities; do not overwrite historical app configs or reuse a live merchant extension identifier.

Keep whole-quote v2 byte layout/carriers, Ed25519 strict verification, complete-subset identity, exact pre-discount money, same-real-variant one-child expansion and independent Validation. The live test profile is at most 32 customized buckets, 200 cart lines and 10,000 physical units; this is an experiment limit only. Use the actual current currency/country/market/shop-local day. The small worked purchase below requires a currently supported two-decimal currency; do not change Markets/tax/currency settings to force it.

Resolve the actual upload build path before remote activation. Prefer the reviewed executables where supported; otherwise rebuild the same source and measure the final executable that will be uploaded. Account for trampoline and Shopify CLI's optional wasm-opt step. Pin or disable additional optimization as needed, or measure the optimized result; never label a different uploaded executable with an earlier hash. Bind source, schema/query, build configuration, final Wasm and actual Function/version identifiers. A platform-side hash unavailable through supported tools is explicitly unknown, not fabricated.

Create a small fixture-only cart/issuer bridge, not a production admin, pricing engine or root workspace. The server/CLI constructs trusted admission inputs; buyers do not provide authoritative byte ceilings. Actual Shopify strings and per-product policies replace synthetic IDs. One product ID must have one coherent policy across its variants. Retain different customized groups/member indices where separate lines are needed, without altering buyer economics.

Run the relevant M0-013 golden/admission/full-target regression on the exact prepared artifacts. Obtain fresh restricted Spec and security review before remote mutation. Ordinary in-scope fixes remain in this package. A required protocol/materialization change returns for principal adjudication rather than being implemented silently.

Done: locally reviewed fixed candidate and a resource/test manifest; this stage alone creates no Shopify objects.

## 2. Prepare the isolated fixture and owned Functions

One remote operator verifies current app/Public status, Basic development-store status, installation/grants, inventory locations, preview ownership and existing transforms/validations. An API returning only this app's resources cannot prove absence of another app's transform. Preserve any unrelated object/settings. Use an existing merchant-managed location actually available to the fixture; do not create a location or fulfillment service.

Permitted OAuth-scope ceiling, only as required for the chosen supported operations:
`read_products`, `write_products`, `read_cart_transforms`, `write_cart_transforms`, `read_validations`, `write_validations`, `read_orders`, `write_orders`, `read_inventory`, `write_inventory`, `read_locations`, `read_merchant_managed_fulfillment_orders`, `write_merchant_managed_fulfillment_orders`.
Preserve existing grants; no unrelated scope, Partner permission or secret rotation. Native Admin operations may avoid unnecessary API writes. If Shopify requires a development-only protected-order-data selection, select only necessary non-identifying order fields; no names/email/phone/address permission request or production access submission. A higher-access requirement is a specific blocker, not permission to broaden access.

Create at most TWO clearly named M0-014 fixture products and THREE total variants:
- Product A, optional customization, Small and Large variants; ordinary and customized purchases may coexist. Base merchandise price 20.00 in the unchanged supported presentment currency.
- Product B, required customization, one variant, base price 20.00; negative checkout probe only.

Initial tracked stock is permitted only for these newly created fixtures, at one recorded location: at most 64 Small, 200 Large and 8 required-probe units (272 total). Record initial setup once; no manual stock compensation/reset later. This stock permits unpaid stress carts; it does not authorize large orders. Publish only these fixtures temporarily to the Online Store and retain storefront password protection.

Generate one fresh ephemeral test signing keypair, never the public fixture seed. Keep the private key outside Git/logs and remove it on cleanup. Add only package-owned app metadata/definitions needed for the public config and two product-policy anchors. Verify absence/ownership before writing; preserve existing values rather than replacing them blindly. Use real current context and valid-through date.

Use a DEVELOPMENT preview, not app deploy/release. Create only this package's Transform and Validation, with explicit `blockOnFailure=true` and Validation `enable=true`; read back their actual settings. Function handles must belong to the new app. Record actual projection in both targets before calling a positive checkout test valid.

Stage fixture policy while unpublished where possible; keep the test store password and dedicated fixture containment. The first observed projection after temporary exposure is only staging evidence, not a production atomic activation barrier. Do not claim M0-008 activation passed or enable production required-product publishing.

Verify Shopify's Bogus test provider. Its activation is permitted only when no real-payment provider or settings are altered. Real payments and payment-method entry for any app subscription are excluded. If the native test gateway or shipping route is unavailable, finish safe independent tests and report the exact prerequisite.

Done: manifest has real resource IDs, initial stock, owned configuration, effective failure flags and artifacts; no order has yet been purchased.

## 3. Test actual carts before a small purchase

Use one active synthetic browser/cart at a time and clear package-owned carts between cases. Record actual line counts and Function input/output; a requested 200 lines that Shopify merged into fewer lines is not a 200-line observation.

A. **Small positive:** three customized Small units allocated as 2 × 30.33 + 1 × 30.34 = 91.00, plus ONE ordinary Small at 20.00. These are the same real Shopify variant with distinct customization/member identities. Exact pre-discount merchandise total 111.00; shipping/tax/discounts, if present, are recorded separately. No new discount configuration is part of this task. Verify materialized lines and independent Validation.

B. **Economic fail-closed and repair:** keep Validation enabled while temporarily removing only this package's owned Transform, then attempt the previously valid signed customized checkout. Correct signature at base prices must reject. Recreate the owned Transform and read back the active identity. Also test a missing/altered member and a known-required unsigned Product B; stop before payment. A single missing policy anchor may be tested on Product B while the surviving anchor is preserved, followed by exact restoration. Remove invalid lines and orphan envelope to prove the remaining optional plain cart can reach checkout. No private network-body interception requirement and no blanket outage policy.

C. **Measured live shape:** evaluate 10 customized +190 ordinary, then 32 customized +168 ordinary lines, without paying. Use distinct nonsecret line properties only where needed to preserve ordinary-line separation. The custom and ordinary Product A lines share coherent optional product policy. Record actual input IDs, number of physical/member records, quantities, costs, output bytes and available per-run counters. Reconstruct the input size from captured input bytes, not a backend assertion. Replay retained live inputs locally against the exact uploaded candidate when possible. Local replay counters are not labeled live platform counters.

D. **Boundary behavior:** prove the fixture issuer rejects a proposed 33-bucket subset before signing and that actual malformed/incomplete input remains recoverable. The earlier valid uncapped64 output failure remains historical; do not deliberately activate an uncapped verifier or pay a large cart. No claim that 33/64 buckets were priced successfully.

Capture stack evidence only if a supported method already exists. A successful live run proves that particular execution completed, not its numerical stack peak. Missing telemetry stays unknown; do not weaken isolation or build new host tooling.

If real CartLine grammar, input projection, price semantics or resource limits differ materially, preserve the failed case and stop dependent commerce. Do not reduce the reported line count, remove checks, partially sign the subset, or change the wire to turn it green. Independent safe evidence may still be completed.

Done: positive and negative observations are separately classified and their repair path is recorded. All large test carts are unpaid and cleared before the small order.

## 4. One Bogus order and bounded native lifecycle

Reconstruct the small A case from fresh actual context and stock. Native checkout must show the accepted 111.00 pre-discount merchandise sum on four real Small units. Any native tax/shipping is separate, and the whole payment remains Bogus.

**Ceiling: ONE successful new Bogus order, FOUR purchased physical units total.** Verify the order lookup before retrying an ambiguous payment so a failed return cannot create a second order. Prior orders and billing subscriptions are untouched.

Reconcile actual variant IDs, line properties, each allocated unit price, total quantity, single inventory commitment and the whole quote reference. Capture native Admin grouping without inventing flat-line semantics from bundle presentation.

Partially fulfill exactly ONE selected customized unit from the two-unit 30.33 bucket. Before submission, inspect current native quantity controls, selected items and aggregate count. Reject inconsistent or ambiguous state; a stale label or form alone is not evidence of correct submission. Inspect the actual fulfillment receipt and inventory immediately after. An unintended bystander fulfillment stops the dependent lifecycle; do not compensate with stock edits.

For a correct partial fulfillment, refund that one fulfilled unit with the native calculated amount and RETURN restock, then refund/cancel the remaining THREE unfulfilled units using the supported native calculated route and appropriate CANCEL restocking/release. Two calculated refunds, or the equivalent native cancellation flow on this new order, are permitted. Their merchandise components must total the actually paid merchandise amounts; native shipping/tax refund choices are disclosed separately. No hand-entered refund correction or garment/customization split. If Shopify does not support the intended sequence, retain the state and report it rather than silently fulfilling additional units.

Read final quantities to establish that only this new order's commitments were released and the fixture's stock returned to its initial state. Record the retained refunded/cancelled test order; deletion is not required.

Done: exact new order and native lifecycle receipts are recorded, or a precise bounded failure with its residue is preserved.

## 5. Cleanup, integrate and return

Clear package-owned synthetic carts and orphan carriers. Unpublish/archive only the new fixtures before removing their managed-policy state. Remove only package-owned active Transform/Validation objects and temporary keys/metadata; delete the ephemeral private key. Stop the package preview/tunnel. Do not run `app dev clean` merely to remove a preview record, uninstall/reinstall, drop scopes, or release a placeholder configuration. Retain a stopped development-preview record and needed development grants with an accurate holding-state report when reverting would change the released baseline. No cleanup of old previews, legacy objects or billing fixtures.

In the integrated PR, update current delivery pointers and evidence. Keep v1.3 architecture, original gate criteria and prior source/receipts unchanged, except the following expressly permitted clarification: make the G6 timing sentence say that an implementable activation contract is due before publication depends on it; M1 must not rely on an unproved activator, but generic foundation work does not require the production publisher to be completed. This clarifies the already-approved principal direction. Preserve the separate public-app economic-proof prerequisite and all production enablement blocks; update explicit current document hashes only if this narrow text changes. Archive prior versions normally; never regenerate old expected receipts.

Use actual sol-6-high, at most two non-overlapping restricted implementation writers, one integration owner and exactly one Shopify operator. Split local issuer/evidence checks from integration only where it adds value. Read the existing writing-for-agents, TDD, diagnosing-bugs and review skills when applicable; no new orchestration framework. Run fresh Spec/security reviews and all relevant local/CI tests after integration. Ordinary corrections stay in this package; a material protocol or product change requires principal direction.

Return ONE implementation/evidence PR with actual base/head/merge-base, CI, artifact/source provenance, observed cart counts, positive/negative outcomes, exact order/lifecycle facts, resource changes and final holding state. Do not fabricate native success from local fixtures or a complete G1/G2/G3/G5/G6 PASS from one run. The next principal review decides whether the bounded foundation prerequisites are satisfied. No automatic M1 start or PR merge.

### Current primary-source pointers

Use the pinned contract and actual schema; these pages can change:
- Function limits, visibility and `wasm_opt`: https://shopify.dev/docs/api/functions/2026-07
- Transform activation: https://shopify.dev/docs/api/admin-graphql/latest/mutations/cartTransformCreate
- Validation activation flags: https://shopify.dev/docs/api/admin-graphql/latest/input-objects/ValidationCreateInput
- Access scopes: https://shopify.dev/docs/api/usage/access-scopes
- Preview cleanup semantics: https://shopify.dev/docs/api/shopify-cli/app/app-dev-clean
