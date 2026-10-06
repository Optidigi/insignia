# Shopify contract notes — checked 7 October 2026

Current Shopify docs state:
- `publications` is a flat list of all publications on the shop;
- it can be filtered by CatalogType;
- `catalogs` is an alternative discovery path;
- `publication(id:)` retrieves a Publication by ID;
- `Publication.includedProducts` means products included but not necessarily published.

PR46 live evidence contradicts the flat-list expectation for Publication339456917787, so no production change may assume the unfiltered list is exhaustive.

References:
https://shopify.dev/docs/apps/build/sales-channels/product-publishing
https://shopify.dev/docs/api/admin-graphql/latest/queries/publications
https://shopify.dev/docs/api/admin-graphql/latest/queries/publication
https://shopify.dev/docs/api/admin-graphql/latest/queries/catalogs
