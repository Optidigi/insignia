# Home state and priority research — 26 October 2026

Research only. No application, UI, test, account, theme, billing, permission or store changes.

## Recommendation

Design Home as a small, state-aware starting point: show the next setup task when setup is genuinely incomplete, or a known operational issue when existing work needs attention. In steady state, use a bounded, date-descending sample of recent Insignia orders and relevant product actions to make Home useful without rebuilding either collection. Let Products, Orders, Storefront setup and Settings own the full workflows.

Do not turn Home into an analytics dashboard, a second Settings hub, or a numbered onboarding journey. Insignia has no Home-specific metrics or activity feed, and its real setup dependencies are not one linear sequence. The requested full onboarding journey remains a later design pass. This note defines the V1 Home state model only; it does not change V1.

There is currently no separate Home screen: [AdminNavigation.astro](../../../apps/web/src/components/AdminNavigation.astro) gives both Home and Products the /admin/products destination. The next Home design needs a distinct destination, but must leave the existing product workflow intact.

## Evidence boundaries

| Fact | Current source | Home implication |
| --- | --- | --- |
| Products is the current Home alias. The product list requests 20 items at a time and carries a cursor. | [AdminNavigation.astro](../../../apps/web/src/components/AdminNavigation.astro), [ProductsOverview.tsx](../../../apps/web/src/islands/ProductsOverview.tsx), [admin/http.ts](../../../apps/web/src/server/admin/http.ts) | An empty first unfiltered catalog page with no next cursor establishes that no Shopify products were returned at that read. It does not establish “products exist but none have Insignia configuration”; that requires a complete configuration inventory. A first nonempty page can still supply specific product actions, but not catalog-wide counts. |
| Product list summaries are not configured, draft or published; “published” is based on an effective revision. | [product-configuration-summary.ts](../../../apps/web/src/shared/product-configuration-summary.ts) | This is an effective-publication fact, not proof that the current draft is published, the storefront is installed, or the customer flow works. A newer draft can coexist with an effective publication. |
| A product detail read has the richer publication state and eligibility reason. | [admin-view.ts](../../../apps/web/src/shared/admin-view.ts), [merchant-config.ts](../../../apps/web/src/server/merchant-config.ts) | Show a particular product’s next action only when its current detail state supports it. Do not infer publication success from a save, click or pending request. |
| The theme check uses shopify.app.extensions() and covers the published theme only. Missing, duplicate, malformed or contradictory extension records become unknown. | [storefront-setup.ts](../../../apps/web/src/shared/storefront-setup.ts), [StorefrontSetup.tsx](../../../apps/web/src/islands/StorefrontSetup.tsx) | Keep theme status separate from product publication. Unknown and a failed read are not “not installed”; unavailable is not by itself proof of incompatibility. Theme status does not establish draft-theme readiness, every-template coverage, placement quality or a working buyer journey. |
| The product-test selection is held in session storage and re-verified; there is no durable “customer test passed” record. | [StorefrontProductTest.tsx](../../../apps/web/src/components/StorefrontProductTest.tsx) | Never mark the customer journey complete or incomplete from that temporary selection. The test remains an explicit Storefront setup action. |
| Orders are Insignia purchase records, not a general Shopify order browser. The API is cursor-paginated; the current page uses 20 records, while search and artwork filters narrow only the loaded page. | [purchase/service.ts](../../../apps/web/src/server/purchase/service.ts), [OrdersOverview.tsx](../../../apps/web/src/islands/OrdersOverview.tsx), [implementation-plan.md](../../architecture/implementation-plan.md) | An authorized empty first unfiltered Orders page with no next cursor supports “No Insignia orders recorded at this read.” A bounded date-descending first page supports a truthful recent customized-orders list without a total or full activity feed. Neither says anything about all Shopify orders or product configurations. A filtered empty page proves only that the filter matched no rows on its page. |
| Purchase detail can expose Needs review exceptions and an Artwork needed status. The latter also covers unavailable or expired retained artwork and is not always directly repairable. | [OrdersOverview.tsx](../../../apps/web/src/islands/OrdersOverview.tsx), [artwork-status.ts](../../../apps/web/src/shared/artwork-status.ts), [PurchaseArtwork.tsx](../../../apps/web/src/islands/PurchaseArtwork.tsx) | A Home action should lead to the order for diagnosis. Do not label every artwork-needed row “upload now,” or count it as actionable without checking the actual detail state. |
| Product read/edit access differs from order/artwork access. canRead requires product read scopes; canEdit requires product write scopes; order and artwork records are restricted to the account owner plus the required order scopes. | [auth.ts](../../../apps/web/src/server/admin/auth.ts), [purchase/http.ts](../../../apps/web/src/server/purchase/http.ts) | Use fresh server authority for visibility and actions. Do not infer that every editor is the owner, or show private order names, artwork status or counts to a staff member lacking that access. |
| Billing exposes trial, active, inactive and unavailable, plus a separate newActionsAllowed value. The merchant Settings page sends plan actions to Shopify. | [billing.ts](../../../apps/web/src/server/admin/billing.ts), [billing-view.ts](../../../apps/web/src/shared/billing-view.ts), [MerchantBilling.tsx](../../../apps/web/src/islands/MerchantBilling.tsx) | Unavailable means unverified, not inactive. A fresh limitation can explain why new customization/publication work is blocked; Home should link to Billing instead of repeating a plan card or inventing a price or benefit. |
| Current Settings already owns Storefront setup, permissions, billing and customer data requests; Products, Methods and Orders already own their work. | [MerchantSettings.tsx](../../../apps/web/src/islands/MerchantSettings.tsx), [AdminNavigation.astro](../../../apps/web/src/components/AdminNavigation.astro) | Home should route to those workflows and avoid duplicating their controls, instructions, tables or settings. |
| The current specification explicitly excludes a usage dashboard and says old readiness evidence does not establish current merchant readiness. | [implementation-plan.md](../../architecture/implementation-plan.md) | Do not introduce usage, revenue, conversion, adoption or “store health” tiles under a new Home label. |

### The data gap that affects state design

There is no Home API or read model. Current product and order reads are paginated and have different permissions; theme state comes from App Bridge; subscription state comes from a separate provider read. The current endpoints do not provide a unified, complete “new / setup complete / no issues” fact.

This does not justify a generic metrics pipeline. Current page data can support bounded lists and a specific known issue; it cannot support a catalog-wide count, all-order issue count or “all setup complete” claim. An authorized empty first unfiltered Orders page with no next cursor can support an at-read statement that there are no Insignia purchase records. An empty first unfiltered product page with no next cursor can support an at-read statement that the Shopify catalog query returned no products. “Products exist but none have Insignia configuration” needs a full configuration inventory. Keep each domain’s loading, ready, unavailable and access-denied outcomes distinct. A successful product read must not conceal a failed Orders read, and a failed Orders read must not become “no orders.”

## Real setup dependencies

Product configuration and theme setup can happen in either order. Within theme setup, the customization block and cart-review embed are independent tasks. The customer test depends on a published product configuration and the corresponding published-theme setup; the app does not persist its completion.

~~~mermaid
flowchart LR
  P[Configure and publish a product] --> T[Try the customer flow]
  B[Add the customization block] --> T
  C[Enable cart review] --> T
~~~

This graph describes current Storefront setup guidance, not a mandatory four-step wizard. Independent tasks can have a meaningful completion count when the task set is fixed and every status is verifiable; a count does not imply sequence. The V1 recommendation is to omit a percentage because there is no fixed, fully verifiable end-to-end task set: the customer test has no durable completion record. That is an Insignia scope choice, not a Checklist Design or Shopify prohibition on progress indicators. See [Storefront setup research](storefront-setup-research-2026-10-26.md) and [Storefront setup V1](storefront-setup-v1-2026-10-26.md).

## State and priority model

Use two kinds of state: **page/data trust** and **merchant work**. Page/data trust wins whenever evidence is missing: no private data, empty-state claim or success summary should render from a failed, stale, partial or unauthorized read. Within available work, prioritize an existing actionable order issue first, a verified gate blocking new work second, and an actual setup task third. In steady state, give merchants a bounded recent-orders view and product actions rather than leaving Home blank or turning it into a full collection page.

The P0–P3 order is a proposed Insignia prioritization, not a Shopify requirement. P0 protects authorization and state truth; P1 favors a specific piece of existing merchant work over setup for future work; P2 covers verified setup/gating tasks; P3 is the useful recent-work view when no higher-priority action is known. Shopify’s Home guidance supports surfacing actionable information but does not prescribe this ordering. The ordering is based on work/actionability, not a claim that an order has a deadline or service-level priority.

| Priority / state | Trigger and evidence | Message and action | Omit / limit |
| --- | --- | --- | --- |
| **P0 — Initial loading** | One or more Home reads are pending. | Keep a small route-matched skeleton; do not announce a state before reads settle. | Zero counts, “all set,” success banners or an empty-state CTA before a read settles. |
| **P0 — Session or product access unavailable** | Fresh 401 or 403 from a required Home read. 401 is session/authentication; product 403 is access denial. | For 401, ask the merchant to reopen Insignia from Shopify Admin. For product 403, explain that product access needs review and link to App permissions if that route is available. | Do not describe this as a new shop, no products, or a theme problem. Do not leave previously loaded private data visible after authorization loss. |
| **P0 — One domain failed** | Product, theme, Orders or Billing read failed independently. Distinguish network/server errors from explicit access denial and from valid unavailable status. | Keep the verified portions of Home; show one contextual “couldn’t check” message and retry only for a recoverable failed read. Send the merchant to the owning page where its recovery is clearer. | Do not turn a failure into empty data, inactive billing, missing theme setup or a global Home outage. Do not claim an all-clear because one source succeeded. |
| **P0 — Staff/owner restriction** | Fresh server capability says the actor can read/edit products, but cannot read orders/artwork, or cannot edit products. | Show only safe product/setup facts. Gate product actions on canEdit. If Orders access is restricted, say it requires the store owner and the correct Shopify access; link to the existing owner-managed workflow. | No order/customer names, private artwork state, issue count or hidden-action CTA. accountOwner and canEdit are separate facts. |
| **P1 — Known order needs attention** | An authorized owner read returns a specific purchase with an exception or a current, relevant artwork state. The current list exposes only a page of records; an app-wide issue or zero-issues claim needs a complete authoritative source. | Put the known work ahead of setup prompts; name the order only when its label is authorized; use Review order to open the existing detail page. The detail page determines whether replacement, lock or another action is actually available. | No “all caught up,” global issue total, urgency/deadline or Upload artwork CTA inferred from Artwork needed. Do not scan only the newest 20 and call the result complete. |
| **P1 — Subscription blocks the next action** | Fresh Billing evidence reports inactive, or reports a current status with newActionsAllowed false, and the Home task being promoted would create or publish new customization. Keep unavailable distinct. | State only the confirmed consequence (“New customizations and publication are unavailable”) and link to Billing. If Billing is unavailable, say the subscription could not be verified and offer its existing retry route. | Do not call unverified billing inactive, remove existing Orders access, claim history is lost, or duplicate plan choice/pricing on Home. |
| **P2 — New product setup** | A complete, current configuration inventory proves products exist but none have Insignia configuration; a single catalog page is insufficient. An empty first unfiltered catalog page with no next cursor is a separate, verifiable “no Shopify products” state. Actor must be able to edit before showing a creation CTA. | For products with no Insignia config, use one clear action such as Choose a product to open Products. If a complete inventory is unavailable, show a neutral Products link. | No claim that the merchant has never used Insignia. Do not call an empty catalog “no Insignia config” when no products exist. A V1 percentage is not proposed because the end-to-end test has no durable completion evidence; fixed verifiable independent tasks may still be counted without implying sequence. |
| **P2 — Product setup in progress** | A known product has no effective publication, or its current detail read shows a draft, pending, failed or conflicted publication state. | Link to that product’s existing configuration. Say Continue setup only for a confirmed draft; for pending/conflict/operator-hold/failure, use the exact current state and the recovery already supported by the product workflow. | Do not equate saving a draft with publishing; do not show a generic Finish setup action if current state needs an operator or support. Product-list published can coexist with newer draft work. |
| **P2 — Published-theme task incomplete** | Current App Bridge evidence says a theme extension is available rather than active. The check is for the published theme. | Link to Storefront setup, where the correct independent action and Shopify editor handoff are already explained. | Do not call a click or return a save; do not conflate block and cart-embed tasks; do not claim every template or unpublished theme is covered. |
| **P2 — Theme status unknown, unavailable or unsupported by this context** | Invalid, ambiguous or missing extension records yield unknown; the status API may be unavailable or failed; Shopify’s explicit unavailable value is distinct. | Use Not verified / Couldn’t check according to the actual cause, with the manual theme-editor route or Storefront setup page. Retry only after a failed check. | Do not call unknown “not installed,” call the theme incompatible from unavailable alone, or treat no App Bridge API as an inactive theme. |
| **P3 — Configured, no recorded Insignia orders** | At least one effective product publication and both published-theme tasks are freshly verified; an authorized empty first unfiltered purchase-record page has no next cursor. Otherwise this state is not known. | Say No Insignia orders recorded at this read. Keep the normal product actions available, and link to Storefront setup if the merchant wants to test the customer flow. The test may have happened, but its completion is not durably recorded. | Never say “store is ready,” “no Shopify orders,” “test not done,” or “all setup complete.” Theme checks do not prove journey behavior. |
| **P3 — Operating normally** | Authorized order data is available. A known issue can be shown from its specific record; absence of an issue on the first page is not a global all-clear. | Show a short, bounded date-descending sample of recent customized orders and useful product actions, such as Choose a product or a specific known draft. Link to Orders/Products for full collections. | No total or claim about older orders from the sample. Do not repeat full tables, filters, product editors or Settings controls. |

### Precedence when states collide

1. **Protect truth and privacy.** A global session failure replaces private content; a domain-specific failure replaces only that domain. Remove unauthorized content.
2. **Show a known, actionable operating issue.** Only do this for a specific record the current actor may see and only link to an action that the existing order page supports.
3. **Explain a verified blocker to the promoted task.** Billing or publication state should appear only when it blocks the next action; theme unknown is a verification gap, not a proven blocker.
4. **Promote one current setup task.** Prefer a product draft or an actual incomplete theme task. Keep independent tasks independent; do not create a sequence.
5. **Otherwise use a useful steady state.** Show a bounded recent-orders sample and relevant product actions, with links to the full owning pages. Do not fill space with empty tiles or unsupported “success” copy.

The criteria above describe precedence, not a promise that every state can be classified with current endpoints. A bounded recent-orders sample and a specific known issue need no global aggregate. Catalog-wide counts, complete issue queues and all-shop completion do. Keep the Home summary honest about page and time scope.

## Checklist Design fit audit

This is an applicability audit for a proposed Home state model, **not** an audit of a rendered Home screen. No separate Home screen exists to mark as visually present or missing. “Use” means the item should shape a future Home design; “Adapt” means use only the product-relevant part; “N/A” means the feature would mislead or duplicate an existing owner. These are not a score.

### Dashboard — Web app

Source: [Dashboard checklist](https://www.checklist.design/web-app/dashboard), bundled as web-app-dashboard.md.

| Fit | Checklist item | Home decision |
| --- | --- | --- |
| Adapt | **Welcome state** — A brief summary of what's happened since the last visit immediately re-orients returning users. | Prefer current actionable work over a greeting. No reliable last-visit or cross-product activity feed exists. |
| N/A | **Key metrics** — The numbers most relevant to the user's goals, readable without leaving the home screen. | No authoritative Home metrics exist; product and order reads are paginated. The current product specification excludes a usage dashboard. |
| Adapt | **Recent activity** — The most recently created or updated items, enabling users to resume work without hunting. | A short date-descending list of recent Insignia purchases is supported by the current first page and can help merchants resume work. This is not a general activity feed or an all-time view. |
| Use conditionally | **Needs attention** — Time-sensitive items requiring a decision, surfaced here instead of buried in another view. | High value only for a verified, current issue with a supported action. Do not raise an alert from a partial scan or mistake “artwork needed” for a repairable upload. |
| Adapt | **Quick actions** — Shortcuts to the most common tasks, accessible without navigating away. | Use a context-matched next action or existing route. A generic tile grid duplicates Products, Orders and Settings, and cannot be ranked by frequency from current evidence. |
| Use with distinct causes | **Empty state** — The state shown when there is nothing to show yet, with a clear first action. | Separate no configurations, no recorded Insignia purchases and read failure. Each requires different evidence and action. |
| N/A | **Layout control (if applicable)** — Controls to show, hide, or reorder widgets so the home screen matches how the user works. | A focused embedded-app Home has no configurable dashboard widgets or preferences. |

### Onboarding — Web app

Source: [Onboarding checklist](https://www.checklist.design/web-app/onboarding), bundled as web-app-onboarding.md.

| Fit | Checklist item | Home decision |
| --- | --- | --- |
| Adapt | **Progress indicator** — An indication of how many steps are involved and where the user currently is in the sequence. | The independent product/theme tasks can be counted if Home defines a fixed set with verifiable status; a count does not imply sequence. V1 does not propose a percentage because the customer test lacks durable completion evidence. This is a scope choice, not a checklist requirement. |
| Adapt | **Welcome message** — A brief message acknowledging this is a new experience and orienting the user toward what the product does. | A short first-use orientation may help, but Home should not assume a new account or add a welcome hero. The current user is already in the installed merchant app. |
| N/A | **Account setup** — The minimum information needed to personalise the experience, gathered at the start. | Shopify and the installed app supply identity; no profile or account form is needed to reach first value. |
| N/A | **Product highlights** — Key features introduced through short contextual tips or a visual walkthrough. | Existing task pages own contextual instructions. Tutorial cards or feature tours repeat their content. |
| Use | **First action prompt** — A clear prompt directing the user to an action or feature. | This is the strongest onboarding-derived idea for Home: one fact-based next action with a real destination. |
| Adapt | **Completion confirmation** — A clear acknowledgement that setup is complete, transitioning the user into the main product. | A specific verifiable task may be confirmed. Do not claim whole-journey completion: the customer test has no durable result, and theme status has narrower scope. |

### Empty State — Web app

Source: [Empty State checklist](https://www.checklist.design/web-app/empty-state), bundled as web-app-empty-state.md.

| Fit | Checklist item | Home decision |
| --- | --- | --- |
| N/A | **Illustration or icon** — A visual that signals the empty state and gives the screen some personality, rather than feeling broken. | Not needed for a task-oriented Home. No illustration should substitute for useful evidence, action or a real store preview. |
| Use | **Clear heading** — A short, plain-language title naming what's missing. | Name the actual absence: no product configuration or no recorded Insignia purchase, only when verified. |
| Adapt | **Supporting description** — A brief explanation of what belongs in this space, most useful for first-time users. | Explain who owns the data and the next step only when that helps. Avoid explanatory filler on a calm steady state. |
| Use conditionally | **Primary action** — A CTA pointing toward the next step: creating, importing, connecting etc. | Point to the causal existing task and only show it when the actor can perform it. Do not offer generic navigation as if it creates the missing data. |
| Adapt | **Zero state vs. no-results state** — A distinction between a screen that is empty because nothing has been created versus one that returned no search or filter results. | Home has no search state, but its source pages do: empty product configuration, filtered Products or Orders results, and an empty later page are not interchangeable. |
| Use | **Error state variant** — A separate variant for when content failed to load, as opposed to genuinely being empty. | A hard requirement. Per-domain errors and permission denials must never masquerade as empty state. |

### Banner — Design system

Source: [Banner checklist](https://www.checklist.design/design-system/banner), bundled as design-system-banner.md.

| Fit | Checklist item | Home decision |
| --- | --- | --- |
| Use | **Style** — How the banner types look (fill, text colour, border radius etc). | Use Shopify’s supported semantic banner tones and native hierarchy; exact rendering awaits design work and native review. |
| Use selectively | **Content** — A title is a must but you can consider a description if you feel a title does not convey enough information. | Give a real blocker/error a clear heading and one useful explanation; do not banner every status badge or setup fact. |
| Adapt | **Types** — Banners typically appear as 5 options: information, success, warning, error, neutral. This helps visually establish context and level of importance. | Map severity to truth: a transient check failure is not a critical product failure, and ordinary “active” status needs no success banner. |
| Conditional | **Call to action button** — A banner may call for the user to do something, like fix the error it is calling out, or viewing the successful outcome of an event. | Include one button only for direct, supported recovery such as retry or Billing. Otherwise keep the action beside the relevant task. |
| Use | **Placement** — Where the banner sits on the page, dependent on context and importance. | Keep product, theme and order messages local to their section. Use a page-level banner only when session or app access affects all of Home. |
| Adapt | **Dismissable** — Whether the banner can be dismissed. | A live blocker or access/data limitation should remain until the underlying fact changes. Dismissing informational confirmation is optional; no dismissal state is needed for V1. |

### Settings — Web app

Source: [Settings checklist](https://www.checklist.design/web-app/settings), bundled as web-app-settings.md.

| Fit | Checklist item | Home decision |
| --- | --- | --- |
| N/A | **Structure** — Organising settings controls into logical categories e.g. account, notifications, security, billing. | Home is not a second settings index. Existing Settings owns those categories. |
| N/A | **Account details** — The fields where users update their name, email address, and profile photo. | Not an Insignia Home task; the app does not need a duplicate merchant profile. |
| N/A | **Security details** — The ability to change the password, two-factor authentication and other security information. | Shopify owns merchant account authentication and security. |
| N/A | **Notification preferences** — Controls for which notifications the user receives and through which channel, grouped by type (product updates, reminders, billing). | No notification preference surface exists or is needed to summarize Home state. |
| Adapt | **Billing** — Managing payment method, upgrading or cancelling a payment — this could also be a preview of this information with a link directly to the billing page if separate. | Only surface a concise, verified new-action gate with a link to existing Billing. Shopify owns the plan action; do not copy the Billing page into Home. |
| N/A | **Additional preferences (if applicable)** — Language, timezone, date format, and appearance settings like dark mode. | No Home-level preference is required; current locale/time-zone behavior remains with existing pages. |
| N/A | **Danger zone** — Destructive actions like account deletion, clearly separated from the rest of settings. | Destructive account actions do not belong on Home and are not part of current Insignia merchant setup. |

## Supplementary design lenses

Shopify’s App Home, content and layout guidance owns merchant-facing component and content choices. These sources are supplementary design lessons, not Shopify requirements and not additional installed skills.

- The [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) were refreshed on 26 October 2026. Relevant lessons for a future Home review are to keep empty and error states distinct, give errors a next step, make link/action semantics clear, handle long text, and keep interactive state accessible. The source also recommends Title Case, which conflicts with this project’s Shopify sentence-case direction; Shopify governs that choice.
- Memorisely’s [visual hierarchy demonstration](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1) groups content, then uses proximity, scale and restrained color to make important content lead. Its example also keeps actions near their related activity and reduces an overwhelming full-width metrics treatment. Applied here, a known issue or next action should own the visual lead; supporting evidence and action stay together; no metrics or decorative imagery should be added just to fill the canvas.
- Zander Whitehurst’s [progressive disclosure post](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX) argues for revealing detail based on context, while the post’s discussion warns against hiding relevant information in a drawer. Applied here, keep the next task, its reason and its direct action in the main view; put optional explanations and technical detail on the existing task page. Do not hide an important blocker merely to make Home look minimal.

## Primary sources and method

The applicability audit used the installed Checklist Design 3.2.4 skill and its bundled index, audit instructions, and five exact reference files: web-app-dashboard.md, web-app-onboarding.md, web-app-empty-state.md, design-system-banner.md, and web-app-settings.md. The links above are each checklist’s own source URL. Checklist items are prompts; N/A is deliberate where the product does not support the feature.

Shopify primary-source links already recorded in the repository’s admin and Storefront research:

- [App Home setup-guide composition](https://shopify.dev/docs/api/app-home/v2.0/patterns/compositions/setup-guide) and [App Home Settings pattern](https://shopify.dev/docs/api/app-home/v2.0/patterns/templates/settings): relevant structure references, not a mandate to create a numbered onboarding sequence.
- [Shopify content](https://shopify.dev/docs/apps/design/content) and [layout](https://shopify.dev/docs/apps/design/layout): merchant task hierarchy and concise, scannable content.
- [Theme extension UX](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/ux), [theme extension configuration](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration), and [App API](https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/app-api): theme ownership, published-theme scope and activation evidence.
- [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing): hosted subscription/plan management boundary.

These Shopify links are carried forward from [admin UI guidance](admin-ui-guidance-2026-10-20.md), [Storefront setup research](storefront-setup-research-2026-10-26.md), and [Settings product-truth review](settings-product-truth-review-2026-10-25.md); they were not re-opened in this pass. This pass reviewed current source and those research records; it did not render a Home screen or re-inspect Shopify’s native Home reference. Native appearance, interaction, owner acceptance and release status remain unassessed.
