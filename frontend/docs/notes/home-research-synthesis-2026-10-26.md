# Insignia Home: research and recommended V1

26 October 2026. Research only: no Home route, application UI, backend or runtime version was implemented. Three independent Luna Max researchers examined Shopify patterns, merchant states and actual Insignia data. A separate Sol reviewer challenged the recommendations before synthesis. Native first-party apps were inspected on the authorized rewrite dev store.

The expanded pass inventories the Help Center's 39-entry first-party roster, with newer and restricted listings checked separately. The [inventory and ranked shortlist](home-first-party-app-inventory-2026-10-26.md) distinguish current availability, documented behavior, published imagery and live observation. The [operational comparison](home-operational-app-comparison-2026-10-26.md) goes deeper into Flow, Subscriptions, Digital Products, Order Printer and Fraud Control. A fresh GPT-6.1 Sol medium reviewer challenged the added research; its [findings](home-expanded-research-review-2026-10-26.md) are incorporated below.

The expanded [visual reference board](http://127.0.0.1:62169/) is backed by `/Users/pc/Development/Insignia/.artifacts/home-research-2026-10-26/index.html`. Four new Flow captures now show actual first-use, inactive-resource, activity-empty and detail states. Additional first-party published examples are labeled individually. They are not current native-version verification. Abstract Knowledge Base marketing graphics and Inbox customer-assistant images are not used as Home layout references. This board documents evidence, not an Insignia mockup.

## Recommendation

Build a **merchant work overview that changes with use**. At first it helps someone configure a product and connect the storefront. Once customized orders exist, it helps them resume product work and open relevant orders. It must still be useful when nothing needs attention: show a small recent customized-orders summary and clear product actions, rather than an empty page or a permanent congratulations card.

This is a UI design direction, not a commitment to add analytics or build new backend features now. The later first-time walkthrough remains separate. Home must lead into the existing product editor, Orders and Settings instead of reproducing those pages.

## Why this direction

[Shopify's App Home guidance](https://shopify.dev/docs/apps/design/user-experience/app-home-page) emphasizes daily value, status and immediate actions. Its [Homepage pattern](https://shopify.dev/docs/api/app-home/latest/patterns/templates/homepage) describes a section-based composition, with card-level status/actions in the section header and simple divider-separated lists. It is an example library, not an instruction to include every news, metrics, templates or promotional block.

The native references reinforce variation rather than one universal dashboard: Forms changes from one creation prompt to a resource overview after the first form; Translate & Adapt is a resource hub; Search & Discovery combines an optional guide with period-specific analytics; Flow starts from its workflow task. Shopify Admin Home shows ongoing order work alongside incomplete store setup. The [observation record](home-native-app-observations-2026-10-26.md) distinguishes native observations from public examples and design inferences.

Checklist Design's [Dashboard](https://www.checklist.design/web-app/dashboard), [Onboarding](https://www.checklist.design/web-app/onboarding) and empty-state checklists prompt us to cover real work, first actions and recovery. They do not justify unsupported metrics, redundant greetings, mandatory wizard steps or customizable widgets. Vercel, Memorisely and Zander add interaction, hierarchy and disclosure lessons; Shopify owns the native component/content choices. The [state research](home-state-and-priority-research-2026-10-26.md) records the actual source files/posts and where guidance is supplementary.

## What the wider comparison changes

The first four-app sample did not support calling the research broad. The added references challenge the page's purpose, not just its styling.

| Reference and evidence | New distinction | Decision for Insignia Home |
| --- | --- | --- |
| [Digital Products](https://help.shopify.com/en/manual/products/digital-service-product/digital-downloads), documented Products-as-home and published resource-table example | A useful Shopify app need not have a separate dashboard. | Keep a separate Home only for cross-resource value: resume product work, check storefront setup when relevant and open customized-order work. Products still owns product selection and configuration. Do not build a second Products table. |
| Flow, newly observed first-use and inactive list/detail | Creating a resource ends first use even when it is inactive, incomplete and has never run. | A saved draft replaces the first-product prompt with a named resume action. Publication, configuration completeness and customer activity remain separate. Flow's news and template catalog do not justify an Insignia news strip. |
| [Flow monitoring](https://help.shopify.com/en/manual/shopify-flow/manage/monitor) and [Subscriptions recovery](https://help.shopify.com/en/manual/products/purchase-options/subscriptions/shopify-subscriptions/manage-subscriptions/manage-contracts), documented operational behavior | Activation/lifecycle, waiting and actionable failure have different meanings. | Distinguish a merchant task from waiting for customer artwork and from historic retention expiry. Specific work rows need an actor, reason and supported destination. Keep ordinary recent orders separate; a non-ready badge alone must not make an urgent task. |
| [Launch Check](https://help.shopify.com/en/manual/intro-to-shopify/launch-check), documented assessment/manual review and published UI | Current assessment and a person's confirmation are different evidence. | Keep customer-test acknowledgment distinct from product/theme checks. A later theme change can prompt another check without claiming the original customer test never happened. Do not copy broad store-ready language or build a scanner. |
| [Knowledge Base](https://help.shopify.com/en/manual/promoting-marketing/knowledge-base/managing-faqs), documented top unanswered questions and Test badges | Actual activity can create a precise next task, while tests remain identifiable. | Link a known issue to its exact order or product destination. Preserve test-order identity where the source identifies it; do not blend simulated fixture events into real customer totals. No recommendation engine or query analytics is implied. |
| [Order Printer](https://help.shopify.com/en/manual/fulfillment/managing-orders/printing-orders/shopify-order-printer/printing-documents), documented order-owned printing | A utility need not relocate task execution to its app landing page. | Keep production sheets, artwork export, selections and bulk work in Orders. Home can open the particular order with its context. This is highly relevant structure even though Order Printer is not a dashboard. |
| [Inbox](https://help.shopify.com/en/manual/inbox/conversations), documented agent Overview and separate staff handoff | Performance summary and an actionable work queue are different contexts. | Borrow specific work and ownership, not an assumed Overview layout, AI metrics, unread-count model or conversation feed. A recent-order list is not an unread-notification system. |
| [Fraud Control](https://help.shopify.com/en/manual/payments/fraud-prevention/fraud-control-app) and [Subscriptions Performance](https://help.shopify.com/en/manual/products/purchase-options/subscriptions/shopify-subscriptions/analytics), documented dashboard/index reporting | Analytics can be appropriate when their definition, period, comparison and availability are explicit. | Omitting charts in V1 is an Insignia product/data choice. It is not a Shopify or Checklist rule against dashboards. Add a metric later only when it answers a merchant question and has a trustworthy definition. |

The operational note also inspects Shopify's public Subscriptions reference repository at pinned commit `575a825f9f38aca9b0a1880e0fac10121b572a1c`. That example distinguishes no subscription plans, no customer contracts, and an empty filtered view. Its contract-list Home differs from the production Help Center's documented Performance index. These sources must not be combined into an invented current Shopify screen. The example's status display choices and generic reload fallback are source behavior to assess, not best practices to copy automatically.

A separate Home remains my recommendation because Insignia has two recurring work areas, product setup and customized orders, plus storefront setup that can need attention independently. The design should demonstrate that combined value in one compact view. If a later rendered V1 only repeats Products and adds navigation cards, remove the extra layer rather than preserving Home for convention.

The wider catalog also contains Collabs, Marketplace Connect, Collective, Checkout Blocks, Messaging, Shop, Planet, Launchpad, Headless and other specialized tools. Their roles and eligibility are recorded in the inventory. Installing every first-party app would not add proportionate Home evidence: several need external accounts, Plus, payments, physical retail or a different buyer-facing workflow. Evidence value is judged by the interaction model, not the app count.

## Recommended default composition

1. **App title and contextual action.** One Shopify host title. The first-use primary action is Configure product, opening existing product selection at `/admin/products`. A known product task links directly to its existing editor. Do not invent a second Home picker or imply creating a new Shopify product. In a working store, the actionable order row can be the primary task; a permanent extra header CTA is not compulsory.
2. **A real blocker, when relevant.** One concise page-level message for a session-wide or action-blocking issue. Explain what is affected and link to its owner page. Ordinary pending work is not a warning banner. A failed Orders panel must not replace the whole page.
3. **Setup or operational work, according to context.** New merchants see a compact setup section. Merchants with orders see relevant work first, with unfinished optional setup below. Existing orders must not be hidden behind setup. The next task, reason and action remain visible together.
4. **A short recent customized-orders summary once orders exist.** Three to five entries is the proposed visual starting point, to test at phone/desktop widths. Each has order identity, date/context and a meaningful status with a direct order link; the header links to all Orders. This is not a replacement full table. Older outstanding work must not be mistaken for resolved work simply because it falls outside this recent slice.
5. **Product work and quiet help.** Show a few drafts that can actually be identified, or a clear Products action. Do not call them recent without a timestamp source. Keep Methods, permission management and Billing in their existing destinations; surface them only when the current task requires them. A consistent support link is useful only when it has a real destination.

The exact grouping and primary action are proposed design choices to prototype. They are not Shopify-mandated headings. Avoid filling the page with separate navigation cards, an empty all-clear card, invented miniature screenshots, routine Refresh, news, app promotions, upgrade banners without a real restriction, or charts without a real question/data source.

## State matrix for the first design pass

| State/evidence | What leads | Main action/relationship | What to avoid |
|---|---|---|---|
| Authenticated shop has no Shopify products | One first action explaining the prerequisite. | Open Shopify's product creation surface, then return to selection. This is the only state requiring a product to be created rather than configured. | Configure a nonexistent product; a dead picker; all-zero metrics. |
| Shopify products exist, no Insignia configuration | One concise Configure product prompt. A small optional theme task may follow. | Established product picker → existing product editor. | Mandatory Methods-library or Billing tour; asking for information already in Shopify. |
| First configuration saved as draft | Named draft and what remains before publication. | Resume that product's editor. Storefront setup can proceed independently. | Treat Shopify ACTIVE status or saved draft as published customization. |
| Published configuration; storefront work incomplete | Specific published-theme task with its own scope and link. | Existing Storefront setup page owns add/enable/editor instructions. | Claiming every product template is covered or the shop is ready to sell. |
| Configuration/theme evidence present; customer test not confirmed | A short invitation to preview/test a product. | Existing product test and Shopify-owned editor preview. | Automatically marking a live customer test complete from a link click or activation response. |
| Setup completed/acknowledged, no customized orders | Compact order empty state, product action and optionally preview. Keep the page useful and calm. | Products or preview; no forced re-onboarding. | Big zero analytics grid; implying there are no ordinary Shopify orders. |
| Customized orders exist, no verified actionable issue | Recent customized-order rows and useful product shortcuts. | Existing order detail and View all orders. | Blank Home because there are no alerts; unverified All caught up statement. |
| A specific order needs a supported action | Named order, reason and direct task action. | Order detail, with the actual file/upload/review action there. | Calling every artwork-needed result urgent, or claiming the customer owes a file when retention/erasure caused it. |
| Many orders or drafts | Keep summaries bounded; link to full resource pages. | Full Orders/Products own search, filters, paging and bulk work. | Growing Home into another full index or duplicating full controls. |
| Orders exist while setup is incomplete | Relevant order work remains reachable before secondary setup. | Order detail; compact Continue setup below. | A wizard that blocks the work the merchant already has. |
| Staff cannot access order/artwork information | Authorized product/setup work remains useful; omit inaccessible order details. | Permission explanation only where it helps, with the existing access page. | Fabricated zero orders, private counts or constant red permission banners for normal staff roles. |
| Plan prevents a new action | One precise restriction next to the affected action, with supported Billing handoff. Existing permitted work remains available. | Existing Billing/Shopify management. | Duplicating plan comparison on Home; inferring restrictions from a status label alone. |
| Theme changed or activation is unknown/unavailable | Scoped Check storefront setup task, without invalidating effective saved product configurations. | Existing Storefront setup recovery. | Changing unknown to Not installed; ordering merchants to Add a potentially existing block. |
| One summary fails or becomes stale | Preserve independently successful panels; local failure and Retry at the failed panel. | Retry that read or navigate to its resource page. | Zero/all-clear on failure; a page-wide error when only one panel failed. |
| Session/store context is lost | Clear reopen/reconnect route, retaining safe return context where possible. | Shopify authentication/host, not a fake local login form. | Showing another shop's cached data or preserving an old positive status as current. |
| Initial/slow loading | Stable silent accessible skeletons matching the intended section geometry. | Independent panels resolve without stealing focus. | Flashing first-use empty state, fake zeros, indefinite spinner with no recovery. |
| No matches in a linked resource filter | Resource-level no-results explanation and clear filters action. | Keep the user in Products/Orders. | Restarting onboarding or announcing the underlying collection is empty. |

This is a coverage matrix, not seventeen unrelated pages or mutually exclusive shop stages. States combine: for example, an operating merchant can have a theme question and one failed panel. Data availability and permissions are independent of lifecycle.

## Setup dependencies and completion

Creating/publishing a product configuration and installing the theme features can happen in either order. A usable product and the relevant storefront entry points are prerequisites for the customer's end-to-end test. Reusable Methods are optional defaults; configuring a product must not require a separate library visit.

Independent tasks **can** have a meaningful completed-task count. A count does not impose a sequence. However, each checked task needs a stated completion source, and an unrecorded customer test cannot silently become a verified step. For the first layout, show task statuses and a collapsible guide without a percentage. Add a count later only if the fixed task set and completion evidence make it useful. The absence of progress is a scoped V1 choice, not a Checklist or Shopify prohibition.

Dismissal and completion must be separate. The merchant can collapse/hide optional guidance without completing it. A real unresolved blocker returns when its underlying condition warrants it; dismissed marketing/help content should not repeatedly return. Do not add a celebratory completion panel that displaces ongoing work. A collapse preference should be scoped to the current shop/user; necessary task state must not depend on one tab's memory.

## Evidence and data boundaries

The [capability audit](home-data-capability-research-2026-10-26.md) maps actual fields and routes. Important distinctions for design:

- A date-sorted purchase page can support a short **Recent customized orders** list. It does not need an activity-feed backend or a complete total. Known specific work may be shown without claiming it is the entire queue.
- An authorized, unfiltered first page with no items and no next cursor can establish emptiness at that read. A failed request or empty filtered/page-limited subset cannot establish global absence.
- Counts derived from one product/order page are not store-wide totals. Exact counts or a complete attention queue need a trusted summary/filter contract. That is a later implementation dependency, not a reason to remove useful states from the UI design. No backend work is started by this research.
- Insignia's orders are tracked customized purchases, not every Shopify order. No current source supports conversion, revenue attribution, traffic, time saved, fulfillment backlog or changes since the last visit.
- Saved draft, effective published configuration, Shopify product status, published-theme activation and customer-test acknowledgment are distinct facts. Do not compress them into one Ready badge.
- Existing artwork-needed status includes deferred/missing artwork and retained-data expiry/erasure. Surface a reason-specific task only when the reason and a supported next action are available. An old fulfilled order with expired data must not become an invented urgent production issue.
- Orders/artwork access is account-owner and scope gated in the current implementation. Do not replace that with an assumption that an app-level scope or general staff product access authorizes order data.

For a simulated V1, scenarios should represent these intended facts explicitly. A future summary needs only current-domain facts and provenance: collection presence, effective configuration/draft facts, a small recent-order list, verified actionable task reasons, the actor's allowed actions, and independent availability results. Omit exact global counts until chosen and supportable. Keep these technical qualifications out of merchant-facing copy.

## Native components and interaction rules

Use the existing iframe App Home model and the project's pinned Polaris contracts. `s-page` owns the host title/actions; `s-section` owns normal cards, heading/subheading and header actions. Section-wide status goes in `supplemental`; See all/collapse actions go in `secondary-actions`. Lists use supported resource rows or simple rows with dividers. A headingless section needs an accessible label. Use `s-badge` for scoped status and `s-banner` sparingly for important messages; do not make every task a banner. Empty state is a content state, not an error banner.

One column is the recommended starting point for this small work overview. Test any supplementary side content before adding a second column. At narrow widths, keep the task name/reason/status/action together, avoid horizontal dashboard scrolling, support long order/product names through the established overflow treatment, and maintain real text/control insets. Examples and icons must explain a real task; no synthetic storefront art is proposed.

Use real links with clear destinations, visible keyboard focus and a logical reading/tab order. Preserve existing browser navigation. Returning from product setup, Billing or Shopify's editor should re-evaluate the relevant facts rather than equating navigation with success. A background refresh must not steal focus, clear filters on the owning page or move an action while the user is using it. An explicit retry belongs to an actual failure; routine Refresh controls are unnecessary.

The app name should open the new Home destination. Keep Products, Orders, Methods and Settings as their own navigation entries; do not add a second visible Home entry for the same URL. Shopify's [navigation guidance](https://shopify.dev/docs/apps/design/navigation) owns this rule. Existing full pages own editing, bulk actions, settings, commercial consent and detailed recovery. Home summarizes and routes.

## Source/version and acceptance limits

The [official pattern research](home-shopify-pattern-research-2026-10-26.md) verifies the selected Section/slot contracts against local `@shopify/polaris-types@2.0.0-rc.3`. Shopify's current versioning documentation describes 2.0 as stable, whereas the local runtime remains `polaris-2.0-rc.js`. No migration was made; runtime alignment should be an explicit implementation decision before building Home. Do not silently upgrade unrelated screens during a design pass.

The state matrix and proposed Home hierarchy still need an actual desktop/phone V1 and review. Native apps supplied first-use, inactive-resource, activity-empty, detail and empty-filter precedents; they did not prove Insignia's active-order or failure states. There is no claim that Home has been built, integrated, visually accepted or released. No application tests were run because this work changes research documents only.

## Independent review outcome

A GPT-6.1 Sol medium reviewer challenged the initial notes and reviewed this synthesis. Five corrections were incorporated: bounded recent orders are useful without an activity-feed service; independently completed setup tasks can be counted; an authorized empty unfiltered first page with no cursor can establish emptiness; quiet Home needs useful content; and proposed operational/error scenarios must remain distinct from observed native states. The reviewer found no remaining material issue in the final research direction. The source notes were corrected to match these distinctions. This is research review, not approval of a Home design that has not yet been built.

## Expanded review and verification

The second Sol review found that the expanded inventory had not yet changed the main argument, that Subscriptions and Fraud Control had been mislabeled as lacking Home evidence, and that ranking by domain similarity underrated Order Printer and Subscriptions. The table above and corrected inventory address those findings. Flow's earlier loading limitation is superseded by successful native captures through the official entry route. No executed workflow or populated run log is claimed.

The expanded board's image sources were checked for loading, and the useful examples were inspected visually. Published imagery is not treated as pixel-accurate current production UI. Abstract marketing art and customer-facing screenshots were rejected as Admin Home layout evidence. One unconfigured inactive Flow research draft now accompanies the earlier inactive Forms fixture. No workflow was activated or executed, no extra app was installed in this pass, and no Insignia UI or backend was changed.
