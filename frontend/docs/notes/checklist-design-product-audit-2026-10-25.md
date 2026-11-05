# Designed-screen audit with Checklist Design

25 October 2026. Research and feedback only. No application UI, tests, product configuration, billing, permissions or store data changed.

## Scope and method

The installed Checklist Design skill is available at `/Users/pc/.codex/skills/checklist-design/SKILL.md`, version 3.2.4, with 129 bundled checklists. We used its audit mode with the actual local checklist files, retaining each matching checklist's item order and descriptions. Bespoke editor/canvas composition received visual critique where no checklist matched. Checklist items are review prompts, not instructions to add every possible feature. No score or compliance percentage is assigned.

Three Luna Max agents independently reviewed editor, Methods/Products and Orders. The Methods/Products auditor then reviewed the current Settings batch separately. A GPT-6.1 Sol medium reviewer inspected selected images and source before reading the first auditors' findings, then challenged their conclusions. I reviewed customer customization, checked the strongest cross-screen findings and narrowed the final recommendations. The agents' disagreements and evidence limits are retained in their notes.

| Included work | Coverage | Evidence and full item-by-item audit |
| --- | --- | --- |
| Products, Methods index, method creation/details and assignment pickers | All 26 assigned gallery IDs, 52 desktop/phone images, current base pages and relevant source | [Methods and Products audit](checklist-methods-products-audit-2026-10-25.md) |
| Product editor, first-use pages, views/placements, image scale, methods/prices, copy setup, publish and unsaved-change dialogs | All 33 assigned IDs, 65 images, current desktop/phone base and source. Draft status is intentionally desktop-only in this manifest. | [Editor audit](checklist-editor-audit-2026-10-25.md) |
| Orders overview/detail, filters and selection, artwork previews/replacement/export and production sheets | All 15 assigned IDs, 30 desktop/phone images, current overview/detail and source | [Orders audit](checklist-orders-audit-2026-10-25.md) |
| Customer Artwork, Quantities and Review, inline positioning, chooser dialogs, local cart confirmation and merchant customer preview | Fresh 117 light-theme captures across 13 scenarios and 3 widths; selected live interactions and source checks. The buyer report distinguishes inspected compositions from supporting captures. | [Customer audit](checklist-buyer-audit-2026-10-25.md) |
| Current Billing, App permissions and Customer data requests | All 34 current Settings V1 IDs, 68 desktop/phone images plus the two actual 320px privacy captures. Awaiting owner review; findings below remain separate. | [Pending Settings audit](checklist-settings-pending-audit-2026-10-25.md) |
| Independent challenge | Selected screenshots/source across the above, rather than a second claim to cover every state | [Skeptic review and disagreements](checklist-independent-skeptic-2026-10-25.md) |

The mature admin coverage is 74 gallery states and 147 images. Current Settings adds a separate pending batch. [The machine-readable scope inventory](/Users/pc/Development/Insignia/.artifacts/checklist-audit-2026-10-25/scope.json) lists every gallery ID, assigned report and exclusions. These are coverage counts, not quality scores.

Untouched homepage, Storefront setup, unfinished Settings areas and masking experiments are excluded. The nine old Reusable Methods library captures, three superseded names-only Settings forms and the external Shopify plan-selection reference are not current product screens to redesign. The Settings navigation hub was source-checked for context, not graded as a mature design. Onboarding and the first-time guide remain later work, as requested.

## What I would fix next

### P2: preserve resource identity in phone tables

Products and Orders share the same underlying issue. Horizontal scrolling can move the product or order identity away while the merchant reads related facts. This is more than a preference for cards versus tables.

In Products, the open methods/locations summary can sit beside quantities or later columns with no visible product name. The summary itself has no product-specific title. [Phone evidence](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/orders-settings/mobile/products-method-summary.png) makes that context loss visible. This is high-confidence P2 because the merchant can confuse which product owns the configuration.

In Orders, later payment/artwork/method columns belong to an order identity that scrolls away with the rest of the table. The source uses one scrolling region around all columns and has no pinned identity column. A fresh isolated 390×844 check records the [initial table](/Users/pc/Development/Insignia/.artifacts/checklist-audit-2026-10-25/orders/phone-initial.png) and [horizontally scrolled table](/Users/pc/Development/Insignia/.artifacts/checklist-audit-2026-10-25/orders/phone-scrolled.png). The latter shows artwork status, methods and item counts without the order number. Both the first auditor and independent reviewer checked that direct evidence. This is high-confidence P2 for the observed context loss; no actual wrong-order production action was observed or attempted.

Preserve the table headings and make the resource identity available beside the facts. A compact pinned identity column can work; a product-specific summary title is also useful. We do not need to convert every phone table to cards or add a second detail page. The task is to let the merchant read a status or price and still know which product/order it belongs to. The [Data Table checklist](https://www.checklist.design/web-app/data-table) explicitly asks about frozen columns, while Shopify [layout](https://shopify.dev/docs/apps/design/layout) and [content](https://shopify.dev/docs/apps/design/content) guidance support keeping task context clear. The exact implementation remains a design choice.

### P3: name the Methods price unit in its summary

The Methods index shows Default pricing and €5.00 without saying that this is per placement, per garment. Its detail and price-entry field already explain that basis, so the independent reviewer downgraded this from P2. I agree. The summary can be clearer without changing the pricing model or repeating a paragraph on every row. Add a short shared unit label or concise value annotation. [Current phone Methods](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/methods/mobile/index-resource-list.png). Confidence is high in the omitted unit and medium in its user cost; no incorrect price calculation was found.

### P3, conditional: give empty assignment pickers a useful recovery direction

The empty picker has Cancel and says unavailable assignments are retained, so it is not a dead end. It does not explain how products can become available to select. [Current empty picker](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/methods/mobile/product-picker-empty-catalog.png).

The source only knows that the supplied selectable catalogue is empty. It does not know whether the shop has no products, access is restricted or existing assignments are unavailable. A blanket Add a product in Shopify instruction could send a merchant to create duplicates. Keep this as a state-design requirement for integration: provide recovery matched to the known cause. Do not invent a cause or add a refresh button solely to satisfy the [Empty State checklist](https://www.checklist.design/web-app/empty-state). Confidence is medium; it is a small recovery gap rather than a critical missing feature.

## Settings, still awaiting owner review

The current view-only permissions state correctly gives the staff member a View only badge and asks the owner to review staff access. Immediately below it says product editing available when describing the app's separate grant. Both facts can be true, but the repeated editing language makes the effective result harder to skim. [Phone evidence](/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/settings/mobile/settings-permissions-view-only.png). Both reviewers found this copy issue. I would make the person's effective access primary and label the secondary line Permissions granted to Insignia. This is P3 copy clarity, not an authorization defect or a reason to add another permissions workflow.

The latest privacy empty state has an illustration, a meaningful heading, an explanation that Shopify supplies requests and proper phone inset. The new request/detail separation avoids the earlier expanded-row clutter. Billing now uses compact dates and removes irrelevant Last checked/internal-state text. Those corrections were checked in the current captures, not judged from the obsolete screenshots attached before they were fixed. Owner approval remains open.

The discounted Billing card accurately labels base rate and provider discount facts. A confirmed upcoming charge could reduce arithmetic later, but we should not manufacture a net charge/date from incomplete provider metadata. Shopify owns plan checkout, invoices and payment details. Their absence from this app is not a missing local billing feature.

The privacy page's one-download-per-order approach is a deliberate minimum workflow. A request-wide package may help if real request volumes make repeated downloads burdensome, but the current sample does not establish that need. It is a future efficiency question, not a new required bulk-export screen.

## Findings we challenged or did not prioritize

- Date sorting is clearly labeled in Display options alongside column visibility and shows the current direction. A clickable Date header is an alternative, not a necessary fix. The Orders auditor removed the proposed P3 after checking this again.
- The A4 production-sheet thumbnail is fitted for page/layout/identity review, with the full PDF available. Its small text alone does not prove that a document zoom tool is missing.
- The phone editor omits a separate Draft label while retaining Save draft and Publish. We recorded this as a watchpoint; no actual save-state misunderstanding was demonstrated.
- Searching the repo did not establish a complete team accessibility policy. That is an evidence gap, not proof of a broken interface. Native Polaris support and existing focused checks are relevant, but do not replace real keyboard and screen-reader testing.
- Exact placement prices in the merchant preview and incremental size upgrades in demo products use different correct pricing models. The matching placement subtotal clarifies the contribution. No wrong arithmetic or demonstrated stacking misunderstanding was found; any label refinement should identify the basis rather than force identical formatting.
- The richer Methods/editor preview still has known production-integration work. Re-reporting that as a fresh UI regression would mix up the agreed design and implementation stages.

## Evidence limits and later decisions

The customer flow's View cart handoff and persisted drafts need explicit integration decisions. The local prototype does not connect Shopify checkout and does not claim to save a cross-session draft. A separate app checkout or local card form would add the wrong work.

Not every gallery state was exercised interactively. Static screenshots and source cannot establish all hover, loading, retry, focus, assistive-technology or native Shopify-host behavior. The slice reports label unrendered states and source-only checks. Fresh customer captures use light appearance; the existing dark-theme evidence is older. Physical mobile keyboards/native select menus and VoiceOver/NVDA remain verification work. These limits prevent a release or accessibility approval, but do not prevent identifying the concrete UI issues above.

The main product references were Shopify's current [layout](https://shopify.dev/docs/apps/design/layout), [content](https://shopify.dev/docs/apps/design/content) and resource-table guidance. The installed [Checklist Design skill](/Users/pc/.codex/skills/checklist-design/SKILL.md) supplied the systematic criteria. [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines) supplemented interaction/accessibility review. [Memorisely's hierarchy lesson](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1) and [Zander's disclosure lesson](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX) informed grouping and context; neither is used as proof that a specific Shopify feature is required.
