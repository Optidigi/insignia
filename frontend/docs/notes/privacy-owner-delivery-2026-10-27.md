# Shopify customer data request delivery

Reviewed 27 October 2026 against current Shopify documentation, Insignia source, and the saved desktop captures. No source, backend, or store changes made.

## What Shopify requires

Shopify requires App Store apps to subscribe to and handle `customers/data_request`, `customers/redact`, and `shop/redact`. It requires an acknowledgement and action within 30 days. For an access request, Shopify sends the app a webhook containing the requested resource IDs; the app must provide its data to the store owner directly. Shopify does not prescribe a merchant-facing page, email, file format, or completion button. [Shopify privacy compliance](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)

The merchant guide says the owner starts the request from Customers > customer profile > More actions > Request customer data. Shopify then makes its own processed data available on the profile and sends that Shopify data to the owner's email. The merchant decides whether to provide the customer with the requested data. The guide does not say that Shopify's email contains data held by Insignia. [Shopify processing customer data requests](https://help.shopify.com/en/manual/privacy-and-security/privacy/processing-customer-data-requests)

## What Insignia does now

- The webhook route verifies and durably records the delivery, then queues processing. The merchant-facing privacy routes are read-only `GET`s; there is no “fulfilled” mutation or customer-send endpoint. See [shopify-webhook.ts](../../../apps/web/src/server/shopify-webhook.ts#L61-L75) and [purchase/http.ts](../../../apps/web/src/server/purchase/http.ts#L49-L73).
- The privacy request list and request detail are scoped to the authenticated shop and installation. Order and artwork access both require the account owner. See [admin/auth.ts](../../../apps/web/src/server/admin/auth.ts#L168-L174) and [purchase/service.ts](../../../apps/web/src/server/purchase/service.ts#L168-L174).
- The request detail shows its received date, due date, requested orders, a per-order JSON download, and a link to the Shopify order for artwork. The browser downloads the assembled file locally; it does not send it to the customer. See [MerchantPrivacy.tsx](../../../apps/web/src/islands/MerchantPrivacy.tsx#L240-L255) and [the request detail](../../../apps/web/src/islands/MerchantPrivacy.tsx#L493-L526).
- The saved desktop captures show this same list and request-specific detail: [request list](../../../../.artifacts/admin-popup-review-2026-10-24/settings/desktop/settings-privacy-requests.png) and [request detail](../../../../.artifacts/admin-popup-review-2026-10-24/settings/desktop/settings-privacy-detail.png).
- No owner email or other outbound notification implementation appeared in the web/worker source or their dependency manifests.

## Recommendation

Keep the request-specific JSON download in the request detail for V1. It gives the authorized owner Insignia's data for the exact orders Shopify requested, while keeping the webhook request and due date together. A generic export from Orders would lose that request context. Do not auto-email the file or mark the request fulfilled.

There is a separate discovery gap: the owner sees a request only after opening Customer data requests in Insignia. Shopify does not require an app notification, and Shopify's email is not documented as carrying Insignia's data. Treat the current flow as owner-pulled retrieval. If the product requires a proactive alert, the smallest useful change is an in-app pending-request count or notice that opens the existing request detail. That would be a new notification requirement, not another block of privacy instructions. Do not add email without an explicit product decision and an actual delivery channel.
