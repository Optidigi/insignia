# Frontend recovery independent pixel review

Reviewed the rendered recovery captures and affected source on 28 October 2026. No application files changed, no build or tests ran, no shared browser was used, and no provider action occurred during this review.

The merchant changes improve task continuity without adding explanatory clutter. The saved-setup warning offers a real authenticated reload and a safe exit. The storefront handoff retains the product identity and test-task anchor while still requiring a native selection and a current authenticated publication check. The buyer warning makes a previously indirect recovery task discoverable. One buyer focus regression was identified and sent to the implementation agent; its correction remains separately recorded below.

## References and direct comparison

Read AGENTS.md, the project UI delivery skill, admin UI guidance, and implementation-plan sections 6.3, 7.1–7.4 and 8.1–8.4. Read the installed Shopify skill and App Home reference; the app pins `polaris-2.0-rc.js` and `@shopify/polaris-types` `2.0.0-rc.3`. A version-targeted toolkit search returned the official [Banner](https://shopify.dev/docs/api/app-home/v2.0/web-components/feedback-and-status-indicators/banner) contract and warning example: contextual warning heading, consequence and secondary recovery actions. This supports the merchant warning composition. The buyer remains its separate Shadow DOM surface.

Inspected the actual before image `/tmp/insignia-recovery-before.png`, then every image in `/tmp/insignia-recovery-merchant-captures`: `unsupported-setup`, `storefront-editor-product-confirmation`, `storefront-test-return-confirmation` and `storefront-verified-product`, each at 1440, 390 and 320 px. The before page uses a centered roughly 784 px column, Published theme card, then a separate customer-test card. Final screenshots preserve that hierarchy, card width, density and roughly 16 px content insets. The added manual-check banner reflects a different fixture state; it does not turn the test task into a new page layout. Confirmation replaces the generic chooser sentence with one short sentence and one button. The verified state gives product identity and publication status, followed by a distinct preview action and two test steps. At 320 px all of these wrap within the cards and actions stack without clipped labels. The visible focus outline on the confirmation region is useful evidence of destination focus, rather than a permanent decorative border.

The unsupported warning uses 16 px page and content insets, readable line lengths on phones and two reachable actions. There is no create, save, publish or reset control. Its captures omit the host title bar and are an isolated warning state, so they establish banner composition rather than a complete embedded page.

Inspected `/tmp/insignia-cart-repair-captures/cart-needs-review-{1440,390,320}.png`, plus `cart-review-pending-320.png`, `cart-review-error-320.png` and `cart-review-ready-320.png`. The buyer warning sits at the top of task content, uses 16 px inner padding and keeps its action within the 288 px content width at 320. Its title wraps to two lines there, with clear title/body/action spacing. Pending copy changes to Reviewing and a live status explains that prices are being checked. Failure retains the warning and review action. A proposal retains the warning until the actual cart has been verified; it does not claim repair merely because prices loaded. The existing fixed footer remains usable and the content remains scrollable.

## Checklist Design audit

Used the installed [Banner](https://www.checklist.design/design-system/banner), [Loading](https://www.checklist.design/design-system/loading) and [Cart](https://www.checklist.design/website/cart) references. The Cart checklist applies only to this customized-subset review; Shopify's ordinary cart and checkout retain payment and promotion controls.

| Status | Banner item | Observation |
|---|---|---|
| Present | Style — How the banner types look (fill, text colour, border radius etc) | Merchant uses native Polaris warning; buyer warning is distinct and readable. |
| Present | Content — A title is a must but you can consider a description if you feel a title does not convey enough information | Both warnings identify the problem and give the next action. |
| Present | Types — Banners typically appear as 5 options: information, success, warning, error, neutral. This helps visually establish context and level of importance. | Warning is appropriate for unresolved setup/cart state. |
| Present | Call to action button — A banner may call for the user to do something, like fix the error it is calling out, or viewing the successful outcome of an event. | Reload and saved-design review perform the stated recovery. |
| Present | Placement — Where the banner sits on the page, dependent on context and importance | Warnings precede the affected task. |
| Present | Dismissable — Whether the banner can be dismissed. Positive/neutral banners (info and success) would suit this, but not warning/error banners as they are too critical. | No dismiss action hides unresolved recovery. |

| Status | Loading item | Observation |
|---|---|---|
| Present | Visual indicator — A clear representation that content is loading or in progress of change | Buyer changes action copy; merchant reload replaces the warning with the existing skeleton. |
| Present | Text — Explaining the loading state | Buyer says Reviewing current prices; route skeleton retains its accessible label. |
| Present | Time — Determine how long the time between two actions must be to require a loading component | Pending UI is tied to the actual request, not a fake completion timer. |
| Present | Accessibility — Ensure your loading state can be clearly seen | Buyer live region and merchant labeled skeleton exist in source. Focus correction is recorded separately. |
| Not needed | Visuals — Entertain the user with an illustration during the loading state | Brief recovery work needs status, not decorative imagery. |

| Status | Cart item | Observation |
|---|---|---|
| Outside this change | Item name and image — Each item shown with its name and image, matching what was displayed on the product page. | Existing design summary is unchanged; captures do not qualify all variant imagery. |
| Present | Update or remove item — The ability to adjust quantity, change variants, or remove an item directly from the cart. | Retained design selector and explicit removal remain available. |
| Outside this change | Item variations — Selected variants for each item — size, colour, style, or type — displayed clearly alongside the item. | Existing configuration controls retain these choices; this review does not approve the whole cart summary. |
| Not needed | Promo or discount code — A text field for entering a promo, discount, or coupon code. | Owned by Shopify cart/checkout. |
| Not needed | Accepted payment methods — The payment methods available for completing the purchase — cards, PayPal, Apple Pay, and others. | This action applies customized items; payment happens later. |
| Outside this change | Link to support — A way to get help with items in the cart — particularly useful for products with configurable options or custom orders. | Support is not added by this bounded recovery change. |
| Not needed | Checkout button — A prominent button to proceed to payment when the user is ready to complete their order. | Buyer must accept and apply the proposal before proceeding to the ordinary cart. |
| Not needed | Suggested add-ons — Related or complementary items suggested based on what is already in the cart. | Unrelated to recovery. |

## Source and interaction assessment

`StorefrontProductTest` does not treat the URL identity as product data or authority. It validates the numeric ID, suppresses a conflicting cache, preselects the native picker, preserves the request when selection is cancelled and consumes it after a valid selection. A fresh config response must match the selected ID before preview eligibility appears. Failure never leaves an old preview link usable. `productEditorReturnPath` permits only the storefront task with its strict product parameter and anchor, or the established product-list return paths. No arbitrary return URL is accepted.

The unsupported setup action runs the existing fresh-session workflow read. It does not mutate, replace or invent the stored draft. Source and focused browser assertions cover loading feedback, absent write controls, no write requests and focus after editable data returns. Those assertions were read, not rerun here. Merchant browser assertions also cover stale cached choices, picker cancellation, authenticated recheck and return-path continuity.

The cart notice does not bypass proposal acceptance or cart verification. `cartRepairRequired` remains until verified application/removal. The action remains available after a failed review. Pending feedback has `role=status`/`aria-live=polite`; errors have `role=alert`.

## Finding sent for correction

The existing wizard-focus effect selected the first visible `section h3`. Adding the persistent warning before the wizard makes that selector choose Your customized cart needs review after successful saved-design review, rather than Complete customized cart review. This obscures the task transition for keyboard users and scrolls a narrow view to the wrong heading. Root passed the finding to the implementation agent for an active-step target and public focus regression. The initial captures above precede that correction. No material merchant visual or source finding remains in this scope.

These are local rendered and source observations. They do not establish native Shopify picker execution, embedded host appearance, provider outcomes, owner acceptance, deployment or release approval.

## Cart correction review

Read the reproductions in `/tmp/insignia-cart-repair-sol-followup-red.log`: the review-heading focus assertion timed out; an external quantity edit produced 3 rather than 5 garments; and external removal reintroduced product 111 alongside retained product 333. The stale-array finding came from the other independent reviewer and was corroborated by these public browser failures.

Reviewed the corrected source. `review` receives an explicit complete/saved/remove-design intent and resolves its groups only after the latest cart read and server restoration. Saved review therefore uses the latest restored quantities and omissions. An empty saved subset gets an actionable error instead of a fabricated proposal. Existing active-design fingerprint checks still reject external change while editing. The focus effect now selects the direct active wizard heading or direct price-review heading, excluding the warning, and reacts to proposal and product changes as well as the step. Fresh authenticated `repairRequired` observations may also clear obsolete guidance; verified apply/removal are not the only legitimate way to learn the current cart is healthy.

Reopened the refreshed `cart-review-ready-320.png`. The corrected focus wiring introduces no visual layout change: warning, design chooser, review summary and fixed footer still fit. The in-progress green browser log records the direct saved-design/focus case passing. Final regression totals remain the implementation agent/root's responsibility; this review does not infer a complete pass from a partial log. No remaining material source or pixel finding in the corrected recovery scope.

## Final preview-host framing check

Inspected `/tmp/insignia-recovery-merchant-captures/unsupported-host-1440.png`, `unsupported-host-390.png` and `unsupported-host-320.png` after the earlier isolated-content captures. Root generated these with the existing preview host and real persisted editor component, using a synthetic authenticated read whose saved pricing is invalid. No additional tests or provider activity ran for this check.

The host title/back control remains visible above the recovery content. Desktop retains its Settings action; narrow captures retain the existing overflow action. The warning starts below that header with clear separation, 16 px outer insets and 16 px content padding. Its warning glyph is now fully rendered. The full-width desktop treatment belongs to the editor's page-wide supplemental region; the centered small-column reference remains the Storefront setup composition, not a reason to narrow the editor warning. At 390 and 320 px the body wraps to three lines, the Reload setup and Back to products actions fit on one row, and neither header nor warning clips. There is no stranded editor footer or save/publication action beneath unavailable data. The whitespace correctly reflects that the saved draft cannot be opened.

This closes the local preview-host framing gap. No new material visual finding. These captures still use the local host and synthetic reads; native embedded Shopify appearance and provider behavior remain unqualified.
