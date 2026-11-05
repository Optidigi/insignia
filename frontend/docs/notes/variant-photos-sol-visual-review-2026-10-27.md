# Variant photos: independent visual review

27 October 2026. Sol reviewer. Reviewed actual local browser captures, using the Insignia UI delivery workflow and Checklist Design's Table, Checkbox, Uploading media and Submitting a form checklists as critique lenses. This is a visual review of the local preview. It is not owner acceptance, native Shopify observation or release approval.

## Evidence and comparison

Read `AGENTS.md`, the admin UI guidance, colour variant design direction, installed Shopify App Home guidance, and the panel, workspace and variant-photo model sources. Inspected the published Customily matching and Teeinblue grouped-assignment reference images under `/Users/pc/Development/Insignia/.artifacts/color-variant-research-2026-10-27/`.

Customily makes option/value mapping explicit. Teeinblue groups thumbnail rows with covered variants and scoped bulk assignment. Insignia uses those mechanisms within its existing view/canvas/settings workspace. It does not copy the vendor wizard or place a second editor inside the media modal. This is the appropriate composition for the requested direction.

Inspected all 26 initial fresh captures at 1440, 390 and 320 px, including normal panel, bulk selection, media picker, assignment alignment, missing image, publication recovery, Colour + Fit grouping and grouping editing. Desktop also included group-specific alignment and the searchable many-group state. The garment photographs were loaded in this set.

Capture root: `/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/variant-photos/`. Rechecked corrected desktop panel/picker, 390 panel/alignment, 320 panel/Fit/missing/picker, and the added 320 failed-image/publication-recovery/alignment-canvas captures.

## Findings and correction

One material finding was raised during review. At 320 px, scrolling the properties pane hid the owning Front or Back header. The remaining generic `Variant images` heading did not identify which view the assignments affected. The corrected headings are `Front images` and `Back images`. They remain visible beside the rows in the corrected narrow captures. Finding closed.

The base-image action originally said `Change image` beside a black shared thumbnail while White was selected on the canvas. The corrected `Change shared image` label makes that scope explicit. The media picker also now names `Black, White · 8 variants` above the media list on desktop; its submit action retains the two-group scope at 320 px.

No material visual defects remain in the reviewed states. The new rows have consistent insets, readable labels, thumbnails, counts and padded actions at all three widths. Bulk controls do not squeeze or overlap the list. The Colour + Fit names wrap within their row. The desktop search-state checkbox has an intact visible focus ring. No repeated section-heading stack or assignment-modal maze was introduced.

## State distinctions observed

- Front and Back remain views. Colour and Colour / Fit are separate preview choices above the canvas.
- The missing Black Back state shows an empty canvas, an `Image needed` row and an explicit Black Back publication issue. White photography is not substituted.
- Shared artwork area and `Alignment for Black` are separate scopes beside the geometry controls. `Use shared area` gives the exception a clear return path. Decoration sizes and methods remain separate sections.
- Newly assigned media has a `Check alignment` status. The corrected phone row includes `Review`, and the narrow canvas capture shows Black, Front and `Confirm alignment` together.
- The failed-image state shows `Image unavailable`, `Retry` and `Change`. Its publication issue requests a working Black Front image and offers `Review view`. Error status does not rely on colour alone.
- Publication recovery is compact and points to the affected view. Save draft and Publish retain their existing roles.

## Limits

Still captures establish the observed composition and visible states. They do not establish hover behaviour, complete keyboard traversal, focus restoration, retry success, upload progress or save persistence. The media picker selects existing catalog media, so direct-upload restrictions and drag/drop are outside this slice. Source and root-run flow checks supply separate behaviour evidence; this reviewer did not operate or mutate the app or store.

The visual result is ready for owner review within the local-preview scope. Backend persistence, live catalog identity reconciliation, production capability support and native host appearance remain separate integration work.
