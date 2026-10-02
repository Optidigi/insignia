# M5-009 public contract notes

Checked 2 October 2026.

Shopify GraphQL Admin 2026-07 currently documents:

- `productCreate` requires `write_products`.
- Product creation is unpublished by default; publication is a separate operation.
- `productUpdate` requires `write_products` and supports status changes.
- Product statuses include `ACTIVE`, `ARCHIVED`, `DRAFT`, and `UNLISTED`.
- ACTIVE status does not itself automatically publish the product.

References:
- https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/productCreate
- https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/productUpdate
- https://shopify.dev/docs/api/admin-graphql/2026-07/enums/ProductStatus

Repository contracts remain authoritative for Insignia's qualification semantics. Public docs support the candidate API behavior; the live experiment must establish actual behavior for the designated store.
