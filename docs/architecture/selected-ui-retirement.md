# Selected UI retirement

7 November 2026. The owner authorized removal after native replacement qualification (§16 of the implementation plan). [PR240 activation evidence](../delivery/evidence/technical-merchant-completion/native-cart-activation-2026-11-07.json) records the live selected Designer, exact quote, automatic Shopify cart navigation and restored design. The earlier single paid test order#1005 remains the order/history proof; no second checkout was performed.

## Source changes

| Retired consumer | Replacement / retained owner |
| --- | --- |
| `apps/storefront/src/customizer.tsx` and its stylesheet | `apps/storefront/src/designer/controller.ts` and selected Designer frame; no fallback |
| Standalone `insignia-artwork-upload` element and old guest upload screens | Selected Designer artwork ports and secure post-order selected artwork mode |
| `frontend/admin/src/islands/MerchantConfigEditor.tsx`, its unused workflow/transaction and placement stylesheet | `SelectedProductEditor.tsx`, authenticated `SelectedProductContainer.tsx` and `selected-product-client.ts` |
| Name-only `MethodLibrary.tsx` and its unused workflow/transaction | `SelectedMethods.tsx`, `MethodsContainer.tsx` and current catalogue transport |
| Duplicate old `apps/web/src/islands` purchase, historical preview, billing, settings, storefront setup/readiness screens and unused Save Bar/stylesheet | Actual routes already compose the selected `frontend/admin/src` screens; privacy retains its used components |
| Old configurator-only formatting, request lane, step controls, default-artwork and scene adapter | Selected runtime/reducers, exact quote formatter and retained canonical geometry renderer |
| Isolated renderer routes importing the old editors | Selected containers, replaced only by explicit local demo adapters when that scenario is enabled |

The two publication-state classifications used by the selected container/client moved unchanged to `frontend/admin/src/islands/publication-state.ts`. Selected visual markup, styles and reducers remain unchanged. Current upload inspection/API services, selected journal/custody logic, publication/reconciliation authority, privacy/tenant checks, historical readers and immutable accepted terms remain in place. No schema, economic, scope or permission change is part of retirement.

## Regression ownership

Tests specific to the removed standalone upload event or old configurator-only helpers retire with those contracts. Shared upload capability, inspection, expiry/retry and permission-loss checks remain under `apps/web/test/artwork`; selected upload and private request behavior remain in the storefront browser suites. Selected geometry, independent placements, retained production choices, current price review, cart recovery and completion checks remain in the selected storefront/Designer suites.

The backend-to-renderer geometry test now calls the retained canonical renderer directly. It retains its exact selected-variant image, fallback/missing image, placement/artwork bounds and unchanged stored-history assertions. This removes a test dependency on the old UI adapter without weakening the reader contract. Existing selected publication/browser tests retain dirty edits, conflicts, authorization loss and original-request recovery checks.

## Deliberately retained sources

- Shared selected components beside `frontend/admin/examples/admin/support` still have production consumers; the frontend guide identifies that ownership. Explicit demo adapters remain useful isolated examples.
- Legacy-named catalogue photos/fixtures still supply selected examples and browser tests. Their names record provenance; they do not enable an old UI or import production history.
- `frontend/docs/notes`, pinned research citations, applied migrations, Function identities/binaries and historical release bindings/receipts remain historical evidence.
- Active infrastructure identities, dated configuration mounts and protected installation records are operational state, not obsolete presentation.

## Local qualification

The workspace build and all48 strict compiler projects pass. Frontend checks pass76 admin,131 Designer,22 localization and24 visualizer cases. The final web suite passes340 cases with71 existing database opt-ins skipped; the storefront suite passes69 with two existing database/Function opt-ins skipped. No skipped result is claimed as native qualification. CI retains its complete database/runtime gates.

The real isolated preview host also loaded both Methods and product configuration in read-only normal and interactive demo scenarios (four browser checks); command requests still returned405. Source/dependency/Polaris boundaries, secret checks, style and the13 status-document plus three theme-artifact regressions pass. A pre-transfer web failure exposed the removed scene adapter consumer; the retained canonical-renderer check now passes with its original factual assertions. PR241 final-head CI and independent review subsequently passed; its merge/tree and preparation are recorded in current state.

## Deployment boundary

PR240 remains the deployed native baseline. This source cleanup changes the shipped bootstrap graph by removing the standalone element. PR241 CI is qualified. Corrected inactive candidate1199166783489 and its21-version binding are prepared; matching-profile final-head CI, runtime promotion and native activation/readback remain required before claiming the cleanup deployed. Candidate1199165767681 used the local-preview identity and remains NEVER_RELEASE. Never edit an old release inventory to admit the new candidate. Owner visual acceptance, received-message email authentication and native EUR qualification remain separately tracked in [current state](../delivery/state.md).
