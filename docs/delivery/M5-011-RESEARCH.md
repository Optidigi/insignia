# M5-011 adjudication research

The fixed harness compares complete legacy publication views with V2 partitions APP, MARKET, COMPANY_LOCATION and NONE on one owned product. It calls the current production port without changing its source. Synthetic observations exercise the real adapter; they establish harness safety and expected branch behavior, not Shopify semantics.

Before the live experiment, the competing explanations are:

1. Legacy membership is conditional on effective visibility; V2 retains configured publication while DRAFT. The current adapter's membership equality check then explains CONFLICT after an exactly settled hold.
2. V2 also loses membership, or differs in a captured way: classify DIFFERENT_PLATFORM_BEHAVIOR and avoid inventing publication intent.
3. Incomplete data, identity drift or unsettled writes prevent inference: classify INCONCLUSIVE and stop.

The retained publication's autoPublish setting may explain initial setup behavior, but one observation cannot prove why the earlier product became published. No publication mutation is part of the experiment.

## Versioned field validation

Shopify developer MCP v1.15.4 accepted all six fixed documents against Admin 2026-07 and rejected the invalid-field control. The inherited identity's ShopPlan.displayName has a deprecation warning; the selected field remains valid. No authenticated query was involved in schema validation.

Official references, retrieved 2026-10-06:

- [Product](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Product): V2 includes staged publication and defaults to APP when catalogType is omitted.
- [CatalogType](https://shopify.dev/docs/api/admin-graphql/2026-07/enums/CatalogType): four catalog partitions.
- [ResourcePublicationV2](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/ResourcePublicationV2): isPublished distinguishes published and staged records; publishDate is nullable.
- [Publication](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Publication): autoPublish, supportsFuturePublishing, catalog and channels.
- [Catalog](https://shopify.dev/docs/api/admin-graphql/2026-07/interfaces/Catalog): id/title/status; __typename supplies the concrete catalog type.
- [Channel](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Channel): minimal id/name/app id/title; merchant account fields are omitted.

Receipts: [valid documents](evidence/m5-011/schema-validation.json), [invalid control](evidence/m5-011/schema-invalid-control.json). These are offline schema checks, not development-gate evidence.
