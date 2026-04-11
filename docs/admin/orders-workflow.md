# Orders workflow (Dashboard)

This doc describes the merchant-facing orders workflow.

## Logo Later (MVP)

- Customer can choose “I’ll provide later” in the storefront modal.
- The backend records the order line as artwork pending (`artworkStatus = PENDING_CUSTOMER`).
- The storefront modal still shows a placeholder logo in previews (merchant placeholder image, else bold `LOGO`).

## Merchant follow-up (MVP)

- Automated sending is intentionally disabled (Coming soon).
- Dashboard MUST include template management UI so the merchant can edit reminder content.
- Dashboard SHOULD provide copy helpers (copy template / copy email + link) so merchants can send manually.
- The “Send reminder” action MUST be present but disabled/greyed out with a short explanation.

## Order detail rendering (MVP)

The dashboard MUST be able to render the same placement previews the customer saw (per order line):

- Base view image (variant + view)
- Placement overlays using percent geometry
- Correct logo per placement (buyer upload or placeholder)

See canonical implementation notes:

- [`order-detail-rendering.md`](order-detail-rendering.md)

## Artwork arrives later

When artwork is provided later (outside the original modal upload), the dashboard attaches it to the specific order line.

- Dashboard uploads artwork via Admin API.
- Backend stores a `LogoAsset` and updates the `OrderLineCustomization`.
- Backend transitions `artworkStatus` to `PROVIDED`.

Canonical references:

- Data schemas: [`../core/data-schemas.md`](../core/data-schemas.md)
- Admin API: [`../core/api-contracts/admin.md`](../core/api-contracts/admin.md)
- Webhooks: [`../core/api-contracts/webhooks.md`](../core/api-contracts/webhooks.md)
- Variant pool finalization: [`../core/variant-pool/implementation.md`](../core/variant-pool/implementation.md)
