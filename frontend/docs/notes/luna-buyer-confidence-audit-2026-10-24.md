# Buyer price and configuration confidence audit

24 October 2026. I walked the buyer's product setup, decoration choices, quantities, and review to see whether the visible price stayed understandable as the design changed. I found no actionable buyer-confidence defect in the scenarios exercised.

## Findings

None from this pass. In the tested T-shirt fixture, placement, decoration size, method, and quantity changes updated the visible unit price and order total. The Review step exposed the selected artwork, method and size, colour/size quantities, an expandable price breakdown, and the total. Editing, removing, and undoing a placement recalculated the figures consistently.

## Walkthrough and evidence

I started with the six-colour Classic cotton T-shirt in the isolated local buyer preview. Adding Left chest opened a grouped position chooser with the available positions and their starting prices. On the setup card, Small was the default; Medium added €2.50 and Large added €5.00. Switching from Print to Embroidery added €4.00. The card and persistent footer updated together: the Left chest price moved from €7.50 to €10.00 for Medium, then to €14.00 for Embroidery, and the per-item amount moved from €17.45 to €23.95 including the €9.95 garment base. Selecting Black changed the garment image without changing this fixture's price.

The sequence was Add artwork, choose a position, choose artwork and decoration options, enter garment quantities, then Review. Adding a second placement repeated only that placement's choices; quantity entry and Review remained shared. I also pressed Choose sizes while both positions still needed an artwork decision. The validation message named each position and said what to do. After choosing sample artwork and Artwork to follow, the flow continued.

Adding Centre back offered 15 cm, 21 cm (+€2.50), and 28 cm (+€5.00). In a fresh default-price run, I used the North outdoor club sample on Left chest and chose Artwork to follow for Centre back. The Review step named each position, method, size, and artwork state. It also showed “Artwork required before production” and a preview-variation note. The collapsed “Price per item” row showed €32.45; opening it exposed Item €9.95, Left chest €7.50, and Centre back €15.00. I set White M to 2 and Black M to 1. The footer changed to 3 items and €97.35.

From Review, I edited Centre back and chose 21 cm. The unit amount rose by €2.50 and the three-item total changed to €104.85. Removing Centre back changed the unit amount to €17.45 and the total to €52.35; Undo restored the placement, its 21 cm choice, and €104.85. In the artwork preview, moving the sample right enabled Undo position change; Reset position returned it to its initial placement. Movement did not change price. I did not select Add to cart.

On an emulated 390 × 844 phone viewport, the position chooser fit in the view. The artwork card scrolled beneath the garment preview while the price and next-step footer stayed visible. Changing Left chest to Medium updated the displayed amount. I observed no horizontal overflow in the states inspected. The preview-enlargement control changed to its pressed “Reduce preview” state, but the follow-up screenshot/snapshot stalled, so I did not assess the enlarged state further.

The implementation locations corroborate the observed presentation: placement artwork and pricing controls are in [designer.tsx](../../../../designer-prototype/src/designer.tsx#L1253), the persistent footer is at [designer.tsx](../../../../designer-prototype/src/designer.tsx#L1691), and the price disclosure, “Artwork required before production” note, and preview disclaimer are in [review-panel.tsx](../../../../designer-prototype/src/review-panel.tsx#L137). The sibling prototype's [README](../../../../designer-prototype/README.md#L41) documents the same buyer sequence and its local-only boundary.

## Scope and limits

The buyer page at `http://127.0.0.1:5173/` was served by the separate sibling `designer-prototype` project, not the production storefront bundle. I used new isolated in-app-browser tabs; I did not change the owner's Chrome tabs, reset the shared demo, reload the draft, or submit Add to cart, checkout, payment, or an order. The product state and totals were local to this preview. Its README says the preview has no persisted draft, real upload service, Shopify cart mutation, checkout, payment, or order creation. Its fixture documentation says colours and garment sizes share the demo unit price, and its dimensions and placement geometry are illustrative. These results therefore do not establish live variant pricing, a Shopify quote, tax/shipping treatment, physical print calibration, or production availability. See the [prototype limits](../../../../designer-prototype/README.md#L47) and [fixture pricing notes](../../../../designer-prototype/SCENARIOS.md#L58).

This complements the earlier Orders/buyer handoff review with a direct product-configuration walkthrough. I did not re-audit Orders or claim that the merchant preview, customer preview, and live Shopify storefront are integrated. The [storefront specification](../../architecture/implementation-plan.md#L421) treats browser price previews as non-authoritative and calls for a backend proposal in the production review flow.

## Principles checked

Shopify's [content guidance](https://shopify.dev/docs/apps/design/content) calls for plain, consistent terms, task-focused steps, and enough information for a user to decide. Its [layout guidance](https://shopify.dev/docs/apps/design/layout) calls for responsive layout and information density that suits the task. Memorisely's [visual hierarchy walkthrough](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1) discusses grouping and prioritizing content, then using size, color, and proximity to show relationships. Zander Whitehurst's [progressive-disclosure post](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX) discusses revealing detail in layers while keeping relevant information easy to find.

Checklist Design's [public index](https://www.checklist.design/) exposes checklists for modal, input, multi-step-form, media-upload, and add-to-cart patterns. Its [checkout checklist](https://www.checklist.design/web-app/checkout) calls for a clear order summary, a visible total, and a final review. I used these as review prompts. The buyer preview's Review is not a checkout, and I did not test checkout or claim those transaction states are implemented.

These sources helped frame the review; they do not prescribe a single layout or prove the local preview's behavior is production-ready.
