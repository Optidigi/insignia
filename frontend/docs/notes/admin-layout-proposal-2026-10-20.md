# Proposed merchant admin structure

20 October 2026. Recommendation for discussion, not approved product scope or implemented UI. Based on the [capability inventory](admin-capability-research-2026-10-20.md), Shopify's official App Home skill and current Polaris 2.0 release-candidate guidance. The current presentation supplies no visual precedent. The customer-facing designer remains a separate experience; this proposal organizes the merchant tools that configure and support it.

## Recommended navigation

Use the Shopify shell's flat app navigation with three visible destinations: **Products, Orders, Settings**. Clicking the app name opens a distinct **Overview**. The following hierarchy describes screens and sections inside the app, not nested items in Shopify's sidebar.

| Entry | Screen hierarchy | Reason |
| --- | --- | --- |
| App name | Overview | First-use guidance and real work requiring attention. |
| Products | Product index → product configuration | The merchant defines the customization offer for a real Shopify product. |
| Orders | Customized-order index → order artwork/detail | The merchant obtains correct production files and resolves missing artwork. |
| Settings | Settings hub → Decoration methods, Storefront setup, Billing, Customer data requests, App status | Reusable configuration, integration and occasional account/data tasks. |

This grouping is an Insignia recommendation. Shopify establishes the underlying rules: few task-oriented categories, concise noun labels, distinct resource/detail pages, and no duplicated main navigation in the body. App nav does not support nested items; the app name already opens home and a `rel="home"` link is hidden. Do not add a second Home entry or an in-iframe copy of the app sidebar. [Shopify Navigation](https://shopify.dev/docs/apps/design/navigation), [App nav API](https://shopify.dev/docs/api/app-home/v2.0-rc/app-bridge-web-components/app-nav)

Keep Products first initially because configuration is the first dependency of every purchase. Validate the frequency of repeat order work with merchants; this is a testable assumption about ordering, not a reason to personalize or reorder navigation unpredictably.

Suggested URLs retain existing product/order/settings routes and add `/admin` for Overview plus `/admin/settings/status` for App status. Existing root/redirect behavior must deliberately change if this is implemented. No route changes are made by this proposal.

## Overview should earn its place

Use a compact task hub, with no marketing hero, revenue chart or generic welcome paragraph.

- Before setup, show the next concrete dependency: configure a product, publish it, add the theme button, enable cart repair and test the storefront. Link to the actual task.
- After setup, surface only actionable exceptions such as missing production artwork, a blocked publication or a due customer data request, if current authorized server data supports them.
- Hide completed onboarding guidance from the main working area while keeping setup accessible in Settings. Show an ordinary quiet state when nothing requires attention.
- Keep help consistently discoverable. Use contextual links to real tasks rather than a grid that repeats Products, Orders and Settings.

Shopify's [App Home guidance](https://shopify.dev/docs/apps/design/user-experience/app-home-page) and [Homepage pattern](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/templates/homepage) support an actionable landing page. The exact Insignia contents above are design inferences. Global exception counts/queues need a qualified summary read. The current API cannot verify theme installation: an opened theme-editor link must stay unverified, not become a completed setup step. A manually acknowledged step, if later offered, must be labeled separately and have deliberate persistence semantics.

## Products

### Product index

Use a scannable resource index with product image/name, Shopify product status, customization publication status and a clear configuration entry. Keep Shopify availability separate from Insignia publication. Search and pagination belong above/below the results with current query/filter state preserved on return from a product.

The desired complete index can provide All, Configured and Needs attention views when the server can supply correct results. Current catalog responses do not contain per-product config/publication summaries. Those columns and filters need a joined projection/read contract, not one config fetch per row or a claim based on the loaded page. Do not add selection checkboxes until a useful supported bulk action exists. [Shopify resource index](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/templates/resource-index), [Index table composition](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/compositions/index-table)

### One product workspace

Use a full details page with the product name, a breadcrumb, distinct saved/live context, and page-specific actions. Keep one draft across five logical sections. Start with named sections and local anchor navigation; do not introduce five wrapping tabs or a second sidebar. A new merchant can follow the order below, while a returning merchant can deep-link to a price or print area.

| Section | Controls and information |
| --- | --- |
| Decoration choices | Product-local methods, import from the reusable name library, decoration-size names and size proportions. Explain that garment sizes remain Shopify variants. |
| Print areas | Product views and images; selected placement; geometry; permitted methods/sizes; artwork-later for that placement; shared versus variant-specific images/bounds. Show dependency-safe removal and reset-to-shared actions. |
| Customer choices | Optional/required customization and supported production-option names/values. Keep placement-specific artwork-later controls with their placement, with a summary here only if helpful. |
| Prices | Final method × print-area × decoration-size surcharges; currency; explicit free versus unavailable choices; a selected-decoration sum. No setup/tier/FX controls. |
| Review and publish | Readable configured choices, a representative visual review, exact decoration-price review, blockers, the saved draft being submitted and effective live publication. |

Make the visual editing area two columns on wide screens: usable canvas next to controls for the selected view/placement. The form remains operable without dragging, with numeric inputs and keyboard actions. Preview belongs where it explains a change; it should not reduce every unrelated form to a narrow column. On narrow screens stack the preview near its selected controls, preserve selection, and avoid nested scroll traps. A larger preview can be a focused view when necessary, not a second full editor in a large modal. [Shopify Layout](https://shopify.dev/docs/apps/design/layout), [Details pattern](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/templates/details)

Use the App Bridge Save Bar for **Save draft** and discard protection. **Publish** remains a separate action after review and authoritative eligibility. Section navigation never silently saves or publishes. A first-time setup guide may link through the sections; it is not a mandatory wizard that returning merchants repeat. Group fields and reveal variant overrides or dependent choices when relevant. Avoid validation errors while a merchant is still typing; validate at meaningful completion/submission points and preserve the backend's exact validation. [Shopify Forms](https://shopify.dev/docs/apps/design/user-experience/forms)

Copy configuration belongs in a contextual secondary action. Its target picker should explain independent copying and existing-target restrictions. Keep technical revision IDs, request keys and JSON out of ordinary editing. This proposal omits the raw JSON editor from the normal merchant interface; any support-only replacement needs a deliberate authorization and validation design.

## Orders

### Customized-order index

Use order number, date, product/design summary where available, artwork status and relevant retention warning. Search, filters and pagination should describe the complete matched collection. Proposed views are All, Artwork needed, Ready and Locked, with unavailable/expired artwork as a separate explicit condition rather than an invented fulfillment status.

The existing browser filter only covers loaded records. Complete order search/filtering and complete counts require backend work. Until then, label results as loaded orders. Keep app sorting stable and make filters visible/resettable. Preserve filter/cursor/scroll when returning from an order. [Shopify index pattern](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/templates/resource-index), [Checklist Design data table](https://www.checklist.design/web-app/data-table)

### Order detail and production artwork

Put the work to be done first: one clearly grouped design and its placement artwork. Each placement shows what was purchased, current production artwork, usable original access, missing/expired state and the permitted next action. Keep the purchased historical preview separate from later replacements.

Use supporting context for order/payment facts, real garment variants/quantities, retention and reconciliation warnings. Offer a contextual route to the actual Shopify order if implemented with verified identifiers. Put attachment history and recorded refund details below the production work, with disclosure for raw technical references. Those are secondary records, not a reason to build another payment or fulfillment system.

| Condition | Main useful action |
| --- | --- |
| Artwork missing, unlocked, detail retained | Upload and inspect a file, then explicitly attach it to the intended placement. |
| Artwork ready | Preview/download each original; confirm and lock the current artwork set when appropriate. |
| Artwork locked | Read/download retained originals and history. No unsupported unlock or replacement action. |
| Link expired but asset retained | Request fresh authorized access. |
| Asset unavailable but replacement still permitted | Explain what is unavailable and offer explicit replacement only within current lock/retention rules. |
| Design detail erased | Explain its absence while preserving permitted economic history. |
| Reconciliation needed | Request the existing check and show pending observation, not synchronous payment success. |

Use a focused confirmation for locking because no unlock API exists. Do not imply that an uploaded file is attached, that an image preview is an original file, or that recorded refund data proves payment settlement. The rules here come from the [actual purchase contracts](admin-api-inventory-2026-10-20.md), not from a visual convention.

## Settings

Use a compact interstitial hub. The following groups appear in that page, not in the Shopify sidebar.

| Group | Destination | Contents and boundary |
| --- | --- | --- |
| Store configuration | Decoration methods | Reusable method names; create/rename/remove; independent product copies. No implied shared prices or geometry inheritance. |
| Store configuration | Storefront setup | Theme button/embed setup, current trustworthy information and test instructions. Theme appearance/button placement belongs in Shopify's editor. |
| Account and data | Billing | Observed subscription/trial/cycle/cancellation and the supported Shopify management link. |
| Account and data | Customer data requests | Request list, due dates, manifest, retained exports and original-artwork access. This is a workflow, not a toggle or a mark-delivered promise. |
| App connection | App status | Current permissions and available readiness observations, a timestamp, actual blockers and the next permitted action. Technical IDs stay in a support disclosure. |

This uses Shopify's [Settings](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/templates/settings) and [interstitial navigation](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/compositions/interstitial-nav) patterns. Checklist Design's [settings checklist](https://www.checklist.design/web-app/settings) supports logical grouping, but its generic account/password/notification/theme examples are not a feature list for Insignia. Do not add those controls where Shopify owns the behavior or Insignia has no setting.

App status is a proposed separate page powered by safe fields from the current readiness read. Its ordinary actions can check again or request the exact optional readiness scopes through the existing supported flow. It is not a signing-key editor, a release control, a Function repair button or a permission-management/RBAC screen.

## States and feedback

States belong to the affected resource or task, not to permanent menu items. Keep independent state dimensions independent.

| State dimension | Placement and response |
| --- | --- |
| Initial loading | Stable, silent accessible skeleton for the page/region; preserve meaningful page context. |
| First-use empty | Explain what can be configured and provide the real first action. |
| No search/filter results | Show the query/filters and clear/reset action. |
| Read unavailable | Persistent retry/recovery; never an empty-list success. |
| Read-only or denied | Explain the missing access at the task; clear private data after authorization loss. |
| Unsaved draft | Host Save Bar and navigation protection. |
| Invalid value | Field error near the value and a summary linking to affected sections when useful. |
| Save in flight | Preserve entered values, prevent duplicate submit and keep stable action wording. |
| Concurrent edit | Preserve local work, show conflict and offer review/reload of the winning draft. No silent overwrite. |
| Unknown write result | Persistent exact-request recovery; block a replacement command or discard that would forget it. |
| Saved draft plus live version | Show both facts. A draft can differ while an older revision remains live. |
| Publication pending/blocked | Persistent publication status and the appropriate continuation or support route. A blocked new draft does not automatically mean the previous live version disappeared. |
| Artwork processing/rejected/ready | Explain file status separately from attachment, lock, payment and fulfillment. |
| Expired or erased data | Explain what remains and offer only permitted renewal/replacement/export actions. |

Use inline errors near fields, section-level messages for local problems and page banners for broader blockers. Immediate non-critical successes can use a brief toast; important pending/recovery state must remain visible. [Shopify Alerts](https://shopify.dev/docs/apps/design/user-experience/alerts)

Saving, publishing, artwork readiness, paid status and theme installation are different facts. Keep backend publication states and exact command identity even when the UI presents simpler plain-language groups. New summary labels need a deliberate mapping with recovery tests, not just a renamed badge.

## How supplementary guidance is applied

Checklist Design pages were opened in a browser because their text did not render in the web reader. Its [Saving changes](https://www.checklist.design/flows/saving-changes), [Uploading media](https://www.checklist.design/flows/uploading-media), [Empty state](https://www.checklist.design/web-app/empty-state) and [Multi-step form](https://www.checklist.design/web-app/multi-step-form) guidance was checked. Use it for dirty/saving/saved feedback, upload constraints/progress/retry, distinct first-use/no-results/error states and preserving progress. Its wizard, destructive-action, bulk-export and settings examples do not authorize new Insignia features.

[Vercel's Web Interface Guidelines](https://vercel.com/design/guidelines) supply review checks for keyboard access, visible focus, non-drag alternatives, deep links/back navigation, narrow-screen behavior and complete state handling. Generic optimistic-update advice must not prematurely declare publication, locking or unknown commands successful. Generic URL-state advice applies to safe navigation/filter state; keep private artwork URLs, bearer capabilities, unsaved drafts and command ownership out of URLs. The existing Astro/Preact routing and authentication boundaries remain.

Shopify governs component semantics, copy and save behavior when generic guidance differs. Use short task titles and specific verbs, without repeated taglines. Preserve necessary pricing, retention and consequential-action explanations. [Shopify Content](https://shopify.dev/docs/apps/design/content)

## Implementation boundaries and validation

| Can use current contracts with UI work | Needs additional backend or product work |
| --- | --- |
| Resource/detail/settings organization; section navigation; contextual disclosures; save/publish recovery; method naming; per-placement artwork; billing links; privacy downloads. | Useful global Overview queues/counts; product customization-summary projections and server-side config filters; complete order search/filter/sort/counts; verified theme installation. |
| Safe draft removal/reset/reordering, option-value removal, exact decoration-surcharge review, copy-target cursor pagination. | Broader media/all-variant browsing, registered arbitrary mockups, full contextual garment-price preview. |
| Improved explanation of current owner-only private-data access. | Broader production-staff permissions, unpublish/config deletion, artwork unlock, manual privacy fulfillment, bulk mutations. |

Use the [API inventory](admin-api-inventory-2026-10-20.md) to qualify every implementation detail. Do not add controls for an action merely because a pattern's sample includes one.

Before implementation acceptance, test these merchant tasks with wide and narrow wireframes: configure a two-placement product, change one surcharge on a live product, reset one variant override, recover a concurrent save, attach late artwork and retrieve a historical original, handle a locked/expired design, and export a requested retained order. Include first-time and repeat merchants. The structure above is an informed recommendation, not a measured usability result.

The source/current-state inventory remains separate from this proposal. No application code, native resources or storefront appearance changed. The [Shopify source note](admin-shopify-layout-sources-2026-10-20.md) contains the primary-source review and supporting constraints. Polaris 2.0 is still an RC; use its supported pattern/component contracts and test both host appearances during implementation.
