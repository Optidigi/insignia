# M8 Server Pixel checkout-context candidate

13 October 2026. Bounded independent primary-source research against local HEAD `2d6972bd444d0b2b78e6cec85780b3516a252656`. Inspected AGENTS, operating model, plan/ledger/state and context-authority research addendum; inspected research skill. Only this document is owned by this task. No credential reads, provider mutations, resource creation, app registration, scope declarations, Shopify contact or native checkout occurred. Native status: **NOT_TESTED**.

## Finding

Server pixels are a real separate candidate. Shopify documents server-delivered checkout events; its changelog specifically confirms Server Pixel `checkout_completed`. Public sources examined do **not yet qualify** the required Shopify-authored completion-time country ISO and numeric Market ID, authenticated with shop and actual-order correlation. This is a missing contract/proof, not a platform impossibility finding. The owner cannot see Function runs; no Function-run observation is a prerequisite or proposed workaround here.

The [3 July 2025 server-pixel changelog](https://shopify.dev/changelog/posts/server-pixels-added-subtotalprice-to-checkout-events) explicitly adds snake_case `subtotal_price` to server `checkout_started`, `payment_info_submitted` and `checkout_completed`. This establishes event existence and one server field; it provides no complete event schema, localization, order identity or checkout token contract. Web Pixels JavaScript fields must not be copied onto this server contract.

## Contracts actually established

All following Admin references opened as **2026-07**, without redirect to another API version:

| Contract | Established meaning |
|---|---|
| [ServerPixel](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/ServerPixel) | Configuration streams customer interactions to EventBridge or PubSub. Read requires `read_pixels` and `read_server_pixels`; public fields are ID, nullable status and nullable endpoint address. It is a configuration object, not a receipt schema. |
| [serverPixelCreate](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/serverPixelCreate) | One unconfigured pixel per app/shop; duplicate creation errors. Requires `write_pixels`, `read_customer_events`, `write_server_pixels` and user access permission. No event-version argument. |
| [eventBridgeServerPixelUpdate](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/eventBridgeServerPixelUpdate) | Required ARN only; same write/customer-event scopes. Deletes previous pixel subscriptions. No documented localization projection or payload version selector. |
| [pubSubServerPixelUpdate](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/pubSubServerPixelUpdate) | Required project and topic only; same scopes and subscription replacement. No payload/authentication configuration arguments. |
| [Order](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Order#field-Order.fields.checkoutToken) | `checkoutToken` identifies checkout creating an order. It is a potential independent join if the server event carries the same documented token. It does not supply missing localization. |

## Payload, field provenance and coverage gaps

Targeted public searches on Shopify primary domains for server-pixel payload/schema/localization/checkout token found the changelog and control plane, but no complete server `checkout_completed` payload reference. Specifically unqualified:

- Original localization country ISO and numeric Market identity, their precise field paths/types/nullability, and whether they are authored by Shopify's checkout server or relayed from browser analytics.
- Stable actual order ID or checkout token; token representation and equivalence to Admin `Order.checkoutToken`; authenticated shop identity and original occurrence timestamp.
- Definition of completion (order creation, payment completion, browser completion, upsell timing), guest/logged-in/accelerated coverage, headless checkout coverage, no-Thank-you-load behavior and consent-denied behavior.
- Delivery envelope, event ID, versioning, ordering, replay/redelivery/retention, and whether events can be fetched historically after a miss.

No Web Pixels schema was used to fill these gaps. A broker-authenticated message only proves that an authorized publisher sent the message; promoting its country/Market requires a separate field-provenance and completion-semantics contract.

Shopify's current [Help Center app-pixel description](https://help.shopify.com/en/manual/promoting-marketing/pixels/app-pixels#server-pixels) says certain app owners have server-pixel access, and checkout/customer events can reach owners through a server without browser intermediary. It says privacy/consent can restrict events when tracking consent is absent. It also describes pixel data-access optimization. These are reasons to test completeness explicitly, not a guarantee that every order obtains the required receipt. The page offers no exhaustive server-event coverage matrix.

## Broker source authentication

**EventBridge has a useful independent source boundary.** AWS's current [partner-source contract](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-saas.html) says only the partner account associated with a partner event bus may send events to it; partner source must be associated with its bus or events are dropped. [PutPartnerEvents](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_PutPartnerEvents.html) is the partner publishing operation. Inference: an actual verified Shopify partner source/bus and an authenticated consumer could establish Shopify publisher provenance without trusting a JSON `source` string. The Server Pixel ARN argument alone does not establish how Shopify provisions that source or which source/app/shop mapping applies. Obtain those pixel-specific contracts and inspect the real configured source before qualification; ordinary webhook setup is not sufficient evidence.

**Pub/Sub authenticates transport, with a publisher gap to resolve.** Shopify's [ordinary webhook Pub/Sub guide](https://shopify.dev/docs/apps/build/webhooks/get-started?deliveryMethod=pubSub) names `delivery@shopify-pubsub-webhooks.iam.gserviceaccount.com` as publisher. This guide concerns webhooks; it does not prove this is the Server Pixel publisher. Google [authenticated push](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions) signs Google JWT claims and requires signature/audience/expected service-account checks. That authenticates the subscription's delivery identity, not Shopify field semantics or each original publisher. Inference: topic IAM restricted to a Shopify-confirmed pixel publisher plus an authenticated isolated subscriber is a plausible authority chain. Project-wide publisher grants, other producers or local synthetic injection would weaken it. Publisher identity, topic binding and relevant IAM must be confirmed for server pixels specifically.

## Eligibility, cost and privacy

The current [official Shopify scope table](https://shopify.dev/docs/api/usage/access-scopes) says server read/write scopes are granted on approval. Public current sources inspected do not provide an app-specific eligibility decision, guaranteed approval route, dev-store support or a server-pixel fee schedule. No historical availability statement is treated as current eligibility. These are app-specific questions before resource allocation, rather than assumed approval.

Broker infrastructure has real usage costs. [Pub/Sub pricing](https://cloud.google.com/pubsub/pricing) lists throughput, transfer and retained-message storage; [EventBridge pricing](https://aws.amazon.com/eventbridge/pricing/) separates event-bus and optional processing/delivery features. No volume, region, consumer design or owner budget is available for a credible estimate, and free allowances are not an allocation. Any proof needs an owner-approved endpoint and bounded billing/retention; no provider account was created here.

Treat unreduced events as potentially containing buyer identification. The Help Center expressly describes first-party email/phone matching. Prefer minimal country/Market/order-or-token/shop/event-time/event-ID receipt and protected raw proof only where needed; establish original retention/erasure and consent rules before collection. The required transactional verification purpose cannot silently be configured as marketing tracking or bypass consent. Approval needs confirmation of this purpose and its resulting delivery coverage.

## Smallest useful next proof

First obtain a Shopify-owned server-pixel contract/sample and app-specific eligibility answer, without creating resources: exact completion payload/version, country/Market provenance and historical meaning, order/token correlation, Shopify broker publisher/source setup, consent/privacy-purpose behavior and test-store availability. Ask specifically whether a non-marketing order-verification purpose is supported and whether any completed order can lack the tuple. This is the smallest useful next evidence because a broker capture cannot repair a missing semantic guarantee.

If those answers establish a viable tuple, request only a bounded owner-allocated broker proof: one consenting test checkout, preserved authenticated source/envelope and minimal original tuple; join server order ID or token to independently read Admin 2026-07 order. Then repeat changed-country/Market, guest/logged-in, accelerated and denied-consent/no-Thank-you cases, including null, replay and duplicates. Receipt provenance must survive broker-to-worker processing without accepting browser/quote substitutes. No native PASS, new scopes, publication or context binding is authorized by this document.

Status: **SERVER_EVENT_EXISTENCE_CONFIRMED / CONTROL_PLANE_2026_07_CONFIRMED / PAYLOAD_AUTHORITY_UNQUALIFIED / APP_APPROVAL_UNQUALIFIED / BROKER_RESOURCES_UNALLOCATED / NATIVE_NOT_TESTED**.

## Current next action

The single [ready-to-send provider inquiry](provider-context-inquiry.md) requests these missing contracts and eligibility facts. It has not been sent. No broker setup or scope request is proposed before a viable contract is established.

Root independently rechecked the pinned [Admin Order](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Order) fields: no direct Market/localization tuple is exposed. The inspected [new Events Order reference](https://shopify.dev/docs/api/events/latest/order) is labelled 2026-10 and does not list country/Market/localization triggers. Its [custom-query contract](https://shopify.dev/docs/apps/build/events/delivery-structure#custom-queries) runs an allowed Admin query after a change. Inference: this does not establish a new original-checkout localization fact absent from the queried provider object. The attempted 2026-07 Events reference returned a tool Internal Error, which is an access limitation, not proof the API does not exist. No API upgrade or subscription was attempted.

Owner-supervised observation on 13 October: supplied entries were ordinary Admin GraphQL product/installation queries, with successful requests on the intended development shop and API 2026-07. The owner subsequently reported no visible Function runs. This is **OWNER_REPORTED_NO_VISIBLE_RUNS**, not proof of no executions or an independently captured Function-log inventory. The diagnostic route did not qualify the required tuple or join. No raw buyer input or tokens were captured. Research-agent isolation was instructional, not an enforced credential/network sandbox; its activity comprised public documentation and this evidence file. Root reviewed its findings against official contracts.
