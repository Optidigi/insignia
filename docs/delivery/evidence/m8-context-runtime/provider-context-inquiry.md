# Shopify checkout-context contract inquiry

Prepared 13 October 2026. **Draft only; not sent.** This requests technical documentation and app eligibility, not scopes, registration, deployment, billing or a store change. No customer data, checkout tokens or credentials are included.

The owner subsequently declined this inquiry. Preserve the unsent draft as research history; it is not an active prerequisite or authorization to contact Shopify. Current direction: [checkout-enforcement purchase-proof research](purchase-proof-recommendation.md).

## Ready-to-send inquiry

We are developing the existing public Insignia rewrite app on `insignia-rewrite-dev.myshopify.com`, with Admin and Function APIs pinned to `2026-07`. We need an independently Shopify-authenticated record of the original checkout-localization country ISO code and numeric Market ID at checkout completion, joined to the actual resulting order. This supports immutable customization purchase records; values copied from our quote, a browser assertion, shipping/billing address or the current Market configuration cannot establish the required historical fact.

Server Pixel `checkout_completed` is a promising candidate. Please confirm:

1. Its supported, versioned server-event payload and exact field paths for checkout-completion time, original localization country, Market ID, order ID and checkout token. Does the token match Admin `Order.checkoutToken`? Are these fields authored by Shopify's checkout server, or can client-published/custom events supply or override them?
2. How an EventBridge or Pub/Sub consumer authenticates the Shopify publisher and receiving app/shop, distinguishes standard completion events from browser/custom assertions, and handles duplicates, delayed delivery and replay.
3. Whether these facts are available for guest, logged-in, accelerated and post-purchase flows; how null values, consent denial, data-sharing optimization and missing events behave. Is a supported authenticated historical recovery source available? Is this transactional purchase-record use case supported?
4. Whether this existing public app and development store are eligible for `read_server_pixels` / `write_server_pixels` approval, and the current approval route. Please identify any additional required scopes or protected-data approvals before we request them.

If Server Pixels cannot provide this complete receipt, is there another supported server-side API/event that provides the original localization tuple with an authenticated unique order/checkout join? Please provide its versioned contract. Function input supplies localization, but the owner found no visible existing Function runs and we have not qualified an order join from diagnostic logs.

We are requesting clarification only. Please do not change installation scopes, subscriptions, pixel configuration or store resources on our behalf.

## Qualification after an answer

First verify the supplied contract against the required fact and existing application boundary. If viable, prepare a bounded development proof using the existing fixture, explicit app approval and an owner-allocated broker endpoint, with operation/cost limits and cleanup. Registration and broker setup are not authorized by this draft. Minimal private native capture would have an explicit deletion deadline of at most seven days; no raw capture exists from this investigation.

Current production order reader still returns `country:null`, `marketId:null`, `contextVerified:false`. No purchase-context semantic change is proposed or implemented. See [Server Pixel findings](server-pixel-research.md) and [active worklist](WORKLIST.md).
