# Customer assumptions logic review

30 October 2026. Independent Sol review of the current working changes against `HEAD`, scoped to buyer variant metadata and the selected sibling designer's option-to-variant path. The repository code-review and unslop skills informed this review. The specification sources were the assignment, `AGENTS.md`, the implementation plan's variant identity and Shopify ownership rules, and the buyer option-metadata delivery note.

## Result

No remaining blocking finding in the reviewed logic. One identity defect was reported during review and corrected by the implementation agent. The prototype initially accepted both `222` and `gid://shopify/ProductVariant/222` as distinct IDs, which could give one actual Shopify variant two selectable tuples. Both prototype boundaries now require canonical numeric strings of at most 20 digits. The final alias probe returns `unsupported`, and regressions cover GIDs and mixed numeric/GID aliases.

## Standards

The new backend response remains a separately negotiated strict DTO. Default `BuyerConfigSchema` and `parseBuyerResponse` still parse v1, and the service explicitly removes metadata from default variant records. The selected frontend preserves IDs as strings rather than converting them to numbers. No reviewed change mixes production customization options with Shopify selected options.

No documented-standard violation remains in this scope. There is no reason to extract a cross-repository helper while the selected frontend remains a separate, unconnected project.

## Specification

The production reader retains actual selected option names and values. Missing metadata, duplicate names, inconsistent option-name sets and ambiguous tuples cannot become available offers. An observed `Title` / `Default Title` tuple stays distinct from missing metadata. Inventory availability remains an explicit boolean from the existing provider path. Sparse three-option products retain actual combinations only.

The prototype adapter derives row and column identities from structured tuples. It does not split display titles, classify product types, invent swatches or generate Cartesian combinations. The state and runtime derive committed variant quantities from current configured cells, reject absent or unavailable cells, ignore supplied stale saved identities and refuse Shopify completion for fixture-only designs without exact variant identities.

The runtime test exercises the adapter result through `configSchema`, state, quantity entry and the injected cart port. This verifies the local data path beyond testing an isolated matrix result. The injected receipt remains synthetic evidence. It does not establish a Shopify cart mutation or a connected selected frontend.

## Independent verification

Run under Node 24.21.0:

- `corepack pnpm --filter @insignia/contracts test`: 8 passed.
- `node --test apps/web/test/buyer-production.test.mts apps/web/test/buyer-http.test.mts`: 18 passed.
- Sibling `node --test scripts/variant-matrix-check.mjs scripts/runtime-check.mjs`: 21 passed, repeated after the canonical-ID correction.
- Direct SDK verifier probe: correctly signed v2 request succeeds; changing `configVersion` without resigning rejects the request.

Visual review, browser-level adapter presentation, full fixture/build checks, deployment, native Shopify observations and owner acceptance belong to their separate verification records. This review changes documentation only.
