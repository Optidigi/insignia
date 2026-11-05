# Buyer Shopify option metadata

30 October 2026. Implemented locally and tested through the production catalogue composition and HTTP response boundary. This does not connect the selected designer, mutate a Shopify cart, deploy a bundle or establish release approval.

The production catalogue reader already requests Shopify `selectedOptions { name value }`. The buyer projection now retains those values beside the exact numeric Shopify variant ID. Production customization `options` remain a separate field. Titles, product types and production options never supply Shopify variant axes, option IDs, swatches or plural labels.

## Version compatibility

Default `GET /v1/config` still returns the strict `m7-config-v1` DTO with its original variant fields. Adding an optional property to that response would break already-built strict clients, so the extension uses explicit negotiation. `GET /v1/config?configVersion=m7-config-v2` returns `m7-config-v2`; the query parameter must be included in the signed App Proxy request. `BuyerConfigSchema` and the default `parseBuyerResponse` remain v1. The v2 parser requires the third argument `m7-config-v2`, and `BuyerConfigV2Schema` is separately exported. The HTTP boundary selects that parser only for the explicit opt-in. The existing storefront continues to request v1.

V2 variant records contain `id`, `label`, `available` and required `selectedOptions`, which is an array of exact `{name, value}` strings or `null`. Limits are 250 variants, three options per variant and 200 characters per name/value. Records and nested option objects reject unknown fields. V2 requires unique canonical numeric variant IDs, unique option names, consistent complete option-name sets and unambiguous tuples.

Missing metadata and empty upstream arrays become `selectedOptions: null` with `available: false`. The existing Shopify reader turns missing arrays into empty arrays, so this projection cannot safely interpret either case as a known product with no options. An explicitly observed Shopify `Title` / `Default Title` tuple remains intact. Inconsistent option-name sets invalidate the affected catalogue metadata; duplicate tuples invalidate every colliding variant, including duplicates supplied in different option orders. Valid sparse tuples remain sparse. The projection creates no Cartesian combinations. The selected designer adapter must treat unknown metadata as unsupported.

V2 narrows offer eligibility when metadata is unsafe. It does not rewrite the provider inventory observation used by proposal, acceptance or renewal checks. Existing authorization and exact-money contracts are unchanged. No scopes, provider operations or catalogue calls were added. The projection tests confirm one existing provider catalogue read per config request.

## Sources and checks

Shopify's pinned [SelectedOption reference](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/SelectedOption) defines the exact name/value fields. The [productOptionsCreate reference](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/productOptionsCreate) documents the three-option limit.

Focused TDD first demonstrated rejection of the unimplemented v2 response and then the absent production tuple projection. Regression cases cover strict v1/v2 compatibility, sparse three-option products, punctuation inside exact values, unrelated production options, absent/empty/default metadata, partial axes, duplicate names and tuples, reversed tuple order, unavailable inventory, bounds and nested unknown fields.

Run under the repository's pinned Node 24.21.0:

```sh
corepack pnpm --filter @insignia/contracts test
corepack pnpm --filter @insignia/contracts build
corepack pnpm --filter @insignia/contracts typecheck:test
corepack pnpm exec tsc -p apps/web/tsconfig.http-test.json --noEmit
node --test apps/web/test/buyer-production.test.mts apps/web/test/buyer-flow.test.mts apps/web/test/buyer-http.test.mts
```

Contracts: eight tests passed. Buyer production and HTTP: 18 passed; nine database-backed flow tests skipped without their configured database environment. The strict contract and HTTP test compiler projects passed. Focused Biome checks passed with three existing optional-chain suggestions in unchanged authorization/artwork checks.
