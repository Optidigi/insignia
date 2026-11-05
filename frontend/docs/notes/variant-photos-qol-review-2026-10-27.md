# Variant photo editor QOL review

Reviewed 27 October 2026. I inspected the editor source and the existing 1440, 390, and 320 px captures under `/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/variant-photos/`. I also opened the published Customily option-mapping and Teeinblue mockup-grouping examples saved under `/Users/pc/Development/Insignia/.artifacts/color-variant-research-2026-10-27/`. These are vendor help-page examples, not logged-in app reviews.

I used the Shopify App Home component and content rules, Checklist Design's Table, Checkbox, Button, and Submitting a form checklists, and the Vercel Web Interface Guidelines fetched on the review date. Shopify governs native components and merchant copy. The competitor examples informed how clearly the source option and grouping scope should read; their modal and wizard layout does not fit Insignia's existing editor.

## Keep the current model

Grouping is option-driven, not hard-coded to Colour. The editor lets the merchant pick any supplied product option and add another. The model builds groups from option combinations that actually exist, so Colour + Fit can split Regular and Relaxed while all sizes in each combination share an image. The row count makes that coverage visible. This works for ordinary Colour / Size products and for products where Fit, Material, or another option changes the photographs. Keep this behavior.

Missing group images remain blank. The editor does not silently show a different colour's photograph. A merchant can explicitly assign the shared view image, and assigned photos expose an alignment review. This is the right fallback rule for accurate previews. The alignment scope and return to the shared area already appear next to the geometry controls, so extra permanent explanation would add noise.

## Changes with the clearest payoff

1. **Keep a direct path to image assignments when removing the extra bar.** The current `Variant images` button in the strip below the canvas header is the only canvas-side shortcut to the assignment list. The 320 px list itself remains readable, but users should not need to know to select a view and inspect its settings first. Put a compact `Variant images` action in the existing canvas or view header, beside the appearance selector. Preserve the direct action when removing the separate strip. See [the editor header](../../../apps/web/test/admin/support/placement-workflow-preview.tsx#L2399) and [the view settings panel](../../../apps/web/test/admin/support/placement-workflow-preview.tsx#L3023).

2. **Say that grouping applies to every view.** `groupingOptionIds` lives once on the product's `variantPhotos` setup, and `setVariantPhotoGrouping` rebuilds assignments across all views. The control currently appears as `Edit grouping` inside a view-specific section such as `Front images`. A merchant editing Front can reasonably read it as Front-only. Put the action with product-level preview controls, or label it `Edit grouping for all views`. If the action stays in the inspector, show the scope while editing. The existing option-value form can remain inline. See [the grouping form](../../../apps/web/test/admin/support/placement-variant-photo-panel.tsx#L130) and [the product-wide grouping mutation](../../../apps/web/test/admin/support/placement-variant-photos.mts#L398).

3. **Restore the last selected appearance when a merchant resumes a draft.** `activePhotoGroup` initializes to the first group every time the editor mounts. `Save draft` stores the product and its image assignments in the tab's `sessionStorage`, but it does not store this UI selection. After editing White / Relaxed on Back, saving, then reloading, the draft comes back on the first group even though the image assignments survived. Store the selected group key as product-scoped tab state and restore it only if that group still exists. This is view state, so it should stay out of the published product configuration. See [the initial selection](../../../apps/web/test/admin/support/placement-workflow-preview.tsx#L190), [draft save](../../../apps/web/test/admin/support/placement-workflow-preview.tsx#L1634), and [the existing reload assertion](../../../apps/web/test/admin/placement-variant-photos-browser.test.mts#L191). That assertion checks saved assignments, not which appearance the canvas restores.

4. **Make explicit shared-image assignment easier to spot.** `Use shared image` appears only after one or more group checkboxes are selected. In the first-use state, a row shows `Add`, while a merchant who wants that group to use the base photo has to discover checkbox selection first. Consider exposing `Use shared image` on an unassigned row or in a compact row action menu. Keep it explicit and unavailable when there is no shared photo. Do not add automatic fallback. See [the bulk actions](../../../apps/web/test/admin/support/placement-variant-photo-panel.tsx#L233) and [the row action](../../../apps/web/test/admin/support/placement-variant-photo-panel.tsx#L329).

The first three items are the strongest fixes. The fourth is a smaller discoverability improvement; at 320 px, the row already has assignment and alignment actions, so add it only if it fits without squeezing those controls.

## Real merchant cases

- A T-shirt merchant has Colour = Black / White / Navy and Size = S–XL. They can group by Colour and map one photograph per view for each colour. The covered variant count explains that each image includes four sizes.
- The same merchant offers Regular and Relaxed fits with different photography. They can group by Colour + Fit. Insignia creates only combinations that exist in Shopify and keeps each combination's sizes together.
- An operator returns later to adjust the Navy Back photo. The saved assignment survives, but the current editor opens on its first group. Restoring the selected appearance reduces the chance of editing a different group's alignment by mistake.
- A first-time merchant wants White to reuse the shared Back photo. The current behavior is safe, but the shared-image action is behind a row checkbox. A direct explicit action would make the intended inheritance easier to find.

## Evidence and limits

The editor's grouping action updates the local product draft through `setProduct`; `Save draft` validates and writes that draft to tab-local storage. The existing browser workflow confirms that group assignments persist through save and reload, and that group alignment edits remain separate from shared geometry. No Shopify catalog or production configuration write occurred during this review.

The captures show the option selector, view assignment list, shared-image action, group alignment review, and narrow layouts. The earlier independent flow review exercised assignment, save/reload, missing-image recovery, and keyboard selection. This audit did not rerun the app. Native Shopify appearance and owner acceptance remain unobserved.

References: [colour variant design direction](color-variant-design-direction-2026-10-27.md), [competitor evidence](color-competitor-research-2026-10-27.md), [Shopify App Home resource list pattern](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/compositions/resource-list), [Customily option mapping](https://help.customily.com/articles/7057019054), [Teeinblue variant assignment](https://support.teeinblue.com/en/article/assign-variants-to-mockup-13wqtx6/), [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).
