# Frontend verification baseline repair — 28 October 2026

## Current status

The latest maintained `test:frontend` run passed all environment-available checks. It completed the buyer and merchant builds, configuration contracts, effective strict type coverage, source coverage, formatting/lint gate, and both serial browser/model stages.

| Stage | Tests | Passed | Failed | Cancelled | Skipped |
| --- | ---: | ---: | ---: | ---: | ---: |
| Merchant, shared artwork, and buyer browser/model | 687 | 627 | 0 | 0 | 60 |
| Storefront buyer browser/model/cart | 61 | 59 | 0 | 0 | 2 |

Across both stages, 748 tests ran: 686 passed, none failed or were cancelled, and 62 environment-gated tests reported their declared skips. No checks were skipped to obtain these counts.

The verified run used Node `v24.21.0`, `TMPDIR=/tmp`, and `INSIGNIA_DESIGNER_PROTOTYPE_ROOT=/Users/pc/Development/Insignia/designer-prototype`. The maintained runner wrote its spec output to `/tmp/frontend-state-maintained-verified.log`, its merchant TAP report to `/tmp/frontend-state-maintained-web-verified.tap`, and its storefront TAP report to `/tmp/frontend-state-maintained-storefront-verified.tap`. The test files and serial concurrency are unchanged by the optional TAP reporter support in `scripts/ci/frontend-state.mts`.

Earlier evidence is retained for comparison:

- The pre-integration run against in-flight editor assets reported 676 tests: 585 passed, 28 failed, 3 cancelled, and 60 skipped (`/tmp/frontend-preintegration-web-tests-correct-env.log`). It is not a current baseline.
- The first integrated full run reported 687 merchant/artwork tests: 622 passed, 4 failed, 1 cancelled, and 60 skipped; the storefront stage reported 59 passed and 2 skipped (`/tmp/frontend-state-maintained-final-rerun.log`). Its failures were subsequently fixed or reassigned and independently cleared before the latest run.
- The first maintained invocation stopped at `check:style` with three formatter errors in touched preview, shared-controls, and Methods files. Only those files were formatted; the maintained style gate now passes. The latest run passed it with the rest of the required source/build checks.
- An intermediate verified invocation stopped at `check:style` after the new placement focus poll used `while (true)`. The test retained its one-second poll budget and was rewritten to use the existing deadline condition; the style gate passed in the completed run.

## Baseline repairs and targeted evidence

- Orders rows now give the pinned identity column 140px so the order label and its `Test` badge stay on one line. The existing 44px limit remains unchanged. The responsive Orders/Products browser regression passes at 1440, 600, 390, and 320px; the compact Orders row measures 37px in the fresh preview.
- The Orders/Products preview test now targets the visible named region. The old label locator also matched a retained loading-skeleton region.
- The shared attachment regression now follows the actual lazy-mounted artwork flow, waits for the upload response, and uses the fixture's accessible placement label. Its privacy checks still distinguish the attached replacement from an unavailable deferred original. Targeted result: 1/1.
- Shared route recovery now asserts that retained skeleton/fallback content is hidden after readiness rather than removed from the DOM. Targeted result: 1/1.
- The date-picker regression waits on its visible calendar day control; the public custom-element host has no layout box. The purchase navigation focus regression accounts for the page reload, which resets its first-missing-item cycle. The Orders breadcrumb test now waits for its exact return cursor and Admin readiness before checking Previous. Each focused test passes 1/1.
- The Methods index shows the fixed-price label on one line and exposes its per-placement/per-garment unit in a single Pricing help tooltip. The existing 48px compact-row assertion remains unchanged. Desktop and phone targeted checks pass 2/2.
- The loading-shell assertion follows the current Methods route title. Its targeted test passes 1/1.
- The runner can optionally emit separate TAP receipts when `INSIGNIA_FRONTEND_WEB_TAP_REPORT` and `INSIGNIA_FRONTEND_STOREFRONT_TAP_REPORT` are set to absolute paths. With both unset, its existing output behavior is unchanged.

The latest full run passes the purchase breadcrumb regression, the Orders/Products row check, and the placement focus regression described below.

The previous placement focus failure was a stale test-node problem, not an app focus defect. The test helper held the old custom-field input across the duplicate-triggered rerender. The current input owned focus, but the helper kept polling the disconnected node. Re-resolving the public input during the existing bounded poll fixed the assertion; typing immediately afterward edits the duplicate. A forced-remount red/green receipt is at `/tmp/frontend-placement-focus-poll-red-confirmed.log` and `/tmp/frontend-placement-focus-poll-green.log`. No runtime focus behavior was changed.

## Explicit skips and remaining prerequisites

The maintained run retained 60 explicit skips in the merchant/artwork stage and 2 in the storefront stage. These are environment-gated checks, not filtered failures:

- 37 database-backed integration cases require a PostgreSQL `DATABASE_URL`.
- 15 approved customer-preview interaction cases require `INSIGNIA_CUSTOMER_PREVIEW_ORIGIN`.
- 8 screenshot/gallery captures require explicit opt-ins: `INSIGNIA_CAPTURE_HOME_GALLERY`, `INSIGNIA_CAPTURE_POPUPS`, `INSIGNIA_CAPTURE_METHOD_POPUP_GALLERY`, `INSIGNIA_CAPTURE_POPUP_GALLERY`, `INSIGNIA_SETTINGS_GALLERY`, `INSIGNIA_SETTINGS_HUB_GALLERY`, and `INSIGNIA_STOREFRONT_GALLERY`.
- The two storefront skips require, respectively, a real database URL and a configured production Functions runner (`INSIGNIA_FUNCTION_RUNNER`).

No live Shopify write, production publish, or purchase qualification was performed by this local verification. Those native prerequisites remain outstanding.

The separate static Polaris presentation inspector still reports 41 messages across 26 unique file/rule/tag findings, including a structural `section.tabIndex` finding. These are known presentation findings for a planned UI review; they were not whitelisted or weakened here. This receipt does not claim that the full boundary suite is green.

## Remaining work

No baseline-repair work remains. The separate static Polaris findings and native prerequisites above remain open for their planned UI review and environment-enabled runs. The maintained `test:frontend` result does not clear those gates.
