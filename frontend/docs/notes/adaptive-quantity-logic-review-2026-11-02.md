# Adaptive quantity logic review

2 November 2026. Independent review of the adaptive quantity changes in `../designer-prototype`, compared with `.artifacts/adaptive-quantities-2026-11-02/before/`. The sibling has no Git history. Scope excludes unrelated existing edits. Sources are the approved adaptive quantity research, inline example, project `AGENTS.md`, implementation plan sections 3 and 9, and project code-review skill. This is implementation review, not visual acceptance or Shopify integration evidence.

## Standards

No separate hard standards findings. The policy is pure, quantity mutations remain reducer events, and search is UI state. No smell judgement warrants a separate action.

## Spec

- **P1: restored unavailable quantities cannot be corrected in compact mode.** `src/quantity-entry.tsx:92` renders only "Unavailable", dropping both quantity and removal controls. `quantity-entered` rejects unavailable tuples. A restored mixed phone-case order with positive Gloss / Model A remains invalid even after a zero event; `buildCommitDesign` returns null. Preserve the retained selection visibly and provide removal without claiming it is available. Research checks 6 and 10 require retained selections to remain discoverable and correctable. Resolved in the reviewed update through shared unavailable-selection recovery and a reducer removal event.
- **P2: focusing a zero-quantity row removes other added rows.** The new `onFocus` at `src/quantity-entry.tsx:56` dispatches `color-selected`; existing `selectColor` replaces all rows whenever total quantity is zero. Add a second empty group, focus either input, and the other group disappears. A reducer reproduction returned `[matte, gloss]` before focus and `[matte]` afterward. Focus should select preview appearance without changing group membership. Resolved by the new `quantity-focused` event, which changes preview appearance without changing rows.
- **P2: noncompact sparse layouts conflate absent and unavailable tuples.** `src/quantity-entry.tsx:115` supplies an `available:false` field for every absent exact tuple. These get the same disabled input and unavailable title as existing unavailable variants, contrary to research check 3. Resolved by rendering absent cells without an input and distinguishing them from existing unavailable cells.
- **P2: search can unmount the input being edited.** `visibleSizes` retains a nonmatching option only while its quantity is nonzero. In a searchable list, enter a quantity on B, search A, then clear B's retained field to replace the value. The forwarded NaN becomes zero in the reducer and B disappears immediately, losing focus. Research checks 6 and 8 require filtering to preserve editable selections and focus. Resolved in source by retaining `focusedSize` until blur.

## Validation

Final recheck passed 9 quantity-entry and variant-matrix tests, plus strict TypeScript and the production build. An independent reducer reproduction confirmed that a restored mixed order can remove an unavailable quantity and commit only the surviving exact available variant.

The main agent's passing browser evidence is recorded in `.artifacts/adaptive-quantities-2026-11-02/adaptive-browser.log`. I inspected both the log and the corresponding browser assertions in `apps/web/test/admin/designer-state-browser.test.mts`: all 14 scenarios at 1440, 390 and 320px retain quantities through resize, Review and Edit; filtered Model 02 remains focused through clear/refill; unavailable and unknown saved keys can be removed; recovery returns focus to an input. The 390px scenario runs use dark mode. The 20-model filtering task uses 320px.

The final update also resolves the inherited bad-input normalization gap. The input boundary distinguishes a deliberately blank value from native `badInput`; the reducer retains NaN as invalid, totals exclude it, steppers disable, and Review blocks. The browser check uses `pressSequentially('1e')`, asserts native badInput and `aria-invalid`, then verifies successful correction. I reviewed this behavior in source and the passing browser evidence; I did not rerun the browser suite independently.

The final guard recheck found no issue: retained nonzero unavailable or unknown keys now count as quantity errors before Review, the attempted-step summary links to the focusable unavailable-selection recovery section, and the quantity-step primary action disables when no configured cell is available. The reducer commit guard remains authoritative. I inspected the final `browser-final.log`, which records all 27 maintained browser and preview checks passing, including the added three-axis and no-availability cases.

Final source review: Standards 0 active findings; Spec 0 active findings, 4 new findings and the inherited numeric-input gap resolved. This review does not grant visual acceptance or release approval.
