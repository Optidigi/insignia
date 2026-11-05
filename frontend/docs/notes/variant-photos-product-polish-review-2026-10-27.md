# Variant photo workflow product polish review

27 October 2026. Independent review of the local editor and its current model. This review does not change production catalog, inventory, pricing, purchase history, or Shopify media.

## Assessment

The image model fits ordinary apparel and other products whose variants change appearance but keep the same production setup. It groups exact catalog combinations, can share a view image deliberately, keeps photo alignment exceptions separate from shared geometry, and blocks publication for missing or unreviewed images. The current tree also places the appearance selector in the existing canvas toolbar, so it no longer needs a separate full-width row.

The remaining work is mostly recovery and continuity. Regrouping can leave a formerly assigned group without an image without showing the impact first. Canvas and thumbnail image failures do not share row state, and the Retry control is only exercised for the thumbnail. The selected appearance returns to the first group after reload even though the draft assignments persist.

## Findings

### 1. Explain conflicting regrouping before applying it

`setVariantPhotoGrouping` preserves an assignment when every old group contributing to a new group has the same image, shared-image choice, and placement rectangles. If those inputs conflict, it leaves the new group unassigned. The panel applies that change immediately and shows `Image needed` afterward. Publication blocks until the group is fixed, but the merchant gets no impact summary before the existing mappings leave the working draft. See `apps/web/test/admin/support/placement-variant-photos.mts` and `apps/web/test/admin/support/placement-variant-photo-panel.tsx`.

Add a small pre-apply summary for merges that lose an assignment, such as "2 image groups will need a new image for Front." Keep the current safe behavior that never chooses a winning photo. Let merchants cancel the regrouping or apply it and resolve the visible missing row.

### 2. Drive row error state and Retry from the same image-load result

The canvas reports failed URLs to `PlacementEditor`, which blocks publication. The image panel keeps a separate local `failedImages` list and does not receive the editor's failed URLs. A canvas failure can therefore block publication before its row shows `Image unavailable` or a Retry action. The row's Retry increments the thumbnail key only; the canvas renderer has no explicit retry generation or callback. The browser workflow verifies the unavailable badge, publication block, and Change recovery, but does not click Retry. See `apps/web/test/admin/support/placement-workflow-preview.tsx`, `placement-variant-photo-panel.tsx`, and `apps/web/test/admin/placement-variant-photos-browser.test.mts`.

Use one status per resolved image URL for both canvas and thumbnails. A Retry action should restart the canvas request and thumbnail, clear the publish block only after a successful current load, and keep the unavailable state after another failure. Add a browser check for both successful retry and retry failure.

### 3. Resume the last reviewed view and appearance

Draft save stores the image assignments, but `viewId`, `activePhotoGroup`, and panel search are editor state. `activePhotoGroup` starts at the first group on every mount. After a reload, a merchant reviewing a later colour or fit must navigate back to it. Applying a new grouping also calls `onSelectGroup(null)`, which switches the canvas to the explicitly labelled Shared image instead of a group in the new mapping. Select the first valid group after regrouping, then persist the last view and group as a per-product editor preference or URL state. The selected group should continue to carry across Front/Back in the current session. Do not add these preferences to the published configuration. See `placement-workflow-preview.tsx:130-160,190-192` and `placement-variant-photo-panel.tsx:115-121`.

### 4. Bulk assignment reuses one image across groups, not a prepared set

The panel supports selecting groups and assigning one image to all of them. That works for deliberate sharing. When each colour has its own actual photograph, the picker is single-select in this flow, so the merchant still chooses one photo for each group and view. For six colours and four photographed views, that is 24 unique image choices. Keep the current scoped list for small and medium catalogs. If merchants regularly bring a complete labelled photo set, the next useful improvement is a per-view mapping pass that lets them assign one distinct image to each exact group in one place, with every target visible before apply. Do not auto-match based only on color names or filenames.

### 5. Treat catalog refresh as a later integration requirement

Groups are generated from the option values and variants already stored in `variantPhotos`. If those inputs are refreshed, a new size in an existing appearance group naturally inherits that group's photo, while a new appearance value creates an unmapped group. But the local preview reads the saved product over the newly fetched product, except for the title, so it cannot test a changed source catalog yet. This is not a frontend-only correction. The catalog integration must merge fresh stable option/value identities with saved assignments, flag new appearance groups for review, and preserve prior published snapshots. See `placement-workflow-preview.tsx` around the preview-data load and `docs/delivery/notes/color-variant-design-direction-2026-10-27.md`.

## Merchant cases

| Merchant case | Current fit | Boundary |
| --- | --- | --- |
| Apparel, Colour + Size | Group by Colour; sizes share each view image. | New catalog sizes need the refresh behavior above. |
| Apparel, Colour + Fit | Group by both when fit changes the photo. Exact existing combinations become groups; sizes stay collapsed. | Fit changes to physical print support still need production-level option rules. |
| Patterned fabric | Assign actual photographs by the pattern option. The model does not tint arbitrary photos. | Current UI displays text labels and assigned photo thumbnails, not image swatches for the option selector. |
| Caps, bags, aprons, and phone cases | Group by any appearance options such as Model + Finish. Photo-specific artwork alignment can differ. | Different print sides or physical limits are not encoded by photo assignments. |
| Mugs, 11 oz + 15 oz | Capacity can group images when the silhouette changes. | Shared methods, physical print sizes, and prices remain the same across the product. Separate or unsupported production configurations need a later contract change. |
| One offered variant | A one-group assignment is valid; an ungrouped product keeps the shared-image path. | No special product-builder mode is needed. |

The model handles sparse combinations without inventing missing Finish/Material pairs. A synthetic tumbler regression covers that case, shared Back imagery, a front alignment exception, opaque variant IDs, and grouping by Capacity.

## Behaviors already covered

- A group is explicit about using the shared image; an absent assignment stays missing rather than falling back to another colour.
- Bulk selection can assign a shared view image or one selected media image to several exact groups.
- Search appears for more than eight groups, filters group labels, and selection applies to visible results.
- Changing an image requires alignment review. A review cannot be confirmed until the image loads, and publication reports missing coverage and review issues by view and group.
- Grouping by Colour + Fit preserves compatible assignments with review required. Merging conflicting images does not silently choose one.
- The view-copy model now carries source group mappings to the cloned view and remaps photo-specific placement rectangles to the cloned placement IDs. It keeps the source review state because cloning preserves the same photo and geometry; replacing the image raises review again.
- Pattern, finish, and material remain actual product photos. An optional hex swatch is not treated as a measurement or a substitute for those photos.

## Verification

The focused model run passed 38 checks across variant photos and placement-view cloning. The clone regression failed before the fix because the cloned variant resolved as missing, then passed after the model copied its group assignments. Biome and `git diff --check` also passed on the changed model and test files. The saved browser workflow covers desktop, mobile, and 320 px states, bulk assignment, missing images, alignment review, search, and publication recovery. It does not currently exercise the Retry click or a refreshed Shopify catalog.

This is local preview evidence. It does not establish live Shopify catalog synchronization, production-specific variant support, native Shopify acceptance, or final owner acceptance.
