# M9 pricing configuration route — 15 October 2026

Read-only primary-source investigation against main `a9dd27f`. No authenticated provider call, session inspection, login, CLI installation, plan selection, pricing write, event submission or external contact occurred in this research task. The lead owns separate current native observations. Billing dispatch remains disabled.

## What the owner's page establishes

The owner reports that exact app `429028933633` in organization `200969036` opens an App Store review draft, then an English listing with **0 public plans**, an existing `customized_order_paid` event-handle localization field, and no visible pricing Manage control. This is owner-reported UI evidence; it is not an independently observed catalog response. It establishes neither the absence of private plans nor their terms. The previously saved active subscription identifies the zero-price development plan `insignia-dev-zero-20260928`; this task did not refresh that response.

## Supported routes and limits

| Route | Useful read | Limits / effects |
| --- | --- | --- |
| Partner Dashboard pricing index | Official location for public/private plan configuration. | Official navigation still says app distribution → app → Distribution → Manage listing → locale Edit → Pricing content → Manage. That final control is absent from the owner's supplied text. No documented alternate deep-link was established. Do not invent a URL or ask the owner to fill all listing fields. |
| Merchant plan-selection page | Inspect plans actually offered to the existing rewrite-dev store without choosing one. | Documented pattern `https://admin.shopify.com/store/:store_handle/charges/:app_handle/pricing_plans`. Authenticate as the existing merchant; do not select, approve, subscribe, install or confirm a plan. The visible set is not the full app catalog. |
| Existing Partner `activeSubscription(appId:, shopId:)` | Current contract, cycle, pricing, usage and pending updates for the exact installation. | Requires the existing Manage apps Partner API capability and public-app identity. It is a per-shop contract query, not an editable plan catalog. Existing access should be reused; this note requests no token/scope widening. |

Sources: [App Pricing configuration and testing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing), [public/private plans](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/plans), [merchant redirect route](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/redirect-plan-selection-page), [pinned 2026-07 active subscription](https://shopify.dev/docs/api/partner/2026-07/active-subscription).

The redirect guide identifies `app_handle` as the app's TOML `handle`. A repository search found no explicit `handle =` in checked-in `shopify.app*.toml`; the app's `/apps/insignia-1` browser path alone is not independent handle proof. The candidate merchant URL is `https://admin.shopify.com/store/insignia-rewrite-dev/charges/insignia-1/pricing_plans`, conditional on verifying `insignia-1` from actual app metadata or an existing qualified record. Read-only navigation may establish the page's identity, but no subscription follows automatically.

Public plan billing terms and localized descriptions are separate. Plans display only when a description exists for the merchant's language. Private plans have their own descriptions and appear only to authorized logged-in stores; they do not support translation. Therefore absent public descriptions can hide a public plan from merchant display, but **no inspected primary source says incomplete listing fields hide the pricing Manage control**. That causal explanation remains unknown. [Plan description and private-store visibility rules](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/plans).

Draft app/store locale mismatch can cause the merchant plan-selection page to return 404. A 404 does not establish absent pricing or a need to reinstall. The pricing overview also documents a private zero-price development test plan and no-charge development-store testing; these facts do not prove that this app has the approved commercial catalog, nor authorize selecting another plan. [Testing and draft locale limitation](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing#testing).

## CLI/source check

The [official CLI App command index](https://shopify.dev/docs/api/shopify-cli/app) exposes no pricing-catalog list/pull command. Bounded inspection of the complete public Shopify CLI `main` tree at commit `1f535b12c0384c497147651bf308b81bf5b97e4d` found subscription migration commands, not a pricing catalog command. This is a bounded negative finding, not a claim that no internal API exists.

- [`shopify app config pull`](https://shopify.dev/docs/api/shopify-cli/app/app-config-pull) refreshes linked app configuration and **overwrites a local configuration file**. [Pinned implementation](https://github.com/Shopify/cli/blob/1f535b12c0384c497147651bf308b81bf5b97e4d/packages/app/src/cli/services/app/config/pull.ts) fetches app extension specifications and writes the merged app configuration. It is not a documented pricing-catalog export. No reason to run it for this question.
- [`shopify app subscription-migrations list --json`](https://github.com/Shopify/cli/blob/1f535b12c0384c497147651bf308b81bf5b97e4d/packages/app/src/cli/commands/app/subscription-migrations/list.ts) lists subscriptions eligible for migration, defaulting to the linked project's Client ID. It needs existing CLI authentication and a linked app project; optional status filters concern migration state. It does not list available public/private pricing plans. Do not install or run it merely to investigate this already-managed development subscription. Schedule/cancel/unschedule are writes and outside this read-only task.

No CLI executable was found on this task's PATH. No CLI capability was claimed as runtime-qualified. The inspected upstream SHA is research provenance, not the locally installed version or authority to upgrade.

## Next useful observation

Use the already-working exact Admin session to inspect the merchant plan-selection page with verified app handle, **without selecting anything**. Record offered plan names/terms and identity, or exact error; compare with the existing independent current subscription. That narrows store eligibility and actual UI behavior while the separate Partner management route remains unresolved. An empty/404 merchant page is not a full-catalog result. If configuration is subsequently needed, first establish the actual management control and prepare the smallest explicit draft/private-plan change; do not switch pricing methods, migrate subscriptions or publish a plan as a diagnostic.

No public-review submission or additional access request is justified by the owner's listing text alone. Public pricing publication and real-charge effects remain distinct from development readiness. Approved commercial terms and native meter/response qualification remain open until actual evidence establishes them.

## Root follow-up: actual read-only browser observations

The exact Admin and Dev sessions were reverified with `open.js`; screenshots inspected and neither showed login or challenge. The historical [September operator report](../../../spikes/m0-012/evidence/baseline/operator-report.md) supplies independently recorded app-handle provenance and the exact old private-editor URL. This resolves the handle uncertainty above without inferring identity solely from a guessed URL.

The documented merchant page now actually renders Insignia and **Insignia $0 Test / Current / $0 per30days**, private to rewrite-dev. Its usage row is Test custom order, nominal$0.01 struck through and effective$0, with Free to test wording. It is consistent with the existing12:38Z API evidence, not a refreshed API observation or full catalog inventory. No plan was chosen or approved.

The exact private-editor URL from that saved report returned `page.goto: net::ERR_HTTP_RESPONSE_CODE_FAILURE`, with an inspected screenshot showing **HTTP ERROR422**. No login/challenge was visible, and no setting, query manipulation or retry followed. The cause is unknown; this does not establish absent permissions or a need to complete listing fields. The original owner access check is fulfilled; one precise read-only owner check of this historical private-editor URL is pending.

The historical nominal draft is not the commercial target: it had no recurring subscription charge/trial and a fixedUSD0.01 usage tariff. Its September migration screen still said Draft and test plans / App Pricing enabled not started / Manual pricing legacy; those labels are historical, not a current-method observation. Actual pricing-method transition must be established before any switch or migration is proposed. Effective-zero dev contracts cannot prove real-price invoice math. No scope, price, plan, subscription, installation or version change occurred. [Actual observations and limits](../evidence/m9-usage/pricing-route-native-observation-2026-10-15.json).

Root also located the previously qualified local CLI4.8.2 package outside PATH and ran only its `app --help` command. The actual help exposes config/info/versions/execute commands but no pricing catalog command. No install, config pull, authenticated CLI request or upgrade occurred. This supplements rather than replaces the upstream source check above.

## Owner follow-up: private editor opens

The owner subsequently opened that exact saved private-editor URL and pasted its actual text: Edit insignia-dev-zero-20260928, Insignia, one authorized store rewrite-dev, nominal preview$0/month plus Test custom order$0.01/unit, eventhandle customized_order_paid, model Flat rate, charge as Cost per unit. The banner explicitly says the plan goes live to merchants when switching from manual pricing to Shopify App Pricing. This is attributed owner-local observation, not a fabricated server screenshot. Unpasted field values/toggle state and trial configuration are not inferred.

Both owner read-only checks are now complete. The server HTTP422 remains a real route/session limitation; it does not imply missing owner access or justify repeating generic listing requests. Current nominal terms still differ from the approved recurring/allowance/overage/trial target. Next prepare the smallest proposed development-only change after checking draft-edit versus existing-subscription effects and trial semantics; no price edit, new plan, approval, billing-method switch, migration, public submission or event send is authorized by the read-only report.
