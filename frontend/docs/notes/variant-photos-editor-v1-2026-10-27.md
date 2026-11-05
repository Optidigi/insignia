# Variant images in the product editor

Implemented 27 October 2026 as a local frontend design in the existing view/canvas/placement workspace. No production configuration contract, inventory, pricing, purchase history, Shopify media or permissions changed.

## Presentation and interaction

The canvas has a labelled appearance selector using the product's option names. Changing its value changes the photo without changing the shared edit scope. Front, Back and the existing placement outline remain intact, including colour-matched view thumbnails.

The selected view's settings contain one inline image-assignment list. Its heading names the owning view, such as Front images or Back images, so the context survives phone scrolling. The shared base photo is explicitly edited with Change shared image. Rows show the group, covered variant count, thumbnail and missing/review/error state. Bulk selection opens the existing media picker rather than another assignment editor. The picker names the selected groups and variant count; its scope remains visible on a short phone while the gallery scrolls.

The grouping control starts with one actual product option, then reveals another only when requested. Exact option combinations come from the supplied variants. Colour + Fit demonstrates a second appearance option; garment Size can remain independent. Grouping changes preserve compatible photo assignments, require review where scope broadens, and leave conflicting merges unresolved.

Artwork areas stay shared until the merchant chooses Adjust for the selected group. An exception is labelled beside the fields and can return to the shared area. Numeric edits, drawing, Undo/Redo and local save preserve the shared base. Movement rectangles follow the photo alignment transform and must remain inside the image. A different photo does not reuse stale image calibration or change manufacturing dimensions, methods or prices.

Missing images remain blank, with a route to the correct assignment. Assigned photos require alignment review after replacement. On phones, Review opens the existing canvas with its Confirm alignment action. Failed loads expose Retry and Change, preserve the assignment, and block publication while the failure is observed. Confirm alignment requires a loaded image.

Incomplete mappings remain saveable as drafts. Local publication reports view/group-specific coverage and alignment issues and links back to the owning controls. Saved and published snapshots are separate. Existing products without optional variant metadata keep their prior behavior.

## States and delivery

The review gallery leads with 15 captured states: Black and White canvases, view image assignments, bulk selection, scoped media picker, first-setup assignment, alignment review, Colour + Fit grouping, grouping controls, missing Back, publication recovery, group area editing, image-load failure/recovery and large-list keyboard selection. There are 41 saved desktop/phone/short-phone PNGs for this slice. The global gallery contains 183 states and 363 desktop/phone images; its standard reader does not count the additional narrow captures.

Live entry: `/admin/products/15464675246464/config?__variant_example=variant-photos&variantImages=1`. Other explicit scenario values are variant-unassigned, variant-missing, variant-fit, variant-review, variant-alignment, variant-many and variant-image-error. The local demo footer exposes them; these are synthetic assignments, not imported Shopify inventory. Fit groups reuse the existing colour photographs to test grouping/layout and do not pretend to show separate fit photography.

The existing customer-preview bridge opens the currently selected appearance as a self-contained snapshot with the resolved images and areas. It does not yet expose the entire merchant variant catalog as a buyer quantity matrix. Real Shopify option identities, grouped persistence, large-catalog capacity and full buyer integration remain later integration work, as recorded in the [design direction](color-variant-design-direction-2026-10-27.md).

## References and review

The [research decision](color-variant-design-direction-2026-10-27.md) records the primary competitors, inspected published interface screenshots and Shopify guidance. This implementation uses the grouped-thumbnail and bulk-selection mechanisms without copying competitor wizard/modal structures. It keeps the existing owner-reviewed editor. Checklist Design's Table, Checkbox, Button, media upload and form recovery checks informed the states; Shopify governs Polaris components and copy. Vercel, Memorisely and Zander remain supplementary hierarchy, focus and disclosure guidance.

Two independent GPT-6.1 Sol medium reviews inspected actual 1440×1000, 390×844 and 320×568 captures. [Visual review](variant-photos-sol-visual-review-2026-10-27.md) and [interaction and flow review](variant-photos-sol-flow-review-2026-10-27.md) record their evidence and limits.

Corrections before handoff included a blank canvas from an unsupported local image URL, lost view context in scrolled phone lists, ambiguous shared-image action copy, bulk target names disappearing during short-phone scrolling, and discoverability of alignment review on phones. The asset correction reuses the existing reserved HTTPS preview origin/service worker; production renderer URL restrictions were not relaxed.

## Verification

- Thirteen new model checks cover exact/sparse groups, references, intentional shared images, missing mappings, regrouping, preserved exceptions, movement containment and pruning. The final focused unit/regression command passed 42 checks across this model, publication, storage, history and setup copy; the model agent separately checked the existing workflow model regressions.
- The focused browser workflow passed at all three widths. It compares the actual Black/White canvases, exercises scoped bulk assignment, save/reload, grouping, missing-image publication and recovery links, group geometry Undo/Redo, keyboard search/selection, image-load failure and recovery. It asserts that bulk target context remains visible after image selection at 320 px.
- Strict admin TypeScript, scoped Biome, web check/build and pinned Polaris 2.0-rc validation pass. Type validation establishes supported components; actual pixels and actions were reviewed separately.

This is ready for owner review in the local preview. It is not deployment, native Shopify acceptance, final customer usability testing or production release approval.
