# Setup copy task redesign

Research, implementation and verification, 23 October 2026. The redesigned flow is implemented in the resettable local admin preview; production persistence and Shopify publication are unchanged.

## Recommendation

Use two contextual stages, with the second stage always reviewing the copied setup and its destination. From the placement editor, stage one selects destination products because the source is the current draft. From Products, selected destinations stay fixed and stage one selects a saved source draft. Both paths then share the same review stage. Do not add a separate confirmation step.

The review should show the source views with their normalized placement outlines, the selected destinations, and the actual copy scope. Select all views by default; let merchants enter custom selection only when needed. Keep product-specific size prices as one explicit select, defaulting to **Set on each product**; offer **Copy from source** only when applicable. Explain the material consequence beside the source preview: target photos are retained, but copied views need a target photo and alignment review. The source thumbnail illustrates the copied layout; it must not look like a preview of the target result.

| Option | Tradeoff | Decision |
| --- | --- | --- |
| One long dialog containing source, targets, scope, options, and follow-up instructions | Fewer transitions, but combines different decisions and stacks headings, options, and copy on narrow screens. | Replace. |
| Three-step source → targets → settings/confirmation wizard | Strong separation, but adds a transition and recovery state for an occasional task. | Avoid. |
| Contextual chooser → common visual review | Keeps the first stage to one missing choice, then makes the copied result and its consequences inspectable. | Recommended. |

## Evidence

Root's fresh authenticated Shopify inspection on 23 October observed the native **Create template** dialog and the **Add section** flow. Create template asks for a name and a base template; Shopify documents that the new template starts with the base template's sections and can then be changed independently. Add section presents a searchable list, then loads the chosen section's settings alongside the live preview. These are useful precedents for separating choice from visual review; they do not establish that Insignia should imitate Shopify's full editor shell. The dialogs were inspected read-only and dismissed without saving. [Shopify templates](https://help.shopify.com/en/manual/online-store/themes/theme-structure/templates), [Shopify sections and blocks](https://help.shopify.com/en/manual/online-store/themes/theme-structure/sections-and-blocks).

Printify's published help article shows a **Copy products** dialog with destination-store selection and an explicit copy action after selecting products. It also warns that some details can be lost and tells merchants to review copied products; the cross-store copy still needs manual publishing. This supports a compact destination-and-consequence review, but it copies store listings rather than Insignia placement setups, so it is not evidence for Insignia's copy semantics. [Printify: How do I duplicate products?](https://help.printify.com/en-us/articles/4483625856017-How-do-I-duplicate-products-in-Printify).

Shopify advises progressive disclosure when input depends on the preceding choice and says to avoid large forms inside max-size modals. Keep optional view selection and price controls out of the default surface; if real catalog or view counts make the shared review unwieldy, use a focused page rather than making the dialog taller. For large real Shopify catalogs, the native Resource Picker selects Shopify products; saved Insignia drafts are app-specific and need an app-backed picker. Insignia must still recheck its own target-readiness rules after resource selection. [Shopify forms guidance](https://shopify.dev/docs/apps/design/user-experience/forms), [Resource Picker API](https://shopify.dev/docs/api/app-home/latest/apis/user-interface-and-interactions/resource-picker-api), [Picker API](https://shopify.dev/docs/api/app-home/latest/apis/user-interface-and-interactions/picker-api).

## Copy contract and safety constraints

- Copy creates independent target drafts. It does not link targets to the source or publish them.
- Views, placement rectangles, sizes, and method assignments are copied. Source images, calibration, and legacy/manual image dimensions are not. Target product identity and media remain intact. Every copied view needs its own target image and alignment review.
- Methods and sizes travel together because excluding them creates an empty shell. Missing methods used by copied placements are added. An existing target method with the same ID keeps its target definition.
- Product-specific prices are opt-in and default off. A value transfers only when both the source method and the effective target method use product-specific pricing; explicit zero is a valid price. Avoid implying all method or price settings copy unchanged.
- All source views are selected initially. Empty views remain valid scaffolding and may be copied; label them **No placements** in the review. If all selected views are empty, show that consequence before applying rather than silently rejecting the copy.
- Existing target setups are never overwritten or merged. Re-read target readiness at apply time. If any selected target is occupied, unavailable, or cannot be checked, stop the batch preflight and let the merchant remove blocked targets. Storage failures can still produce partial per-target results: distinguish successes from failures, preserve the original scope for retries, and never claim the batch was atomic.
- On phones, keep stage navigation and selected target context visible, keep source thumbnails bounded/scrollable, and preserve choices when returning to the chooser. Cancellation before apply must leave drafts unchanged.

## Implemented interaction

The editor now opens a destination chooser with search, retained selection across pages, and a selected-only view. Products overview already knows the targets, so it instead shows saved source setups as resource rows; selecting one proceeds directly to the shared review. Neither chooser writes drafts.

Review leads with the source identity and actual source images with normalized placement outlines. View selection is available through **Edit views**, rather than displaying a wall of checked boxes by default. Recipients are inspectable through **To N products**; size prices use the native select described above. The main consequence stays visible: **Choose product images after copying.** Less frequent compatibility details live behind an inline information disclosure. There is no nested popover competing with the modal's Escape handling.

Desktop uses a visual grid and a compact options column. On phones, view cards form a bounded horizontal strip and options follow beneath it. The native modal retains its Back/Copy actions. Larger view sets scroll within a bounded region; four-view setups do not get an unnecessary inner vertical scrollbar. Image bounds and outlines preserve the source aspect ratio.

Results distinguish successful, failed and blocked products, link to copied products, and provide one follow-up instruction. Deterministic compatibility failures are blocked rather than offered as blind retries. Transient storage failures remain retryable with the original scope. Persisted reports include a source signature: if the source draft changes, old results remain readable but retry is disabled with an explanation. Existing reports without a signature are readable, but cannot silently resume against a different source. Published setups and duplicate method IDs fail closed.

## Verification and evidence

Three independent Luna xhigh reviews compared the alternatives and reviewed failure cases. Fresh authenticated Shopify DOM inspection covered Create template and Add section; both were dismissed without saving. Native Shopify Save remained disabled after inspection. Printify's published copy-dialog image was also inspected; no competitor account or write action was used.

Relevant verification passed:

- Three focused browser workflows: staged editor/overview copy; partial failure followed by changed-source retry protection; and selection across a 61-product searchable catalog. The catalog includes two allowlisted eligible targets and unavailable filler rows; this does not claim 61 fully copyable production products.
- Responsive and geometry checks at desktop, 390px and 320px, including Back/cancel without writes, zero-view disabling, source/target identity, occupied/published protections, retained scope, preview aspect ratio and caption containment.
- Four copy-engine unit checks, scoped admin TypeScript, scoped Biome and diff whitespace checks.
- Pinned Polaris App Home 2.0-rc validation: dialog artifact revision 7; shared review artifact revision 2. Standard semantic HTML handles composition and disclosure; custom preview graphics are not Polaris components.
- Live desktop and phone browser inspection after the final build, including Escape from the information disclosure with no orphan overlay. Screenshot files were checked for actual viewport dimensions after a resize-capture timing issue was caught and corrected.

Screenshots: [destination chooser](/tmp/insignia-copy-task-choose-desktop.png), [desktop review](/tmp/insignia-copy-task-review-desktop.png), [390px phone review](/tmp/insignia-copy-task-review-phone.png). Authenticated native references: [Create template](/tmp/insignia-reference-create-template.png), [Add section](/tmp/insignia-reference-section-picker.png).

This is a frontend prototype, not a native Shopify Resource Picker integration. Copy creates browser-tab drafts only. Existing source/target media, calibration, method identity, no-overwrite and explicit image-review rules remain material limits of the operation. No live store data was changed or published.


## Independent flow review and polish follow-up

A further three independent Luna xhigh reviewers covered merchant decisions, interaction/accessibility, and recovery. They were asked to distinguish observable defects from preference and avoid expanding this occasional task into another setup editor. Root inspected both actual local entry points, applied a copy in an isolated tab, followed the destination handoff, and freshly opened/dismissed Shopify's native Create a template dialog without saving.

The additional reference review compared [Shopify product duplication](https://help.shopify.com/en/manual/products/add-update-products), [Printful copy/templates](https://help.printful.com/hc/en-us/articles/50263450185873-Can-I-copy-my-products), [NN/G progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) and the current [Vercel interface rules](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). These support exposing consequential choices while deferring less common controls. They do not prove a universal optimum or replace merchant usability testing. Printful templates illustrate reuse followed by destination editing; their product/store semantics are not copied into Insignia.

Accepted changes:

- Products-first selection keeps recipients visible before choosing a source. Up to three recipient names remain visible; larger sets can be expanded. Change products returns to the existing table selection instead of inventing a second recipient editor. The editor path uses its existing Back action.
- Review states **Creates independent drafts. Add product images and review alignment before publishing.** The price compatibility condition appears beside the select when Copy from source is chosen.
- Products and editable view cards now have one native checkbox keyboard stop. The non-focusable row/card delegates only additional pointer clicks to the same selection state and ignores checkbox events. This is a narrowly documented accessibility-lint exception: the keyboard action stays in the native checkbox, rather than adding a second button or a dummy keyboard handler. Public component internals are untouched. Hover, selected-hover and focus states do not change geometry.
- Completion uses the base resource-list modal size and per-product Review setup links with unique accessible names.

Review findings were checked rather than accepted wholesale. Actual runtime DOM showed that source s-clickable rows render native buttons, so the claim that those actions lacked button semantics was rejected. Rich checkbox labels were not adopted based on types alone: the inspected runtime had no public label slot. Programmatically focused stage regions are orientation targets, while keyboard interaction and focus indication remain in the native controls. A complete alternative numeric description of every placement rectangle was not added to this view-selection task.

Live screenshots caught a narrow recipient-column issue after the first context change. Count/action and recipient names now occupy separate rows, and a browser assertion prevents the names from sharing the action's narrow column. Small phone modals intentionally scroll their body while keeping native footer actions available; both the initial view and lower options were visually checked.

The three relevant browser workflows pass, including the extended staged flow at 1440/390/320px. Added assertions cover one tab stop per product/view, whole-card/title pointer selection, unchanged table selection after Change products, full-width recipient names, absence of a duplicate editor Change action, and compact result width. The original partial-failure/source-signature and 61-product paging checks remain green. Scoped TypeScript/Biome and diff checks pass. Pinned public Polaris validation passes at dialog revision 9 and review revision 3.

Fresh evidence: [source chooser](/tmp/insignia-copy-polished-source-picker.png), [desktop review](/tmp/insignia-copy-polished-desktop.png), [phone review](/tmp/insignia-copy-polished-phone.png), [phone lower options](/tmp/insignia-copy-polished-phone-options.png), [completion](/tmp/insignia-copy-polished-results.png). Captured files were checked at their actual 1212×1000 or 390×844 dimensions. The original user tab and native Shopify data were not changed; copies were applied only in the isolated local preview tab.
