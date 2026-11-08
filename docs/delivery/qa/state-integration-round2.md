# State integration review — round 2

Date: 2026-11-08
Scope: read-only review of the selected editor and customer Designer state paths, `docs/delivery/qa/state-cases.json`, the accepted preview adapters, the production mapping, and existing browser/runtime checks. No app, test, issue-register, or provider data was changed.

## Findings

### CUS-16: live artwork-expiry path lacks a selected-Designer integration assertion

**Classification: coverage gap, not a reproduced implementation defect.** The reducer mapping is present in source. The missing check is the complete production-port-to-frame-to-reducer path, including preservation of a non-default production choice.

- `createDesignerRuntime.renew()` blanks the expired URL and maps only 403/404/410 to `artwork-unavailable` at [runtime.ts](/Users/pc/Development/Insignia/insignia-ui-audit-2026-11-08/frontend/designer/src/runtime.ts:109).
- The production host catches the renewal result and forwards only 403/404/410/422 at [frame-host.ts](/Users/pc/Development/Insignia/insignia-ui-audit-2026-11-08/apps/storefront/src/designer/frame-host.ts:227); the iframe rebuilds the same status allowlist before rejecting the request at [frame.tsx](/Users/pc/Development/Insignia/insignia-ui-audit-2026-11-08/apps/storefront/src/designer/frame.tsx:252). The reducer removes the unavailable artwork while retaining the other designer state at [designer-state.ts](/Users/pc/Development/Insignia/insignia-ui-audit-2026-11-08/frontend/designer/src/designer-state.ts:242).
- The direct runtime check covers successful renewal and a synthetic 410, but its terminal assertion checks artwork and print preservation only; it does not seed/assert a production option or traverse the production frame bridge ([runtime-check.mts](/Users/pc/Development/Insignia/insignia-ui-audit-2026-11-08/frontend/designer/scripts/runtime-check.mts:892)). The buyer browser check at [buyer-browser.test.mts](/Users/pc/Development/Insignia/insignia-ui-audit-2026-11-08/apps/storefront/test/buyer-browser.test.mts:1645) renews a garment photo after a config refresh, not a selected customer's uploaded artwork. The separate artwork viewer renewal check in [customer-artwork-browser.test.mts](/Users/pc/Development/Insignia/insignia-ui-audit-2026-11-08/apps/storefront/test/customer-artwork-browser.test.mts:219) does not exercise the Designer reducer.

**Minimal repro to add to the existing buyer browser fixture:** seed an artwork with an expiring preview and a non-default production choice, expire that preview, then make the production renew endpoint return 410 (parameterize 403/404 if useful). Assert that the stale URL is no longer used, only the terminal artwork is removed, the production choice and quantity/design remain, and no quote acceptance or Shopify cart mutation occurs. A transient 503/timeout case should separately assert that no terminal-loss event is fabricated and that the user retains an explicit recovery path.

### CUS-12/Q1: reload during lost acceptance is not covered by the same-page retry test

**Classification: known-finding coverage extension; not registered as a separate issue.** `CUS-12` already names Q1, which covers decline-versus-unknown recovery. The current browser test exercises a lost acknowledgement and exact retry only while the same frame remains alive.

- The attempt identity is allocated in the `createDesignerRuntime` closure ([runtime.ts](/Users/pc/Development/Insignia/insignia-ui-audit-2026-11-08/frontend/designer/src/runtime.ts:206)). The production quote/proposal maps and issuance guard are also local to one `createLiveDesignerPorts()` instance ([live-ports.ts](/Users/pc/Development/Insignia/insignia-ui-audit-2026-11-08/apps/storefront/src/designer/live-ports.ts:61)). The browser cart journal stores unresolved cart-mutation intent, which is written by `cart.apply` after acceptance returns; it does not persist the proposal ID or acceptance key ([buyer.ts](/Users/pc/Development/Insignia/insignia-ui-audit-2026-11-08/apps/storefront/src/buyer.ts:253), [live-ports.ts](/Users/pc/Development/Insignia/insignia-ui-audit-2026-11-08/apps/storefront/src/designer/live-ports.ts:345)).
- The existing lost-ack browser test verifies identical proposal/key on an in-frame retry and then a new key after changed terms ([buyer-browser.test.mts](/Users/pc/Development/Insignia/insignia-ui-audit-2026-11-08/apps/storefront/test/buyer-browser.test.mts:1047)). Its reload coverage elsewhere tests explicit repair custody, not reload between an ambiguous acceptance and retry.

Extend that test by forcing acceptance to commit server-side and lose its response, then reloading before retry. Assert the original proposal/key is reconciled or explicitly held before any replacement proposal/key is allocated. This is a source-derived risk/coverage question; this round did not reproduce a duplicate accepted quote or establish the backend's recovery behavior after document reload.

## Demo versus production contract checks

- The local Designer adapter is explicitly in-memory and returns `local-preview`; it does not model authenticated status errors or durable quote recovery ([local-runtime.ts](/Users/pc/Development/Insignia/insignia-ui-audit-2026-11-08/frontend/designer/src/demo/local-runtime.ts:68)). It remains useful for reducer and interaction checks, but is not an oracle for production error delivery.
- For CUS-16, the host/iframe production bridge carries a deliberately bounded HTTP status set. The current direct runtime test bypasses that bridge, so its passing 410 assertion does not establish the end-to-end mapping.
- The editor demo passes its captured revision into `publishPlacementPreviewProduct` ([placement-workflow-preview.tsx](/Users/pc/Development/Insignia/insignia-ui-audit-2026-11-08/frontend/admin/examples/admin/support/placement-workflow-preview.tsx:37)); the production container's `publish` callback accepts only `product` ([SelectedProductContainer.tsx](/Users/pc/Development/Insignia/insignia-ui-audit-2026-11-08/frontend/admin/src/islands/SelectedProductContainer.tsx:449)). Production still uses the selected client's CAS base and turns a changed draft observation into `remote === 'conflict'`, which blocks publication; this signature difference alone did not establish a regression in this review.

## Existing test coverage and execution

- The state-case document contains 73 planned cases, all recorded as `not-run`. It is a state checklist, not an automated execution ledger.
- Focused admin checks on `/tmp/insignia-qa-clean-20261108` under Node **v24.21.0** completed **46/46 passing, 0 skipped**: `selected-product-lifecycle-browser.test.mts`, `session-request.test.mts`, and `selected-method-load-cancellation-browser.test.mts`. They cover selected Methods route retirement, editor CAS conflict, 401/403 authorization loss, pending-write reconciliation, and request timeout/token retry paths.
- `frontend/designer/scripts/runtime-check.mts` under the same Node version completed **32/32 passing, 0 skipped**. This includes the direct runtime renewal/410 case above, reducer stale-result guards, commit cancellation, and exact in-memory retry identity.
- A combined customer browser attempt was not a valid pass/fail run: Vite dependency scanning could not resolve `react/jsx-dev-runtime` from `frontend/designer/scripts/fixtures/customer-language-probe.tsx`; the affected buyer/frame suites then failed to load their fixture assets. No customer-browser pass count is claimed. No dependencies were installed or edited.
- Buyer integration fixtures include 409/503/500 cases and a 404 restore case, but no live-adapter 401 or 403 response assertion was found in the inspected selected-Designer browser fixtures. Admin's separate authorization tests do cover 401/403, which does not substitute for customer bridge coverage.

## Test-method blind spots

1. Direct reducer/runtime checks prove the core transition given an injected port result; they do not prove production adapter errors survive `postMessage` serialization and reach that reducer.
2. The accepted local demo intentionally has no API/authentication/Shopify boundary. Integrated regression checks should use the real live-port composition with controlled service responses and assert visible state plus absence of cart writes.
3. `state-cases.json` currently records no execution statuses beyond `not-run`, so it cannot distinguish implemented, automated, native-observed, and still-unexercised paths. Keep source inspection, controlled browser reproduction, and native observations as separate evidence labels.
