# M5-011 research notes — checked 6 October 2026

Shopify ProductStatus says DRAFT is unavailable to customers and ARCHIVED is no longer sold/available. ACTIVE is ready to sell but does not itself add a publication:
https://shopify.dev/docs/api/admin-graphql/2026-07/enums/ProductStatus

Product.resourcePublicationsV2 represents published or staged-to-be-published resources. `onlyPublished:false` includes scheduled/staged records. For Product it defaults to APP when catalogType is omitted, so complete adjudication needs APP, MARKET, COMPANY_LOCATION and NONE:
https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Product
https://shopify.dev/docs/api/admin-graphql/2026-07/enums/CatalogType

Shopify staff has explained that standard publication fields can appear empty for DRAFT products even though publication is configured for when they become ACTIVE, and specifically recommended `resourcePublicationsV2(onlyPublished:false)`:
https://community.shopify.dev/t/publications-are-empty-for-draft-products/17037/2

Publication exposes autoPublish, catalog and channels; autoPublish means new products are automatically published to that publication:
https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Publication
https://shopify.dev/docs/api/admin-graphql/2026-07/queries/publication

A June 2026 Shopify staff community response also says auto-publish is on by default in the discussed sales-channel context:
https://community.shopify.dev/t/auto-publish-settings-for-sales-channels-in-admin-ui/35035

M5-003 already required the DRAFT hold snapshot to retain enough publication/visibility metadata to detect drift. M5-011 tests whether the field selection, rather than the DRAFT mechanism, is the defect.
