# M0-003 — isolate native fulfillment selection; conditionally finish G1 development evidence

Principal-issued: 25 September 2026. Orchestrator: sol-6-high, verified explicit `gpt-6-sol`/`high` route.

## Outcome and start boundary

Determine whether M0-002's intended-one/actual-two fulfillment arose in browser automation, control semantics/projection, Shopify's native UI, or the fulfillment processing path. Preserve the failing case. Test the same price-materialization mechanism, not an alternative implementation.

PR #4 is principal-approved only as an evidence checkpoint at base/effective merge base `523efa4e0248cb2c64ed846e0b37af0067f01d9c`, head `1bfe9a13357b9c49042627f68fcca9daec93b1f5`. Start repository changes on a new branch from actual merged remote main. A merge by the agent requires the owner's explicit one-PR delegation. Keep the reviewed branch unchanged. Read-only/scratch diagnosis may continue while the maintainer merges; staging mutations require the owner's explicit permission for this continuation.

Read AGENTS, ledger, operating model, delivery state, the accompanying principal verdict, the original M0-002 prompt, G1 record, and the M0-002 receipt index/manifest. Use the pinned diagnosing-bugs skill for a falsifiable reproduction, writing-for-agents for these records, TDD for capture/guard code, and a fresh read-only code review. One writer and one serialized staging operator; no new preflight, model-attestation loop, parallel store writers, or framework installation.

Keep the implementation plan, decision ledger, Function source, Function schema, price operation and historical M0-001/M0-002 receipts unchanged. New collector/tests/runbook changes stay under `spikes/m0-001/`, plus the existing workflow and narrow delivery pointers. New observations belong in `evidence/m0-003/`. On the continuation branch copy this prompt and the attributed principal review under `docs/delivery/`, and update AGENTS/current-state routing to M0-003. Append an adjudication to G1; never overwrite a historical failure with a later pass.

## 1. Resource and mutation envelope

| Resource | Established identity |
|---|---|
| Rewrite | `Optidigi/insignia`, repository ID `1386102402` |
| Organization / app | `212732011` / existing `insignia` |
| OAuth client | `942e6668fd1177524c0fc48b104b0ac3` |
| Test shop | `insignia-staging.myshopify.com`, shop `gid://shopify/Shop/78935261342`, Basic development store, last observed USD |
| Installation | `gid://shopify/AppInstallation/781307904158`; verify current state |
| Location | Shop location, `gid://shopify/Location/89465290910` |
| Owned product | `gid://shopify/Product/10294344482974` |
| Small | variant `gid://shopify/ProductVariant/50529053343902`, inventory item `gid://shopify/InventoryItem/52644294131870`, SKU `INS-M0-001-BLK-S` |
| Medium | variant `gid://shopify/ProductVariant/50529054163102`, inventory item `gid://shopify/InventoryItem/52644294951070`, SKU `INS-M0-001-BLK-M` |
| Function / marker | `m0-001-same-variant`; `_insignia_m0_001`; values starting `m0-001:` |
| Protected historical order | `#1001`, `gid://shopify/Order/7184619962526` |
| Protected historical fulfillment | `gid://shopify/Fulfillment/6511606562974` |

**Order #1001 and its fulfillment are read-only throughout this slice.** Do not cancel/undo/complete/refund/restock them or use them as a clean retest. Preserve the two Small and two Medium commitments. The previous run's transform is deleted; never reuse its resource ID as an active transform.

Once the owner sends the companion authorization, permitted staging actions are: restore/publish only the existing fixture; run the existing app's development preview and one owned allowlisted transform; use dedicated synthetic carts; create at most **three successful new Bogus test orders and thirteen total purchased units** as specified below; perform native fulfillment/refund/cancellation/restock only on those new orders; and clean up only owned resources. No new stock seed or manual inventory adjustment is authorized. Use verified existing uncommitted fixture stock and release/restock new control orders through native operations as needed. Reconcile rather than overwrite unexpected state.

Retain the existing nine actual scopes. No extra write-order, fulfillment-write, publication, customer, billing or all-orders scopes. Use native Admin for write operations and the existing app for supported narrow reads. No independent fulfillmentCreate mutation or undocumented internal API replay; observe the native UI request instead. No new app/store, distribution selection, released deploy/version, real payment, paid label, physical shipment, live gateway/account change, password removal, overselling, requiresComponents change or unrelated resource mutation. Keep the fixture catalog price USD 20 and marked price USD 30.

The existing authenticated browser and designated location are already supplied. Verify live access; ask only for an actually expired session or a genuinely additional permission. A host-maintenance or broader access change is not implied.

**Complete when:** identities, current stock, order #1001 baseline, app scopes, publication/password/test-payment and absence of unexpected conflicting transforms are recorded, and the next action's exact permitted resources are known.

## 2. Forensics before new orders

Recover the original native fulfillment request and automation steps from existing local browser/session logs if retained. Inspect narrowly and privately; export only sanitized action/line/quantity projections. If unavailable, record UNAVAILABLE. Do not reconstruct a request and label it captured.

Read the original selection projection alongside actual order/FulfillmentOrder/FulfillmentOrderLineItem/LineItemGroup mapping. It records plain Small selected=false, quantity=1; marked Small selected=true, quantity=1; and selectionLabel='2 items selected'. That is a pre-submit discrepancy, not proof that the server received one unit. The original actual fulfillment contains two distinct order-line IDs; its inventory delta matches two shipments.

Write a small hypothesis table with an observable discriminator, not a premature verdict:

- Projection/locator error, or an automation edit that did not commit into native UI state.
- Checkbox/quantity semantics or stale native form state: a retained plain quantity contributes despite the reported checkbox.
- Native Admin same-variant or bundle/group row-selection defect.
- A correct one-target request was sent but the fulfillment processing path created extra line quantity.

The first two are inexpensive to test; their position is a test priority, not a claim of blame. Review Shopify's documented quantity-based partial-fulfillment flow. Distinguish IDs at every layer; SKU and variant IDs are not sufficient to target one of two lines sharing a variant.

Before touching #1001's form, install a read-only/abort guard on that page or stay on read-only views. Prefer historical logs and new control orders; do not accidentally submit the old order while diagnosing.

**Complete when:** available historical facts and missing evidence are separated, hypotheses have falsifiable checks, and protected order #1001 has not changed.

## 3. Capture and prevent another known-inconsistent submission

Build the minimal deterministic capture/guard before another fulfillment mutation. Use ordinary browser locator interactions and native controls, with real input/change/blur behavior. DOM inspection may read; it may not assign DOM properties, alter framework state, monkeypatch native behavior, or manually rewrite outgoing requests to achieve success.

Capture, with UTC times and stable line mappings:

- Target intent as the expected multiset of line identities and quantities.
- A native screenshot cropped/redacted to the synthetic item/selection area and a reproducible DOM projection. Record row scope, accessible name, actual checked/aria-checked/indeterminate/disabled state where applicable, effective numeric value, hidden/disabled controls relevant to submission, and the aggregate selected count. Distinguish real properties from default attributes.
- A sanitized native request projection: actual operation, relevant order/fulfillment-order identifiers, line/group IDs and quantities, and whether it was sent or locally aborted. Native Admin may use a different format from the public API; map observed semantics rather than inventing its schema.
- Direct response success/userErrors and subsequent public order/fulfillment/inventory receipts.

Keep credentials, cookies, CSRF data, checkout/cart tokens, addresses, emails and raw authenticated HARs out of Git and chat. Capture only the operation in this authorized dedicated page. Retain a collector source/provenance and deterministic redaction method; a handwritten summary is not a direct request receipt.

**Pre-submit invariant:** intend one target unit, effective quantities/selection must reconcile to exactly that one target, and aggregate native count must agree. On the ordinary quantity-based flow, set non-target quantities to zero through supported UI controls and commit the edit; do not merely assume unchecking excludes a still-positive input. If this native UI has different semantics, establish them in a no-mutation probe first. Take another snapshot after state settles. If quantities, IDs, controls or aggregate disagree, do not send the fulfillment request.

Where the browser supports request interception, a scoped **abort-only dry run** is permitted to inspect the native payload before it reaches Shopify. Label it REQUEST_ABORTED_LOCALLY, never a Shopify success/failure. A submit-time safety guard may reject a payload with an unexpected target/quantity. It must not rewrite it, synthesize an internal request, or auto-retry an uncertain mutation. If the payload cannot be safely recognized and correlated, stop mutation and report that concrete capture limit. Mere DOM-count agreement is not a replacement for the outgoing-request evidence sought here.

Implement a small fail-closed local test for the recorded selected-one/summary-two input and a passing one-target/summary-one control. Assert exact sets, not just aggregate totals. Preserve the existing historical failure in its checker. Wire the read-only historical receipt checker, safe manifest verification (length, path and SHA-256), and new guard/receipt tests into the existing local/CI check path. A consistency check must not interpret historical FAIL as an overall gate pass. Local helpers must not mutate staging or fetch credentials in CI.

**Complete when:** the capture path is ready, the recorded inconsistent selection is rejected by a test, and a coherent control passes without store mutation.

## 4. Controlled native comparison

Use dedicated synthetic carts and the verified Bogus gateway only. Carts with unrelated merchandise are not cleared. Check IDs, quantities and prices before Pay now; suppression of avoidable notifications remains required. Capture all relevant inventory states/locations and order mappings before and after each actual mutation, with bounded polling for settled state.

Reuse the existing stock baseline, including #1001's four commitments. Last recorded Small available/committed/on_hand is 8/2/10; Medium is 10/2/12. These are starting observations to verify, not reset targets. Control-order restoration may free stock for the candidate. Count new-order deltas separately from #1001.

### C — ordinary duplicate-variant control (four units, USD 80 merchandise)

Create 3 Small target units and 1 Small bystander as two distinct plain lines using inert differing diagnostic properties. Neither uses a recognized `_insignia_m0_001` marker; confirm no transform operations and no LineItemGroup. Do not change the variant/SKU or catalog price to separate them.

Using the documented native quantity flow, intend one target unit and zero bystander. Apply the pre-submit guard and capture actual native request/response. A proper one-target result must leave the bystander untouched. A generic failure here undermines an expansion-specific explanation; investigate the control before proceeding.

If the control completes exactly as intended, capture it and unwind only this new control order through clearly reconciled native refund/restock/cancellation, restoring its own stock effect. This is control cleanup, not the marked-item refund acceptance test. Any ambiguity or mismatch stops dependent mutations; do not compensate with manual stock.

### R — same mixed expanded/plain candidate (six units, USD 170 merchandise)

Only after a coherent control flow is established, reproduce 3 marked Small + 2 marked Medium + 1 plain Small with new run-specific markers. Reuse the unchanged same-variant expansion and fixed prices. Capture cart output, actual Function logs, checkout and accepted order with real/group/FOL identities.

Intend exactly one marked Small and zero other units. Use the same native interaction/capture/guard established by C. Compare target intent, effective native form, actual outgoing native payload and actual fulfilled lines. Examine controls sharing SKU/variant without using positional assumptions to identify a row.

A consistent form and one-target request followed by an extra fulfilled line is substantially stronger server/group evidence. A payload already containing the bystander localizes the discrepancy before fulfillment processing. A capture/selector error corrected by ordinary native interaction is a harness finding; retain the original failure and show the correction with a positive control. A control pass and persistent candidate-only UI failure is a merchant-experience problem even if an API workaround might succeed.

If another mismatch occurs, stop dependent lifecycle steps, preserve new-order state and return the smallest reproducer. Do not perform a third checkout merely to fill the matrix. Read-only debugging and owned-transform/publication cleanup remain permitted.

### Conditional completion, not a separate automatic phase

Only if both C and R demonstrate coherent native selection and R's exact one-target fulfillment succeeds, continue R through the remaining previously planned development checks: native remainder fulfillment; native calculated refund of one marked Small with restock; remainder refund without restock; and, if still within the budget, order B (3 marked Small, USD 90 merchandise) followed by entirely-unfulfilled native cancellation/refund/restock.

Total new successful orders are C, R and optional B: at most three and thirteen purchased units. No mutation to #1001. Verify native calculated refund economics before submit; never type a convenient amount to mask a wrong native basis. A native refund selector discrepancy gets the same guard and stop treatment. Separate refunded money, on-hand restock and unfulfilled commitment release; do not double-count parents/groups as physical stock.

Explain a successful rerun precisely. Without a captured original request or a reproducible old harness error, report that the old cause remains unproven even if the corrected native procedure works. Do not claim causality merely because a later run is green.

**Complete when:** C and R have evidence-based PASS/FAIL/BLOCKED/NOT_RUN outcomes, the discrepancy is localized as far as the evidence supports, and any conditional remaining lifecycle rows have honest outcomes. A stable reproducer or a blocked pre-submit guard is an acceptable result, not pressure to force checkout/fulfillment.

## 5. Cleanup and single handoff

Delete only this run's owned transform, stop its own dev preview, and unpublish/archive the fixture. Preserve password protection, app installation, allowed scopes and unrelated apps/versions. Retain direct post-cleanup receipts. No manual stock cleanup adjustments are authorized in this diagnostic slice. Residual stock and newly failed test orders may remain on the archived fixture and must be listed; no undisclosed correction or automatic clearing of #1001 commitments.

Retain historical M0-002 files and hashes. Add M0-003 request/response/DOM mappings, test intent and operation IDs, capture/aborted/sent status, actual outcomes, source/tool/Function versions, local Wasm hash, UTC times, redaction provenance, inventory deltas and remaining artifacts. Record missing original raw evidence honestly. Include exact request-to-FulfillmentOrderLineItem-to-LineItem correspondence where observable, not merely variant/SKU totals.

Run the existing Function suite, historical/new receipt and manifest checks, and fresh sequential read-only review at fixed base/head. Report which checks ran locally and in CI. Update G1 with the principal-approved prior evidence and the new candidate observation; do not mark overall G1 PASS. Public-app/ordinary non-Plus qualification, general authorization, rounding and G2–G8 are not demonstrated by these controlled tests.

Return one focused PR, exact refs, a hypothesis/discriminator result table, the strongest supported conclusion, and residue list. An unresolved or confirmed native merchant-operations defect keeps dependent work blocked and returns to principal review. An API-only workaround, prohibiting plain/customized coexistence, a synthetic fee product or switching price operation is not authorized.

**Stop at principal review.** The owner delegation covers only the reviewed PR #4 merge, not this new PR. M1 and G2–G8 remain unauthorized.

## Primary diagnostic references

- Native quantity-based partial fulfillment: https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/single-fulfillment
- Public fulfillment object/line selection semantics: https://shopify.dev/docs/api/admin-graphql/latest/mutations/fulfillmentCreate
- FulfillmentOrderLineItem selection examples: https://shopify.dev/docs/apps/build/orders-fulfillment/order-management-apps/build-fulfillment-solutions
- Same-variant cart line identity: https://shopify.dev/docs/api/ajax/reference/cart

Use current primary references and the pinned schema for actual reads. These references do not attest the incident or define the private native Admin request format.
