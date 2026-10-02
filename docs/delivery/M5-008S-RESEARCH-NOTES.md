# M5-008S — contracts and observation provenance

Public Shopify documentation inspected on 2 October 2026 UTC:

- [Manage access scopes](https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes): an optional declaration permits a later merchant-approved request; it does not itself modify existing grants. The documented direct Admin URL uses the store name, client_id and optional_scopes. write_products includes product read access, so a separate read_products handle is unnecessary.
- [App versions](https://shopify.dev/docs/apps/launch/deployment/app-versions): Dev Dashboard version creation combines the form configuration with the current active version’s extensions. This is the brief’s accepted preservation mechanism; the inspected version pages do not expose an independent extension manifest.

The exact intended grant URL was https://admin.shopify.com/store/insignia-rewrite-dev/oauth/install?client_id=1443cf6d03d39edae7c101a943c5c684&optional_scopes=write_products. Returned session/authorization query strings are excluded from evidence. The native grant page’s only permission category was Edit products (Products, collections); the final API read separately verifies the actual handle and identities.

Required scopes stayed empty. The current-installation inventory prerequisite was explicitly retired by this [slice brief](prompts/M5-008S-OPTIONAL-SCOPE-DEV-STORE-GRANT.md); no inventory search occurred. This development qualification neither establishes public-merchant authentication nor adopts a production scope catalog.
