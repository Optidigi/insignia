# Customer positioning V1

23 October 2026. Original non-masking admin preview on port 62168 and the existing customer visual prototype on port 5173. This implements the owner-requested frontend-first V1; no production contracts or deployed storefront changed.

## Merchant setup

The existing artwork rectangle still defines the maximum print envelope and merchant starting position. `customPlacementAllowed` remains optional and false by default. Enabling it reveals Set movement area. The merchant draws a separate image-space boundary, reviews it, and chooses Done or Cancel. It must contain the original full artwork rectangle and stay within the image. Existing decoration sizes and prices remain independent.

`movementRect` is optional in old records and independent across duplication and cross-product copies. Incomplete enabled configurations can save as drafts; local publication requires a movement area. Malformed or non-containing geometry is rejected. Existing image/alignment review rules still apply to copied configurations. No ruler is required and no garment-safe region is inferred from a photo.

The staged movement editor keeps the print rectangle as a reference. Selection and geometry editing cannot change that rectangle during this task. Escape/Cancel abandons the staged boundary; Done creates one normal history edit.

## Customer flow

The current Add artwork, placement choice, artwork library, method selection and quantities/review flow is retained. Customer positioning now happens directly on the existing product preview. The earlier positioning dialog was rejected by the owner and removed, along with its separate task CSS. There is no positioning mode, Done step or second screen.

Selecting an artwork card selects that artwork on the preview. The selected artwork can be dragged inside a subtle dashed movement boundary; other artwork remains visible. Directional buttons and keyboard arrows provide alternatives to dragging. Approved sizes and their price differences live in the same artwork card. Reset restores the merchant suggestion while retaining the selected size. Per-placement Undo restores the last size/position change without reverting artwork or method choices. A drag commits once on release; Escape, pointer cancellation and lost capture abandon that gesture. Mobile can enlarge the same inline preview without opening a dialog.

The classic example enables Left chest with Small, Medium and Large labels to demonstrate positioning without a ruler or physical measurement claim. A generic phone-case schematic tests a portrait source image, relative sizes and a conservative rectangular movement area below its camera. Photo configs need no garment classification; missing generic previews never fall back to a T-shirt. Existing scenarios retain configured centimetre labels. Size indexes still select existing scales and cent prices.

Whole artwork bounds, including aspect ratio, must fit every selected colour image used in the order. The preview maps coordinates into the fitted source-image content, excluding letterboxing. Replacement artwork retains the prior settings and invalid combinations require correction, without silent repricing or repositioning. Pending/failed image constraints prevent movement and progression. Review and local-cart editing preserve coordinates. The existing artwork chooser remains a dialog; positioning does not.

## Mapping and integration boundary

Admin `rect`/`movementRect` use `centerX`, `centerY`, `width`, `height` in 0–1 source-image units. Customer `movementArea` uses `x`, `y`, `width`, `height` in 0–100 units relative to the fitted source-image content. Their center/full-extent semantics agree, with explicit multiplication by 100 in a future adapter. These previews are separate demos, not a shared publication transport. Shopper placement data has not been added to production configuration, signed quotes, checkout acceptance, orders or production output.

## Review and verification

Three independent Luna xhigh reviews considered customer interaction, product geometry and browser validation. The redesign uses the existing frontend design language and Vercel interaction guidance. Competitor examples provide narrow interaction precedents, not a blanket quality endorsement. The owner explicitly requires selective references and direct product interaction.

The original merchant setup checks remain unchanged. Customer verification passes strict TypeScript/build, 58 config/model/geometry checks and 10 focused browser workflows at desktop/390/320px. The test file also passes scoped Biome and admin-test TypeScript checks. The browser suite checks bounded touch/pointer movement, keyboard nudges, price presets, Reset retaining size, placement-specific Undo, review/cart persistence, actual portrait image geometry, empty relative-size labels, failed selected-colour constraints, Escape cancellation and touch cancellation. These are browser simulations, not physical-device or assistive-technology qualification.

Customer browser command from the main repo, with the separate Vite preview running:

```sh
INSIGNIA_CUSTOMER_PREVIEW_ORIGIN=http://127.0.0.1:5173 node --test apps/web/test/admin/customer-positioning-preview.test.mts
```

New inline-flow screenshots are in `/Users/pc/Development/Insignia/.artifacts/customer-placement-inline/`. Earlier popup screenshots in `customer-placement-v1/` are superseded.

## Sources

- [Shopify App Home layout](https://shopify.dev/docs/apps/design/layout) and the actual theme editor informed the contextual merchant controls and task hierarchy. Public Polaris 2.0 RC contracts remain the admin control boundary.
- [Printful Design Maker transforms](https://help.printful.com/hc/en-us/articles/50264129164305-How-can-I-transform-a-design-in-the-Design-Maker) provides direct-manipulation precedent. Its broader transformation suite is outside this V1.
- [Customily movable text](https://help.customily.com/articles/6004583164-movable-text-allowing-customers-to-move-the-text) demonstrates a merchant-defined movement boundary and default. Its documented feature is text-specific, used here as a boundary-pattern reference.
- [Vercel interface guidelines](https://vercel.com/design/guidelines) informed gesture alternatives, focus, touch targets, viewport-safe actions and state clarity. The existing customer UI supplies the visual language.

- [Canva moving elements](https://www.canva.com/en_gb/help/moving-elements/) documents selecting and moving the element in place, with arrow-key adjustments. It supports this interaction choice without determining the storefront's visual design.
- [WCAG dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements) supports providing the directional-button alternative.

## Drag release correction

23 October 2026. The owner reported intermittent snap-back, possibly after leaving the movement area while holding the mouse. Normal capture across the preview/sidebar worked in native replay, but browser regression tests reproduced a rollback on unexpected pointer-capture loss. The previous handler discarded the transient center. A second regression confirmed that pointerup coordinates were ignored if no terminal pointermove arrived. A one-pixel drag also visibly moved before the two-pixel activation threshold rejected it on release.

The component now samples pointermove and pointerup through one geometry path. Motion below the activation threshold is not painted, so a click cannot show a move and then revert it. Unexpected capture loss commits the last valid visible point once. Escape and pointercancel explicitly abandon the drag. Clearing the gesture before releasing capture prevents a later pointerup/lost-capture event from committing twice.

The capture-loss and terminal-sample tests failed before this correction and pass afterward. All 14 focused customer browser checks, the strict frontend build, test-file Biome and admin-test TypeScript pass. Native browser replay verifies releasing over the sidebar retains the clamped edge position. This fixes demonstrated rollback paths; it does not establish that every possible browser interruption has been reproduced. Evidence: `/Users/pc/Development/Insignia/.artifacts/customer-placement-inline/drag-release-fixed.png`.
