# Orders overview implementation

20 October 2026. First implementation at `8add4fdd` on `codex/ui-redesign`, subsequently rejected by the owner for visual mismatch. This note preserves that pass's behavior and verification. The [reference diagnosis and refinement](orders-reference-diagnosis-2026-10-20.md) records the correction. Neither pass establishes deployment or owner visual acceptance.

## Result

`/admin/orders` now mounts `OrdersOverview.tsx` independently of the purchase/artwork detail island. It uses Shopify's resource index pattern, Polaris 2.0 web components and concise sentence-case copy. The columns are Order, Date in UTC, Artwork and Total. Order links open the exact retained purchase. Test orders have a Test badge. Money remains an exact minor-unit string.

The collection uses the existing authenticated `before`/`limit` API with 20-row pages. Next and Previous replace rows. The artwork filter explicitly applies to this page; there is no unsupported store-wide search, saved view, bulk action or order mutation. The filter and current cursor survive reload and returning from a detail page. Known previous cursors stay in browser history. A shared cursor link without that history offers View first page rather than inventing an adjacent previous page.

Initial loading, first-use empty, filtered no-results, failed reads and access denial are separate states. Failed pagination retains the attempted cursor for Try again. Authorization loss removes private rows and amounts. Initial and navigation skeletons match the collection's wide layout. Narrow screens use the table's native list layout.

The implementation follows the [Shopify research note](orders-overview-shopify-research-2026-10-20.md). Shopify content and component guidance take priority over supplementary Vercel advice. The existing admin layout was used only to preserve behavior and boundaries.

## Runtime migration

The single runtime now loads `polaris-2.0-rc.js`; checked types are `2.0.0-rc.3`. The lockfile, source guard, browser intercepts and unmodified public runtime fixture changed together. Fixture provenance and SHA-256 are in the [fixture README](../../../apps/web/test/fixtures/README.md). The admin CSP additionally permits the RC's specific `admin-ui-foundations/experimental/` icon directory. It does not grant the entire CDN connect access.

Local standalone SSR previously resolved unlisted transitive dependencies against ancestor `node_modules`, producing cookie named-export and Zod version errors. Vite now bundles those transitive runtime dependencies using `ssr.noExternal`. Application runtime dependencies retain their existing package declarations.

## Verification and limits

Shopify's official skill helpers and connected Dev MCP validated the Orders composition and both loading components against `v2.0`. The new controls use validated components/properties; structural accessibility containers and the app's skeleton wrapper are checked by repository types and boundaries.

Twenty focused browser/preview checks pass and cover pagination, page-local filtering and clearing, exact money, responsive overflow, retry, authorization clearing, empty state and query restoration. Independent standards/spec review found no remaining actionable issues after correcting retry, state restoration and skeleton width.

The full web suite passed with 224 tests passed, 54 skipped and no failures. On this macOS machine it used `TMPDIR=/private/tmp` so the signing fixtures use a canonical directory instead of the `/var` symlink. The migration exposed two test synchronization issues: modal edits now await hide/show lifecycle, and the publication recovery test awaits the completed canvas redraw while retaining exact pixel equality. The production renderer and method editor behavior did not change.

The web build, all 36 strict TypeScript projects, source/boundary checks and secret/provenance checks pass. Biome exits successfully with the repository's existing warnings and informational diagnostics. Verification commands are `pnpm --filter @insignia/web build`, `pnpm check:types`, `pnpm check:boundaries`, `pnpm check:source`, `pnpm check:style`, `pnpm check:secrets`, and `TMPDIR=/private/tmp pnpm --filter @insignia/web test`. The final text-only refinements also received a focused purchase/preview rerun.

Synthetic screenshots at 1440×900 and 390×844, including empty/denied/unavailable mobile states, are in ignored `.m1-artifacts/orders-overview-2026-10-20/`. They show no horizontal overflow. They contain synthetic data only. The local normal preview runs through `pnpm dev:admin`; its loopback port is assigned on startup. Desktop browser access was disabled in Work settings, so headless Chromium supplied visual evidence.

The synthetic bridge defines `window.shopify`, which the unmodified Polaris runtime treats as embedded mode. The real Shopify host owns the surrounding title bar and page actions. A synthetic screenshot therefore does not prove the host Orders title or Refresh action. Native verification in both Shopify admin appearances and owner visual acceptance remain outstanding. The branch is not deployed.
