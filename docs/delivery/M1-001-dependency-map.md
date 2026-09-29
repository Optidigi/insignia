# M1-001 workspace and entry points

The root pnpm workspace includes `apps/*` and implementation-bearing `packages/*`; archived `spikes/` and their lockfiles stay outside membership. The root Cargo workspace includes only `crates/cart-authorization`, `crates/cart-transform` and `crates/cart-validation`. Exact Node/pnpm/Rust pins are in the root manifests/toolchain file. Package entry points use `exports`; `@insignia/domain` exposes only its built pure money primitive.

| Entry | Present M1 behavior | Boundary |
|---|---|---|
| `apps/web` standalone Astro Node SSR | Public `/live`, a static non-merchant shell and `/local-test/interaction` Preact/Polaris-markup fixture | No merchant API, shop-query auth, credential or command route. The local test CSS permits a visible fallback when the Admin host does not upgrade Polaris elements; it is not live embedded Admin proof. |
| `apps/storefront` Vite/Preact | `insignia-local-preview` Custom Element, Shadow DOM and local event harness | No cart, product configurator, price, artwork or buyer command. The theme block references the exact generated bundle. |
| `apps/worker` Node | Local liveness, graceful shutdown and deterministic Sharp synthetic-pixel derivative | `durableReady:false`; no database, pg-boss, merchant upload or fake outbox. |
| `packages/domain` | Browser-safe exact nonnegative minor-unit parse/format | No framework, network, storage, SDK, implicit clock or randomness. |
| `crates/cart-authorization` | Experimental-v2 strict verifier and checked arithmetic with synthetic test vectors | No production signer/issuer or merchant key defaults. |
| `crates/cart-transform`, `crates/cart-validation` | Current-source experimental-v2 Function candidates with independent verification | No live extension UID, generation or app trust configuration. Synthetic fixtures and runner are offline only. |

Executable `.dependency-cruiser.cjs` rules and `scripts/boundaries/check.mjs` cover direct and type-only edges, browser transitive re-exports, a real browser bundle, package exports, and deliberately invalid imports. The normal check runs these negative controls. Future `application` ports may depend inward on domain; Shopify, database and artwork adapters may implement ports but may not call one another. Only a future `packages/shopify` may import `@shopify/shopify-api`. Future browser-safe `contracts` may expose Zod DTOs, never server implementations. Preact/Polaris belong in UI surfaces; Konva belongs only in the later visualizer, and React/react-konva are excluded from the current runtime.

The root artifact manifest binds final and raw Wasm, query/schema/source, storefront/theme assets, web/worker outputs and both lockfiles to the current build. It is local build evidence, not a production deployment or supported 200-line checkout claim. Actual capacity, stack telemetry, activation/fencing and complete gates remain in [the milestone-owned register](M1-UNRESOLVED-ACCEPTANCE.md).
