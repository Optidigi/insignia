# Shopify platform notes — checked 7 October 2026

Current stable/latest documentation shows:
- `channels` is not a reliable generic inventory of every third-party channel for the calling application context; Shopify notes that for multi-channel calling apps it returns only channels established by the calling application.
- `publication(id:)` can retrieve a known Publication by ID.
- Product publication state exposes effective Publication IDs.
- DRAFT products are unavailable to customers.

A future/unstable ChannelConnection documents an `allChannels` query for all active sales channels, but the production app is pinned to a stable API and M5-017 must not depend on an unstable/release-candidate surface.

PR47 live evidence is stronger than documentation for current behavior:
- exact hidden Publication direct lookup works;
- complete stable generic Publications/Catalogs discovery omits it.

Therefore v3 uses direct anchors for already-effective Publication IDs and does not claim generic hidden-intent discovery.

References:
https://shopify.dev/docs/api/admin-graphql/latest/queries/channels
https://shopify.dev/docs/api/admin-graphql/latest/queries/publication
https://shopify.dev/docs/api/admin-graphql/latest/objects/Product
https://shopify.dev/docs/api/admin-graphql/unstable/connections/ChannelConnection
