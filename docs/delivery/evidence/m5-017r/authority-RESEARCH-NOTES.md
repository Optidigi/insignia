# ResourcePublication timing contract — checked 7 October 2026

Shopify 2026-07/latest ResourcePublication:
- `isPublished=true` also returns true when the resource is scheduled to be published.
- `isPublished=false` means the resource is neither published nor scheduled.
- `publishDate` is the date the resource was or is going to be published.
- Product.resourcePublications(onlyPublished:false) also returns future publications.

ResourcePublicationV2 is different:
- true means published;
- false means staged.

The Insignia v3 production document uses legacy ResourcePublication, so its timing classifier must not apply V2 `false=staged` semantics.

The canonical M5-017 restore case has publishDate inside the mutation observation interval. Completion-time evaluation (`publishDate <= receivedAt`) is consistent with the resource being effective by the completed response, while request-start evaluation falsely flags it as future.

References:
https://shopify.dev/docs/api/admin-graphql/latest/objects/ResourcePublication
https://shopify.dev/docs/api/admin-graphql/2026-07/objects/ResourcePublicationV2
https://shopify.dev/docs/api/admin-graphql/latest/objects/Product
