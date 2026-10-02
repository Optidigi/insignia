# M5-008 research notes

1. Shopify app versions bundle app configuration and extensions. The Dev Dashboard version-create page creates a version from the configuration on the page plus extensions present on the current active version.
   https://shopify.dev/docs/apps/launch/deployment/app-versions

2. Shopify scope guidance says a write scope includes its read counterpart. `productUpdate` requires `write_products`; Product reads require `read_products`, which is covered by the write scope.
   https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes
   https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/productUpdate
   https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Product

3. Scope changes only become usable when approved/granted. Shopify's current guidance says apps acting only on stores in their own organization approve that change themselves when releasing the version; other installed merchants can require approval. Therefore M5-008 conditions release on bounding installation impact to owner-controlled development context.
   https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes
