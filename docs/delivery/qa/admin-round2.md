# Admin parity round 2

Date: 8 November 2026. This pass covered nine admin surfaces: Home, Products, Methods, Settings, Billing, Permissions, Translations, Orders list and Order detail. I used the approved local demo as the visual and workflow reference. I counted only current, observed behavior. Data fixture differences are recorded but not filed as bugs.

## Capture context

- Native store: `insignia-rewrite-dev`, entered through `https://admin.shopify.com/store/insignia-rewrite-dev/apps/insignia-1`.
- Native content routes: `/admin/home`, `/admin/products`, `/admin/methods`, `/admin/settings`, `/admin/settings/billing`, `/admin/settings/permissions`, `/admin/settings/translations`, `/admin/orders` and `/admin/orders/def6bbeb-90e2-48c0-b642-ee94b398cb5a`.
- Demo origin: `http://127.0.0.1:62171`. App frame routes used `/admin/home?__preview_frame=1`, `/admin/products`, `/admin/methods?locale=en-GB`, `/admin/settings`, `/admin/settings/billing?locale=en-GB&__settings_example=active`, `/admin/settings/translations?locale=en-GB&wordingLocale=en`, `/admin/orders?locale=en-GB&q=1048&artwork=complete` and `/admin/orders/10000000-0000-4000-8000-000000000107`.
- Chrome via CUA, browser viewport 2560×1267. Saved screenshots are raw 2560×1267 captures. The native Shopify app frame measured 2336×1205 CSS pixels in the successful embedded Products route. The demo uses a full-width local preview, so the content widths are not identical. I did not treat Shopify navigation or the outer shell as an app defect. I did not change the shared browser viewport, so a 390px sample is not included.
- Native requested locale was `en-NL`; its document reports `lang=en`, `data-admin-locale-ready=true` and the displayed copy is English. Demo locale was `en-GB`.
- Root recorded the current read-only web image as `001ffe0481d65cc6e630d8fe92e7191f4af84b9cd6a318abc6c324df1f2d21c7`, started 22:05:03 UTC. Shopify app version 119950 was not independently tied to that OCI image or a source commit.
- The console sample at 22:21:17 UTC contained the ShopifyQL Direct API Access warning. Root identified it as benign. It does not explain the Products read failure below.

## Outcome

Seven surfaces reached a usable state: Home, Methods, Settings, Billing, Translations, Orders list and Order detail. Products showed an intermittent read failure, which maps to existing **QA-002**. The independent Permissions check returned partial status and also maps to **QA-002**. No new issue ID is proposed. The three Translations labels already tracked by **QA-005** remain visible in both native and demo.

No native product, order, method, billing, permission or translation data was changed. I changed only local demo example selectors to view Orders overview and Active subscription. I did not click write actions, download actions, Manage plan, Add language or permission grants.

## Results by area

### Home and entry

Opening Insignia through Shopify Admin settled at `https://admin.shopify.com/store/insignia-rewrite-dev/apps/insignia-1/admin/home`. The page loaded its summary, recent customized orders and product drafts. The demo loaded the same sections at `http://127.0.0.1:62171/admin/home?__preview_frame=1`.

Native shows 0 customization activity and the recent test orders `#1005` to `#1001`; the demo shows 43 orders, 151 items and demo orders `#1048` to `#1044`. Those are fixture differences. The current native Home link for `#1005` uses the same purchase UUID as the current Orders row and displays the same `#1005` label. An older `Order 7570906415387` capture came from before the runtime change and does not reproduce on the current Home/list pair. I do not count it as a defect. A fallback card appeared after direct navigation to `/admin/home` from an existing tab, but ordinary Shopify app entry settled to Home, so I do not count that intermediate result either.

Evidence: [native Home](../evidence/frontend-qa-2026-11-08/admin-round2-entry-native-home-current.jpg), [demo Home](../evidence/frontend-qa-2026-11-08/admin-round2-entry-demo-home-current.jpg).

### Products

On a fresh visit to `https://admin.shopify.com/store/insignia-rewrite-dev/apps/insignia-1/admin/products`, one route load earlier in this session showed 16 products. A later fresh navigation from Billing settled on the visible error card, `Products could not be loaded / Products are unavailable. Try again.` The Retry control was present. I did not retry this latest failure. This is one current intermittent Products read failure under **QA-002**, not a separate issue for each route or retry.

The approved demo has a settled Products list in [the earlier loaded capture](../evidence/frontend-qa-2026-11-08/admin-round2-demo-products-list.jpg). The contemporaneous demo capture in this pass was still on its loading skeleton, so it is retained as a loading-state capture and is not presented as a settled list. The native failure is visible in [the current native capture](../evidence/frontend-qa-2026-11-08/admin-round2-native-products-error-current.jpg); [the contemporaneous demo capture](../evidence/frontend-qa-2026-11-08/admin-round2-demo-products-current.jpg) shows the skeleton.

### Methods

The current native route `https://admin.shopify.com/store/insignia-rewrite-dev/apps/insignia-1/admin/methods` loaded the empty state, “Create your first decoration method,” with a Create method button. The demo route `http://127.0.0.1:62171/admin/methods?locale=en-GB&__preview_frame=1` showed two configured methods. I did not create a method. The row-count difference is fixture data, and the native route is usable. The earlier Methods loading error belongs to a pre-refresh capture and is not counted as current.

The demo table exposes Filter, Search and Sort methods. The native empty state has no table controls to exercise. Evidence: [native Methods](../evidence/frontend-qa-2026-11-08/admin-round2-native-methods-current.jpg), [demo Methods](../evidence/frontend-qa-2026-11-08/admin-round2-demo-methods-current.jpg).

### Settings and Billing

The Settings overview loaded at `/admin/settings`. Native and demo both show App language set to Use Shopify language, Storefront setup, Translations, App permissions and Billing. The native overview also has a Privacy link absent from the selected demo. Privacy was outside this pass's listed routes and was not opened; I have not classified the extra link as a defect. I left the language preference unchanged.

Native Billing loaded with Subscription active, Development test terms at USD 0.00 per 30 days, a USD 49.99 standard plan price and the current period 31 Oct–30 Nov 2026. I selected the demo's Active subscription example, which showed Subscription active at USD 49.99 per 30 days for 15 Oct–14 Nov 2026. The status card structure and active state match; the terms and dates belong to different fixtures. I did not open Manage plan. An earlier Billing read error recovered on Retry; the current fresh Billing route loaded successfully.

Evidence: [native Settings](../evidence/frontend-qa-2026-11-08/admin-round2-native-settings-current.jpg), [demo Settings](../evidence/frontend-qa-2026-11-08/admin-round2-demo-settings-overview.jpg), [native Billing](../evidence/frontend-qa-2026-11-08/admin-round2-native-billing-current.jpg), [active demo Billing](../evidence/frontend-qa-2026-11-08/admin-round2-demo-billing-active-current.jpg).

### Permissions

The native Permissions page loaded. In the root agent's separate read-only Check access run, the button disabled while checking; the result showed Checkout Allowed and Orders app access Allowed, while Product remained Not checked with an “Access could not be checked. Try again” alert. The accompanying copy says app-scope editing/publication is granted. No permission or grant changed. This is a partial provider read under **QA-002**, not proof that the app or staff permissions are missing. Evidence: [root's native partial-check capture](../evidence/frontend-qa-2026-11-08/root-round2-permissions-partial-check.jpg), [demo Permissions](../evidence/frontend-qa-2026-11-08/admin-round2-demo-permissions-checks.jpg).

### Translations

Native Translations loaded at `/admin/settings/translations?wordingLocale=en`. The first paint showed a skeleton; the later DOM check reported `readyState=complete`, `data-admin-ready=true`, `data-admin-locale-ready=true` and `data-admin-content-ready=true`. The route content was visible and both skeleton and failure containers were hidden. The demo loaded the same English Default overview. Both show three `Unavailable` category labels tracked by **QA-005**.

Only English Default is configured. Native Save is disabled on the overview, and the General category exposes English text fields. Demo Add language is disabled while the native Add language button is enabled. I did not add a language or edit English defaults, so the language override save/discard/cancel workflow remains untested. There was no existing non-default language to use safely.

Evidence: [native Translations](../evidence/frontend-qa-2026-11-08/admin-round2-native-translations-overview-current.jpg), [demo Translations](../evidence/frontend-qa-2026-11-08/admin-round2-demo-translations-current.jpg).

### Orders list and detail

Native Orders loaded five rows at `/admin/orders`; the demo Orders overview showed eight. Searching native for `1005` and demo for `1048` returned one row each. Applying Artwork complete kept one row in both. The native row linked to purchase UUID `def6bbeb-90e2-48c0-b642-ee94b398cb5a`; its list result matched Home's `#1005` link. These outcomes are current. Row-count and order-content differences are fixture data. Neither list displayed a sort control. I did not select rows or change data.

Clicking the native `#1005` row opened `/admin/orders/def6bbeb-90e2-48c0-b642-ee94b398cb5a`. It showed Paid, Artwork complete, Test and 1 item. Demo order `#1048` showed the same state and item count. The product and price differ because the orders are not the same fixture. Both details expose Download artwork, More actions and Production sheet. Their More actions menus both expose View in Shopify, Refresh, Check order updates in Shopify and Lock artwork. I opened the menus for comparison but did not activate any option. Earlier native order read failures were before the current runtime and are not counted as a current failure.

Evidence: [native search result](../evidence/frontend-qa-2026-11-08/admin-round2-native-orders-search-current.jpg), [demo search result](../evidence/frontend-qa-2026-11-08/admin-round2-demo-orders-search-current.jpg), [native detail](../evidence/frontend-qa-2026-11-08/admin-round2-native-order-1005-detail-current.jpg), [demo detail](../evidence/frontend-qa-2026-11-08/admin-round2-demo-order-1048-detail-current.jpg), [native action menu](../evidence/frontend-qa-2026-11-08/admin-round2-native-order-actions-menu-current.jpg), [demo action menu](../evidence/frontend-qa-2026-11-08/admin-round2-demo-order-actions-menu-current.jpg).

## Limits

This was a bounded admin pass, not a claim that every state case passed. Current action coverage includes normal app entry, route navigation, Products intermittent error and Retry affordance, Orders search/filter/detail and order action-menu availability. I did not retry the latest Products failure. Sorting had no control in Orders and no native table in the empty Methods state. Language override save/discard/cancel was blocked by the lack of a non-default language. No 390px viewport pass was made. The native Products request cause remains unproven; diagnosis needs correlated provider/request evidence before closing QA-002.
