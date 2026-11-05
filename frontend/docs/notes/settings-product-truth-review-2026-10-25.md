# Settings product-truth review

25 October 2026. This supersedes the first Settings V1 presentation review where noted. The owner requested alignment with actual permissions and collected data, removal of routine refresh actions, a free-plus-two-paid-plan direction, and several Luna Max product reviews.

## Audit and decisions

Four GPT-6 Luna Max agents reviewed permission/authentication flows, order-linked customer data and retention, billing/subscription truth, and cross-workflow confidence. Their evidence included source and real desktop/phone captures. The first three informed implementation; the fourth checked the corrected source and captures independently. Findings were evaluated against actual server authority rather than treating a polished screenshot as proof of behavior.

### Permissions

The prior page requested only read-only checkout scopes and collapsed missing product access into session failure. The runtime scope candidate also declares optional `write_products` and `read_publications`; product reads/edits and publication checks actually use them. The page now offers a separate explicit product-setup consent action, requesting only the missing optional subset. A fresh scope query verifies the result. Checkout consent stays separate and requests only missing `read_cart_transforms` / `read_validations`. No prompt runs on mount, repeats silently, or requires a reload after refusal. Another consent attempt needs a fresh explicit check.

Known missing product-write access blocks the broad readiness read instead of producing a predictable 403. The existing readiness endpoint still couples staff/product inspection to checkout setup observations; that backend seam is unchanged. App scope availability is not staff authorization or publication readiness. A 403 explains insufficient app/staff access and keeps consent recovery available; a 401 replaces controls with session-reopen guidance. Fresh checks clear stale refusal messages. App order-scope availability and the store-owner requirement are shown without claiming that App Bridge verifies private-record access. The server still verifies that authority when records are opened. The full native app-permission list remains Shopify's responsibility.

The current TOML describes itself as a candidate, not an active-grant receipt. Its unused `read_product_listings` declaration and the difference between its optional development scopes and the wider Lean order/checkout installation baseline are recorded integration work. This UI pass neither adds manifest scopes nor requests undeclared order access. It makes missing access visible instead of treating the owner role alone as sufficient.

### What data the reviewed paths handle

| Path | Source-backed data and boundary |
| --- | --- |
| Merchant setup | Shop/installation/staff identity and grants, product/variant references, configuration, decoration choices, pricing and publication state. Authentication credentials and signing material retain their existing server custody. |
| Buyer customization | Artwork uploads, chosen variants/quantities, method/placement/size choices and accepted design/economic records. These are customer-associated data even without a contact-profile feature. |
| Purchased orders | Order IDs, lines, binding/economic facts, retained designs, payment/refund observations and artwork events. The export does not contain artwork binaries. |
| Privacy intake | Shopify supplies the request and order links. Incoming contact fields are not a separately maintained contact profile; processed raw webhook bodies are erased by the existing privacy processor. |
| Retention | Artwork has a seven-day cap; purchased design payloads have a six-month cap. Fresh tombstones/expiry remain authoritative, and downloads do not renew retention. |

Evidence: `apps/web/src/server/admin/auth.ts`, `apps/web/src/server/admin/production.ts`, `apps/web/src/server/purchase/http.ts`, `packages/database/migrations/20261017000100_customer_privacy.sql`, `20261017000200_privacy_merchant_export.sql`, `20261013000100_m8_purchases.sql`, and `packages/application/src/artwork/artwork.ts`. This table describes the inspected product paths, not an exhaustive legal/telemetry inventory.

Customer data requests remains an operational inbox, not a policy editor or deletion center. The page now describes order/design exports and directs merchants to the original order for retained artwork. Only the store owner with the needed Shopify access can export. The metadata-only request-summary download was removed. Internal GIDs are not displayed as human order numbers; the fallback says Order ID.

Opening a request checks only its first expanded order. Other orders are checked on expansion, exposing retained design actions without forcing an order download. The current API returns the full authorized order export during this check, up to its existing response limit; the UI stores only retained set IDs. A future narrow metadata endpoint could reduce that transfer, but this pass adds no backend endpoint or new collection. Every actual export makes a fresh authenticated GET. Order 404s withdraw unavailable actions; a design that expires between checking and export loses only its own action. A prior-installation purchase link that cannot be exported is therefore shown unavailable instead of offered as a broken download. Exact generation/retention guards remain intact. Errors have one contextual retry and preserve clearly identified loaded context. 401/403 clears private state. Request pagination commits cursor history only after successful reads. A failed Next retries the same cursor, and Previous remains available on an empty later page.

### Billing and plans

The implemented backend still recognizes one Standard recurring plan, USD 49.99 per 30 days with the existing trial and shop-scoped development terms. The owner's new design direction is Free plus two paid tiers. Prices, names, inclusions and entitlement mapping are not decided. No free plan is enabled, no current subscription is converted, and no new commercial promises are inferred from placeholder cards.

Shopify App Pricing owns the hosted plan selection and approval page. Plan names, prices, trials and descriptions are configured in Partner Dashboard. The app shows confirmed current subscription facts and routes to Shopify. A redirect parameter alone never grants access. The local billing handoff now contains a clearly labeled three-card structural preview based on Shopify's native example; undecided paid prices/features are explicit and selection is disabled. It is test support, not a duplicate production plan picker.

Billing no longer has a routine Refresh billing status action. Page entry reads current state, and transient/unverified results retain contextual Try again. Inactive/unverified states no longer receive a fictional current Standard heading or all-features benefit claim. The action says Choose a plan, Manage plan or View plans according to what is known. Existing development zero-dollar terms stay distinct from a future Free plan.

The provider already returned discounts, but the display projection discarded them. A backward-compatible read-only DTO field now preserves recognized discount amount/percentage, remaining cycles and end date. The UI labels the base rate and discount separately and computes no invented net charge. Freshness, current-installation checks and entitlement policy are unchanged. Frozen/cancelled causes and exact pending target-plan terms are not invented where the existing DTO lacks them; specific future tier states require a trusted plan mapping and confirmed provider terms.

## Sources

- [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing), especially its hosted plan selection, subscription verification and testing sections.
- [Plan configuration](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/plans) and [subscription-charge setup](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/setup-subscription-charges) support the free/paid structure without supplying Insignia's benefits or prices.
- [Shopify's native plan-selection example](https://shopify-assets.shopifycdn.com/shopifycloud/shopify-dev/production/assets/assets/images/apps/billing/managed-pricing-plan-selection-qcktHHMX.png) was inspected in the browser. Three restrained native cards follow its hierarchy; no annual discount, recommended badge or fake limits were copied.
- [SubscriptionDiscount](https://shopify.dev/docs/api/partner/2026-07/objects/SubscriptionDiscount) distinguishes provider discount metadata from the recurring base rate.
- [Scopes API](https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/scopes-api) governs query and explicit consent. A page reload is not used as a consent-retry requirement.
- [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md), [Memorisely hierarchy](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1) and [Zander disclosure](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX) informed grouping, recovery, focus, responsive labels and optional explanations. Shopify governs actual component/content contracts.

## Verification boundary

Pinned Polaris 2.0-rc validation, source/type checks, scoped style, the production web build, focused permission/billing/privacy regressions and refreshed desktop/390/320 captures qualify the local implementation. The gallery leads with these revised Settings states and includes the illustrative Shopify-owned plan handoff. The original review ZIP remains recoverable separately.

No live permission, subscription, app manifest, customer record, erasure, store or theme was changed. Native consent/payment behavior, dark Shopify appearance, final plan configuration, human usability and owner/release acceptance remain separate.

## Final local evidence

- Twenty focused browser/production regressions pass across Billing, permissions, privacy, navigation and fresh export authority. Privacy includes 100→1→100 pagination, a failed Next retry and an empty later page. Three explicit-consent/Settings editor workflows and two retained-context/access workflows are included in that count.
- Fifteen source/component boundary tests pass; maintained source coverage reports zero unchecked TypeScript or untyped maintained source. Strict admin-test compilation and scoped Biome pass. The web build checks 147 files with zero errors, warnings or hints.
- Pinned Polaris 2.0-rc component validation passes for Billing, both permission components, privacy and the local plan fragment. This validates component contracts, not native layout acceptance.
- The opt-in gallery passes at 1440×1000 and 390×844 with 320×568 overflow checks. The plan reference uses a full-height 390×1122 capture so all three cards can be reviewed. Thirty-six revised Settings states produce 72 captures; the complete gallery has 122 states / 243 captures. Latest changes is the default filter.
- The independent GPT-6 Luna Max skeptic inspected the corrected source and fresh desktop/phone captures and found no blocking UX or product-claim gap for owner review. The original Settings V1 review remains in `settings-v1-first-review.zip`; the portable current gallery ZIP is refreshed. No owner visual acceptance is implied.


## Owner feedback: copy, request workflow and empty-state correction

This follow-up supersedes the earlier presentation verdict and the accordion/preflight UI described above. The owner identified real defects that the earlier component and source checks did not catch. Supported component names alone did not establish correct slot children, spacing or useful merchant copy.

### Decisions

- Billing now ends at its Shopify management action. The unrelated artwork-limit aside and routine Last checked timestamp are removed. Trial, discount and billing-period dates remain calendar dates without time-of-day clutter; the UTC calendar remains the provider billing boundary, formatted in the app/browser locale. Shopify's grammar guidance uses relative timestamps for activity and permits time zones only when needed; future contractual dates should remain calendar dates.
- Permissions retains its task-specific access rows and explicit checks/consent. The separate duplicate How Insignia uses access disclosure, repeated technical explanation and unrelated View products navigation are removed. A short line points to Shopify's app settings for management. Consent and authorization behavior are unchanged.
- Customer data requests stays a low-frequency Settings utility. Shopify mandates verified privacy webhooks and providing the requested data; its documentation does not prescribe this admin page. The utility is needed here to retrieve Insignia-held records. It does not deliver files to a customer, mark requests fulfilled or trigger erasure.
- The inbox shows a compact Request/Due table, without a Viewing badge, repeated selected row, timestamps or separate action column. Opening a request shows a separate detail view with native breadcrumb return and a durable request query. Return preserves the local page; direct entry works independently of the list. There is no general client router or new server route.
- Details show Received, Due and order count, then an order table with one Download data action and View order for artwork. The accordion, preflight transfer and per-design download controls are removed. Errors use the same action for retry; unavailable order data withdraws both actions. Authentication loss clears private state.
- The empty state reuses the licensed Shopify record illustration, a clear heading and one short explanation. It uses the supported Text subheading slot inside a padded container. It offers no fake creation CTA because Shopify supplies the requests.

### Complete data download on existing reads

The base export contains design metadata but not design payloads or each binding's economics. The UI therefore obtains the base order response and the union of its binding/design set IDs, then calls the existing set-specific read for each ID (at most four concurrently). It merges fresh binding/design records into the base JSON, preserving the server shape and opaque exact-money values, and downloads only after every read succeeds. Expired/erased design payloads remain null; 404 or authorization loss discards the prepared download. Every HTTP read retains current server owner/scope/generation and retention checks. No API, SQL, retention policy, data collection or authorization rule changed.

This browser assembly is not a single transactional server snapshot and repeats existing per-set response data. A dedicated complete export endpoint would reduce that transfer later; it is not part of this frontend pass. The explicit download avoids the previous preflight transfer on opening a request.

### Reference checks

Fresh source checks used [Shopify content](https://shopify.dev/docs/apps/design/content), [grammar and mechanics](https://shopify.dev/docs/apps/design/content/grammar-and-mechanics), the pinned [empty-state contract](https://shopify.dev/docs/api/app-home/v2.0/web-components/feedback-and-status-indicators/empty-state), [privacy compliance](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance), and [merchant data-request handling](https://help.shopify.com/en/manual/privacy-and-security/privacy/processing-customer-data-requests). The native installed-app details page was inspected read-only: compact activity rows use relative activity times, an installed date uses a calendar date, and access information is grouped by purpose. It did not supply a paid billing reference or establish this app's native integration.

Memorisely's grouping/proximity example and Zander's context-based disclosure guidance were reopened, alongside Vercel's current interface checklist. They support reducing duplication and showing request details only when selected; they do not justify hiding necessary deadlines or inventing app capabilities.

Checklist Design's [Empty State checklist](https://www.checklist.design/web-app/empty-state) was applied to the supplied screenshots and then the revised rendered states:

| Status | Item | Why |
| --- | --- | --- |
| Present | Illustration or icon — A visual that signals the empty state and gives the screen some personality, rather than feeling broken | The existing Shopify record illustration identifies the empty inbox. |
| Present | Clear heading — A short, plain-language title naming what's missing | No data requests yet identifies what is absent. |
| Present | Supporting description — A brief explanation of what belongs in this space, most useful for first-time users | One sentence explains that Shopify sends the requests and no action is currently needed. |
| Not needed here | Primary action — A CTA pointing toward the next step: creating, importing, connecting etc | Merchants do not create requests in Insignia, so a creation action would be false. |
| Present | Zero state vs. no-results state — A distinction between a screen that is empty because nothing has been created versus one that returned no search or filter results | A genuinely empty inbox and an empty later page have different copy; pagination can return from the latter. Search is not supported by the endpoint. |
| Present | Error state variant — A separate variant for when content failed to load, as opposed to genuinely being empty | Failed reads retain contextual retry and never masquerade as an empty inbox. |

### Rendered evidence

Spacing checks measure visible text glyphs against the actual content container at 390px and 320px. Polaris's custom-element and hidden light-slot hosts report zero layout boxes, so measuring those is not evidence of clipping or padding. The revised checks require visible supporting text and at least 16px inset on each side. The gallery also waits for the visible preview-host request title before capture; a fast no-orders response had previously been captured before the host title updated. Actual 320px empty/detail captures are kept in settings/narrow for the independent visual review.


Final follow-up verification: twelve focused browser workflows pass (Billing/Settings, explicit consent/navigation and the two privacy flows), plus eight Polaris presentation-boundary tests. Strict admin-test types, scoped Biome, pinned component validation and the 147-file web build pass. Thirty-four revised Settings states / 68 desktop-phone images lead Latest changes; the full gallery has 121 states / 241 images. Two additional actual 320×568 empty/detail captures are stored in settings/narrow. The free/two-paid layout remains a clearly labeled Shopify reference outside Latest changes. A fresh GPT-6.1 Sol medium reviewer inspected the actual final desktop/390/320 images, found no remaining concrete visual defect in scope, and verified the corrected no-orders request title. This replaces the earlier review verdict; no native integration, owner acceptance or release approval is implied.
