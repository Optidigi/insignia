# Variant photos: robustness and editor refinement

27 October 2026. Local frontend refinement requested after the first variant-photo design. Supersedes the separate appearance toolbar in the preceding V1 captures. No production configuration contract or Shopify write was added.

## Result

The existing canvas header now owns the appearance selector, Images shortcut and Preview action. The extra band is removed. Comparable captures regain 78 px of desktop canvas and 75 px on phones. Native controls retain accessible labels; long values truncate inside a bounded field. At 320 px, appearance and decoration-size preview controls fit beside Front, Exit preview and Expand. Images remains directly available when editing.

The two Luna audits and two independent Sol reviews led to these corrections:

- Duplicating a view copies its image assignments, explicit shared-image choices and review status. Photo-specific placement rectangles map to the new placement IDs.
- View, placement and appearance selections survive a reload within the browser tab. State is scoped by product and example, validates stale IDs and respects explicit URL entry. Event-time writes avoid losing a just-selected colour on immediate reload. This is UI state, separate from saving a product draft.
- Grouping states that it applies to every product view. An inline warning previews existing images that would need reassignment or alignment review before Apply. Applying a grouping keeps the selected appearance where possible. Undo and Redo restore that appearance with the product state.
- Image failure is shared by the canvas and assignment rows. Retry reloads both, shows pending progress and continues to block publication until a successful result. A thumbnail cannot clear an active canvas failure. Change remains available for replacing a permanently unavailable image.
- Images moves focus into the revealed panel. Review opens the phone canvas and focuses Confirm alignment once the image is ready. Confirm returns focus to Images.

Intentional existing behavior remains: missing groups do not silently show another colour, shared images require an explicit choice, and photo alignment exceptions do not change manufacturing dimensions or prices. Bulk work and search remain inside the existing view settings rather than adding another assignment wizard.

## Product coverage and remaining boundaries

The source and model checks cover Colour plus Size, Colour plus Fit, arbitrary Finish/Material options, sparse combinations, opaque SKU IDs, shared rear photography and a front alignment exception. A synthetic tumbler test also groups by Capacity. It proves the model does not invent combinations; it is not a non-shirt visual demonstration. The Colour/Fit and long-name gallery fixtures reuse existing colour photographs to exercise grouping and layout, not separate fit photography.

Different print capabilities, physical limits or prices for different variants require a separate production contract. Live Shopify catalogue refresh and reconciliation of newly added option values also remain integration work. Automatically matching different uploaded files to different groups is deferred until there is a verified naming or metadata rule; this slice keeps deliberate assignment and safe bulk reuse.

## Sources and composition

- The installed Shopify skill searched and validated the actual pinned App Home 2.0-rc controls. [Select](https://shopify.dev/docs/api/app-home/v2.0/web-components/forms/select) and [Button](https://shopify.dev/docs/api/app-home/v2.0/web-components/actions/button) guidance govern native labels, disabled/loading state and accessible icon actions. The editor retains its previously reviewed three-panel workspace.
- Checklist Design's bundled [Checkbox](https://www.checklist.design/design-system/checkbox) and [Table](https://www.checklist.design/design-system/table) checks informed explicit selection, bulk scope, action insets, keyboard interaction, search and responsive treatment.
- Fresh [Vercel interface guidance](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) informed focus handoff, long-content constraints and recovery. Shopify's sentence case and native component behavior take precedence over generic examples.
- The published Customily and Teeinblue reference captures were re-inspected for option/value scope and grouped assignments. The [earlier research](color-variant-design-direction-2026-10-27.md) records exact primary sources, including Memorisely's hierarchy and Zander Whitehurst's disclosure lessons. These support making scope explicit and revealing exceptions as needed; they are not claimed as installed packages or current native app observations.

## Verification

- 74 focused model, selection, publication, history, storage and existing workflow-model tests pass.
- The final browser sweep passes at 1440, 390 and 320 px. It verifies actual photo changes, scoped bulk assignment, missing/failed images, alignment, local saving, immediate reload selection, grouping continuity and Undo/Redo. Every visible native toolbar button and combobox is checked against the toolbar bounds.
- The retry regression deliberately holds the image response while clicking Publish, checks the blocking issue, then releases the response and observes both thumbnail and canvas recovery.
- Strict admin TypeScript, affected-file Biome, whitespace checks, web build and pinned Polaris validation pass.
- The corrected gallery leads with 20 variant-image states and 52 captures. Native operating-system select popups are excluded from browser screenshots. Full option labels were checked through the actual native accessibility tree and browser options; no 320 px popup screenshot is claimed.

Independent notes: [Luna product audit](variant-photos-product-polish-review-2026-10-27.md), [Luna QOL audit](variant-photos-qol-review-2026-10-27.md), [Sol pixel review](variant-photos-polish-sol-review-2026-10-27.md), [Sol workflow review](variant-photos-final-flow-sol-2026-10-27.md). Both Sol reviewers found no remaining blocking issue in the inspected frontend scope after correction. Owner acceptance, live catalogue integration, native host acceptance and release approval remain separate.
