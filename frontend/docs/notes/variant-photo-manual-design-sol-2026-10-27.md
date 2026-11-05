# Manual photo assignment independent design review

27 October 2026. This supersedes the [matching review](variant-photo-matching-design-sol-2026-10-27.md). The owner rejected matching because its photo suitability remained ambiguous. Passing model states and tidy pixels did not establish that the extra workflow helped a new merchant. Matching is being removed.

## Source and references

Read the current UI delivery workflow and existing photo panel, image picker and dialog integration. Reused the already inspected Checklist Design Table and Checkbox guidance. Inspected actual existing desktop/320 picker and 390 bulk-selection captures, plus the saved actual Shopify media selector at `.artifacts/dialog-design-2026-10-24/shopify-media-reference.png` in the repository. The saved Customily screenshot uses explicit source-to-destination choices and a separate Front context. The Teeinblue screenshot uses compact thumbnail/label/count rows with local Edit. The Shopify selector uses a full-width upload area, search/filter controls, compact labelled image grid, scroll ownership and a stationary action footer. Keep that established composition. The explicit owner correction in `admin-dialog-audit-2026-10-24.md` rejected the compact upload tile. Neither vendor reference supports inferring orientation or colour from arbitrary supplier photos. Their useful composition lessons remain explicit scope and compact local editing.

## Minimal direction

Keep the existing per-row Add/Change path and real-photo grid. Name current view and group where the merchant chooses the photo. For bulk selection, make the consequence explicit: one chosen photo goes to every selected group. This operation helps deliberate reuse; it does not assign many different photos at once.

Search can use supplied image labels and actual recorded usage. Avoid a new orientation or colour filter without explicit metadata. Do not stack a repeated title, group summary and instruction when one scope cue communicates the destination.

The implemented Use and next action reduces repeated picker opening for distinct photos. It is limited to a single group, shows the current target, commits only the chosen photo and advances to the next unassigned group later in the existing order with no source photo preselected. It skips all existing assignment records, including exceptions and deliberate clears. Use image finishes the current assignment. Ordinary draft Undo remains available.

## Concrete source findings

The first pass found that picker usage counted shared view images only. It ignored explicit group assignments, so a used image could say "Unused" and appear in the Unused filter. The new usage helper now reads actual view/group records, and the new Next capture shows the earlier Black assignment in usage.

The first pass also found failed previews remained selectable. The revised picker gates selection and application on the current image load attempt, guards stale load callbacks and adds Retry. That reports asset availability; it does not interpret photo suitability.

## Rendered verdict

Inspected actual new manual panel, initial picker, selected image, next target, applied assignments, same-image bulk, needs-image filter and search at 1440, 390 and 320 px under `.artifacts/admin-popup-review-2026-10-24/manual-photo-assignment`. No material visual finding in these frames.

The picker names Front and the current group, then places search, filter and actual photos in the established native composition. The deterministic Next transition changes Black to White and clears source selection. Bulk explicitly says "Same image for Black, White", retains the 8-variant scope and uses "Use for 2 groups". At 320 px the three footer actions fit one line, body/title insets align and labels are not clipped. Applied groups show Check alignment; unassigned Navy stays Image needed. The 24-group needs-image filter and search retain a local Add action.

The upload area is intentionally full width. I initially suggested a compact tile, then withdrew that suggestion after reading the explicit owner correction and inspecting the saved actual Shopify media reference. Reopening that accepted choice would be outside this change.

Inspected actual failure/retry frames at 390 and 320 px. The failed current photo stays selected as context, but Use image is disabled and Retry is visible. The recovered frame shows the real garment photo and enables Use image. At 320 px the gallery can scroll the recovery action into view while retaining footer actions.

The first 320 px long-target capture omitted the dialog title/close control. Root refreshed it after waiting for finite native animation and asserting title visibility. I inspected the corrected actual frame: Choose Front image, close X and the full Navy / Relaxed unisex fit target are visible. No source workaround or alternative dialog composition was needed.

Keep the existing alignment-review rule for new explicit photos in this slice. The existing Use shared image control already expresses inheritance; source dimensions alone do not prove the inherited setup has been reviewed.

Browser behavior and model/type/component checks belong to root's verification report; this independent pass did not operate shared browser tabs. Earlier matching frames do not approve this replacement workflow.

Final independent judgment: no outstanding material source/state or pixel finding in the corrected manual-assignment slice. The flow now asks the merchant to choose the actual photo for a named group and view. Efficiency comes from deterministic continuation, truthful usage and filtering, without inferred suitability. This is local preview evidence, not live Shopify integration, measured merchant usability or owner acceptance.
