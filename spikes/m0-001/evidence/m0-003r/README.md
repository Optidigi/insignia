# M0-003R native outcome continuation — run evidence

Run opened 25 September 2026 UTC under the owner's delegated M0-003R version 1.1 envelope. Capture mode is `NATIVE_UI_PLUS_PUBLIC_API_RECEIPTS`; native request-body capture is unavailable and optional for this run. This record preserves M0-003 and M0-002 receipts without editing them. The historical intended-one/actual-two fulfillment remains cause-undetermined.

## Predecessor and current authority

The principal's attributed external review of PR #5 approved base/effective merge base `895aef65179267a9944c57c40478eeb704a8b65a` and head `afce3b668240d3a6b87741c173d1be0547ef4821`; Actions run `36079496495` succeeded on that head. The owner delegated its normal merge and this bounded run. GitHub reports merge `a9398ebf8d069f3556c0b359be1372d94d45f82e` with exactly those two parents; fetched remote `main` matched before branching. No native GitHub approval was posted. The new branch is `spike/m0-003r-native-outcome`.

## Live preconditions

The [direct app-specific Shopify CLI read](readiness.json) used API `2026-07` and the existing `insignia` OAuth client on `insignia-staging.myshopify.com`. The [shop/product/stock read](baseline.json), [protected order read](protected-order.json), and [protected fulfillment read](protected-fulfillment.json) are JSON-equal to the corresponding M0-003 receipts. The only order returned by a paginated [current order inventory read](order-inventory.json) is protected test order `#1001`; `hasNextPage` is false. Current protected order and fulfillment retain their exact IDs, line quantities and Shop location; no M0-003R order exists. The fixture is ARCHIVED; both catalog variants are USD 20, tracked, shipping-required, DENY; no Cart Transform is active. Shop-location Small stock is available/committed/on-hand `8/2/10`, Medium `10/2/12`. An unauthenticated product request still ends at `/password`.

The shared T3 Admin browser opened authenticated at the named staging store. Its Payments page (`/store/insignia-staging/settings/payments`) displayed: “Activate the test payment provider, or set your payment provider to test mode.” No Bogus provider was visible. Historical order `#1001` has `paymentGatewayNames: ["bogus"]`, but that proves only prior use. **A currently active test-only payment route is not yet established.** The owner has been asked to activate only the staging test gateway. No checkout will be submitted until the active test-only route is directly verified. No staging mutation has occurred in this run.

The [narrow app-version projection](versions-before.json) shows `insignia-2` active and `insignia-1` inactive. It omits unrelated account metadata from the CLI response. No version release was attempted.

Shopify's [current partial-fulfillment instructions](https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/single-fulfillment) say to enter the desired item quantities in the native Admin form. This supports checking effective numeric inputs rather than assuming an unchecked appearance excludes a positive quantity. It does not identify the cause of #1001's earlier discrepancy.

## Execution boundary and current matrix

This single authorized package proceeds in dependency order: establish the test gateway and activate only the fixture/owned preview; run C's exact cart, order and native one-unit check; run R only if C is exact; run R's remaining lifecycle and optional B only if both partial results are exact; clean only owned activation, verify receipts, review the fixed diff and open one PR. Independent offline evidence and instruction work may continue while the gateway is unavailable.

| Case | Current result | Evidence / next dependency |
|---|---|---|
| C plain duplicate-variant control | NOT_RUN | Requires verified active test gateway, fixture activation, exact cart/checkout and native control checks. |
| R mixed expanded/plain candidate | NOT_RUN_DEPENDENT | Begins only after C exact native partial result. |
| Conditional R remainder/refunds and B cancellation | NOT_RUN_DEPENDENT | Begins only after C and R exact partial results. |
| Native request capture | UNAVAILABLE_NOT_REQUIRED_FOR_THIS_TEST | Fresh native form/line/quantity projections and direct post-action receipts remain mandatory. |
| Historical root cause | UNDETERMINED | The old form already displayed “2 items selected”; no old request body was retained. |
| G1 / other gates | IN_PROGRESS / NOT_RUN | Principal adjudication remains required. |

The CLI smoke and baseline are read-only. `./scripts/check-local.sh` passed under the pinned Rust 1.98.1 and explicit Zig linker: format/clippy, two native Rust tests, 11 Wasm fixtures, seven Python tests, both historical receipt checkers and both historical manifests. The native multi-agent smoke with explicit `gpt-6-sol`/`high`, read-only sandbox and apps/plugins off did not spawn a child: it reported `no thread with id` twice. It read AGENTS and the pinned code-review skill directly; the project uses the previously verified restricted sequential-review fallback. This is a runtime limitation, not evidence that a child was safely constrained.

No app preview, transform, publication, inventory adjustment, order, fulfillment, refund, cancellation, distribution or deployment action has occurred. Order #1001 and its fulfillment are read-only. The app installation, nine scopes, fixture stock and storefront password are preserved.
