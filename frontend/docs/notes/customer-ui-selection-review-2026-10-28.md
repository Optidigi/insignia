# Customer UI selection and recovery action review

28 October 2026. Independent review of the owner's correction. No application files changed, browser sessions opened, builds or tests run, or provider actions performed by this reviewer. This note is the only file written.

No material finding remains in the released captures and gallery inventory. The review requested three missing light edit captures before closing; those were supplied and inspected.

## Customer UI and status boundary

The approved customer UI comes from `/Users/pc/Development/Insignia/designer-prototype`, using native Preact and its existing light/dark themes. The production integration UI in `apps/storefront` is a different implementation. Its earlier recovery captures did not establish the appearance of the approved UI and should not have been presented as that design.

Read the prototype README, entry point, designer state and product-return presentation. Its cart and product-return flows are in-memory demonstrations. `cart-needs-review` describes integration status observed from the server, not a new customer page. That status is not connected to this prototype now. There is no basis for adding a fabricated repair warning or quote-expiry behavior to the approved design. The existing `recovery-expired` reducer event only retires the six-second Undo notice; admin preview expiry belongs to the separate preview-session contract.

Inspected all 18 released images in `/tmp/insignia-approved-customer-captures/`. They cover `designed-cart-{light,dark}`, `designed-product-cart-{light,dark}` and `designed-cart-edit-{light,dark}`, each at 1440, 390 and 320 px. `evidence.json` identifies the sibling prototype source, classic scenario, both themes and three widths, with no recorded capture errors.

The added-to-cart dialog keeps its existing centered composition, summary, return action and secondary design actions. At 320 px the item count and placement summary wrap without losing the amount or actions. The product-return page retains the garment photo, base price, saved design quantities, amount and Edit action. Edit stays on the amount row at narrow widths. Both edit themes retain the selected quantity, focus outline, three-item total and Review action without clipping. These are the designed flows, with no new repair banner, status page or expiry claim.

## Merchant recovery composition

Read AGENTS, the saved UI delivery workflow, its observed-failures reference, admin UI guidance, affected specification sections and previous recovery receipts. The selected runtime remains `polaris-2.0-rc.js`, with types `2.0.0-rc.3`. Read the Shopify App Home reference and official versioned [Stack](https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/layout-and-structure/stack) and [Banner](https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/feedback-and-status-indicators/banner) contracts. The Stack contract identifies `alignItems` as the perpendicular alignment control for an inline stack. Checklist Design's bundled [Banner](https://www.checklist.design/design-system/banner) and [Button](https://www.checklist.design/design-system/button) references supplied the placement, actionable copy and consistent control-treatment checks.

The unavailable-setup action row now uses `alignItems="center"` and a native tertiary navigation button beside Reload setup. Inspected `/tmp/insignia-ui-correction-merchant/unsupported-host-{1440,390,320}.png` and `alignment.json`. Both controls are 28 px tall, share the same y position and have a measured center difference of 0 px at every width. The warning glyph, host title/back control and narrow overflow action render correctly. Text and actions fit inside the 320 px layout. The earlier isolated-content captures have an incompletely loaded warning glyph; the final host captures resolve that artifact.

Read the updated browser assertion and its passing one-test log. It checks recovery action centers within 1 px, no horizontal overflow, truthful loading and retained recovery behavior. Read the separate nine-pass designer browser log, which identifies the correct prototype source and an isolated Vite origin. These are implementation-run results, not tests independently rerun here.

## Gallery inventory

Read the final generator, generated `index.html`, `all-popups.json` and gallery log under `/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/`. The inventory contains 281 states and 488 screenshots. All referenced images exist.

The generator excludes `surface: integration-check` and legacy `recovery-cart-*` entries before generating either the HTML or JSON. This exclusion applies to All current states as well as Latest changes. The final inventory has zero matching integration records, and the HTML contains no legacy recovery-cart identifiers or image references. The 12 approved customer inventory rows contain all 18 reviewed images; each copied image's SHA-256 matches its released capture. The gallery explanation states that Shopify cart integration is not connected yet and identifies the local customer cart, product-return and edit flows.

Merchant artwork-preview coverage remains classified as merchant preview. It does not establish customer-cart design acceptance. Local rendered evidence, browser regression results, native embedded Shopify qualification, owner acceptance and deployment remain separate.
