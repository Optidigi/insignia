# M5-012 research notes — checked 6 October 2026

## Product.updatedAt

Shopify describes Product.updatedAt as the time the product was last modified and explicitly notes that it can change for different reasons. It is not documented as a compare-and-swap token or mutation/readback equality guarantee.

https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Product

## Channel-specific intended visibility

Shopify's current product-search syntax supports:

`published_status:<channel_id_or_handle>-intended`

and

`published_status:<channel_app_id_or_handle>-intended`

where `intended` means the resource is added to the channel but not yet published.

https://shopify.dev/docs/api/admin-graphql/2026-07/queries/products

## Publication includedProducts

Publication.includedProducts is explicitly the list of products included, but not necessarily published, in the publication. It accepts a search query, which allows a fixed exact-ID lookup without enumerating unrelated merchant products.

https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Publication
https://shopify.dev/docs/api/admin-graphql/2026-07/queries/publication

## Exact effective state

Product.publishedOnPublication(publicationId:) directly answers whether the product is currently published to the exact publication.

https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Product

## Why these surfaces matter

M5-011 found all resourcePublicationsV2 catalog partitions empty in both ACTIVE and DRAFT, so a V2-only replacement is not supported by store evidence. The search/inclusion surfaces are separate documented representations of intended/channel association and can be tested read-only on the existing DRAFT fixture.
