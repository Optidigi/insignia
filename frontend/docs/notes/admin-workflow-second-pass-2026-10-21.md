# Admin workflow second pass

Local implementation on `codex/ui-redesign`, continuing the 20 October admin iteration. The owner's request covers mobile placement editing with realistic configurations, Orders selection and batch production sheets, and a critical detail/Products workflow review. The existing dirty work is preserved. No native Shopify writes or deployment are part of this pass.

## Placement editing

The area and decoration-size selectors precede the canvas. Desktop uses preview and settings columns; mobile keeps the preview first in the actual document order. Percentage-based geometry controls sit directly below it. Shared decoration-size definitions remain a separate disclosure, with the effects of editing a shared definition explained. Duplicate size labels include their associated areas without changing stored labels or IDs.

The selected Konva area and its transformer move above overlapping areas in edit mode. This fixes the selected chest area's drag and resize being intercepted by a larger overlapping area. Buyer and order preview modes remain non-interactive.

Optional production width and height use the existing `physicalMm` contract. They are manually entered production information, independent of relative preview geometry. Both blank removes the dimensions; a positive pair saves them. Incomplete or invalid input stays visible per size, blocks save/publication/copy, and has a recovery action returning to the affected fields. Loading, discarding and removing a size clear the corresponding transient input.

## Orders and production sheets

Native checkboxes occupy the left side of each order. Header selection covers only shown orders on the current page. Selection clears on view changes. A sticky action bar keeps production-sheet preparation, copying order numbers and clearing selection available after selecting a row below the fold. No fulfilment, approval or production-complete state is invented.

The batch report shows every selected order, included pages, production holds and exclusion reasons. Partial downloads state the included and selected counts. Sheet previews are optional, so an image gallery does not displace the report. Order links allow recovery through the real detail page. The detail breadcrumb preserves validated artwork/search/date/sort/cursor controls; external return paths and credential parameters are rejected. The route passes the sanitized return path into the island so server rendering and hydration agree.

Preparation uses fresh authorized reads, the existing worksheet renderer and current artwork. Each included order is checked again immediately before download. Changed facts, expired access, permission loss, cancellation and selection changes invalidate retained pages. Preparation is sequential and capped at 20 selected orders, 200 pages and 64 MiB of retained page PNGs. These are application bounds, not a measured device-memory guarantee. PDF creation yields and checks cancellation between pages, and embeds each image before decoding the next one.

The A4 worksheet prioritizes order/design identity, garment quantities, front/back proofs and artwork/placement instructions. Missing physical dimensions are explicit. Missing artwork, test orders and other production holds remain visible on every relevant page. Image-loading failures identify the garment or artwork; expiry and stale-order failures offer direct retry. The worksheet contains placement previews, not the original production files or a scale-calibrated proof.

## Detail and Products

Unavailable or expired composed design previews now explain their state instead of silently losing the action. Existing compact variants, missing-artwork navigation and scoped artwork actions remain.

Products separates customization navigation from native Shopify catalog editing. Search can be cleared directly from matching results, including on mobile, and resets pagination. Native catalog links remain available in narrow table presentation. Incomplete variant counts and unknown product statuses are presented without inventing precise data.

## Qualification and limits

Focused browser checks cover selection without row navigation, keyboard selection, clipboard handling, partial export, stale versions, permission loss, cancellation/reopening, actual eight-order export and guarded demo editing. Placement checks use the real legacy T-shirt, hoodie and polo configurations at 390px and 320px, including touch drag/resize, method and price changes, review and save. Synthetic scenarios cover duplicate/long labels, shared sizes and geometry collisions. New regressions cover physical dimensions and return navigation. Build, strict types, Polaris 2.0-rc component validation and presentation boundaries are checked separately from visual inspection.

The sample batch contains eight orders and twelve A4 pages. Rendered first and last pages and desktop/mobile report screenshots were inspected. The final combined build checks 126 files with no diagnostics. The final focused return-navigation/partial-export run passes four cases; the two physical-dimension cases pass using accessible shadow buttons and modal-host scopes for slotted actions. Strict admin-test compilation, scoped formatting and seven Polaris presentation-boundary checks pass. An independent read-only Luna review found no actionable P1/P2 issue in selection, batch ownership/expiry/rechecks or invalid-dimension command fences.

Returning through the order breadcrumb retains the current cursor and filters. Without the earlier history entry's cursor stack, it uses the existing direct-link behavior: View first page is available rather than an invented previous-page cursor. This is a known navigation limit, covered by its focused regression.

Browser fixtures are local evidence; this pass adds no native Shopify appearance qualification or owner acceptance. Preview-only state, assets and transports remain under `apps/web/test/admin` and are excluded from production application imports. The verified build is running on the existing loopback preview port 62168.

Backend follow-ups remain separate: catalog configuration/publication summaries need a list DTO before Insignia-specific catalog filters can be truthful; original-artwork archives need file metadata and a packaging contract; bulk reconciliation needs an explicit permission/workflow decision. The UI does not implement these through per-row fetches, guessed metadata or broader permissions.

## Filtering and selection correction

The owner identified that the right-side filter menu opened an artwork-status popover anchored to its other, left-side trigger. That duplicate entry point is removed. Artwork status and Order date now each have one direct trigger, with applied filters represented by removable chips. Search, column visibility and date sorting have distinct controls; sorting no longer opens a nested popover from Display options.

Filters and selected-order actions share one native Section with the table. Selection replaces the filter area with the selected-count checkbox, Production sheets, a native More actions menu and Clear selection. The app-owned toolbar remains immediately above the table rather than inside its filters slot, because the public slot's containing wrapper prevents it staying sticky for below-fold selection. This preserves the documented selection/action hierarchy without styling Polaris internals. Secondary actions are copying order numbers and selecting all shown orders. Clearing selection restores the filters and keyboard focus; switching via select-all transfers focus to the replacement checkbox. Minimum first-column width keeps ordinary order numbers readable before the responsive table switches to its mobile list.

Focused checks cover direct popover placement at 1440px, 390px and 320px, chip removal, exclusive open filters, custom-date validation/store time zone, search and column visibility, selection/clipboard behavior, keyboard focus handoff and the real eight-order batch. The web build and both generated components pass Polaris 2.0-rc validation. This is local preview qualification, not a new native Shopify observation.

## References

- Shopify [index-table composition](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/compositions/index-table) and [bulk-action migration guidance](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/unstable-bulk-actions), adapted to the public web-component API and current page-scoped operations.
- Shopify [product searching and filtering](https://help.shopify.com/en/manual/products/searching-filtering), used for catalog workflow review within the available DTO.
- Konva [node API](https://konvajs.org/api/Konva.Node.html) and [layering](https://konvajs.org/docs/groups_and_layers/Layering), used for selected-area stacking.
- pdf-lib [image embedding](https://pdf-lib.js.org/docs/api/classes/pdfimage#embed), used to release per-image decoded data during PDF construction.
