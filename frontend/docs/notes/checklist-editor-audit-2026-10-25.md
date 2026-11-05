# Product editor Checklist Design audit — 25 October 2026

This is the Product editor slice of the larger screen audit: all 33 `Product editor` IDs in the 24 October manifest, plus the current configured editor base at desktop and phone widths. It is a research-only design audit; it did not edit application, fixture, test, build, screenshot-gallery, or documentation content outside this report. The audit's only write is this report.

## Findings to carry forward

- **Evidence gap · Accessibility governance.** The repository search did not surface a project-level WCAG target, contrast-ratio standard, or accessibility contribution checklist. Shopify Polaris documents component behavior and semantics for several controls used here, but this audit did not locate external team policies or establish an app-wide conformance commitment. These rows remain `Can't tell`, not confirmed UI defects. To settle governance, verify the team policy; to assess the rendered UI, perform keyboard traversal/focus-return checks and VoiceOver/NVDA review on representative desktop and phone flows. Confidence that a local policy was not found: medium; confidence about external policy: none.
- **Watchpoint · Phone Draft status.** In the live 390×844 base, `Save draft` and `Publish` are visible, but there is no separate `Draft` status label; the manifest also records that the phone header omits it. A status item is visible in the 1440×1000 `draft-status` capture. The evidence shows a label difference, not that merchants mistake the current state. Keep this as a low-confidence observation; revisit only if user evaluation or the product state model establishes actual confusion. No change is recommended from this audit alone.
- **Prototype integration boundary — not a new UX finding.** The actual product route imports production `MerchantConfigEditor` ([config.astro:32–34](</Users/pc/Development/Insignia/insignia/apps/web/src/pages/admin/products/[productId]/config.astro:32>)). The local preview host separately builds the test-only `placement-workflow-preview.tsx` ([preview.mts:68–100](</Users/pc/Development/Insignia/insignia/apps/web/test/admin/preview.mts:68>)); the capture test seeds disposable preview fixtures ([popup-gallery-editor.test.mts:292–305](</Users/pc/Development/Insignia/insignia/apps/web/test/admin/popup-gallery-editor.test.mts:292>)), and setup-copy is expressly marked preview-only ([placement-setup-copy-dialog.tsx:1](</Users/pc/Development/Insignia/insignia/apps/web/test/admin/support/placement-setup-copy-dialog.tsx:1>)). Therefore the dialogs and workflows in this audit establish the current prototype composition, not production integration or persistence. In particular, `Copy setup to products` is present in the test preview ([placement-workflow-preview.tsx:1828–1834](</Users/pc/Development/Insignia/insignia/apps/web/test/admin/support/placement-workflow-preview.tsx:1828>)), not in the production island. Keep this boundary separate from UI quality.

No new visual issue was clear enough to recommend changing the owner-reviewed composition. Add views remains accepted; the product-image grid and image-replacement radio group remain intentional. The inline image-measurement estimate and its contextual popover are also retained as a deliberate workflow choice. See the existing decisions in [admin-gallery-comments-2026-10-24.md:89–90](</Users/pc/Development/Insignia/insignia/docs/delivery/notes/admin-gallery-comments-2026-10-24.md:89>) and [setup-reuse-and-image-scale-2026-10-23.md](</Users/pc/Development/Insignia/insignia/docs/delivery/notes/setup-reuse-and-image-scale-2026-10-23.md>).

## Method and evidence limits

The audit uses the bundled Checklist Design v3.2.4 material: [index](</Users/pc/.codex/skills/checklist-design/references/index.md>), [audit rules](</Users/pc/.codex/skills/checklist-design/references/audit.md>) and the matching local checklist files. Each table below follows the checklist’s item order and preserves each item name and full description. I did not retrieve Checklist Design pages from the web. For component-specific interpretation, Shopify’s official App Home Polaris contracts govern: [modal](https://shopify.dev/docs/api/app-home/latest/web-components/overlays/modal), [drop zone](https://shopify.dev/docs/api/app-home/latest/web-components/forms/drop-zone), [text field](https://shopify.dev/docs/api/app-home/latest/web-components/forms/text-field), [button](https://shopify.dev/docs/api/app-home/latest/web-components/actions/button), and [popover](https://shopify.dev/docs/api/app-home/latest/web-components/overlays/popover). The repository’s [admin UI guidance](</Users/pc/Development/Insignia/insignia/docs/delivery/notes/admin-ui-guidance-2026-10-20.md>) pins the preview to Polaris 2.0 RC; this report does not recommend changing that runtime.

I inspected the actual PNGs for every manifest ID: desktop captures are 1440×1000; phone captures are 390×844 except `add-views-no-results`, which is 320×568. The sole exception is `draft-status`, which has desktop only. Each available capture is linked below, including the stress-state capture. I also read the current local preview live at 1280×720 and 390×844 using CUA, then restored the viewport and closed the transient help popover. No save, publish, upload, or fixture mutation occurred. The live base is linked as a local route because it is not a manifest PNG.

Static images establish layout, hierarchy, and visible copy, not complete keyboard, focus-trap, validation, upload, save, or screen-reader behavior. Source is used to identify controls and declared state handling; it does not prove that each state works in the rendered production route. I did not intentionally type into fields or run screen-reader/contrast tooling. For live product workflow behavior, the project’s earlier delivery notes record focused checks, but those checks were not rerun for this audit.

### Checklist-family coverage

| Checklist | Screens / states covered once at family level |
|---|---|
| Modal | All 21 dialog IDs in the manifest matrix below. |
| Input field | Add method, price, measurement, search, copy, and live editor fields where present. |
| Button | All 33 captured states and the live configured-editor base. |
| Dropdown menu | The six menu IDs in the matrix below. |
| Accessibility | All 33 captured states and the live desktop/phone editor base; system-process rows are repository-level. |
| Spacing / Grid | All captured editor layouts and the live base; source values are reviewed alongside the screenshots. |
| Checkbox | Multi-selection in Add views, setup-copy, and Manage methods. |
| Radio | `change-view-image` single-image selection. |
| Tabs | Live phone base panel navigation (`Views & placements`, `Settings`). |
| Searchbar | Image, product, and method chooser searches where shown. |
| Uploading media | `add-views` and `add-views-no-results`. |
| Saving changes | Live base, Draft, discard/leave guards, publish review, and source state handling. |
| Showing input error | Applicable editable form states; normal valid-state captures only. |
| Submitting a form | Method/price forms and preview copy/review flow. |
| Empty state | First-view, no-images, and no-search-results states; blocked publish is an adjacent recovery state. |
| Single Item Detail | Live configured product editor, Draft, measurement, and first-use editor pages. |

### Manifest evidence matrix

Every assigned ID has both desktop and phone image coverage below, except the manifest’s intentional desktop-only `draft-status`. Links point to the original screenshots, not contact sheets.

| ID | State evidence | Desktop | Phone |
|---|---|---|---|
| `add-product-method` | Name a method within this product; helper explains its scope and that placement prices follow. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/add-product-method.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/add-product-method.png) |
| `add-views` | Owner-accepted upload and image-library state: drop zone, filters/search, usage, multi-selection and fixed actions. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/add-views.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/add-views.png) |
| `add-views-no-results` | No-match state with guidance, Upload image and Show all images; phone capture is 320×568. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/add-views-no-results.png) | [320×568](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/add-views-no-results.png) |
| `canvas-controls` | On-demand canvas help lists zoom, pan, move, undo/redo and keyboard modifiers. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/canvas-controls.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/canvas-controls.png) |
| `change-view-image` | Single-choice image gallery for replacing a view image. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/change-view-image.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/change-view-image.png) |
| `copy-placement` | Choose a destination view for an independent placement copy. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/copy-placement.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/copy-placement.png) |
| `copy-review-50-products` | Large-recipient stress state; the isolated capture uses a plain gray background, not the editor shell. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/copy-review-50-products.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/copy-review-50-products.png) |
| `copy-source-chooser` | Choose a source product from the preview catalog. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/copy-source-chooser.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/copy-source-chooser.png) |
| `copy-destinations` | Choose destination products and review the recipient count. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/copy-destinations.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/copy-destinations.png) |
| `copy-review` | Review views and optional product prices; alignment review is explained. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/copy-review.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/copy-review.png) |
| `copy-review-selected-products` | Browse the selected destination products during review. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/copy-review-selected-products.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/copy-review-selected-products.png) |
| `copy-about-settings` | Explains what the setup copy includes and excludes. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/copy-about-settings.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/copy-about-settings.png) |
| `method-size-prices` | Enter prices by decoration size, with unavailable/free semantics. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/method-size-prices.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/method-size-prices.png) |
| `discard-changes` | Confirm discarding the current draft changes. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/discard-changes.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/discard-changes.png) |
| `draft-status` | Desktop outline shows Draft; no matching phone capture exists and the phone header omits this label. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/draft-status.png) | No phone capture — not in manifest |
| `fixed-product-method-price` | Edit a retained product-wide price; helper distinguishes blank and zero. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/fixed-product-method-price.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/fixed-product-method-price.png) |
| `editor-actions` | Editor menu offers Copy setup; Discard changes is disabled in this clean fixture. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/editor-actions.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/editor-actions.png) |
| `estimated-dimensions` | Contextual explanation of image-based estimated artwork dimensions and uncertainty. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/estimated-dimensions.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/estimated-dimensions.png) |
| `measurement-actions` | Measurement action state with Redraw line and Clear measurement available. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/measurement-actions.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/measurement-actions.png) |
| `leave-unsaved` | Confirm leaving while draft changes remain unsaved. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/leave-unsaved.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/leave-unsaved.png) |
| `manage-decoration-methods` | Choose methods for this product and edit method-specific prices. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/manage-decoration-methods.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/manage-decoration-methods.png) |
| `placement-actions` | Context actions for one placement, including copy, move and removal. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/placement-actions.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/placement-actions.png) |
| `unconfigured-editor` | First-use page pairs the product image with a clear Add view task. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/unconfigured-editor.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/unconfigured-editor.png) |
| `unconfigured-editor-no-images` | First-use page without a product photo, using the neutral records illustration. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/unconfigured-editor-no-images.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/unconfigured-editor-no-images.png) |
| `publish-blocked` | Publication blocker identifies the missing first view and offers Add view recovery. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/publish-blocked.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/publish-blocked.png) |
| `publish-setup` | Review product setup before publication; local-preview wording explicitly disclaims Shopify writes. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/publish-setup.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/publish-setup.png) |
| `remove-placement` | Confirm removal of one placement and its scoped setup. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/remove-placement.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/remove-placement.png) |
| `remove-view` | Confirm removal of one view and the contained placements. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/remove-view.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/remove-view.png) |
| `inspector-placement-actions` | Selected placement menu with rename/duplicate/reorder/remove actions. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/inspector-placement-actions.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/inspector-placement-actions.png) |
| `inspector-view-actions` | Selected view menu with view-level actions. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/inspector-view-actions.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/inspector-view-actions.png) |
| `copy-results` | Copy result summary with a direct destination-review action. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/copy-results.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/copy-results.png) |
| `view-actions` | View-row menu with rename/duplicate/copy/reorder/remove actions. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/view-actions.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/view-actions.png) |
| `outline-actions` | Outline menu with Expand all views and Collapse other views. | [1440×1000](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/desktop/outline-actions.png) | [390×844](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/editor/mobile/outline-actions.png) |

**Live base in addition to the matrix:** [local configured editor route](http://127.0.0.1:62168/admin/products/15468416336256/config), observed at 1280×720 and 390×844. Desktop shows the four-view/six-placement editor, selected garment canvas, inspector and a clean disabled Save draft action. Phone stacks the canvas above the two panel tabs and the selected view list. The visible `Local demo` footer belongs to the preview host.

## Audit tables

Every row includes a reason. “Not needed” means the checklist feature does not serve this bounded editor task; “Can’t tell” means the supplied state or allowed observation does not establish the behavior. Item text is copied from the matching bundled checklist; optional tips are omitted.

### [Modal — Design system](https://www.checklist.design/design-system/modal)

| | Item | Why |
|---|---|---|
| 🟢 Present | **Title** — Clear, simple text explaining the action of the modal | The 21 dialog captures name their task (add views, edit price, copy review, remove, publish) in the heading. |
| 🟢 Present | **Actionable item** — A button or link to continue or close the event | Footer actions state the next operation, such as Add view, Done, Publish or Remove, with a separate Cancel/Back where staging is involved. |
| 🟢 Present | **Close action** — A way to exit the modal | The paired captures show a close affordance or named Cancel/Back/Done route; dismissal behavior itself was not tested for every dialog. |
| 🟢 Present | **Responsiveness** — Consider the size of the modal on different device sizes, and whether a modal is suitable on all | All dialog states have desktop and phone captures; the Add views no-result case also fits the 320×568 short-phone viewport. |
| 🟡 Partial | **Background change behind modal** — Darken, blur or lighten - change the background behind the modal to bring focus to it | Normal dialogs dim the live editor; the 50-recipient stress fixture uses a plain gray isolated background, so it does not evidence a real underlying page in that state. This is a capture-harness limit, not a product backdrop defect. |
| 🟢 Present | **Description** — Incase they require more information to understand how to make their decision | Confirmation bodies state affected setup; copy and pricing dialogs explain scope; simple one-field tasks provide direct helper copy. |

### [Input Field — Design system](https://www.checklist.design/design-system/input-field)

| | Item | Why |
|---|---|---|
| 🟢 Present | **Input field** — Interactive text field for user to enter their data into | Method names, prices, search queries, measurement values and placement details use visible editable controls in the applicable states. |
| 🟢 Present | **Label** — Stating what information the user is meant to provide | Price, size, placement and measurement controls have nearby visible labels; the product-image search uses an accessibility-only label in source. |
| 🟢 Present | **Placeholder text** — Text inside the input field acting as an example of what you want the user to enter | The name field and search controls expose short task-appropriate placeholder text; blank price behavior is described separately. |
| 🟢 Present | **Data format** — Set text fields to allow the relevant text values e.g. numeric only for phone number | Percentages and amounts use numeric controls; currency/percent markers and the price helper communicate units and locale. |
| ⚪ Not needed here | **Illustration or icon** — A visual cue can help break up a long list of text fields | These are compact task forms; an icon inside every name/price input would add decoration rather than improve entry. |
| 🟢 Present | **Hint** — Elaborate on the title of the text field incase a user struggles to know what to enter | The method dialog explains product-only scope; price fields distinguish blank from zero; measurement copy describes estimate limits. |

### [Button — Design system](https://www.checklist.design/design-system/button)

| | Item | Why |
|---|---|---|
| 🟢 Present | **Base style** — Your default style, one of the following: fill, outline, underline | Primary and secondary actions use Shopify Polaris button styles consistently across the modal and editor states. |
| 🟢 Present | **Shape** — Visual properties of a button: padding, border, border radius, shadow | Buttons retain consistent native control height, padding and rounded shape in both captured widths. |
| 🟢 Present | **Variants** — Each visual type to represent button structure e.g. primary and secondary buttons | Primary action, secondary cancel/back and tertiary utility actions are visually distinct; destructive actions use critical tone. |
| 🟢 Present | **Copy** — Instructional text that details what will happen if you click the button | Actions use direct verbs and identify scope where needed (Add view, Copy setup, Save draft, Publish, Remove). |
| 🟡 Partial | **States** — How the button changes based on the interaction: hover, focused, disabled | Static pairs show enabled/disabled and critical variants, and the live base shows a visible focus ring; they do not cover hover/focus/loading for every button. |

### [Dropdown Menu — Design system](https://www.checklist.design/design-system/dropdown-menu)

| | Item | Why |
|---|---|---|
| 🟢 Present | **Trigger affordance** — The element that opens the menu: an overflow icon, chevron button, or right-click target | The six menu pairs use labeled overflow or contextual controls anchored to the editor, view, placement, or outline. |
| 🟢 Present | **Menu item anatomy** — The structure of each action: label, optional leading icon, optional trailing shortcut, optional destructive styling | Items are text-led and scannable; removal uses a critical label at the bottom of placement/view menus. Icons and shortcut labels are optional for these short task lists. |
| ⚪ Not needed here | **Section dividers and groups** — Dividers and/or labels that break related actions into sections once the menu gets large | Menus are short single-context action lists, so grouping would add structure without improving scanning. |
| 🟢 Present | **Destructive item styling** — Visual differentiation — typically the danger colour — for actions that cannot be undone | Remove placement/view is red and last; the editor’s Discard changes item is disabled when the clean fixture has nothing to discard. |
| ⚪ Not needed here | **Nested submenu** — A secondary menu triggered by a parent item, used for grouping related but distinct actions | No menu has enough related actions to justify another level; current menus stay flat. |
| 🟢 Present | **Disabled items** — Menu items that are visible but cannot be triggered, indicating an unavailable action | The clean editor shows disabled Discard changes; this is the exact state in which that action is unavailable. |
| 🟢 Present | **Positioning and overflow** — The menu's placement relative to its trigger, repositioning automatically to stay within the viewport | Desktop and phone pairs keep each menu attached to its trigger and within the visible surface. |
| ⚪ Not needed here | **Keyboard shortcut display** — Shortcut hints aligned to the trailing edge of the item label | No menu action has a dedicated shortcut that a merchant needs to learn; canvas shortcuts are documented in the separate controls popover. |

### [Accessibility — Design system](https://www.checklist.design/design-system/accessibility)

| | Item | Why |
|---|---|---|
| ❔ Can't tell | **Target conformance level** — The WCAG conformance target the team has committed to documented and referenced in contribution guidelines. AA as a baseline for most products, with AAA achievable for specific criteria such as text contrast. | No target or linked contribution guideline surfaced in the repository search; an external design-system or team policy could establish one. |
| ❔ Can't tell | **Colour contrast standards** — The contrast ratios verified across all text and interactive element colour combinations (4.5:1 for normal text, 3:1 for large text and UI components) | The screenshots look legible, but this pass did not measure combinations; a contrast measurement across actual Polaris-rendered states would settle it. |
| 🟡 Partial | **Focus indicator design** — A visible, high-contrast focus indicator designed for every interactive component | The live help trigger shows a clear ring and the image/source contain focus styling, but no representative focus capture covers all menu, checkbox, radio, input and modal controls. |
| 🟡 Partial | **Keyboard navigation patterns** — Standard keyboard interaction patterns documented and applied consistently e.g. arrow keys for menus and listboxes, Enter and Space for activation, Escape for dismissal | Source and the help popover document keyboard alternatives; I verified Escape closes the live popover, but did not exercise every menu, list, dialog, or phone control. |
| 🟡 Partial | **ARIA pattern library** — Attributes that make web content accessible to those who use assistive technologies with roles, states, and properties defined for every interactive component pattern | The test editor uses explicit accessible labels, checked/pressed states and live status; the capture/source sample is not a complete production route-wide ARIA audit. |
| ❔ Can't tell | **Screen reader testing** — Components tested with at least VoiceOver on Safari and NVDA on Chrome before shipping | No screen reader was run in this research-only pass; the repository notes do not document this exact coverage. |
| ❔ Can't tell | **Accessibility annotations in design** — A shared annotation kit used in design files to specify ARIA labels, roles, reading order, and focus behaviour | No linked design-system file or annotation kit is part of the supplied editor evidence; a design-file review would settle whether one exists. |
| ❔ Can't tell | **Accessibility in contribution guidelines** — Ensuring accessibility requirements are part of the component contribution checklist | No contributor checklist defining these requirements surfaced in the inspected repository material; the team contribution guidance would settle this. |

### [Spacing / Grid — Design system](https://www.checklist.design/design-system/spacing-and-grid)

| | Item | Why |
|---|---|---|
| 🟡 Partial | **Spacing scale** — A defined set of spacing values (typically base-4 or base-8, covering 4, 8, 12, 16, 24, 32, 48, 64, 96) used for all margin, padding, and gap decisions | The rendered editor has a clear rhythm, but preview CSS mixes 4/8/12/16/24/32 with 2/10/20/44px values rather than a single documented scale. |
| 🟡 Partial | **Semantic spacing tokens** — Named tokens for spacing that describe purpose (space-component-padding-sm, space-layout-section-gap) so spacing decisions are intentional, not arbitrary | Polaris owns much native component spacing; app-owned preview CSS still declares raw pixel gaps/padding (for example the picker and manager styles). |
| 🟡 Partial | **Column grid** — A defined column grid for each major breakpoint (typically 4 columns mobile, 8 tablet, 12 desktop) with gutter and margin values specified | The three-panel desktop and single active phone panel are well composed, but the inspected sources define component grids rather than a shared breakpoint column grid. |
| 🟡 Partial | **Breakpoints** — A named set of breakpoints (sm, md, lg, xl) that are shared between design and code, so responsive behaviour is described in consistent terms across both disciplines | Responsive thresholds are implemented, but they are numeric source conditions rather than named shared breakpoints in design and code. |
| 🟢 Present | **Component vs layout spacing** — A clear distinction between spacing used inside components and spacing used to compose layouts, since different scales often apply to each | Polaris components keep their own internal padding while editor panels use separate grid gaps and section spacing. |
| ⚪ Not needed here | **Density variants** — Where applicable, defined compact and comfortable density modes, common in data-heavy products where users need to choose between information density and breathing room | This visual editor is not a dense table; fixed responsive composition is more appropriate than a user-selectable density setting. |
| 🟡 Partial | **Baseline grid alignment** — Text baselines and component heights designed to align to the base unit, so stacking elements produces predictable, harmonious vertical rhythm | Inputs and labels align cleanly in the images, but custom row/touch heights and the lack of a stated base unit prevent confirming a shared baseline rule. |

### [Checkbox — Design system](https://www.checklist.design/design-system/checkbox)

| | Item | Why |
|---|---|---|
| 🟢 Present | **Label** — Text paired with the checkbox to indicate what is enabled if selected | Product, view, method, and customer-option choices have descriptive visible and/or accessible names. |
| 🟢 Present | **Default selection** — Whether the checkbox is selected or not | Defaults match the task: views included in a setup copy start selected; destination/product and Add views choices remain explicit choices. |
| 🟢 Present | **Style** — Make sure checkbox is unique and stands out from other input options, and consider whether it's in a container, how it's grouped, and what colour it uses | The check mark is visually distinct from radio image selection and sits within its image or method row context. |
| 🟡 Partial | **States** — Default, hover, focused, active and disabled (see documentation tab for examples) | Selected and unselected states are shown, and source declares disabled behavior; a full hover/focus/disabled visual sweep was outside this pass. |

### [Radio — Design system](https://www.checklist.design/design-system/radio)

| | Item | Why |
|---|---|---|
| 🟢 Present | **Label** — Text associated with the radio input | Each image option has its name and usage context; source attaches an accessible label and description. |
| 🟢 Present | **Grouping** — There must be more than one radio option for the experience to work | The replacement-image chooser presents multiple alternatives in one image set. |
| 🟢 Present | **Default selection** — Start with a radio option selected | The current image is selected on entry, preventing an accidental blank replacement. |
| 🟢 Present | **Style** — Make sure radio is unique and stands out from other input options | The single-choice mark is distinct from the multi-select image checkboxes used by Add views. |
| 🟢 Present | **Clickability** — Consider what is clickable to make the radio option active (text label, container) | Source wraps the thumbnail and its details in a label, making the complete image choice activate the radio. |
| 🟡 Partial | **States** — Radio can be default, active and disabled (see examples below) | The gallery shows selected/unselected choices; no disabled/focused radio image is included. |

### [Tabs — Design system](https://www.checklist.design/design-system/tabs)

| | Item | Why |
|---|---|---|
| 🟢 Present | **Labels** — Name of each tab | Phone editor tabs are concise and predictable: Views & placements and Settings. |
| 🟢 Present | **Content area** — Where the content for the active tab is displayed | The active phone tab displays its named panel below the tab strip; canvas remains above it. |
| 🟢 Present | **Style** — How the active tab and inactive tabs differentiate visually, as well as the tab container overall | The active panel has a clear underline and stronger text; inactive panel remains visible as a neighboring choice. |
| 🟢 Present | **Item order** — Consider the arrangement of tabs to be ordered by popularity or familiarity | The outline/placement navigation is first, followed by settings, matching the common task sequence. |
| 🟡 Partial | **States** — Default, active, hover are the key states | Active/inactive are visible; hover and keyboard switching were not verified in this pass. |

### [Searchbar — Design system](https://www.checklist.design/design-system/searchbar)

| | Item | Why |
|---|---|---|
| 🟢 Present | **Input field** — A clear container for a user to start typing in | Search is a distinct Polaris field in image and product/method chooser states. |
| 🟢 Present | **Label or placeholder text** — Identify the purpose of the field is for them to search | Search scope is named in source and the visible placeholder is short; the no-results state repeats the search context. |
| ⚪ Not needed here | **Quick links, autocomplete and suggestions** — As the user is typing, offer available links and phrases based on what they have entered so far | A small, fixed product-image library does not have useful query suggestions or search history to surface. |
| ⚪ Not needed here | **Submit search button** — A visible link to submit search and view results | These pickers filter as the query changes; a separate submit action would duplicate the live result update. |
| ⚪ Not needed here | **Previous searches** — Showing what a user has searched before can speed up their experience if they frequently search the same queries | These are contextual, short-lived selection dialogs, not a recurring global search destination. |
| 🟢 Present | **Appropriate visibility** — Search should be directly linked to what you are looking for, whether it's searching across the entire platform or in a specific area | The image, product, or method picker keeps search inside the collection being selected and provides a clear no-match recovery. |

### [Uploading media — Flows](https://www.checklist.design/flows/uploading-media)

| | Item | Why |
|---|---|---|
| 🟢 Present | **Empty state** — Show a clear visual placeholder with an upload icon and simple text that indicate a file can be dropped into the area to upload. It’s also suitable to offer a click to upload route incase a user prefers that option. | The accepted Add views surface shows a public drop zone with an upload action and concise supported-file helper; no-image setup state says what the upload creates. |
| ❔ Can't tell | **Drag and drop interaction** — When a file is across the interaction canvas, there should be a clear visual state change to indicate it has detected a file attempting to be dropped. This lets the user know it’s safe to release the file at this point. | Source uses the public Polaris drop zone and handles rejection, but no drag-over screenshot is in the evidence set; a transient drag-state capture would settle the visual feedback. |
| 🟡 Partial | **Progress indicator** — Display progress that updates in real-time so users know their upload is working. If a percentage is not possible to show, a loading indicator can at least show that something is happening. Include file names and show overall progress when uploading multiple files to keep users informed throughout the process. | Source exposes an `aria-live` “Processing images…” status and blocks re-entry; it has no per-file/overall percentage, and the processing state is not captured. This is local image conversion rather than a network transfer. |
| 🟢 Present | **File restrictions & constraints** — Clearly state limits to what files can be uploaded. This is commonly file size and format, shown in the upload area before users attempt to upload files. If a user tries to upload a file outside the constraints, an error message should show explaining it does follow the constraints. | The upload tile states 5 MB; source accepts JPEG/PNG/WebP and presents rejected-file errors with the constraint. |
| 🟢 Present | **Outcome status** — Use visual indicators like green checkmarks for successful uploads and red warning icons for failures. For failures, include an error message explaining what went wrong and what users can do to fix it. | New images are selected and shown in the gallery; selection checkmarks confirm inclusion, and failed formats/errors receive critical banner copy. |
| 🟡 Partial | **Upload actions** — Ways to interact with an upload. Choose which actions to show by default vs on hover based on available space, aiming to avoid overwhelming users with too many visible options. Common actions include: Retry failed uploads Cancel upload in progress Delete files Rename files | Upload, select, clear selection and dialog cancellation are available; retry is by choosing files again. Per-file deletion/rename and mid-process cancellation are not part of this product-image chooser. |
| 🟢 Present | **Showing multiple uploaded files** — Display files in a clean list or grid with thumbnails when possible, and ensure the layout you choose is scalable. What information you show about each file depends on the context of the upload. A file name or size can be relevant in one case, while seeing the images you uploaded can be the relevant detail in another. | The chooser uses a scrollable thumbnail grid with image name and usage; captured desktop and phone layouts keep selection and footer reachable. |

### [Saving changes — Flows](https://www.checklist.design/flows/saving-changes)

| | Item | Why |
|---|---|---|
| 🟢 Present | **Show action that enables change** — There should be an action to enable information to be updated. It may be automatically editable, but that can be riskier for some software. If it is read-only by default, then a button can trigger the editable version to then update and save. | The configured editor exposes direct fields; the clean live base shows Save draft disabled until a change is staged. |
| 🟢 Present | **Disable save action until changes are made** — An action should be visible as a source of confirming changes to be saved - this is usually a button. Initially, the action can be disabled. It indicates no changes have been made, and there is nothing to save. A common location for this action is in the navigation above the fold, so it's always visible over the content. Another option is after all the content that's editable. | Save draft is visible and disabled in the clean live base, at the persistent top action area. |
| 🟡 Partial | **State changes to active once a change is made** — In the example, we've changed the email address, which means a change is waiting to be saved. Changing the button state to active brings the user's attention to the action. | Source tracks dirty/saving/saved states, but the allowed live inspection did not edit a fixture, so the active after-edit visual is not confirmed here. |
| 🟡 Partial | **Action changes to loading state when pressed** — Now that the changes are being saved, you want to show that action is in progress. You can do so with a loading spinner in the action, as the user's view will be on that element. | The production island has a saving state; no saving action was submitted in this research pass and no loading screenshot is assigned. |
| 🟡 Partial | **Notify changes have been saved** — The page will reload or update, and this is the critical part. The user should now be informed that their changes have been saved. They can now safely leave the page, knowing the details are locked in until they choose to change them again. | Source tracks a saved result and prior delivery notes record save feedback checks, but the corresponding success visual was not re-observed or captured here. |

### [Showing input error — Flows](https://www.checklist.design/flows/showing-input-error)

| | Item | Why |
|---|---|---|
| 🟢 Present | **Keep the input in default state** — The text field should be checked for errors only after the information has been entered. | Normal captured forms open without error styling; no fields begin in a spurious invalid state. |
| 🟢 Present | **Allow user to enter information** — Let the user type without interruptions and submit the information aka don't assess as changes are made. | The name, price, search and numeric fields are editable; the live base AX tree exposes their field/stepper values. |
| ❔ Can't tell | **Signal error after loss of focus** — After the input has lost focus (user has clicked another element), the field should be assessed. Looks like we have an error here! In this case, explain why the error happened, and what is required to resolve it. For accessibility, combine the text with a visual icon that indicates an error was found. | No invalid or blurred error-state capture is among the 33 IDs; a screenshot and read-only validation state would be needed to confirm exact visual, field association, and timing. |
| ❔ Can't tell | **Return to default state upon reattempt** — Once the user focuses on the field again, the error message should disappear. If there is an error again, the process will simply repeat until they are able to continue. | The evidence contains no corrected-after-error state; screenshots of the normal field do not establish reset behavior. |

### [Submitting a form — Flows](https://www.checklist.design/flows/submitting-a-form)

| | Item | Why |
|---|---|---|
| 🟢 Present | **Show button to submit** — Below the form fields, a button to submit the information needs to be present. You can change the copy to fit the form e.g. the button can say “Subscribe” if someone is providing their email address to receive emails. | Method, price, copy and publication tasks present a direct completion action in the footer or adjacent to the edited value. |
| ❔ Can't tell | **Show loading state after submission** — The user must see the form is in the process of being submitted. Note: also make sure your hover state is considered before they press the button! | The relevant flow states are not captured during submission and no action was submitted in this pass; source alone cannot confirm the rendered loading/hover state. |
| 🟢 Present | **Show success message when it submits** — The form was submitted! Let’s communicate that back to the user with a clear success message. | `copy-results` communicates that setup was copied and offers review; that result remains a preview-only state, not production success proof. |
| ❔ Can't tell | **If it doesn't, show an error message** — Sometimes, things don't work out. If the form can't submit, because of invalid information or another error, that also needs to be shown. | No failed-submit dialog or error variant is included in this editor assignment, so the visual recovery cannot be assessed. |
| ❔ Can't tell | **An error may occur because of the wrong information** — If the criteria for a text field isn't met, the form can fail to submit due to that error, and must be detailed. | Normal form captures do not show invalid values or field-level error content; this requires an invalid-input state capture. |

### [Empty State — Web app](https://www.checklist.design/web-app/empty-state)

| | Item | Why |
|---|---|---|
| 🟢 Present | **Illustration or icon** — A visual that signals the empty state and gives the screen some personality, rather than feeling broken | Product-photo state uses the relevant garment image; no-photo setup uses Shopify’s neutral records illustration; no-result state uses a compact search context. |
| 🟢 Present | **Clear heading** — A short, plain-language title naming what's missing | First setup says Add your first product view; search empty says No images found. |
| 🟢 Present | **Supporting description** — A brief explanation of what belongs in this space, most useful for first-time users | First-use copy describes views/placements; no-results copy suggests changing the search or uploading an image. |
| 🟢 Present | **Primary action** — A CTA pointing toward the next step: creating, importing, connecting etc | The empty editor goes directly to Add view; no-results has Upload image and Show all images. |
| 🟢 Present | **Zero state vs. no-results state** — A distinction between a screen that is empty because nothing has been created versus one that returned no search or filter results | `unconfigured-editor`/`unconfigured-editor-no-images` are first-use states; `add-views-no-results` has explicit search recovery. |
| ❔ Can't tell | **Error state variant** — A separate variant for when content failed to load, as opposed to genuinely being empty | No load-failure state is in the assigned gallery; prior source notes describe separate error/retry handling, but this image set cannot verify its UI. |

### [Single Item Detail — Web app](https://www.checklist.design/web-app/single-item-detail)

| | Item | Why |
|---|---|---|
| 🟢 Present | **Clear title or identifier** — The name, ID, or primary label of the item, shown prominently at the top of the screen | The live header identifies the selected Shopify product; the inspector names the current view/placement. |
| 🟡 Partial | **Status indicator (if applicable)** — A clear signal of the item's current state (active, pending, completed, archived) | Desktop Draft is explicit, while the phone base omits a separate status label; Save draft and Publish remain visible but describe actions rather than the current state. |
| 🟢 Present | **Key details section** — The most important attributes of the item surfaced prominently, with secondary details available below or in a sidebar | View/placement counts, selected item, geometry, methods, sizes and prices are separated into the outline, canvas and inspector. |
| 🟢 Present | **Edit action** — A clear way to modify the item's details, either inline or via an edit mode | Inline fields plus drawing and selection controls make the main setup directly editable. |
| ⚪ Not needed here | **Related items or activity** — Associated records, linked content, or a history of changes related to this item | The editor is a single-product setup task, not a collaborative record detail; local undo/redo and edit history suffice for this scope. |
| 🟢 Present | **Breadcrumb or back navigation** — A way to return to the list or parent context | Back to Products is visible in the live shell and contextual navigation is present in the editor header. |
| 🟢 Present | **Destructive actions** — Delete or archive options, available on the detail screen but kept visually separate from the primary actions | Removal is scoped to view/placement rows, uses critical styling and opens an explicit confirmation; publish remains separate. |

## Unverified interactions to retain in the audit trail

Only inspectable local transient navigation was used. I did not alter the owner’s Chrome page, type into the product editor, upload a file, save, publish, or mutate demo fixture data. The following points remain unverified from this pass and should not be represented as defects or as fully validated behavior:

- Phone screenshot for `draft-status` does not exist in the manifest; the separate Draft label is known to be omitted at narrow width.
- Drag-over visual state and upload processing appearance; public Polaris drop zone is used, source declares busy and error states, but no state image was provided.
- Validation after blur, error correction, submission loading, save success and failure visuals. Normal-state screenshots and source do not settle the rendered variants.
- Complete keyboard traversal/focus return across each dialog and menu, VoiceOver/NVDA announcements, and measured color contrast.
- Production integration of the richer editor preview and setup-copy flow; the gallery is not evidence of production route persistence or availability.

No application changes or tests were run as part of this research-only audit.
