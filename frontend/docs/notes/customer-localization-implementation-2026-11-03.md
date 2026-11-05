# Customer modal localization implementation

Date: 2026-11-03

## Delivered

The customer modal now reads app-owned interface messages through a per-instance customer locale controller and Preact context. The English catalog covers navigation, artwork upload and recovery, quantity entry, option and placement pickers, positioning controls and live announcements, review, validation, file disclosure, theme controls, and pending/error states. Merchant-provided product, option, placement, size, method, and artwork names remain supplied values. Generated generic `Option` and `Selection` labels carry provenance and are translated only when the source omitted a value.

Runtime failures and recovery notices are stored as stable reason codes and parameters. The UI translates them from the active locale when rendered, so changing language during an edit, upload, or cart request preserves the current draft, focus, pending request, and retry idempotency key.

AdminPreview uses its separate admin translator and merchant locale. Its setup failures and preview notices are translated at render time. Preview copy is not stored in `ProductConfig`; the customer bundle continues to use only the customer localization entry point. Shopify still owns product, cart, and checkout behavior.

## Owned files

- Canonical catalogs: `packages/localization/src/catalogs/en/customer.json` and `packages/localization/src/catalogs/en/admin-preview.json`.
- Prototype locale boundary and modal integration: `designer-prototype/src/customer-locale.ts`, `designer.tsx`, `designer-state.ts`, `runtime.ts`, `admin-preview.tsx`, and `preview-shell.tsx`.
- Localized customer components: `color-picker.tsx`, `compact-fields.tsx`, `file-name.tsx`, `garment-preview.tsx`, `inline-positioning.tsx`, `position-picker.tsx`, `quantity-entry.tsx`, `review-panel.tsx`, `theme.tsx`, and `validation-summary.tsx`.
- Domain/provenance support: `config.ts`, `model.ts`, `position-geometry.ts`, `shopify-variant-matrix.ts`, and `demo/local-designer.tsx`.
- Regression checks: `scripts/localization-state-check.mjs`, `scripts/customer-catalog-check.mjs`, `scripts/customer-localization-browser-check.mjs`, `scripts/fixtures/customer-localization.html`, `scripts/fixtures/customer-localization.tsx`, and the preview assertion in `scripts/config-check.mjs`.

`designer-prototype` is a sibling workspace; its files are outside the main Git repository. The package manifest and lockfile were left to the root integration owner. The canonical customer and admin-preview catalog contents matched the installed localization artifact when these checks ran.

## Verification

- `npm run build` — passed (`tsc --noEmit` and Vite production build).
- `npm run check:runtime` — 17 tests passed.
- `npm run check:configs` — 74 tests passed.
- `npm run check:variants` — 4 tests passed.
- `node --test scripts/localization-state-check.mjs scripts/customer-catalog-check.mjs` — 5 tests passed, including stable reason-code state, catalog key resolution, hidden-message coverage, and a scan for literal customer UI text.
- `node --test scripts/customer-localization-browser-check.mjs` — 4 browser tests passed. They cover locale changes during invalid quantity editing, pending and failed cart submission with retry idempotency, upload pending/error recovery, and expanded pseudo-localized copy at 320/390 px in light/dark mode.
- The browser fixture passed an explicit strict TypeScript check.

The browser fixture uses the development-only pseudo locale as expanded-text stress input. It does not add or advertise another supported language.
