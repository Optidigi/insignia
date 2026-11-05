# Home V1

26 October 2026. Local application source and explicit preview scenarios, not deployment or owner acceptance.

Home is now a merchant work overview at `/admin/home`. The root entry and Shopify app-name navigation lead here; Products, Orders, Methods and Settings retain their own work. The local preview defaults to an operating store. Its Home example selector and the review gallery expose first use and recovery without changing Shopify data.

## Design and sources

The [expanded research](home-research-synthesis-2026-10-26.md) owns the comparison and source distinctions. Flow and Forms informed the first-use-to-resource transition. Digital Products challenged the need for a separate Home; this page earns its place through product work, storefront setup and customized orders. Launch Check informed scoped setup facts and manual acknowledgment. Order Printer informed the order-owned production boundary. Inbox, Knowledge Base and Subscriptions informed actor-specific tasks, test identity and lifecycle distinctions.

Shopify's [App Home guidance](https://shopify.dev/docs/apps/design/user-experience/app-home-page), [Homepage pattern](https://shopify.dev/docs/api/app-home/v2.0/patterns/templates/homepage), [content guidance](https://shopify.dev/docs/apps/design/content) and [navigation guidance](https://shopify.dev/docs/apps/design/navigation) govern the composition. The official toolkit searched the pinned `2.0-rc` contracts before implementation. The application retains `polaris-2.0-rc.js` and `@shopify/polaris-types@2.0.0-rc.3`; no runtime migration was made.

The installed Checklist Design skill supplied Dashboard, Onboarding, Empty state, Loading and Alert audit criteria. [Vercel's current guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) informed focus, truthful controls, overflow, semantic interaction and recovery. [Memorisely's hierarchy lesson](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1) informed proximity and grouping; [Zander Whitehurst's disclosure lesson](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX) informed optional setup disclosure. Those two are first-party teaching sources, not claimed installed skill packages. Shopify remains the component and content authority.

## Composition

First use has one centered product action. An empty Shopify catalog opens native product creation through `shopify.intents.invoke('create:shopify/Product')`; completion rereads Products and cancellation does not invent success. Pending and failed creation are separately reviewable. Existing Shopify products lead to product selection in Products, avoiding another Home picker.

Returning merchants see a bounded recent customized-order list and actual product drafts. Supported merchant tasks lead when explicit facts establish an action; waiting for a customer and historic artwork loss are not invented urgent work. Order identity, product context, date/quantity and status stay grouped. Test orders retain a visible Test label. All orders and product-list destinations remain visible in section headers.

Home summarizes storefront work with one accurately named handoff. It does not reproduce the Settings checklist or label an internal navigation link Add to theme. Verified theme features and a merchant's test acknowledgment remain different facts. Completed, explicitly acknowledged setup disappears from the preview's operating state. Unknown facts say Not verified; they never become missing or complete.

Each Products/Orders section can independently load, fail or be restricted. Success in one remains visible when the other fails. Retry restores keyboard focus after the rendered update; if an empty recovered section disappears, focus moves to the visible product section. Session loss shows the Shopify recovery state rather than private cached data. A known new-action restriction links to Billing; returning from an external change rereads billing and theme facts, with stale theme responses suppressed.

## Scenario coverage

The 24 explicit cases cover no Shopify products; creation failure and pending handoff; first product setup; saved draft; published product with pending theme work; customer test invitation; no customized orders; operating store; supported merchant artwork work; awaiting customer; historic artwork loss; incomplete setup with existing orders; many items with bounded summaries; restricted orders; independent Products/Orders failures; failed retry followed by recovery; full and independent loading; unavailable shop context; plan restriction; unknown theme; and long names/copy.

The preview and gallery use the production presentation component. Fixture facts are synthetic. The creation handoff is local and makes no Shopify product. There is no Home-specific backend endpoint, analytics service, fulfillment system or task-completion feature.

## Changes caught within this turn

A Luna Max preflight and independent GPT-6.1 Sol source/pixel review were used alongside the parent visual passes. Corrections include:

- Section header destinations use supported native button slots after rendered inspection found that link children were invisible despite type validation.
- Order rows use compact contextual identity rather than loose three-line floating order numbers.
- Mobile drafts use a fixed thumbnail track and a real action wrapper; native display-contents controls no longer enlarge the image column.
- Completed setup omits Add/Enable instructions, and equivalent handoffs no longer repeat under misleading labels.
- Plan-restricted fixtures suppress new configuration; long-copy fixtures contain merchant guidance rather than internal preview instructions.
- Blank decorative order graphics were removed. Empty-state heading, description and creation-error recovery share centered line boxes.
- Native creation, return-from-Billing refresh, mixed unknown/theme facts, out-of-order checks and hidden-panel retry focus were corrected before handoff.

See [preflight criteria](home-v1-preflight-2026-10-26.md) and the [independent review](home-v1-sol-review-2026-10-26.md) for scope and dispositions.

## Live read limits

`MerchantHomeContainer` composes existing bounded authenticated Products, Purchases and Billing reads and read-only App Bridge theme status. It does not claim totals from a page. Complete unfiltered catalog absence is required for first-use claims. Recent orders use existing date-desc ordering. Missing/erased/expired artwork is not enough to create a precise actionable queue, so the live adapter does not invent tasks from that status.

The product summary exposes effective publication before saved draft changes. Home can therefore list observed unpublished drafts, but cannot list every newer draft on an already-published product or establish global publication absence from one title-sorted page. The test prompt is an invitation, not proof of an unfinished or completed customer journey. Without a reliable shop/user preference key, live collapse preference is mount-local. Intended richer states remain explicit preview facts until their existing-domain source contracts are supplied; this turn does not expand backend scope.

## Verification and acceptance

Focused source tests, container/native-handoff browser tests, entry/navigation recovery tests, strict admin-test TypeScript, scoped Biome, Astro check/build and official pinned Polaris validation passed. The gallery captures all 24 states at 1440px and 390px, with nine additional 320px checks, 57 images in total. It checks horizontal fit, partial recovery and Enter-key focus after both failed and successful retries. The parent and independent reviewer inspected representative pixels; source validation alone did not count as visual approval.

These are local browser and synthetic App Bridge observations. Native Shopify embedded appearance, a real product creation, complete production data aggregation, deployment and owner acceptance remain separate. No Shopify theme, product, order or subscription was changed while building this V1.
