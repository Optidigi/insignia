# Insignia frontend

This folder contains the selected merchant UI and customer Designer, plus isolated examples. The current integration reuses their presentation and reducers in `apps/web` and `apps/storefront`, with authenticated services for persistence, publication, artwork, quotes and cart operations. Deployment and owner visual acceptance are separate from local integration; see [current delivery state](../docs/delivery/state.md).

## Native development review

The new merchant UI and customer Designer are deployed and active on rewrite-dev, and the unused legacy UI has been removed. Open the [fully configured T-shirt demo](https://insignia-rewrite-dev.myshopify.com/products/insignia-superfunny-t-shirt-demo) or its [merchant editor](https://admin.shopify.com/store/insignia-rewrite-dev/apps/insignia-1/admin/products/10588458647835/config). It uses Superfunny's blank T-shirt photographs, six colours and 64 actual combinations across XS–7XL, with front, back and both shoulder views, six placements and two print sizes. Its 50cm image calibration and decoration prices are example settings for UI review, not measured production specifications. The earlier [single-placement fixture](https://insignia-rewrite-dev.myshopify.com/products/insignia-ui-demo-example-calibration) remains available.

The current speed rollout is active in both the merchant UI and storefront. Native checks cover the richer product’s same-file upload, exactUSD24.95 quote/cart, automatic Shopify navigation, close/resume and desktop/narrow CSS layouts. Prepared opening measured17–213ms and the21,882-byte artwork applied in2.38–2.55seconds. Cold opening and live quote checks still require real loading time. The test cart is empty; no additional checkout/order was submitted. See [current delivery state](../docs/delivery/state.md) and [activation evidence](../docs/delivery/evidence/technical-merchant-completion/native-speed-followup-activation-2026-11-08.json) for exact identities and limits. Owner visual acceptance remains separate. Customer email authentication and native EUR qualification remain outstanding.

The reported Firefox and customer-parity corrections are now deployed. Direct canonical-link Firefox startup, real upload/checking feedback, direct draft resume, exact quote/cart/restoration and clean readback pass. The developer-only Personalise/Start-new page is removed from the customer flow; the deployed baseline preserves drafts on close, while actual dirty design switching uses the selected dialog. Current source adds a non-destructive close confirmation for edited designs and a separate cancellation decision for unfinished uploads. Startup reuses selected typography/theme/control styling. See the [baseline behavior map](../docs/architecture/selected-live-designer.md#baseline-behavior-and-opening-performance) and [current state](../docs/delivery/state.md) for exact qualification and remaining limits. The earlier fixture’s single placement/default variant is data, not missing UI; the richer T-shirt fixture above now covers native colour, size and multi-view configuration.

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

Some shared selected components remain beside example composition. Keep those components and their reducers; do not delete the whole support folder. The production routes use the selected placement/Methods composition identified above. The selected publication-state classifications remain in `admin/src/islands/publication-state.ts`. The replaced editor/workflows have been retired; accepted publication/history authority remains in the application/backend.

See the [UI retirement record](../docs/architecture/selected-ui-retirement.md) for removed entrypoints, retained contracts and deployment status.

## Replaceable examples

The demo order/catalog server, sample products, in-memory saves, browser-local drafts and simulated publication/upload/cart outcomes are examples. They do not authorize production operations. The [research action map](../docs/architecture/frontend-backend-map.md) and [confirmed target](../docs/architecture/implementation-plan.md#15-confirmed-selected-frontend-integration-target) define integration requirements. The preview server cannot forward writes to Shopify. Its child Astro process renders UI frames and has no API routes or server services.

The customer configurator has a separate embeddable entry, `designer/src/index.ts`. Run `corepack pnpm --filter @insignia/designer build:library` for its embeddable build. It produces JS, CSS and TypeScript declarations without importing the demo host, scenario catalog or fake upload/cart implementation. It requires host inputs and upload/cart ports. `apps/storefront/src/designer` supplies real session, upload, design restoration, quote-review and cart ports. The artwork-only portal uses its separate secure post-order capability; merchant preview cannot purchase or persist artwork. Use the stylesheet in an isolated modal document/iframe, not in the surrounding Shopify theme document.

All customer flows use the selected Designer, including products with retained production choices. Products without those choices retain the selected presentation unchanged. Opaque production-choice definitions/labels travel with selected merchant snapshots and independent copies, while accepted order values remain immutable.

Shopify owns the product page, cart and checkout. After a matching verified add/update or confirmed removal, the selected modal closes and navigates to Shopify’s locale-native cart. Manual close and failed/unknown operations keep the current page. Local demo success does not prove a real cart operation. Example totals must not authorize production purchases.

Production hosts use server-confirmed currency and current authentication authority. Local storage holds unresolved operation custody only; it is not authoritative product or store data. Save and Publish remain separate. Method inheritance/overrides, review decisions, production dimensions and movement are carried by shared contracts. See [selected Designer wiring](../docs/architecture/selected-live-designer.md) and [customer artwork](../docs/architecture/customer-artwork-integration.md) for the buyer and post-order boundaries.

## Checks

The source has strict compiler coverage. After the workspace build, install the designer browser and run the complete frontend gate:

```sh
corepack pnpm --filter @insignia/designer exec playwright install chromium firefox
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
