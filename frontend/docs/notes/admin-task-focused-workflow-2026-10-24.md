# Task-focused product setup review

Follow-up: the [second workflow audit](admin-method-bridge-and-workflow-audit-2026-10-24.md) connects first-product method assignment and repeats the journey through simulated publication. Its findings supersede the unresolved local method-assignment gap recorded below.

24 October 2026. Original non-masking local preview on port 62168. This review changes local frontend exploration modules only. No production persistence, Shopify publishing, method assignment contract, customer designer or masking fork changed. The owner's saved corrected movement boundary remains intact.

## Evidence and limits

Four independent Luna xhigh agents used separate browser tabs and merchant goals without source inspection or coaching through the tasks. These are AI scenario walkthroughs, not human usability testing:

| Scenario | Observed outcome | Main friction |
| --- | --- | --- |
| First-time shop, one hoodie and one fixed-price logo | Added image/view, renamed, drew artwork area, saved local draft, attempted publish | No connected method assignment path in the first-product preview |
| Catalog operator, 10 views and 40 placements | Found repeated placement names, changed one area, configured movement, managed methods, previewed and checked another placement | Multiple overlapping colored boxes obscured which area was being edited |
| Reuse operator, hoodie setup copied to polo | Reviewed and copied 4 views/6 placements to one destination, retained target photos and left other product alone | Default size-price consequence was vague; copied views still need deliberate target-image alignment |
| Phone-only merchant, product without images | Uploaded an image, added its first view and placement, inspected readiness | Method requirement is below the first screen; save/publish completion was not exercised |

The parent also walked through a blank product and inspected native desktop, 390px and 320px task states. Three further independent reviews checked the implementation; one reproduced an overview panning dead zone and another caught the truncated phone task caption and duplicate drawing instructions. The first-shop report is [recorded separately](scenario-first-shop-2026-10-24.md).

Some agent interpretations did not survive source review. Outline placement rows are native buttons with `aria-pressed`; macOS accessibility reports checkbox semantics. They are not an accidental checkbox selection UI. The first-shop `Choose a decoration method` label belongs to a row warning, not an inert standalone action. Generic View N names are intentional because image metadata does not reliably identify a side. The large-outline fixture reuses photos, and large-outline/large-method fixtures cannot be combined through the selector; neither proves behavior with a real combined catalog.

## Visibility policy implemented

| Current task | Canvas content |
| --- | --- |
| View overview | All artwork areas on this view, without resize handles |
| Edit a placement | Only its artwork area and handles |
| Redraw artwork area | Previous area as a faint locked reference plus the new draft |
| Set/edit customer movement | Selected artwork area locked, movement boundary/draft visible, neighboring areas hidden |
| Measure image | Image and measurement tools, editing areas hidden |
| Sample artwork preview | Sample artwork, editing areas hidden |

The view-name back button returns directly from a placement to the overview. The outline remains another direct route. Hidden neighboring areas cannot intercept a drag or selection. Overview hit testing no longer reserves the selected-handle margin around every box, so empty image space beside an outline remains pannable.

The toolbar names the current view, placement and tool. Redundant Edit view was removed because the view-name button opens the same settings. Tool tasks hide Preview while it is inapplicable. On phones, the short task name stays readable while long object names truncate. One short instruction appears on the canvas during drawing and disappears afterwards. Duplicate instructions in the inspector were removed. This retains the earlier on-demand help and avoids restoring a permanent instruction footer.

A focused existing regression also caught a delayed name-focus callback returning the cursor after Enter. A revision guard now cancels stale add/rename focus callbacks when a non-IME Enter finishes editing. The test failed before the fix, passed afterwards and passed again alongside the large-outline rename/reorder workflow; three independent reviewers found no concrete issue.

Copy review now states that its default leaves product-specific size prices blank. The optional advanced choice still copies compatible source prices. Copy mechanics and overwrite rules are unchanged.

## Why this shape

Shopify's [preview inspector](https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/preview-inspector) makes inspection a deliberate mode and routes selected elements into contextual settings. This supports explicit overview and selected-object editing, but does not prescribe our exact rectangle policy. [Theme-editor features](https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/features-overview) support keeping outline navigation, contextual settings and history together. Actual Shopify's existing theme-editor accessibility tree was available this turn; its screenshot returned white, so this is not a new pixel-for-pixel visual comparison.

[Adobe Illustrator isolation](https://helpx.adobe.com/ca/illustrator/desktop/manage-objects/select-objects/isolate-objects.html) is precedent for reducing interference while editing one object. Our inference is to keep the all-placement overview one click away instead of adding another permanent visibility preference.

[Nielsen Norman Group's progressive disclosure guidance](https://www.nngroup.com/articles/progressive-disclosure/) supports showing secondary controls when relevant. Our interdependent area, size, method and price settings do not justify a new rigid wizard. The existing optional movement switch remains within Artwork area, default off. Image scale remains optional.

[Printful's safe print area](https://help.printful.com/hc/en-us/articles/50264024409233-What-is-the-safe-print-area) is a production-safety concept. Our customer movement boundary is not a physical safe-print guarantee. Copy and documentation must preserve that distinction. The fresh [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) supplement Shopify for focus, clear feedback and layout stability.

## Remaining priority

The first-product/no-method fixture cannot complete setup: its placement method list is empty while the independent global Methods demo has ready entries. Manage methods opens that library but does not connect a method back to the new product/placement. Publication correctly blocks the incomplete setup; returning to the placement cannot resolve the missing connection. This is a known local-preview integration gap, not a proven production defect. It requires a shared method assignment flow, not more instructions or another jump button. This pass does not fabricate that integration through cross-tab browser storage.

Once that connection exists, repeat first-product setup through publication and check that a newly created or assigned method is immediately available at the placement. Also validate copied target imagery and method readiness together against real product data. These are more valuable next steps than adding more editor controls.

## Verification and artifacts

Eleven distinct relevant browser workflows pass across the focused runs. The name-confirmation failure was repaired and rerun; this is not a full-suite result. Focused behavior regressions capture hidden-neighbor selection, overview panning, returning to overview, phone task readability, movement overlay lifecycle and measurement cleanup. Existing relevant checks cover create/draw/save/remove for an unconfigured product; missing images/methods at 390/320px; drag/resize/snap/pan/zoom with mouse and touch; staged setup copying; customer movement save/history/discard; and invalid-to-valid boundary recovery. Strict admin-test TypeScript and scoped Biome pass. Official Polaris validation succeeds for the three changed TSX modules with `--version 2.0-rc`; the service reports resolved `v2.0`, so the local RC type/runtime pins remain the exact compatibility check. Validator success does not cover canvas CSS or native visual acceptance. No full-suite or deployment claim is made.

Native screenshots under `/Users/pc/Development/Insignia/.artifacts/workflow-audit-2026-10-24/`:

- `native-focused-desktop.png`, `native-overview-desktop.png`
- `native-movement-desktop.png`, `native-movement-phone.png`
- `native-measurement-desktop.png`

Scenario and automated screenshots in the same directory retain the initial setup, copy review/result and narrow-layout evidence. The owner has not accepted this iteration yet.
