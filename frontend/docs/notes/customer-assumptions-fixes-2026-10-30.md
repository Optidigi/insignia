# Customer option and preview corrections

30 October 2026. Implements the approved [customer knowledge audit](customer-assumptions-verdict-2026-10-30.md) in the selected sibling customer UI, merchant artwork-preview bridge and existing buyer metadata response. No real Shopify cart, quote, store write or deployment is included.

## What changed

The customer steps now say Artwork, Quantities and Review for every product. The UI does not classify phone cases or apparel. Option names are displayed exactly as supplied, without casing changes or invented singular/plural forms. Missing presentation metadata uses named Option choices. Swatches require explicit hex data.

Availability is required. An empty availability list offers no combinations; missing availability is invalid. The new structured Shopify adapter accepts one to three explicit option axes and retains only actual variant tuples. It never splits titles or generates a Cartesian product. Unknown, incomplete or ambiguous metadata returns an unsupported result. Canonical numeric variant IDs stay strings. GIDs, duplicate identities and conflicting cells reject at the boundary. State and commit logic derive selected variant IDs from current configured cells and reject unavailable or absent cells, including stale saved quantities.

The existing production reader already requests Shopify selectedOptions. Those exact names and values now survive an explicit `m7-config-v2` opt-in. Default strict v1 clients remain unchanged. Metadata is unknown when upstream data is missing or ambiguous, and those variants are unavailable in v2. The signed App Proxy request must include the version parameter. No extra provider calls or permission scopes were added. The [metadata record](buyer-shopify-option-metadata-2026-10-30.md) documents compatibility and bounds.

The merchant bridge now sends one supported artwork snapshot. An explicitly selected appearance resolves its assigned image and area adjustment. Overview previews use configured shared images and never choose a variant assignment by ordering. A matching unsupported payload reports an error immediately; opener, origin and nonce checks remain enforced.

Artwork-only mode hides quantity steps, prices, purchase actions and the purchase footer. Its notice explains the omitted product options and availability. The mode is enforced even through the ordinary designer entry. Phone header spacing reserves the close action without placing the scope notice behind another control.

## Sources and independent review

The changes use Shopify's exact [SelectedOption name/value fields](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/SelectedOption) and documented [three-option limit](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/productOptionsCreate). The UI review applied the installed Checklist Design modal and multi-step form guidance. The source and screen reviewers checked these changes against the existing Shopify modal ownership and frontend workflow records.

Two independent GPT-6.1 Sol reviews found no remaining material blocker in their reviewed local scope:

- [Logic and data contracts](customer-assumptions-logic-sol-review-2026-10-30.md). The review found a numeric/GID identity alias, which was corrected and regression-tested.
- [Actual customer screens](customer-assumptions-ui-sol-review-2026-10-30.md). The review found incomplete artwork-only guards, label casing and a phone-header overlap. Each was corrected and rechecked.

## Verification

Under Node 24.21.0:

- Selected customer config checks: 69 passed.
- Exact variant matrix and runtime checks: 21 passed.
- Full maintained customer browser, artwork contract and preview-launcher checks: 26 passed. The final capture-only rerun also passed after resetting the panel scroll before screenshots.
- Contracts: eight passed. Buyer production and HTTP: 18 passed independently. Nine database-backed buyer-flow cases were explicitly skipped without their database environment.
- Selected customer build, contracts build/types, merchant admin-test and HTTP-test strict types, older integration storefront build/test types and source coverage passed.
- Targeted repository Biome checks completed with three existing optional-chain suggestions in unchanged authorization/artwork checks. No style errors were reported.

Fresh rendered evidence is in `/Users/pc/Development/Insignia/.artifacts/customer-assumptions-fixes-2026-10-30/`. Exact-option, Review and artwork-only states were inspected at 1440px light, 390px dark and 320px light; ordinary apparel was also checked. The gallery leads with the revised screens and retains earlier designed states under All current states.

## Integration still required

The selected sibling customer UI remains unconnected to Shopify. Its illustrative case asset, numeric test IDs, prices and injected cart receipts are synthetic. The new adapter and v2 response provide explicit data boundaries for that connection; they do not establish real product imagery, physical calibration, pricing or a native cart mutation. Shopify continues to own product pages, cart, checkout and host completion behavior. Translation work remains plan-only.
