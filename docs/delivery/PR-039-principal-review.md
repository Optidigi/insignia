# PR #39 — external principal review

**Verdict: APPROVED for normal merge at the stopped M5-009 qualification scope.**

Exact binding:
- base/effective merge base: `9ce56a1a9b8f674a3500f6592803f7a52e2ef18d`
- approved head: `0bc88f130b7f37b0a544846ba2c09a37f8d66c27`
- approved tree: `9878c2b1f5c06292aa750a2dc41183b939a48da9`
- current main at review: exact base
- final CI: 10/10 SUCCESS, all attempt 1
- native GitHub reviews: none

The M5-009 successor harness remains within the authorized experiment scope. Closed M5-004 history is preserved; M5-009 has a fresh canonical profile/register/binding; exact app/client/shop/domain/install/development identity stays fixed; the new capability gate requires `write_products` while safely permitting additional well-formed grants; legacy M5-004 exact-nine behavior remains regression-covered; production availability/catalog adapters and the shared qualification matrix remain materially unchanged.

Accepted live stop: auth1/read2/create1/update0. The single DRAFT `productCreate` returned HTTP200 with GraphQL ACCESS_DENIED at `productCreate.product.unpublishedPublications`. The one permitted exact-marker lookup returned ACCESS_DENIED at `products.nodes.0.unpublishedPublications`. Create settlement remains UNKNOWN, no usable Product ID exists, and no cleanup/status mutation followed. This is correct. Never resend that create.

Predecessor marker: `insignia-m5-009-439c9699-af2f-4e8a-b0f1-89003b88a2d4`; retained run start `2026-10-02T19:57:53.469Z`.

Publication-scope disposition: keep the publication guards. Current Shopify references indicate publication information on products requires publication-read capability beyond `write_products`; M5-010 will add `read_publications` and `read_product_listings` as optional scopes on the exact development installation. Do not request `write_publications`, because no publication mutation is authorized.

After those grants are verified, resolve the predecessor marker read-only using the complete ownership/publication fields. If absent, proceed. If exactly one slice-owned product is completely verified unpublished, archive it once if needed before a fresh M5-010 fixture. Any ambiguity stops.

This approval is not M5 completion, RELEASE_BOUND, production activation, M6/M7, gate acceptance, or launch.
