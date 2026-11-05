# Translation settings independent review

4 November 2026. Current review of the redesigned overview and editor. The earlier large-row editor verdict is superseded by the owner's rejection of its composition. That review established several behavior and overflow corrections, but it did not establish the requested Shopify fidelity.

## Current verdict

No unresolved material finding remains in the current reviewed local light-appearance overview/editor states. This verdict follows an actual composition review and correction pass, not merely confirmation that controls exist or fit. The redesign follows the measured native overview-to-editor hierarchy, density and source/target relationship described below. It is suitable for owner review. It is not a claim of pixel identity, native host acceptance, shared shop persistence, storefront delivery or release approval.

## Evidence and limits

Read AGENTS.md, the Insignia UI delivery workflow, admin guidance, translation implementation, UX preflight, runtime audit and reference research notes. Used Checklist Design's Settings, Saving changes, Showing input error, Searchbar and Empty State lenses. Read the current MerchantTranslations markup/CSS, AdminSaveBar, translation reducer/workflow/storage, customer overlay runtime and tests, selected sibling Designer input, and AutoSizeTextArea adapter. No application implementation, build, server restart or Shopify resource edit was performed by this reviewer.

The selected runtime is Polaris 2.0-rc with @shopify/polaris-types 2.0.0-rc.3. Public [Shopify Settings guidance](https://shopify.dev/docs/api/app-home/latest/patterns/templates/settings) supports related groups and unsaved-change protection. The [Translate & Adapt guide](https://help.shopify.com/en/manual/international/languages/translate-adapt-app) supports the manual language/resource/field/save workflow. These documents do not establish exact editor geometry.

The native composition facts were supplied by root after its live DOM and pixel inspection. This reviewer could not independently view the claimed Chrome tab. The earlier CUA attempt returned an already-claimed-tab message without a usable binding. The old resource-hub screenshot is not substituted for an editor reference. Direct native-to-implementation pixel comparison remains root's observation, not this reviewer's independent evidence.

Current implementation images are in `/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/translations/`. The old parent folder date is an existing gallery convention. Reviewed refreshed overview desktop/390/320, English editor desktop/390/320, long-copy desktop/390/320, Arabic/RTL, six-form plurals, token error, save failure, reset confirmation, and overview/editor loading. The final requested captures were re-opened after root reported the complete corrected gallery run.

## Composition comparison

| Native fact supplied by root | Current actual implementation | Assessment |
| --- | --- | --- |
| Overview groups resource links with a Languages rail. | Desktop has one card of actual customer-copy categories and a right Languages rail. Phone has the real language selector and Add language before categories. | The two-step task and category grouping are now present. No fake Shopify resources or language publication status are added. |
| Editor has a flat approximately 299 px category sidebar and main heading/filter. | Desktop has an approximately 300 px section rail and separate main resource heading/filter. Current section is selected; category order follows the overview's customer journey then secondary text. | This corrects the omitted sidebar and inconsistent wayfinding of earlier passes. Phone substitutes a section selector. |
| A 180 px field-label column precedes equal reference/target columns. | The actual desktop grid has the narrow field column and equal source/target cells, with aligned short-row text. | The label is no longer a full-width heading above each record. |
| Short rows are approximately 51 px and controls approximately 32 px. | Current short rows are 52 px. Eleven navigation records fit in the desktop capture. | Density is now close to the measured native editor, rather than the superseded roughly 150 px records. Longer text grows when its actual wrapping requires it. |
| Source has a continuous shaded column; target is white; column labels appear once. | Desktop has one comparison header and a continuous subdued English band beside white target cells. | The repeated Default text/target headings have been removed from desktop rows. Phone repeats source/target labels because records stack. |
| Narrow records stack field/source/target. | 390 and 320 px captures stack records with intact labels, input bounds and corrected 12 px source insets. | No horizontal comparison-table scroll is needed. |

The implementation retains the supported public s-text-area treatment: rounded bordered target controls and rounded shaded read-only controls within the source band. Its per-field reset also reserves a small action gutter. These details differ from the native app's own internal control treatment. The review does not call those controls pixel-identical or infer exact native border measurements that this reviewer did not independently see. This is a disclosed component-level difference, not the earlier hierarchy/density deviation.

## Findings corrected during this redesign

- Target markup and CSS initially disagreed about which wrapper owned the input/reset grid, risking a 32 px target input. The current control row owns the flexible input and 32 px action gutter.
- English overview initially repeated English in its badge. It now uses Default. Repeated Customer customizer headings in sidebar/main were also removed.
- Initial mobile Languages controls came after thirteen category links. The selector and Add language are now available before the category card at 390/320.
- Overview and sidebar initially used different category orders. Both now follow the same primary journey and secondary text order.
- Short-row field labels initially sat above the source/target text. They now align in the actual compact rows.
- Blanket rows=1 clipped long target wording and made a long read-only source appear blank. Refreshed captures show the full long Dutch wording, including at 320 px, and the long English instruction is readable.
- The first mobile source inset fix styled only the custom-element host and did not move its content. The final inner wrapper gives the Reference label and control a real 12 px inset while preserving the full-width shaded band.
- The focused save-failure notice initially touched the language selector. The final 320 px capture has 16 px separation and a visible recovery message.

All of those concrete findings were sent to root before closure. The latest images show the stated corrections. No remaining material composition or usability issue was found in the reviewed local states.

## Auto-size adapter review

AutoSizeTextArea renders the public Polaris control and changes only its public rows property. It reads the pinned runtime's nested open shadow tree and measures an inert, hidden HTML copy. It does not alter the real textarea's inner DOM, text, selection or scroll position. The mirror starts at one row, is removed in finally, and copies computed typography and direction, including Unicode bidi behavior. Recalculation supports growing text, replacement/shrinking text and viewport width changes. Observer cleanup, RAF cancellation, alive guards, component upgrade and font readiness are handled. Rows settle at the measured value, with a 12-line cap and standard textarea scrolling for extreme content.

This is a small presentation compatibility seam, not a domain rule. The shadow-tree shape remains a pinned-runtime dependency. If it becomes unavailable, the component falls back to a usable public multiline control. Root reports the gallery's actual native-height and geometry assertions passed; this reviewer read the mechanism and inspected the resulting long-copy pixels rather than independently rerunning that test.

## Behavior and delivery boundaries

The earlier reducer/validation corrections remain relevant: discarding an unsaved new locale selects an existing saved locale; invalid submission reveals its field; errors wait for blur or submission; failure preserves the draft and focuses a visible notice; placeholders and locale-specific plural forms remain validated; target direction is separate from the Admin/reference layout. Browser test execution is root's evidence. Full keyboard traversal, every modal's focus return, hover, dark appearance and native App Bridge Save Bar behavior were not independently exercised by this reviewer.

The editor contains app-owned customer wording only. Staff language, product/option/placement content, the theme trigger setting, Shopify product/cart/checkout and language publication retain their owning workflows. Storage is browser-local in this frontend phase. The actual selected Designer accepts validated overlays, but this review does not claim Settings-to-live-store delivery. There is no fake product preview, automatic translation service, Markets interface or unsupported publication badge.
