# Settings scope recommendation

27 October 2026. Research and product-structure proposal only. The owner asked which settings screens Insignia needs and what belongs on them, before designing the hub. No application, store, subscription, permission or theme changes. This is a source-based completeness review, not a new visual acceptance pass.

## Proposed V1 structure

Keep one Settings hub and four existing child destinations. Do not create a new General, Account or Preferences page without a supported merchant decision to put on it.

| Group | Destination | Contents and actions |
| --- | --- | --- |
| Storefront | Storefront setup | Separate customization-block and cart-review-embed activation states for the published theme, their native editor handoffs, brief compatibility help and a product-specific customer test. Provide a way back to the same product setup when testing is blocked by an unfinished or unpublished configuration. |
| App and account | App permissions | Product setup app access, effective staff read/edit access, read-only checkout setup checks and order/artwork access limitations. Explicitly request only a supported missing optional scope, then recheck the result. Link to Shopify for its full permissions/staff management. |
| App and account | Billing | Confirmed current plan/status, actual price and billing cadence, relevant trial/period/cancellation dates, confirmed discount or pending change, consequences of unavailable entitlement, and the appropriate Shopify plan-management handoff. |
| App and account | Customer data requests | Compact request inbox with due dates, a linked request detail, relevant order references, authorized data export and a route to retained artwork on the original order. Keep read/download errors and access limitations contextual. |

The hub is navigation, with short task descriptions and native full-row links. It has no global Save, Check everything, refresh or primary action. Keep high-frequency storefront work ahead of account utilities. Do not perform privileged reads of every child just to decorate the hub with badges. Add a status only if an authoritative, cheap source exists and the status changes the merchant's next action. Unknown is not failed; a missing access check is not a successful check.

Help should be reachable without a new Help Center page. Shopify already provides Get support and Manage app in the app's native header overflow. Verify that those lead to the configured real support information; reuse a small contextual help link when a page needs one. Current local Billing/unavailable copy says Contact support without an in-body destination. That is a recovery-link check to close, not proof that the actual Shopify-hosted app has no support entry point. Do not invent an email, chat widget, response-time promise or documentation destination.

Remove the ordinary Decoration methods row from Settings: Methods already owns a top-level destination. It is a frequently used business resource, including product assignment and pricing, rather than a general app preference. Current source duplicates it in both places. This is a proposed navigation change, not an implemented one.

## Ownership boundaries

Product editor: placement geometry, views, decoration sizes, eligible methods, prices, artwork movement and orders-without-artwork policy. These should remain next to the relevant product/placement. A global switch could contradict saved or published product choices.

Methods: reusable method definitions, default pricing and product assignment. The owner has already chosen independent product prices. Editing a library default must not silently alter existing saved product prices. Do not add a second Defaults screen with competing price controls.

The designed local Methods exploration includes richer pricing and assignment than the production names-only MethodLibrary. This implementation gap does not remove the owner's approved frontend direction. The settings recommendation follows the current intended UX and records integration separately.

Orders: artwork upload/replacement, locks, original downloads, production sheets and individual order work. Retention deadlines belong next to the affected records as well as in concise help. Export choices such as a production document belong to their current preparation flow unless repeated merchant needs justify a saved default later.

Shopify: merchant identity, passwords/2FA, staff roles, store currency/time zone, store policies, app uninstall and native billing/payment approvals. A useful contextual link is enough; do not recreate these controls. App-specific authorization still belongs to the application and must enforce the actual effective permissions.

Theme editor: app block placement, embed activation and the block's supported visual/text settings. The current customization block exposes Button label and a technical App proxy prefix; the cart embed exposes the prefix. Ordinary merchants should not be led toward technical routing configuration as personalization. Do not turn a technical schema field into a promoted Insignia setting. A later implementation review can decide whether to remove or support-gate it.

## Three areas to consider without inventing settings

### Storefront appearance and wording

There is a real future need to decide how the actual designer follows the merchant's storefront appearance and language. The light/dark/layout choices in the design prototype are not proof of persisted merchant settings. For V1, put available block customization in Shopify's theme editor and make its location discoverable from Storefront setup. Do not add a separate Branding or Translation editor until its actual controls, preview and save scope are defined.

Shopify's language or market selection does not automatically translate Insignia's hard-coded customizer text. Theme-extension locale files and merchant-entered settings are different mechanisms. The existing button-label text setting can follow Shopify's supported translation workflow; app-owned UI strings need actual localization implementation. A language selector with no translated content would be misleading.

### Operational notifications

The product specification requires warnings before retained data is deleted, but that does not establish a merchant-facing notification preference service. The inspected settings source has no channel/recipient/schedule controls. Resolve which events genuinely require notification, recipient authority, channel and delivery behavior before proposing a Notifications page. This is an unresolved product need, not an unconditional checklist N/A merely because the controls are absent today. Do not offer a switch that can disable a required warning. Home and order-level notices alone must not be claimed to satisfy an unimplemented delivery promise.

### Data and privacy information

Keep Customer data requests as the low-frequency operational utility, not a policy editor. Add concise help about what the app retains, where exports go and how expiry affects retrieval where that answers a real question. Link to the actual published privacy policy when its destination is available. Do not create a separate Privacy settings page solely for static prose, a global retention slider, Delete all data or an invented request-fulfilled button. Shopify requires compliance handling, not this particular inbox design.

## Screen states to retain in the design scope

| Destination | Material states |
| --- | --- |
| Hub | Normal desktop/phone, long localized labels, constrained staff access, any real unavailable destination. Static navigation should remain available without waiting for unrelated billing/privacy checks. |
| Storefront setup | Neither feature active, either feature active alone, both active, status unknown/check failed, return from editor without saving, changed published theme, unsupported theme/template, no suitable product, unpublished product and a ready product test. App activation does not prove the customer journey was tested. |
| App permissions | Not checked, checking, granted, supported missing optional scope, declined, uncertain result, insufficient staff access, insufficient order access, request failure and expired session. App scopes and staff authorization remain different facts. |
| Billing | No selected plan, real Free entitlement once configured, paid/trial, pending or scheduled change, cancelled/inactive, verification failed, staff restricted and return from hosted selection without approval. Names/prices/limits for Free and two paid plans remain undecided; current backend Standard/development terms are not those future plans. |
| Customer data requests | No requests, pending list/detail loading, direct request entry, multiple pages, no matched/available order, partial expired/erased data, successful local download, transient export failure, denied access and expired session. Download does not mean delivery to the customer or legal fulfillment. |

Most child states already exist. This table sets the intended coverage to verify; it does not claim every state is implemented or freshly rendered in this research turn.

## Design basis and implementation order

1. Define the hub's four destinations, remove redundant Methods navigation, and design the hub against a current rendered native settings/interstitial example.
2. Check direct links, native back navigation and staff-aware destinations across the existing children. Keep this to presentation and simulated state work.
3. Fill only demonstrated child-state gaps. Resolve appearance/localization and notification product decisions separately rather than placing dummy controls on the hub.
4. Leave the broader first-time customer journey pass until this remaining page/state work is complete, as requested by the owner.

Shopify's [Settings pattern](https://shopify.dev/docs/api/app-home/latest/patterns/templates/settings) governs logical groups and saving actual editable settings. Its [navigation guidance](https://shopify.dev/docs/apps/design/navigation) supports few task-oriented categories and avoiding duplicate app navigation. [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing) provides hosted plan selection; this is distinct from a future billing-adapter migration. [Managing apps](https://help.shopify.com/en/manual/apps/managing-apps) establishes native permissions/privacy/uninstall surfaces, while [theme-extension UX](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/ux) keeps supported visual controls in the theme editor. [Privacy compliance](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance) establishes the processing requirement, not a requirement for an app-authored privacy settings page.

The installed [Checklist Design Settings checklist](https://www.checklist.design/web-app/settings) was read directly. Its seven items are applicability questions: structure and billing apply here; account/security belong to Shopify; notifications require a real delivery feature; locale/appearance apply only where the app owns supported choices; destructive actions are not a reason to duplicate native uninstall. The fresh [Vercel guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) support real links, clear labels, unsaved-change protection where needed and contextual errors. Memorisely's [hierarchy example](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1) supports grouping and action proximity; Zander's [disclosure example](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX) supports keeping detail on its relevant child page. These supplementary sources do not prescribe new Insignia features or privacy obligations.

Local source basis: `MerchantSettings.tsx`, `ReadinessPermissions.tsx`, `MerchantBilling.tsx`, `MerchantPrivacy.tsx`, `AdminNavigation.astro`, the current theme block schemas, the placement preview's Customer options controls, implementation plan sections 7 and 10.4, and the superseding owner corrections in `settings-product-truth-review-2026-10-25.md` and `storefront-setup-v1-2026-10-26.md`. Older no-multiple-plans scope text does not override the owner's newer Free-plus-two-paid design direction.

Independent Luna Max findings are recorded separately in `settings-scope-product-2026-10-27.md`, `settings-scope-shopify-2026-10-27.md` and `settings-scope-checklist-2026-10-27.md`. They are inputs to this proposal, not visual approval or production verification.
