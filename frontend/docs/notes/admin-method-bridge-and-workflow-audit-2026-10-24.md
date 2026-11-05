# Method assignment and second workflow audit

24 October 2026. Original non-masking local preview on port 62168. This continues the [task-focused review](admin-task-focused-workflow-2026-10-24.md) and resolves its first-product method-assignment gap within the local frontend preview.

## Decisions and behavior

- A placement can choose eligible methods from the library without leaving the editor. Eligibility uses the existing manual/tag product assignments. Existing product definitions retain their names, pricing mode and prices until deliberately changed; opening the picker does not synchronize or overwrite them.
- Done imports only confirmed method definitions and applies the placement selection and size prices in one history commit. Cancel imports nothing. Other placements keep their own selections and prices.
- With no eligible methods, a native empty state offers **Save draft and open library**. Saving must succeed before navigation. Creating a method preselects the current existing product. **Back to Product setup** returns to the exact saved view and placement and opens its chooser once. Unknown or stale IDs show a recovery notice instead of opening a different placement.
- Small libraries use a compact list without search or filters. More than six methods use bounded scrolling, search and an enabled-only filter. Filtering does not clear hidden selections. Product-specific prices open a focused size-price editor. Blank remains Not offered; zero remains Free.
- Missing method references can be unchecked and replaced. Loading errors offer retry while retaining staged choices. Slow or failed library loads cannot apply a half-loaded selection.
- Movement editing hides measurement and disables size preview until the boundary task finishes. Cancel/Done clear the resolved movement-task warning. Other validation errors remain visible.
- Copy setup disables a product as a source while it is selected as a destination and explains why. The copy engine keeps its same-product guard. Copying still retains target imagery, requires alignment review and clears product prices by default.
- The demo example selector keeps its active value after a blocked switch and clears the resolved footer warning after Save/Discard. This is demo scaffolding, not a merchant workflow.

Fixed-price wording now consistently says **per location, per item**. One view/placement uses singular wording in publication review.

## Independent reviews

Seven fresh Luna agents used max reasoning. They independently covered a first-time merchant, pointer/mode conflicts, phone and keyboard recovery, copying across products, multi-size pricing, method/state contracts and a final implementation review. Two reviewers separately checked the final state guarantees. These are AI scenario walkthroughs and code reviews, not human usability testing.

Useful findings included the original method dead end, stale movement notices, cached count labels in a native select, an unavailable-method recovery trap, self-source selection during copying and stale demo selector feedback. Those were reproduced or checked against the implementation before changes were selected. A reviewer also identified missing direct coverage for Undo/Discard after importing a library method; the first-product test now exercises both.

Some suspected failures were test limitations. Four old browser checks targeted replaced controls or read slotted web-component text incorrectly. They were updated to assert the same visible behavior through current semantic controls. The accessible table showed the correct fixed-price sort order. Decimal-comma entry worked through actual keyboard input; a native automation value setter rejecting it was not treated as a product defect.

## Sources and visual checks

Shopify remains the primary reference:

- [Resource list](https://shopify.dev/docs/api/app-home/v2.0/patterns/compositions/resource-list) informed bounded resource selection, search and staged confirmation.
- [Empty state](https://shopify.dev/docs/api/app-home/v2.0/web-components/feedback-and-status-indicators/empty-state) specifies the named subheading slot. A native screenshot exposed an initially hidden explanation; a failing visibility check reproduced it before the slot correction.
- [Theme editor preview inspector](https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/preview-inspector) supports contextual inspection and mobile task focus.
- The logged-in Shopify theme editor accessibility/DOM reference was re-read. This pass makes no pixel-perfect Shopify parity claim.
- [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md) supplemented error recovery, keyboard, overflow and state checks.

Parent native browser checks covered a product with no definitions, a newly created fixed-price method, exact placement return, attaching/saving and simulated publication, plus a large method list with long names. Screenshots cover desktop, 390px and 320px states. The owner's original tab and saved corrected movement boundary were preserved. No shared Reset demo action was used for the final verification.

Evidence is under `/Users/pc/Development/Insignia/.artifacts/workflow-round2-2026-10-24/`, including `native-compact-method-chooser-desktop.png`, `native-compact-method-chooser-phone.png`, `native-large-method-chooser-desktop.png`, `native-large-method-search-320.png`, `native-method-prices-320.png` and `native-first-product-ready.png`.

## Verification and limits

The final broad relevant browser run passed all 72 tests across placement workflows, Methods workflows and first-product setup. It covers image upload processing/cancellation/errors, empty and large libraries, twelve sizes, eighteen methods, long labels, hidden selections, copying/retry, save/publication isolation, history, keyboard and combined pointer/touch canvas interactions. Focused reruns cover the final empty-state slot correction and library import Undo/Discard. The demo selector has a separate recovery test.

All 51 focused model, assignment, copy, publication and storage tests passed. Strict admin TypeScript, scoped Biome and Shopify component validation passed. The toolkit resolves the requested `2.0-rc` documentation/validation alias to `v2.0`; the local compiler/runtime retain the project's exact RC pins. Validation does not check every named slot or custom layout, so native inspection and behavioral checks remain necessary.

This is still frontend exploration. Drafts and published previews live in tab-local browser storage. Production method/configuration APIs, buyer contracts, customer designer and Shopify data were not changed. The global Methods page retains its fixture-based setup/readiness summaries; the Products overview reads actual saved local placement summaries. A production implementation still needs one authoritative backend assignment/readiness model and deliberate handling of later global-definition changes. No physical print accuracy or production publication is qualified by these checks.
