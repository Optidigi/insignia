# New Insignia app: nominal usage tariff and effective-zero dev contract

Observed 2026-09-28 UTC. This report is operational handoff outside the tracked rewrite repository and outside the fixed PR #16 review archive manifest. One Shopify operator used the authenticated native Partner/Admin browser and an existing protected, read-only Partner credential. No token value, secret, or session was recorded.

## Fixed identity and preconditions

| Resource | Verified value and source |
| --- | --- |
| App | Dev Dashboard `https://dev.shopify.com/dashboard/200969036/apps/429028933633` rendered **Insignia** under **Optidigi**. The pricing URL was scoped to OAuth client `1443cf6d03d39edae7c101a943c5c684`. Prior pinned Admin API evidence identifies the same app as `gid://shopify/App/429028933633`. |
| Store | Shopify CLI `store list --organization-id 200969036 --type dev --json` returned exactly one match: `insignia-rewrite-dev.myshopify.com`, `gid://shopify/Shop/105501393179`, `type: dev`, `plan: basic`, `organizationName: Optidigi`, `organizationId: 200969036`. The native Admin identified the same store as `dev` under Optidigi. |
| Private plan | Existing `insignia-dev-zero-20260928`; before editing its saved UI had only `insignia-rewrite-dev.myshopify.com` under Stores with plan access, subscription-charge checkbox off, broad development-store access checkbox off, and no usage charge. No other plan was created. |
| Existing subscription | Fixed Partner API 2026-07 read for the exact app/shop at `2026-09-28T16:48:59Z` and again immediately before approval at `2026-09-28T16:52:14Z`: HTTP 200, no GraphQL errors, `activeSubscription: null`. Native Admin app details also said `Billing: No plan selected`. The private plan had only this one accessible store, so no existing plan consumer was found. |

Credential file ownership/mode were checked without displaying the content: `serveradmin`, `0600`; containing directory `0700`. The helper read the expected variable as data, sent it only as the HTTPS Partner header, did not follow redirects, bounded responses, and rejected any response echo of the token. Exact fixed query variables and actual sanitized responses are in `PARTNER-ACTIVE-BEFORE-NOMINAL-METER-2026-09-28.json`, `PARTNER-ACTIVE-BEFORE-DRAFT-APPROVAL-2026-09-28.json`, `PARTNER-ACTIVE-AFTER-DRAFT-APPROVAL-2026-09-28.json`, and `PARTNER-ACTIVE-CONFIRM-2026-09-28.json` in this handoff directory.

## Saved draft tariff

- Updated only the existing private plan at `https://apps.shopify.com/services/pricing/1443cf6d03d39edae7c101a943c5c684/insignia-dev-zero-20260928?billingSystem=managed`.
- Reused existing event handle `customized_order_paid` (`Test custom order` on invoices). Saved one usage charge: UI model `Flat rate`, charge as `Cost per unit`, nominal **USD 0.01 per event**. This is the provider's fixed per-event option, not a recurring flat fee or extra flat amount. One event unit represents one qualifying order in the intended later test; no event was sent here.
- Subscription-charge checkbox remained off. No recurring fee, additional flat charge, extra tier, or trial was configured. The broad `Free for partners and developers` option remained off. Access stayed restricted to **only** `insignia-rewrite-dev.myshopify.com`.
- After Save, reloading the editor retained `customized_order_paid`, `FLAT_RATE`, `COST_PER_UNIT`, `0.01`, one usage charge, unchecked subscription/development-store checkboxes, and the one-store restriction. The nominal preview was `$0/month` plus `$0.01` per `Test custom order`. The setup list showed one private plan as `$0/month plus usage charges, 1 store with access`; zero public plans. The migration stage remained `Draft and test plans` current, `App Pricing enabled` not started, with `Manual pricing (legacy)` still present. No numeric plan or meter ID was exposed by this UI.

## Native development test and approval

- Derived installed Admin app handle `insignia-1` from the native installed-app link for this exact store, then opened Shopify's documented hosted plan-selection route: `https://admin.shopify.com/store/insignia-rewrite-dev/charges/insignia-1/pricing_plans`.
- The native page showed the store as `dev`, `Free to test`, and `These plans are free to test on this store. Regular pricing applies when the store goes live.` It showed the existing private plan at `$0 / 30 days` and the `Test custom order` usage row with nominal `$0.01` struck through and effective `$0`.
- `Test with this plan` opened an actual `Approve charge` page for **Insignia by Optidigi**, with the exact plan handle in the URL. It said `This plan is free. You will not be billed.` and `You will not be billed for this test charge.` Subscription details were `Free`; the usage row again struck through `$0.01` and showed `$0`. No payment-method request appeared. These recurring and usage terms, together with the same-Partner dev-store context, were verified before clicking `Approve` once.
- Approval redirected to `https://admin.shopify.com/store/insignia-rewrite-dev/apps/insignia-1/?plan_handle=insignia-dev-zero-20260928&charge_id=38085427483`. The app endpoint was stopped and rendered no app content. This redirect was not treated as proof of failure; no retry occurred. The following Partner API read established the actual contract. Native Admin app details subsequently showed `Billing: $0/month + usage` and `Insignia $0 Test`.

## Actual Partner API 2026-07 contract readback

At `2026-09-28T16:53:10Z`, the fixed read-only Partner query returned HTTP 200, no GraphQL errors, and a non-null `activeSubscription` for app `gid://shopify/App/429028933633` and shop `gid://shopify/Shop/105501393179` / `insignia-rewrite-dev.myshopify.com`:

| Field | Actual response |
| --- | --- |
| Billing period | `EVERY_30_DAYS`; current cycle `2026-09-28T16:53:01Z` to `2026-10-28T16:53:01Z` |
| Trial / cancellation / pending change | `trialEndsAt: null`; `cancelAtEndOfCycle: false`; `pendingUpdate: null` |
| Subscription identifier | `legacySubscriptionId: gid://shopify/AppSubscription/38085427483` (matches redirect charge ID) |
| Plan item | Handle `insignia-dev-zero-20260928`; `FlatRatePrice`, `active: false`, `currency: USD`, `amount: "0.0"`; `usage: null`, `discount: null` |
| Usage item | Handle `customized_order_paid`; `TieredPrice`, `active: false`, `currency: USD`, `tiersMode: VOLUME`; exactly one tier `upTo: null`, `amountPerUnit: "0.0"`, `amount: "0.0"`; `discount: null` |
| Current usage | `quantity: 0.0`, `cost.amount: "0.0"`, `cost.currencyCode: USD` |

The effective recurring amount and **each** returned usage-tier amount are zero. This conclusion does not depend on current usage cost being zero. The provider represents the nominal fixed per-event draft as a one-tier `VOLUME` `TieredPrice` in the effective dev subscription; this differs from the historical adapter's old-target, two-tier `GRADUATED` expectation. Both returned `price.active` flags are `false` and are preserved as observed; no guard or parser was changed to make this shape pass. The nominal USD 0.01 tariff remains configured in the private draft for later authorized testing, while this dev subscription currently has zero effective prices. Shopify's native wording also says regular pricing applies if the store goes live; no such change was made.

A second fixed read at `2026-09-28T16:55:52Z` again returned HTTP 200 and the same subscription ID, app/shop identity, 30-day billing period, null trial/pending update, and zero flat/per-unit tier amounts. The second raw sanitized response is retained; no subscription retry or second approval occurred.

## Retained state and limits

One private draft, one event handle/meter configuration, and one confirmed effective-zero dev subscription were retained. No app-wide Enable/Switch/Publish, public plan, subscription migration, App Events POST, additional App Events token acquisition, preview restart, deployment, buyer order, payment-method step, credential/permission change, tracked code edit, or PR occurred. The earlier incomplete App Events token remains rejected; this task did not retest it. This is a tariff and contract observation, not a G8 pass or proof of paid-price invoice math.
