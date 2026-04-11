# Product configuration workflow (Dashboard)

This doc describes the merchant workflow in the dashboard for configuring product customization.

## What the merchant does

1. Create a `ProductConfig` and link it to one or more Shopify products.
2. Upload/select view images per color variant (front/back/left/right/etc.).
3. Define printable placements using the placement editor.
4. Configure the step schedule per placement (labels, default step, optional price per step).

## Backend requirements (summary)

- Must provide secure persistence for configs.
- Must store assets in R2 and return stable URLs.
- Must support duplicating a view configuration to another variant (copy geometry + steps; swap images only).

Canonical contracts:

- Placement editor saved outputs: [`../core/placement-editor.md`](../core/placement-editor.md)
- Admin API endpoints: [`../core/api-contracts/admin.md`](../core/api-contracts/admin.md)
