# M0-011 provider eligibility and resource register

Checked 28 September 2026. This is one operator's read-only inspection of the designated existing app and staging store, plus official public contract research. It does not establish a live billing subscription or authorize an event send. The normal PR #13 merge is `88dca8ebb4aad6baa24922508335e14038abbc98`, with reviewed base `31484d328ec401a30994d073518b11eb67777433` and head `8bda74f1985762923580b5d1d92b56c4a0d7203f` as exact parents and the approved head tree.

## Direct eligibility observations

| Question | Current evidence | Status / limit |
|---|---|---|
| Existing app identity | Authenticated Dev Dashboard `https://dev.shopify.com/dashboard/212732011/apps/427859050497/settings` showed `insignia`; its Client ID field compared equal to `942e6668fd1177524c0fc48b104b0ac3` without reading the secret. Authenticated `shopify app info --path /home/serveradmin/insignia-pf002-shopify-import --json` returned the same name/client and organization ID `212732011`. | **VERIFIED** name, OAuth client and Dev Dashboard organization. Dashboard numeric resource is not a Partner App GID. |
| Staging shop and organization | Authenticated Dev Dashboard Stores listed `insignia-staging.myshopify.com` as **Dev**, **Basic**, organization `My Store`. `shopify store info --store insignia-staging.myshopify.com --json` returned shop `gid://shopify/Shop/78935261342`, organization ID `212732011`, type `dev`, plan `basic`. | **VERIFIED** named shop, Dev status and same Dashboard/CLI organization ID as the app. This does not independently establish App Pricing eligibility. |
| Installation and existing Admin grants | Dev Dashboard Apps list showed one install. Staging Admin Settings still listed the `insignia` development preview, which was not cleaned. Earlier M0-009 evidence identified installation `gid://shopify/AppInstallation/781307904158` and eleven restored effective Admin grants. | Exact installation GID and effective grants were **not re-read** in M0-011; no preview, scope or released-version command was run. |
| Public distribution and pricing method | The app's Dev Dashboard Overview/Settings navigation showed Overview, Logs, Versions and App settings; no Distribution/Pricing section was visible. The documented hosted staging URL `https://admin.shopify.com/store/insignia-staging/charges/insignia/pricing_plans` rendered “There's no page at this address.” Authenticated navigation to `https://partners.shopify.com/212732011` rendered a 404, so no Partner Dashboard app listing or pricing card was inspected. | **UNVERIFIED**, not an inferred Custom/Public classification. The tested Partner path reused the Dev Dashboard organization ID and may not be the applicable Partner Dashboard route. No distribution or billing method was selected. |
| Actual Partner App GID, current contract and history | No approved Partner API client credential is exposed to this run. No Partner GraphQL request was made. The Client ID, Dev Dashboard resource number and installation GID were not substituted for the Partner App GID. | **UNKNOWN** App GID, active subscription, effective tariff, cycle, history, existing consumers and test plan/meter state. `activeSubscription: null` was not assumed. |
| App Events credential and actual route | No app client secret was copied from the Dashboard; no approved local App Events credential is present in the operator process environment. No token or event request was made. | **NOT_RUN** live authentication, endpoint behavior, event receipt, replay, asynchronous processing and aggregate use. |
| Dashboard logs | The existing app's Dev Dashboard Logs page loaded in the authenticated browser. A billing-specific log/result was not established; no M0-011 event exists to inspect. | **VERIFIED** general log-page access only. App Billing Event visibility/processing is **UNKNOWN**. |

The read-only CLI commands returned exit 0. Their output was filtered to nonsecret identity fields; no owner profile, bearer token, client secret, cookie, session or raw screenshot was retained.

Staging Admin Billing showed the store's **Basic** plan at $0.00 in this development context. That is the *store plan*, not evidence of a $0 **app subscription**. The collaborative browser host became unavailable after this read; no further browser check or mutation was attempted.

## Current public contract and endpoint resolution

Shopify's [App Pricing reference](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing) says pricing configuration remains in the **Partner Dashboard**, not the Dev Dashboard; `activeSubscription` is for public apps. It describes an included private $0 test plan and says same-Partner-organization development stores can select available plans at no charge, producing effective $0 recurring **and** usage prices. These documented rules do not prove this app has that pricing method, test plan or a safe effective contract.

The current [App Events API reference](https://shopify.dev/docs/api/app-events/latest) selects **2026-07 latest** and explicitly documents `POST https://api.shopify.com/app/2026-07/events` plus client-credentials token acquisition at `https://api.shopify.com/auth/access_token`. The [billing-event tutorial](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/build-billing-event) still contains `unstable` in example sends. Thus the old M0-010 2026-07 endpoint has current reference support, while authenticated behavior for this app remains **UNOBSERVED**. HTTP 202 would mean transport receipt only; the Dashboard and Partner cycle totals are separate checks.

The [Partner API reference](https://shopify.dev/docs/api/partner/latest) requires a separate organization client. The [active subscription query](https://shopify.dev/docs/api/partner/latest/active-subscription) and [historical events query](https://shopify.dev/docs/api/partner/latest/historical-events) need an actual Partner App GID and scoped shop ID. A newly created App Pricing subscription can be canceled only through the applicable [Partner cancellation path](https://shopify.dev/docs/api/partner/latest/app-subscription-cancel) with the required permission; M0-011 has not exercised it.

## Live branch decision and resources

The live mutation branch is **STOPPED BEFORE SETUP**: public-App-Pricing availability, private test plan/meter isolation, complete zero-price terms, existing subscription status and both provider access paths are not established. No safe inference from a Development-store label, one installation or a missing UI section satisfies those preconditions. Independent local adapter/tests/CI work continues.

The local adapter pins shop `gid://shopify/Shop/78935261342`, requires an operator assertion that the separately resolved Partner App GID belongs to the approved OAuth app, and reads the actual zero-priced cycle again after credential acquisition and journal sync. The GID assertion is **not** independent identity evidence; this run cannot truthfully set it. The normal path uses one ignored journal with three-key/six-attempt limits, but that file is not tamper resistant and replacing it resets its counter (demonstrated by a synthetic test). Before any future live POST, the single staging operator must preserve a separate package-wide attempt register across process restarts and file replacements; an absent or ambiguous register stops submission. The current register is **0 unique, 0 POST attempts** because no live send was attempted.

| Resource | Before M0-011 | After current checks |
|---|---|---|
| Existing `insignia` app and `insignia-staging.myshopify.com` | Designated; identities above verified | Same; no settings or grants changed |
| Stopped M0-009 preview, released configuration, eleven historical grants | Accepted prior holding state | Untouched; exact live grants not re-read |
| Existing subscription/plan/meter | Unknown; no Partner pricing access | Unknown; none edited or replaced |
| New test plan, meter, subscription | None created by this run | **0 created** |
| Synthetic App Events | None submitted by this run | **0 unique, 0 POST attempts** |
| Orders #1001–#1006, payments, product/Function/inventory state | Protected prior state | No action on any of them |

### Owner-only prerequisite path

The owner or app organization administrator must identify the **existing app's actual Partner Dashboard listing** and make its distribution, App Pricing method, private test plan/meter and any existing subscription/consumer state available for read-only inspection. An already approved Partner API client with suitable read permission and the existing app's App Events client credential must be made available through a secure local mechanism if they exist; no secret is requested in chat and no permanent client may be created under M0-011. If the listing requires distribution selection, App Pricing opt-in/switch, a new permanent API client, shared plan/meter edits or replacement of an existing subscription, that is a separate owner/principal decision. No such action was taken here.
