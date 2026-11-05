# Insignia UI handoff

This folder contains the designed UI and working examples of its intended behavior. **It is not mapped or connected to the production backend.** The backend developer will do that work. The existing production applications, APIs and backend packages are unchanged.

## Run the examples

Use the repository's pinned Node and pnpm versions. From the repository root:

```sh
corepack pnpm install --frozen-lockfile
# Build the existing shared types/validators, then the UI:
corepack pnpm -r --filter './packages/**' build
corepack pnpm build:ui
corepack pnpm dev:ui:admin
# In another terminal:
corepack pnpm dev:ui:customer
```

The commands print their local URLs. The admin demo uses a local frame renderer and fixture server; it starts no backend service. The customer demo's `/scenarios` page offers example products. Its `/product` page is a labelled development host stand-in, not an Insignia storefront/cart page.

## Folder map

| Folder | Purpose |
| --- | --- |
| `admin/src` | Merchant UI components, pages, browser workflows, reducers and styles |
| `admin/examples/admin` | Optional local demo host, example orders/catalogs, fake responses and browser storage |
| `admin/examples/admin/support/placement-*` | Selected product editor presentation and its example adapters |
| `admin/examples/admin/support/method-*` | Selected Methods presentation and its example adapters |
| `designer/src` | Selected light/dark customer configurator and its reducer/runtime |
| `designer/src/demo`, preview shell and scenario files | Optional sample data, local upload/cart results and Shopify host stand-in |
| `localization` | Shared English, Dutch, German, French, Spanish and Italian UI text and locale state |
| `visualizer` | UI-specific browser canvas, camera and placement interactions |
| `theme` | Reference Liquid blocks/locales for later integration; not a deployable extension |
| `docs/notes` | Historical design research/review records; old paths describe the original working checkout |

Some selected product-editor and Methods components are still beside their example composition. Keep those components when replacing demo adapters. Do not delete the whole support folder. The older integration-oriented editor remains available in `admin/src/islands`, but the selected placement/method designs are the files identified above.

## Replaceable examples

The demo order/catalog server, sample products, in-memory saves, browser-local drafts and simulated publication/upload/cart outcomes are examples. They are not backend implementations or agreed API mappings. The preview server cannot forward writes to Shopify. Its child Astro process renders UI frames and has no API routes or server services.

The customer configurator has a separate embeddable entry, `designer/src/index.ts`. Run `corepack pnpm --filter @insignia/designer build:library` for its embeddable build. It produces JS, CSS and TypeScript declarations without importing the demo host, scenario catalog or fake upload/cart implementation. It requires host inputs and upload/cart ports; their real implementations are the backend developer's responsibility. Use the stylesheet in an isolated modal document/iframe, not in the surrounding Shopify theme document.

Shopify owns the product page, cart and checkout. After a verified add/update the Insignia modal closes and returns control to Shopify. Local demo success does not prove a real cart operation. Example totals must not authorize production purchases.

The admin source contains browser request contracts used by its example workflows. These are UI examples, not a declaration that an existing backend endpoint implements them. Connect real data, persistence, pricing, translations, permissions and publication separately. No such mapping is part of this delivery.

## Checks

The source has strict compiler coverage. Useful focused commands:

```sh
corepack pnpm --filter @insignia/admin-ui typecheck:examples
corepack pnpm --filter @insignia/admin-ui test
corepack pnpm --filter @insignia/designer typecheck:test
corepack pnpm --filter @insignia/designer check:runtime
corepack pnpm --filter @insignia/designer check:configs
```

The customer runtime checks enforce the separation between the configurator and its demo. Repository CI still checks the existing production applications independently. The guided tour remains deferred.
