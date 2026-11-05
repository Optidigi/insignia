# Variant photo matching independent design review

Superseded by [the manual photo assignment review](variant-photo-manual-design-sol-2026-10-27.md). The owner rejected matching because its photo suitability remained ambiguous. The passing states and pixel review below did not establish that this was a useful merchant workflow.

27 October 2026. Independent source/state review by Sol. Actual desktop, 390 px and 320 px implementation captures have been inspected. This is review of the local preview workflow, not production integration or owner acceptance.

## Evidence and composition

Read the UI delivery skill, admin guidance, persona audit, current preview model and existing photo panel. Reviewed the actual saved Customily mapping and Teeinblue assignment screenshots under `.artifacts/color-variant-research-2026-10-27` at readable scale.

Customily's published example places explicit source values opposite destination selectors with a separate Front area choice. Its useful lesson is visible mapping and view context. Its large blank wizard area is not a density target. Teeinblue's example uses bounded rows with thumbnail, variant label, count and local Edit in a dialog. That supports compact, scannable assignments. Neither establishes that Shopify's native variant image identifies Front or Back.

[Shopify's variant-image guidance](https://help.shopify.com/en/manual/products/product-media/add-images-variants) confirms one assigned image per exact variant. Further photographs live in product media. The toolkit search used App Home 2.0-rc and confirmed supported responsive table/list and checkbox patterns. Project types are pinned to `2.0.0-rc.3`. Checklist Design Table and Checkbox supplied the selection, row-density, context and phone-layout lens.

## State decisions checked before implementation

- Review belongs inside the selected view's existing photo panel. Name that view beside the review. Native image associations have no side identity, so suggestions begin unselected.
- Only propose a candidate when every exact SKU in the image group has the same valid product image reference. Missing associations and conflicting image IDs stay unresolved. Do not infer from filenames, labels or gallery order.
- Preserve every existing explicit assignment, including shared-image intent, partial records and placement exceptions. An existing image with the same URL is still an existing assignment.
- Apply changes only the deliberately selected candidates. It retains custom placement rectangles and requires alignment review for changed photos. Cancel makes no draft change. The existing Undo must restore image assignments and alignment acknowledgements without losing unrelated later edits.
- Image metadata and a visible loaded image are separate facts. An image that exists in the catalog but fails to load must show recovery and must not look reviewed. Reuse the panel's failed/pending image status and retry mechanism.
- Changing view, grouping or native source associations must invalidate a stale proposal. Never apply rows computed for a previous view.
- Phone rows must keep group label, photo, selection and unresolved reason together. Do not depend on desktop headers remaining visible. Counts must state selected candidates, not all groups or variants.

These are concrete guardrails for the requested match action. They do not justify another settings page, a global alignment switch, or production-rule controls inside image groups.

## Findings and correction

The first source pass found that partial and exception-only assignment records were still eligible. Root changed the guard to preserve every existing record. A second pass caught an empty record being shown with the shared thumbnail despite no explicit shared choice. Root restricted that lookup to `useShared === true`. The corrected source preserves deliberate clears and says "Existing setup kept" when no current image exists.

## Rendered verdict

Inspected the five actual 1440 px captures in `.artifacts/admin-popup-review-2026-10-24/variant-photo-matching/desktop`: entry, review, enlarged image, selected and applied. No material desktop visual finding. The inline panel uses compact thumbnail/name/count rows, native aligned checkboxes, no selected defaults, a readable side-review instruction, one action row and an enlarged real garment photo. Apply 2 agrees with the visible choices. Applied state restores the existing list, marks the changed groups for alignment review and leaves the unselected Navy group missing. This follows the useful reference composition without importing its blank wizard space.

Inspected actual 390 and 320 px review, selected, enlarged-photo, applied, conflict, missing/partial source, all-existing and no-source states, plus 390 px failed-image/recovered and desktop stale-proposal captures. No material visual blocker remains in those frames. At 320 px, thumbnail, group name and reason stay together; conflict text wraps without clipping; both footer actions remain on one row. The enlarged photograph fits inside the viewport. Existing setups have no selectable checkbox, an explicit preserved reason and one Back to images action. With no source metadata the matching entry is absent and ordinary Add remains available. A failed photograph has an unavailable checkbox and a visible Retry; the recovered frame shows the restored photograph and truthful selected/apply count. The stale state displays recovery and disables application.

The supplied captures establish these observed layouts. Root reports browser interaction coverage for apply/cancel/Undo, selection and image recovery, model checks, strict types and pinned component validation. I did not independently operate those interactions or a live Shopify product. The three-colour fixture does not prove a completed 24-colour merchant assignment run or real supplier outlier alignment.

Also inspected the actual preview-purpose 1440 and 320 artwork-preview frames and 320/390 storefront-test frames. The artwork destination says "Artwork preview · Current draft" and its field says "Decoration size" with Embroidery selected. The separate storefront destination keeps theme verification and a published-product customer-flow test distinct. The editor entry intentionally remains "Preview customization". No additional visual correction is required for this narrow copy/context change.

Final independent judgment: the requested local matching design is reviewable and has no outstanding material source/state or pixel finding from this pass. Production catalog ingestion, native embedded observation and owner acceptance remain separate.
