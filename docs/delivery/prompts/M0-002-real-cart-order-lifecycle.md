# M0-002 — finish the real development-store cart/order lifecycle

Principal-issued: 25 September 2026. Local orchestrator: sol-6-high.

## Outcome, authority and start condition

Use the reviewed M0-001 Function to answer the remaining empirical question: can the one-child, same-real-variant expansion carry an actual Online Store purchase through exact merchandise pricing, real quantities, native fulfillment, refund and restock?

The principal approves PR #3 as a partial harness/activation checkpoint at base/effective merge base `0f87be149247ea6720984f2cefdc557423001661`, head `a64f5939f9f9871e274868d4d9c10ed3dbbd890b`. G1 is not passed. Start repository changes on a new branch from actual remote main after that exact PR has been merged normally. An agent merge requires the owner's explicit delegation; the companion owner message grants only PR #3's merge and this bounded staging continuation when sent by the owner. Attachments alone are not authority to merge.

This prompt is the next authorized implementation slice, not another preflight. It retains the prior M0-001 staging envelope and adds the already supplied location designation. The owner reports that the existing shared browser is signed in to staging Admin and at the fixture product. Verify live access; do not ask for another resource designation, password, token or code. A genuinely expired session may require the owner to complete login in that same browser.

Read AGENTS, ledger, delivery state, operating model, the companion principal review, the original M0-001 prompt, `spikes/evidence/G1.md`, and the existing fixture manifest/code/tests. Use the pinned writing-for-agents, tdd, diagnosing-bugs and code-review skills when their tasks arise. Apply the verified explicit `gpt-6-sol`/`high` launches, bounded writer and fresh read-only reviewer; use the known Rust/linker environment. No model-attestation or general tool-installation loop. One writer and one serialized staging operator; no parallel resource mutation.

Keep the plan and decision ledger unchanged. Update operational routing to M0-002 on the new branch, such as `spike/m0-002-real-lifecycle`. Reuse the harness under `spikes/m0-001/`; do not create a second scaffold. Preserve old evidence as history. New receipts belong under `spikes/m0-001/evidence/m0-002/`, with a new manifest and an appended/current summary in the existing G1 record.

## 1. Exact resources and permission boundary

| Resource | Established identity |
|---|---|
| Rewrite | `Optidigi/insignia`, repository ID `1386102402` |
| Organization / app | `212732011` / existing `insignia` |
| OAuth client ID | `942e6668fd1177524c0fc48b104b0ac3` |
| Staging shop | `insignia-staging.myshopify.com`, `gid://shopify/Shop/78935261342`; Basic dev; last observed USD |
| Existing installation | `gid://shopify/AppInstallation/781307904158`; re-read, do not blindly assume unchanged |
| Designated stock/fulfillment/restock location | **Shop location**, `gid://shopify/Location/89465290910` |
| Owned product | `gid://shopify/Product/10294344482974`; handle `insignia-m0-001-fixture-20260924` |
| Black/Small | Variant `50529053343902`; inventory item `52644294131870`; SKU `INS-M0-001-BLK-S` |
| Black/Medium | Variant `50529054163102`; inventory item `52644294951070`; SKU `INS-M0-001-BLK-M` |
| Function / marker | handle `m0-001-same-variant`; attribute `_insignia_m0_001`; value prefix `m0-001:` |

Variant/inventory numbers above are the suffixes of their normal Shopify GIDs. Retain full identifiers in API evidence. The earlier transform `gid://shopify/CartTransform/143098014` was deleted. A new activation gets a new ID; record the returned owned resource rather than reusing that deleted ID.

Permitted work is limited to this shop/app and owned fixtures: development preview; minimum scopes/reauthorization within the original ceiling; owned transform activation; fixture publication/stock; synthetic Online Store carts and at most two successful test orders; native partial/remainder fulfillment, refund/restock or cancellation; and cleanup. The existing approved test-only payment setup remains permitted. No live account/gateway changes, fees, real payment credentials, real shipping or paid labels.

Keep existing scope grants, adding only `read_orders` and `read_merchant_managed_fulfillment_orders` when their planned queries require them, plus required read counterparts within the original envelope. Use native Admin for publication, fulfillment and refunds. Do not add publication/fulfillment/refund write scopes merely for convenience; no read_customers, read_all_orders, billing or theme-write scopes. Re-read actual granted scopes through this app after any development reauthorization.

No new apps/stores, distribution selection, app deploy/released version, storefront password removal, store-plan change, unrelated product/order/location mutations, security-policy relaxation or broad credential collection. Do not switch location, remove another app's transform, enable overselling, change requiresComponents, or use another pricing mechanism to get a pass. Stop only the action requiring extra permission and finish independent permitted work.

**Complete when:** the current app/shop/fixture/location IDs, browser route, ownership and resource baseline are verified and recorded.

## 2. Prepare a buyable fixture and direct evidence capture

Before mutation, take a narrow app-API snapshot of shop/currency, installation/scopes, existing visible transforms, product status/publication and both variants' price, tracking, shipping flag, inventory policy and location-level stock. Query all relevant fixture inventory levels, not only a filtered level that could conceal a second decrement. Reuse the shared Admin browser and follow its normal storefront preview/view route; a development store's password page is not a reason to disable protection. Keep cookie/session/password handling inside the authorized browser, never in chat, code, logs or exported evidence.

Start capture **before** activation and purchasing. Save queries/variables or browser-operation descriptions, API version, UTC timestamps, success/userErrors, correlations and direct result projections. Use narrow CLI output-file/GraphQL projections and redacted browser/Function outputs instead of reconstructing a transcript afterward. Distinguish direct captured output, deterministically redacted projection, UI screenshot and operator note. Hash saved artifacts, recording provenance; hashes do not make an operator note an API receipt. Keep only synthetic records and nonsecret fields in Git; exclude cart tokens/secret keys, cookies, authorization headers, customer/payment details and raw authenticated HARs. Preserve structural parent/component and line correlation data rather than filtering to only the expected child.

Through native Admin, restore the existing owned product to ACTIVE and make it available on the **staging Online Store only**. Leave the two ordinary variants at USD 20.00, tracked, shipping-required and inventory policy DENY. Confirm a real buyable storefront result; `ACTIVE` alone or an assumed product URL is insufficient.

At Shop location only, seed **12 available units of each owned variant** when its verified baseline is zero/uncommitted. Reconcile existing quantities if the state differs; do not overwrite unexpected reservations or another actor's work. Stock nowhere else. Record this as fixture setup, separate from inventory caused by orders. Verify the location can fulfill the fixture through the existing delivery configuration. Use existing safe shipping/delivery options; if checkout cannot offer one, record the concrete unmet setup rather than changing unrelated rates/profiles or switching locations.

Verify the existing supported test gateway before clicking any final payment button. The original envelope permits enabling a built-in test-only gateway on this confirmed dev store, with prior-state capture; no live payment/account modification. Use synthetic buyer details and a controlled non-customer email or test sink; suppress notifications where possible. If a suitable test-only route is unavailable, stop payment while completing cart evidence.

Run the existing local check script from frozen dependencies. Preserve the price operation and test hypothesis. Necessary additions are bounded receipt collectors, runbook/fixtures and the minimum app scope delta, not general infrastructure. Any Function behavior change needs a failing local test and a new source/build record; never substitute lineUpdate, a second child, a synthetic fee variant or catalog-price mutation. Record the fresh local Wasm hash and actual source commit; investigate unexplained divergence from the prior local hash without asserting an unavailable remote binary attestation.

Re-establish `app dev` only on the named staging store. Reconfirm the Function handle/ownership/schema and activate one owned transform with `blockOnFailure=true`. Capture creation and readback directly. The metafield must allowlist only the same two fixture variants at USD 30.00. If an unexpected existing transform or installation conflicts, do not delete/replace it. Preserve the error and isolate the conflict.

**Complete when:** the fixture is buyable with limited stock at the designated location, test payment is verified, and the exact Function/configuration is active with direct receipts.

## 3. Run the smallest decisive lifecycle matrix

Use actual Online Store Ajax cart calls in the authorized storefront browser, with locale-aware routes, and native checkout. Use current line keys to target cart edits where the same variant appears more than once; do not rely on variant ID alone. Do not clear an existing unrelated browser cart. Use a dedicated empty test cart/context or remove only owned fixture lines after explicit inspection. Correlation values still start `m0-001:` (for example `m0-001:m0-002-A-S`) so the unchanged Function recognizes them. They are fixture labels, not signed authorizations.

First capture the unmarked control, then marked quantity one/three, quantity changes and removal/re-addition. Confirm actual merchandise economics **before** paying. A correct Function output does not prove that Shopify used it; compare the actual cart/checkout. If a marked line remains USD 20, has the wrong variant or double quantity, stop the affected checkout and isolate that real failure. Do not pay merely to advance the checklist.

| Case | Expected evidence |
|---|---|
| Plain control | One unmarked Small costs USD 20.00; no customization operation on it. |
| Marked quantity 1 then 3 | USD 30.00 then USD 90.00 pre-discount merchandise; original variant; physical quantities 1 then 3, not squared. |
| Edit/remove/re-add | Re-read actual cart keys and Function output; exact prices/quantities remain stable without unintended duplicate expansion or merging. |
| Mixed cart / order A | 3 marked Small + 2 marked Medium + 1 plain Small: **USD 170.00 pre-discount merchandise**, 6 physical units (4 Small, 2 Medium). Preserve plain versus marked identity even for the same variant. |
| Checkout A | Actual Online Store checkout and test payment; capture order line/group/component IDs, original/current merchandise money, custom attributes, test/payment state, real variants/SKUs and fulfillment-order mapping. |
| Partial then remainder fulfillment A | Native partial fulfillment of one marked Small, then the remaining purchased units. Verify ordinary UI support and correct variants/quantities/locations; do not ship or buy labels. |
| Partial refund A with restock | Select one marked Small, use Shopify's native calculated refund and restock at Shop location. Preserve the calculated merchandise/tax/discount basis before submission. |
| Remainder refund A without restock | Refund the remaining eligible units using the native calculation; explicitly choose no restock and verify no inventory increase from that refund. |
| Repeat checkout B then unfulfilled cancellation/refund/restock | 3 marked Small at USD 90.00 pre-discount merchandise, same real variant, new cart/order. Cancel/refund while unfulfilled through the native flow with appropriate restock. Verify one reversal/release, no double restock. |

Taxes/shipping/actual discounts are separate from the fixed merchandise expectation. Capture each rather than assuming a paid-order total equals the pre-discount subtotal. Do not manually enter USD 30 to conceal a different native refundable amount. When real discounts/taxes alter a native refund, reconcile to the actual order's economics; do not expand into G4 or change store-wide tax/discount policies.

Capture available, committed and on_hand per fixture variant/location before checkout, after accepted order, after partial/remainder fulfillment, after each refund/cancellation and at final settled state. Interpret reservations/holds explicitly and poll boundedly for asynchronous state, retaining intermediate observations. An unfulfilled paid order normally moves units out of available into committed without shipping them off hand; fulfillment clears commitments and moves stock off hand, not a second available decrement. A fulfilled-item restock and release of an unfulfilled commitment have different expected transitions. Use these distinctions to detect double counting, not to force results by manual adjustment.

For the zero-unavailable example with the 12/12 setup: after A is fulfilled, Small on_hand/available should be 8 and Medium 10; one Small restock gives 9/10; refunding the remainder without restock leaves 9/10. B temporarily commits three Small, then its unfulfilled cancellation/restock should return to the pre-B 9/10 state. This is an expected model for this controlled fixture, not a substitute for actual observations or an instruction to reset stock.

If a group/parent prevents normal partial fulfillment/refund of the real units, capture the actual native UI/API result and classify a semantic failure rather than manually dissolving bundles. If any price, identity, quantity or stock assertion fails, preserve enough direct evidence to reproduce it and stop dependent steps. A failed same-variant lifecycle is an acceptable spike outcome; it reopens the mechanism for principal review, not agent-selected alternatives.

**Complete when:** every matrix row has direct expected-versus-observed PASS/FAIL/BLOCKED/NOT_RUN evidence, with dependencies explicit. No wholesale rerun/preflight is required to report a concrete failure.

## 4. Clean up, review and hand off once

Before cleanup, preserve the final acceptance snapshots. Then delete only this run's owned transform, end only its dev preview, and archive/unpublish the owned fixture product. Retain the app installation, justified scopes and synthetic order records as permitted. Disclose all residues. Residual synthetic stock may remain on the archived fixture; if reduced for hygiene, make a separately recorded **post-test cleanup** adjustment after the final inventory assertions. Never use that adjustment as a refund/restock result. Restore a temporary test-only payment configuration when necessary and safe under its recorded prior state, without changing live payment accounts.

Make a direct post-cleanup API read and record the actual result, not merely successful mutation calls. Check that neither unrelated resources nor another actor's preview/transform were touched. Preserve failures; do not erase previous evidence or silently mark unrun rows as passed.

Append the M0-002 result to `spikes/evidence/G1.md`; keep M0-001 history. A new manifest must name source/build/test refs, local Wasm hash, exact app/shop/location and owned IDs, scopes, currency, run times, direct receipts/projections, matrix results and cleanup. Distinguish observed uploaded source/Function identity from a remote binary hash the tools do not expose. Current PR head belongs in PR metadata/external handoff rather than self-referential commit churn.

Run the existing local/CI checks for any changed code/build input and a fresh sequential read-only fixed-ref review. Use a small evidence-consistency check for new receipt JSON and hashes where practical. Stage only scoped source/configuration/test/evidence changes; verify no credentials, session exports or buyer data. Open one focused continuation PR from actual merged main; principal reviews it before any merge or next slice.

Return the PR/base/head/effective merge base; prior PR #3 merge result; exact test-order IDs and matrix outcomes; links to direct evidence; native monetary and inventory reconciliation; cleanup/residues; and the supported claim. Avoid another general tool inventory.

Overall **G1 remains IN_PROGRESS** even if all development-store rows pass. Public-app/ordinary non-Plus qualification is still outstanding; distribution stays UNVERIFIED unless genuinely observed. A dev-store lifecycle does not prove production authorization, arbitrary-price rounding, Markets/discount compatibility or merchant-plan availability. G2–G8 remain NOT_RUN. No M1/full product, separate pricing architecture, distribution selection, release/deploy, real charge or later merge.

**Stop at principal review.**

## Current source pointers for the executor

- Function testing/captured input-output: https://shopify.dev/docs/apps/build/functions/test-debug-functions
- Cart Transform: https://shopify.dev/docs/api/functions/2026-07/cart-transform
- Dev-store password/payment limitations: https://shopify.dev/docs/apps/build/stores/development-stores
- Ajax line targeting and locale-aware routes: https://shopify.dev/docs/api/ajax/reference/cart
- Inventory state definitions: https://help.shopify.com/en/manual/products/inventory/fundamentals/inventory-states
- Native refunds/restock: https://help.shopify.com/en/manual/fulfillment/managing-orders/refunding-orders

These are evidence sources, not observed gate results. Validate exact new query/mutation shapes against the pinned 2026-07 schema and installed CLI before use.
