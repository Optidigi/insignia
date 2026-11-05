# Independent design review of the audit fixes

25 October 2026. GPT-6.1 Sol review, independent of implementation. Reviewing the regenerated local preview captures and the affected source against the installed Checklist Design Data Table and Empty State checklists. Permissions copy received a narrow visual/content review. This is a follow-up to the [product audit](checklist-design-product-audit-2026-10-25.md), not another audit of every product screen.

## Scope and evidence

Read `AGENTS.md`, the [admin UI guidance](admin-ui-guidance-2026-10-20.md), the original audit, the installed Checklist Design 3.2.4 skill and its actual bundled checklist files. Shopify's installed skill and App Home reference governed source priority. Runtime pins are `polaris-2.0-rc.js` and `@shopify/polaris-types` `2.0.0-rc.3`.

Source inspection covered `AdminResourceTable.tsx`, `AdminValueSummary.tsx`, `ProductsOverview.tsx`, `OrdersOverview.tsx`, `ReadinessPermissions.tsx`, `admin-editor.css`, and the Methods preview index/picker and their relevant CSS. I made no application edits and ran no builds or tests.

The evidence root is `/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/`. Its directory name is historical. The table and Methods files reviewed here were regenerated on 25 October at 22:26–22:27 local time. I checked their filesystem modification times before reading them. The six Settings images are from 25 October 22:19. The implementer confirmed those contain the final permissions source; subsequent edits affected tables and picker wording only. I checked the final permissions source against those images.

Actually inspected desktop and 390px captures:

- `orders-settings/{desktop,mobile}/orders-scrolled-columns.png`
- `orders-settings/{desktop,mobile}/products-scrolled-columns.png`
- `orders-settings/{desktop,mobile}/products-method-summary.png`
- `orders-settings/{desktop,mobile}/products-location-summary.png`
- `methods/{desktop,mobile}/index-resource-list.png`
- `methods/{desktop,mobile}/product-picker-empty-catalog.png`
- `settings/{desktop,mobile}/settings-permissions-view-only.png`
- `settings/{desktop,mobile}/settings-permissions-product-missing.png`
- `settings/{desktop,mobile}/settings-permissions-allowed.png`

Also inspected the fresh 320px `checklist-fixes/products-scrolled-320.png`, `orders-scrolled-320.png`, `permissions-view-only-320.png`, and `products-location-summary-320.png`. The first location-summary capture caught the popover during its fade-in and was rejected as final opacity evidence. I inspected its settled replacement from 22:29:13. That replacement is opaque and readable, names "Ontwerp je eigen Superfunny hoodie" in full, and stays inside the 320px viewport.

## Checklist Design: Data Table

Auditing against [Data Table, Web app](https://www.checklist.design/web-app/data-table), using `/Users/pc/.codex/skills/checklist-design/references/checklists/web-app-data-table.md`. Item names and descriptions below retain the bundled criteria and order. These prompts do not require adding unsupported endpoint capabilities.

| Status | Item | Why |
| --- | --- | --- |
| 🟡 Partially present | **Sortable columns** — Column headers that sort rows by that value on click, toggling ascending and descending | Orders exposes its supported date ordering through Display options rather than clickable headers. That agreed alternative remains sufficient; arbitrary column sorting is not a new requirement. |
| 🟡 Partially present | **Column visibility and order** — Controls to show or hide individual columns and drag to reorder them | Orders retains column visibility controls. Drag ordering is outside this fix and is not necessary to preserve resource context. |
| 🟡 Partially present | **Row selection and bulk actions** — Checkboxes on each row and a persistent action bar appearing when rows are selected | Source retains selected counts and action bars, including phone actions. Current screenshots show the row controls; this reviewer did not exercise a selected-state workflow. |
| ⚪ Not needed here | **Row actions on hover** — Contextual actions (edit, delete, view) appearing when hovering over a row | Real row links and explicit summary controls cover the changed workflows without introducing touch-inaccessible hover-only actions. Methods retains its menu. |
| 🟡 Partially present | **Search and filter** — A search input for quick lookup alongside filter controls for narrowing by specific attributes. | Current screenshots retain their search/filter toolbar. Filter behavior and every active-filter state were not re-audited in this narrow review. |
| 🟡 Partially present | **Pagination** — Controls to navigate between pages of results, with an option to choose how many rows show per page | Source retains the existing supported cursor controls; this change does not add page-size selection or invent a total. Pagination was not exercised by this reviewer. |
| 🟢 Present | **Frozen columns** — The first column pinned so it remains visible when the user scrolls horizontally | At 390px and 320px, Products retains its name and selection control beside later facts; Orders retains order number and selection. The pin is opaque, and summary popovers name their product. |
| 🟡 Partially present | **Export action** — A way to download the visible or selected rows as CSV, spreadsheet, or another format | Existing source actions remain. Export results were not downloaded or re-audited by this reviewer. |
| ❔ Can't tell | **Empty and loading states** — The states shown when the table has no rows or when data is being fetched | These table states are outside the final images assigned here; this review does not claim renewed visual acceptance of them. Their original audit remains the evidence. |

The product pin is 144px in narrow containers and hides the thumbnail there. It leaves enough room for a later column at 320px, rather than freezing the desktop's 400px identity region. The desktop keeps the thumbnail and existing density. The source now opts only Products/Orders into pinning, so Methods keeps its established responsive identity/details layout.

Phone captures sometimes show the edge of a partly scrolled non-primary heading or value beside the pin. This is ordinary clipping at the current horizontal position. It does not cover the identity or the fully opened summary. I found no evidence that the fix requires converting these tables into cards.

`AdminResourceTable.tsx` supplies a named, keyboard-focusable native scroll section, a visible focus rule and a focus-in handler that reveals controls obscured by the pinned column. Its scroll padding matches the pin width, and the handler accounts for inline direction. That is relevant supporting source, not proof of every keyboard outcome. The implementer reported five passing focused browser workflows, but I did not independently run them or make a blanket accessibility judgment.

## Checklist Design: Empty State

Auditing against [Empty State, Web app](https://www.checklist.design/web-app/empty-state), using `/Users/pc/.codex/skills/checklist-design/references/checklists/web-app-empty-state.md`. Scope is the Methods product-assignment picker.

| Status | Item | Why |
| --- | --- | --- |
| 🟢 Present | **Illustration or icon** — A visual that signals the empty state and gives the screen some personality, rather than feeling broken | A small product icon gives the empty catalogue a suitable visual cue. |
| 🟢 Present | **Clear heading** — A short, plain-language title naming what's missing | "No products available" describes the supplied selectable catalogue without claiming that Shopify has no products. |
| 🟢 Present | **Supporting description** — A brief explanation of what belongs in this space, most useful for first-time users | The copy names unavailable existing assignments and tells the merchant to check Shopify products and staff access before reopening. It does not prescribe creating duplicate products. |
| ⚪ Not needed here | **Primary action** — A CTA pointing toward the next step: creating, importing, connecting etc | The cause is unknown. The existing Cancel action plus concrete recovery direction is honest; an invented create/refresh action would not be. Select remains disabled until a staged selection change exists. |
| 🟢 Present | **Zero state vs. no-results state** — A distinction between a screen that is empty because nothing has been created versus one that returned no search or filter results | Source distinguishes the empty catalogue from search/filter or selected-only misses and retains Show all products for filtered misses. Only the catalogue variant was newly inspected visually. |
| ❔ Can't tell | **Error state variant** — A separate variant for when content failed to load, as opposed to genuinely being empty | This preview picker receives a product array and does not own a fetch-error signal. Error integration needs actual cause information; the assigned capture cannot establish it. |

During review I identified that the first wording, "will be kept", promised future preservation even though Clear selection intentionally stages removal and Select commits it. The implementer changed this to "remain selected". The final source and desktop/phone images now describe the current state accurately. Clear selection remains an intentional explicit action; it is not silently triggered by an empty catalogue.

## Content and layout findings

The Methods fixed-price row now says "per placement, per garment" directly beneath €5.00. The desktop row remains compact. At 390px the unit wraps into two readable lines in the existing details layout. Product-specific pricing keeps its distinct label and does not receive an invented flat unit/value.

The permissions states make "Your product access" and its Can edit/View only/Not checked result primary. "Insignia's Shopify permissions" labels the separate grant line. In the view-only state the staff-access explanation remains clear even when the app has editing permission. The missing-grant state exposes the actual Allow product setup recovery. The allowed state says the person can edit. The 320px view-only capture wraps without cutting off these distinctions. This addresses the original copy conflict; it does not claim a newly verified authorization boundary.

Both product summary popovers show the product's full name above Methods or Print locations. The duplication is useful local context because the table can be scrolled or partly covered by the popover. I found no unnecessary explanatory paragraph or new invented feature in the changed copy.

## Current sources and their limits

Shopify is primary. I fetched current [layout](https://shopify.dev/docs/apps/design/layout) and [content](https://shopify.dev/docs/apps/design/content) guidance on 25 October. The former supports responsive resource layouts and useful information density; the latter supports concise, consistent, actionable content. These support the narrow fixes above, not a requirement to add every checklist feature.

The installed Shopify search was run with `--api polaris-app-home --version 2.0-rc` for table/index behavior. The official [Table documentation](https://shopify.dev/docs/api/app-home/v2.0/web-components/layout-and-structure/table) resolves to current v2.0 and documents `auto`/`list`, including mobile transformation. Its sticky limitation discusses headers; it is not evidence that Shopify mandates this app's pinned identity implementation. This app-owned native table remains a deliberate exception to the public table's phone transformation. Existing Polaris controls and the established admin composition are preserved.

Fetched the current [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) as supplementary guidance. Its relevant checks are focus visibility, focused controls remaining clear of sticky content, semantic controls and long-content handling. Shopify's sentence case and component contracts take precedence over generic Vercel copy examples.

## Verdict

Ready for owner review of these audit fixes. No remaining actionable UI defect was established in the final desktop, 390px and supplemental 320px images and inspected source. The original resource-context, Methods unit, empty-picker guidance and permissions-copy findings are addressed in this local preview.

The 320px product names still truncate after three lines, with full names supported through the existing resource-name disclosure and shown in opened summaries. This is the deliberate cost of retaining useful room for facts beside the name. The reviewed summary identifies its product in full. I did not establish a new defect from truncation alone.

Owner acceptance, native Shopify-host verification, physical touch behavior, screen-reader behavior, dark appearance and release approval remain separate. Static captures and source are insufficient for a blanket accessibility or production approval.
