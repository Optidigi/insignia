# Insignia frontend

This folder contains the selected merchant UI and customer Designer, plus isolated examples. The current integration reuses their presentation and reducers in `apps/web` and `apps/storefront`, with authenticated services for persistence, publication, artwork, quotes and cart operations. Deployment and owner visual acceptance are separate from local integration; see [current delivery state](../docs/delivery/state.md).

## Native development review

Open the [published development product](https://insignia-rewrite-dev.myshopify.com/products/insignia-ui-demo-example-calibration) to review the selected customer Designer, or open Insignia in the rewrite-dev Shopify Admin for the merchant editor. The product's calibration is labelled example-only. Current deployment limits and outstanding qualification are recorded in [delivery state](../docs/delivery/state.md); a published demo does not establish complete E2E or owner visual acceptance.

## Run the examples

Use the repository's pinned Node (`.node-version`) and pnpm (`package.json`) versions. From the repository root:

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
| `admin/src/islands/SelectedProductEditor.tsx`, `SelectedProductContainer.tsx` | Selected product presentation and authenticated backend composition |
| `admin/examples/admin/support/placement-*` | Shared selected presentation/reducers and explicit isolated example adapters |
| `admin/src/islands/SelectedMethods.tsx`, `MethodsContainer.tsx` | Selected Methods presentation and authenticated catalogue composition |
| `admin/examples/admin/support/method-*` | Shared selected Method helpers and explicit isolated example adapters |
| `designer/src` | Selected light/dark customer configurator and its reducer/runtime |
| `designer/src/demo`, preview shell and scenario files | Optional sample data, local upload/cart results and Shopify host stand-in |
| `localization` | Shared English, Dutch, German, French, Spanish and Italian UI text and locale state |
| `visualizer` | Browser canvas/camera interactions; production geometry delegates to canonical `packages/visualizer` |
| `theme` | Reference Liquid blocks/locales for later integration; not a deployable extension |
| `docs/notes` | Historical design research/review records; old paths describe original sources preserved in Git (including PR223 base `d490e4d`) |

Some shared selected components remain beside example composition. Keep those components and their reducers; do not delete the whole support folder. The production routes use the selected placement/Methods composition identified above. Historical editor transaction helpers and accepted publication/history authority remain distinct from replaceable presentation.

## Replaceable examples

The demo order/catalog server, sample products, in-memory saves, browser-local drafts and simulated publication/upload/cart outcomes are examples. They do not authorize production operations. The [research action map](../docs/architecture/frontend-backend-map.md) and [confirmed target](../docs/architecture/implementation-plan.md#15-confirmed-selected-frontend-integration-target) define integration requirements. The preview server cannot forward writes to Shopify. Its child Astro process renders UI frames and has no API routes or server services.

The customer configurator has a separate embeddable entry, `designer/src/index.ts`. Run `corepack pnpm --filter @insignia/designer build:library` for its embeddable build. It produces JS, CSS and TypeScript declarations without importing the demo host, scenario catalog or fake upload/cart implementation. It requires host inputs and upload/cart ports. `apps/storefront/src/designer` supplies real session, upload, design restoration, quote-review and cart ports. The artwork-only portal uses its separate secure post-order capability; merchant preview cannot purchase or persist artwork. Use the stylesheet in an isolated modal document/iframe, not in the surrounding Shopify theme document.

All customer flows use the selected Designer, including products with retained production choices. Products without those choices retain the selected presentation unchanged. Opaque production-choice definitions/labels travel with selected merchant snapshots and independent copies, while accepted order values remain immutable.

Shopify owns the product page, cart and checkout. After a verified add/update the Insignia modal closes and returns control to Shopify. Local demo success does not prove a real cart operation. Example totals must not authorize production purchases.

Production hosts use server-confirmed currency and current authentication authority. Local storage holds unresolved operation custody only; it is not authoritative product or store data. Save and Publish remain separate. Method inheritance/overrides, review decisions, production dimensions and movement are carried by shared contracts. See [selected Designer wiring](../docs/architecture/selected-live-designer.md) and [customer artwork](../docs/architecture/customer-artwork-integration.md) for the buyer and post-order boundaries.

## Checks

The source has strict compiler coverage. After the workspace build, install the designer browser and run the complete frontend gate:

```sh
corepack pnpm --filter @insignia/designer exec playwright install chromium
corepack pnpm check:ui
```

This runs admin, localization and visualizer tests; every existing designer `*-check.mts` suite (including browser/localization and variant checks); and the embeddable library/artifact checks. The normal Designer build produces the embeddable JS/CSS/declarations before the demo. The full repository check includes this gate after build and strict compiler checks. Foundation CI installs both web and designer browser versions; frontend-only main pushes select that existing protected job.

Useful focused commands:

```sh
corepack pnpm --filter @insignia/admin-ui typecheck:examples
corepack pnpm --filter @insignia/admin-ui test
corepack pnpm --filter @insignia/designer typecheck:test
corepack pnpm --filter @insignia/designer check:runtime
corepack pnpm --filter @insignia/designer check:configs
```

Browser localization checks write generated captures beneath the ignored `.m1-artifacts/frontend/customer-language/` directory.

The customer runtime checks enforce the separation between the configurator and its demo. Repository CI still checks the existing production applications independently. The guided tour remains deferred.
