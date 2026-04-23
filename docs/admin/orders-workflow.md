# Orders workflow (Dashboard)

> **Last verified**: 2026-04-23

This doc describes the merchant-facing orders workflow.

## UI Implementation Note

The Orders pages (`app.orders._index.tsx`, `app.orders.$id.tsx`) use **Polaris Web Components** (`<s-*>` custom elements), not the React `@shopify/polaris` package. Status labels and badge tones route through `app/lib/admin/terminology.ts`; App Bridge APIs (toast, saveBar, modal, print, batch download) route through `app/lib/admin/app-bridge.ts`. See `CLAUDE.md §2` for full WC rules.

## Order list

The orders index page (`app.orders._index.tsx`) shows orders filtered by production status tab:

- `all` — all orders with at least one customized line
- `awaiting` — lines where `productionStatus = ARTWORK_PENDING | ARTWORK_PROVIDED`
- `in-production` — lines where `productionStatus = IN_PRODUCTION | QUALITY_CHECK`
- `shipped` — lines where `productionStatus = SHIPPED`

Actions available from the list:

- **Bulk-advance**: select multiple lines and advance production status in one action (`app.orders.bulk-advance.tsx`)
- **Export CSV**: download all orders as CSV (`app.orders.export.tsx`, backed by `GET /api/admin/orders/export`)

## Order detail

The order detail page (`app.orders.$id.tsx`) renders via the page route loader — not a standalone JSON API. The loader returns all data needed for rendering in a single response:

- Shopify order metadata (name, financial status, customer, currency, `orderStatusUrl`)
- All customized line items with placement geometry snapshots, artwork status, production status
- Resolved logo asset URLs (presigned R2, 10-minute TTL)
- Download URLs (presigned R2) per placement per line
- `notes` (array of `OrderNote` records for this order)
- `allShopifyLineItems` (including non-customized lines for full order context)

Additional actions on the detail page:

- **Print view**: `app.orders.$id.print.tsx` — printable summary of the order
- **Artwork upload**: `POST /api/admin/artwork-upload` — attach or replace artwork for a line, transitions `artworkStatus` to `PROVIDED`
- **Add note**: creates an `OrderNote` anchored to the order

## Logo Later (MVP)

- Customer can choose "I'll provide later" in the storefront modal.
- The backend records the order line as artwork pending (`artworkStatus = PENDING_CUSTOMER`).
- The storefront modal still shows a placeholder logo in previews (merchant placeholder image, else bold `LOGO`).

## Merchant follow-up (MVP)

- Automated reminder sending is intentionally disabled ("Coming soon").
- Dashboard includes template management UI so the merchant can edit reminder content (`MerchantSettings.emailReminderTemplate`).
- Dashboard provides copy helpers (copy template / copy email + link) so merchants can send manually.
- The "Send reminder" action is present but disabled/greyed out with a short explanation.

## Artwork arrives later

When artwork is provided later (outside the original modal upload), the dashboard attaches it to the specific order line.

- Dashboard uploads artwork via `POST /api/admin/artwork-upload`.
- Backend stores a `LogoAsset` and updates the `OrderLineCustomization`.
- Backend transitions `artworkStatus` to `PROVIDED`.

## Production status transitions

Status flow: `ARTWORK_PENDING` → `ARTWORK_PROVIDED` → `IN_PRODUCTION` → (`QUALITY_CHECK` if enabled) → `SHIPPED`

`QUALITY_CHECK` is only shown when `MerchantSettings.productionQcEnabled = true`.

Bulk-advance moves selected lines to the next status in the sequence.

## Order block extension

The `insignia-order-block` Shopify Admin UI extension renders a summary card directly in the native Shopify Admin order detail page (outside the embedded app iframe). It fetches data from `GET /api/admin/order-block/:orderId`. This is separate from the full order detail page above and provides a quick-glance view for staff using Shopify Admin directly.

## Canonical references

- Data schemas: [`../core/data-schemas.md`](../core/data-schemas.md)
- Admin API: [`../core/api-contracts/admin.md`](../core/api-contracts/admin.md)
- Webhooks: [`../core/api-contracts/webhooks.md`](../core/api-contracts/webhooks.md)
- Order detail rendering: [`order-detail-rendering.md`](order-detail-rendering.md)
- Variant pool finalization: [`../core/variant-pool/implementation.md`](../core/variant-pool/implementation.md)
