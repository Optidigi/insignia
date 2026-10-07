# Exact Publication resolution research

The pinned [2026-07 Publication documentation](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Publication) describes exact `publication(id:)`, `includedProducts`, `autoPublish` and `supportsFuturePublishing`. Inclusion does not imply current effective publication.

The pinned `queries/nodes` page and its Markdown route were not accessible during this research. The Node interface route redirected to latest; its nodes link reached unstable documentation. Unstable `nodes(ids:)` documentation was not treated as qualified 2026-07 support or as evidence of stable unavailability.

M5-017 therefore selects the brief's permitted fallback: fixed bounded serial exact-ID Publication queries. Authenticated schema/provider qualification remains part of the gated live run. Documentation, compilation and mocked responses do not establish that live behavior.
