# Public contract notes — checked 6 October 2026

Shopify `Publication.supportsFuturePublishing` means whether that publication supports future publishing; it is a channel/publication capability.

Shopify's own product-publishing example shows Online Store with:
- autoPublish: true
- supportsFuturePublishing: true

This does not mean every product in Online Store is scheduled.

Shopify Product `resourcePublications(onlyPublished:false)` is documented to include resources scheduled for future publication, which is the product-level schedule evidence relevant to this hold.

References:
- https://shopify.dev/docs/apps/build/sales-channels/product-publishing
- https://shopify.dev/docs/api/admin-graphql/latest/objects/Publication
- https://shopify.dev/docs/api/admin-graphql/latest/objects/Product

Project limitation remains: actual scheduled/future publication behavior is not live-qualified, so actual observed scheduled records stay fail-closed.
