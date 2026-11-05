# Variant photo workflow polish review

Independent Sol pixel review, 27 October 2026. This reviews the corrected local preview against the owner's request to recover canvas space and keep the variant-photo workflow usable. It does not establish owner acceptance, native Shopify appearance or release approval.

Read AGENTS.md, the Insignia UI delivery workflow, admin UI guidance, installed Shopify App Home guidance, the implementation note and both previous Sol review notes. Inspected the original captures before replacement, then the corrected 1440 × 1000, 390 × 844 and 320 × 568 captures under `/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/variant-photos/`.

## Canvas and toolbar

The separate appearance band is gone. The desktop canvas starts at y=101 rather than y=179, recovering 78 pixels. At 390 pixels it starts at y=108 rather than y=183, recovering 75 pixels. The phone photograph is visibly larger in the same reserved editor region. The desktop retains Front, Left chest, Colour, the selected value, Images and Preview in the existing toolbar.

Corrected Black, White, long Colour / Fit and sample-artwork preview captures retain Front, the selected appearance and Expand at both phone widths. Preview becomes an icon with an accessible name; Exit preview uses the edit icon. The appearance and decoration-size selectors fit together at 320 pixels. Images is hidden while preview uses that space, and returns when editing resumes. The phone tree or inspector retains the selected placement's name when the toolbar caption is hidden.

The long `Navy / Relaxed unisex fit` value truncates inside its bounded native selector. It does not overlap adjacent actions. The desktop inspector preserves the full group name beside Adjust for. Root reports checking full native option text through accessibility and DOM inspection. The operating-system select menu is excluded from both available screenshot paths, so this review does not claim visual acceptance of that opened menu at 320 pixels.

## Assignment and recovery

Inspected corrected view settings, grouping, regrouping impact, bulk picker, alignment, image error, recovered thumbnail and group-area captures. Front images survives phone scrolling. Change shared image distinguishes the base image from group assignments. The group geometry inspector says Alignment for Black and offers Use shared area. The narrow picker keeps Black, White and 8 variants visible while its media list scrolls.

The grouping editor says it applies to every view of the product. The new impact warning states that regrouping will leave eight image assignments without photos and that photos must be added before publishing. At all three widths the warning appears before Apply grouping, wraps cleanly and leaves Cancel available. The old assignment rows remain visible below while the grouping change is still pending.

The 320-pixel alignment capture shows Front, Black, Check Black on Front and Confirm alignment together. Image unavailable retains Retry and Change. The pending-retry phone capture shows a readable publication dialog asking the merchant to wait for Black / Front to load, while the underlying row says Loading image. The recovered phone capture shows the Black thumbnail loaded again.

Two focus findings were sent to the integration agent during this review. Images previously scrolled to the inspector without transferring focus. Review alignment previously expanded the canvas while focus remained on the inspector action. The corrected source transfers focus to the panel, requests alignment-action focus and returns focus to Images after confirmation. Root reports a final browser pass covering these destinations, control bounds, restored selection, regrouping Undo/Redo and publication blocked during a held retry followed by successful recovery. These are root-run interaction results, not independent browser operation by this reviewer.

## Result and limits

No material visual defect remains in the corrected captures inspected here. The compact toolbar addresses the owner's canvas-space complaint without adding another persistent row. Group assignment, shared-area scope and recovery remain readable on the short phone.

Non-shirt generality has a separate synthetic tumbler model regression reported by root. No non-shirt product-photo UI fixture was rendered for this review. Garment photographs reused across Fit groups demonstrate grouping and layout, not distinct fit photography. Backend persistence, real Shopify variant identities, full buyer catalog integration and production rollout remain outside this local-preview acceptance.
