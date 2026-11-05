# Customer customizer handoff and admin loading

28 October 2026. Local implementation and independent review; no Shopify writes, integration or deployment.

## Correct ownership

Insignia opens as a customizer modal from a Shopify product page. Shopify owns the product page, cart, native cart feedback and checkout. The earlier local product-return/cart experiment, including the initial expansion attempted in this task, was the wrong product boundary and is removed. Its earlier reviews are superseded.

The selected sibling `designer-prototype` remains the customer design. Its former `product-return-page.tsx` and stylesheet are removed. There is no Insignia cart list, removal flow, empty-cart page, View cart route or nested cart-confirmation popup. `PreviewShell` alone injects a labelled development-only host stand-in. That stand-in is not part of the customer design gallery and explicitly says the result is simulated and no Shopify cart is changed.

A local preview add/update closes the customizer after the reducer accepts a valid completion, never merely because Add was clicked. Typed completion retains added versus updated and the saved design ID. Rejected/duplicate commits cannot navigate. Updates replace the same preview snapshot. An unchanged edit offers Done and closes without another completion. Cancel/close preserves an unfinished design and does not assert success. Reopening, editing and starting new clear the earlier completion. The local snapshot collection is test data, not Shopify cart authority.

The actual theme and application contract is in `extensions/insignia-theme/blocks/customize.liquid`, `apps/storefront/src/element.tsx`, `apps/storefront/src/customizer.tsx` and implementation-plan sections 8.1/8.4. The production integration UI is still separate from the chosen design. It already requires verified cart application before its completion event. This task does not connect or replace that adapter.

## Loading changes

Settings reserves one card with three destinations. Permissions reserves three checks and its action. Billing reserves one price/date/action card and reuses it on retry. Storefront setup reserves theme tasks and a separate product-test section. Compact and designed Methods retain their respective list/editor shapes. Existing Products/Orders table and placement workspace compositions remain intact.

Corrected measured native widths/gutters, editor cold insets, Methods mobile overflow and collapsed field heights before Polaris defines, Home’s initially invisible bars, the excessive inline minimum height, and order-detail centering/phone gutters. Static pages do not manufacture asynchronous work. Decorative placeholders remain hidden from assistive technology; small Settings routes expose one loading status.

## Additional rendering fix

The long-content pixel pass found React-style SVG attribute names surviving the native Preact migration. Actual DOM styles showed black opaque gradient stops and default 1px/butt icon strokes. [Preact’s SVG guidance](https://preactjs.com/guide/v10/differences-to-react/#svg-inside-jsx) explains that attributes are applied as written. Correct standard SVG attributes restore configured garment colours/shading and intended icon strokes. A browser regression checks computed shading and strokes; no compatibility adapter or React dependency was added.

## References and review

[Shopify SkeletonPage migration](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/skeleton-page) supports preserving the known page shell and loading only pending regions. Actual pinned Polaris 2.0 RC measurements and before/delayed/loaded captures established the geometry. [Dawn’s cart notification](https://github.com/Shopify/dawn/blob/main/snippets/cart-notification.liquid) demonstrates theme-owned cart feedback; it does not justify adding a second Insignia cart. [Vercel interface guidance](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md), Checklist Design Adding to cart/Cart/Loading, [Memorisely’s hierarchy example](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1) and [Zander Whitehurst’s context/disclosure example](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX) informed hierarchy and review. The latter two are supplementary examples, not cart integration specifications.

The independent [Sol source/pixel review](customer-handoff-loading-sol-review-2026-10-28.md) covers corrected classic/long review/edit/update, both themes and all three widths, and refreshed admin skeletons. Its initial cart-layout approval was withdrawn when the owner corrected the boundary. The final review checks the corrected boundary and appearance. A separate agent independently exercised the customer browser suite and an admin audit agent exercised loading/navigation.

## Verification

- Customer: 14 passing tests in the combined handoff-model/browser run, including all 13 scenarios, desktop/390/320, light/dark and long copy, update identity, unchanged Done, host focus, no Insignia cart, draft switching/resume/history, uploads/failure/retry/stale cancellation, unload and SVG rendering.
- Configuration/model checks: 62 passed. Selected frontend strict TypeScript and production build passed.
- Admin: 9 focused loading/navigation browser tests passed; strict test types and final Astro build passed. 84 cold/delayed/final screenshots at 1440/390/320 had no document overflow.
- Pinned 2.0 RC validation passed the loading component, Billing’s native surrounding composition and expanded Methods loading markup. Standalone validation of the whole preexisting Billing island could not resolve imported state types (`unknown`); full-project Astro/TypeScript passed. No validator-driven weakening of application types was made.
- Scoped Biome passed with the three existing CSS warnings; no errors. Diff whitespace check passed.
- Gallery: 301 states/518 images, 32 latest rows. All hosted images returned 200, no browser errors, obsolete cart/product-return IDs absent from Latest and All current states. Developer host captures remain evidence only, not customer design entries.

Durable local evidence is in `/Users/pc/Development/Insignia/.artifacts/frontend-handoff-loading-2026-10-28/`. It includes 60 customer and 84 admin captures, receipts, scripts, source hashes and logs. The gallery retains other current designs for comparison.

## Remaining integration states

No additional Insignia product/cart page is needed. When connecting the selected UI, bind it to the real adapter’s bootstrap, authorization/application busy, rejection, retry and uncertain-result recovery states. Keep the customizer open until the cart outcome is verified; an uncertain write must not close as success or be blindly repeated. Restore a design requested from Shopify’s cart using real cart identity, reconcile native quantity/removal changes, and restore focus to the actual Personalise/Edit trigger. Theme drawer refresh/opening requires a supported host adapter; `insignia-cart-updated` alone does not establish universal drawer compatibility. Shopify remains checkout authority.

These are wiring/qualification requirements, not claims that the disconnected preview currently performs Shopify operations. The loading audit identified no need for another admin page.
