# Adaptive quantity screen review

2 November 2026. Independent read-only review of the selected sibling `designer-prototype` customer customizer. No implementation edits were made.

Reviewed the rendered PNG captures against the owner-approved interactive example, using the installed Checklist Design [Input Field](https://www.checklist.design/design-system/input-field) and [Multi-step form](https://www.checklist.design/web-app/multi-step-form) checklists to guide a focused visual critique. This is a screen review, not an item-by-item flow audit.

## Result

No remaining visual finding in the supplied captures. The compact rows and bulk quantity layouts follow the approved direction and remain readable at 320px. The minor long-content group-header issue found in the first pass was corrected and rechecked in refreshed desktop and phone captures.

The compact phone-case list has one shared outline, thin row dividers, a two-line combination label and right-aligned quantity controls. It removes the cross-product grid and repeated warning blocks. The existing unavailable record has a quiet inline status. The actual record order differs from the example, which is consistent with preserving supplied ordering. The singleton apron has one quantity without an artificial selector. The three-colour apron uses the same compact list consistently.

The actual compact rows are about 76 to 80px tall, close to the approved example. Desktop labels and controls have roughly 16px insets. At 320px, the panel has 12px outer gutters and row contents retain about 12px of inset. The 142px-wide quantity control fits beside both phone-case labels and Natural cotton without collision or clipping. Each action and number segment has roughly 47px of width and a 46px control height. The focus outline remains inside the visible row, with a clear gap to the shared outer border.

The Classic six-size group retains direct numeric entry. Desktop places the six fields in one row. Both phone widths wrap them into three columns, matching the approved bulk example's readable size labels above controls. The 320px cells have about 87px of width and 44px of height. The focused first field's outline stays visible and does not cover its neighbour's value. The extended-size group uses six columns on desktop and three on phones, with the remaining fields continuing in supplied order. Its partial final desktop row stays aligned with the columns above. It does not compress fourteen controls into one line.

The long-content group switches to label-and-input rows. Its desktop capture shows the complete long size value beside its control without truncation. Phone captures keep readable labels and wide controls, though lower fields require scrolling. A static first-viewport capture does not establish how every lower field behaves while focused.

The 390px dark captures have clear white values, readable secondary labels and a pale double focus outline against the dark field and card. The light 320px captures have a strong blue outline. Neither appearance clips the focused first field in the supplied states. In compact lists, the outline groups the stepper rather than isolating only its numeric segment. The individual action symbols and centered number remain distinct.

## Correction recheck

The first `long-content-1440.png` capture broke the group count into `2` on one line and `items` on the next. The refreshed capture keeps `2 items` on one line, with the swatch and long name grouped beside it. The complete name wraps into two lines without collision. The minor finding is resolved.

Reopened `long-content-390.png` and `long-content-320.png` after the correction. Both retain a one-line count. The swatch stays beside the multiline name, which remains complete and distinct from the count. At 320px the name takes four lines, but the Size label and 88px-wide numeric fields remain readable. The pale dark focus outline and blue light outline remain fully visible around the first field.

Also inspected the new `three-axes-320.png`. Both actual tuple rows show the model name and complete Material and Pack values. The secondary attributes wrap before the right-aligned stepper, without colliding with it. The positive row's focus outline remains inside the row boundary.

The new `no-availability-320.png` keeps all three actual tuples with explicit Unavailable text, followed by `No options are currently available.` There are no misleading editable quantities. Review is visibly disabled. The footer's Per item label and complete €29.00 value fit inside the viewport. No new quantity-entry finding arose from these states.

## Evidence and limits

Inspected both approved example captures in `.artifacts/quantity-pattern-research-2026-11-02/`, including the compact desktop example and 320px bulk example. Inspected all three supplied widths for phone-case-options, classic, minimal, one-size-apron, long-content and extended-sizes in `.artifacts/adaptive-quantities-2026-11-02/`, plus many-models-320 and retained-unavailable-390. Reopened the three refreshed long-content captures and inspected the added three-axes-320 and no-availability-320 captures after the correction. The widths are 1440px light, 390px dark and 320px light. This does not establish a separate 320px dark observation.

The large-model capture shows a readable Model search field, a full two-line model label and a quantity control. The unavailable-retention capture groups retained entries in a warning card with explicit Remove actions. Developer scenario controls above the customizer in these two captures were excluded from the product critique. The resulting viewport reduction was not treated as a customer layout defect.

Progress labels, the current Quantities state, Back and Review are visible. The footer retains the item count and price with a large Review action. The fixed footer means longer quantity groups continue below the initial viewport. The parent agent reports the final browser and preview-contract run passed 27/27, including all 42 scenario/width Review/Edit journeys, 20-model search/clear/focus, retained-unavailable and unknown recovery, three-axis UI and no-available-option state. Those results were supplied as context; this reviewer did not rerun them. Static images cannot independently prove keyboard navigation, retained values, step validation, search results, save/resume or final editable review.

This review supports the local quantity presentation only. It does not establish Shopify cart mutations, production integration, deployment, owner visual acceptance or release approval. Shopify remains responsible for the host product page, cart and checkout.
