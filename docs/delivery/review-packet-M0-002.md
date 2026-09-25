# Principal review packet — M0-002

## Identity

Repository: `Optidigi/insignia`.
PR: pending creation; final URL and refs belong in PR metadata and handoff.
Slice/spec: [M0-002](prompts/M0-002-real-cart-order-lifecycle.md).
Reviewed base candidate: remote `main` after PR #3 merge, `523efa4e0248cb2c64ed846e0b37af0067f01d9c`.
Head candidate: see PR metadata after commit.
Effective merge base: see PR metadata after push.
Required next action: principal review of the native fulfillment failure and G1 continuation.

## Outcome and scope

The existing Function's live cart and test-only checkout preserved fixed USD 30 marked unit pricing, ordinary USD 20 plain pricing, six real units and a USD 170 mixed order. Native Admin partial fulfillment unexpectedly included an unchecked plain Small line with the selected marked Small. Dependent fulfillment, refunds/restock and second-order cancellation stopped under the prompt's failure rule. G1 remains IN_PROGRESS; G2–G8 remain NOT_RUN.

The implementation plan and decision ledger are unchanged. Changes are limited to the two required read scopes in the existing harness configuration, receipt projection/consistency scripts, direct evidence, and operational documentation. No Function source, schema, test fixture, migration, production application or catalog pricing changed. No generated code was added.

## Acceptance evidence

| Invariant/criterion | Executed procedure | Result | Evidence |
|---|---|---|---|
| Exact predecessor merge | Verify PR #3 base/head/CI/external review, normal GitHub merge, fetched remote main and merge parents | PASS | [Current state](state.md), merge `523efa4e0248cb2c64ed846e0b37af0067f01d9c` |
| Local Function and Wasm | `./scripts/check-local.sh` with isolated Rust/Zig linker | PASS | [M0-002 evidence index](../../spikes/m0-001/evidence/m0-002/README.md); two native tests, eleven Wasm fixtures, local Wasm SHA-256 in manifest |
| Named app/shop/fixture and scopes | Shopify CLI 4.8.2 app-specific 2026-07 GraphQL `--output-file` reads | PASS | [Baseline](../../spikes/m0-001/evidence/m0-002/baseline.json), [preview readback](../../spikes/m0-001/evidence/m0-002/preview-readback.json) |
| Buyable fixture, stock and transform | Native Admin Online Store publication, single-location idempotent stock seed, live `app dev` and owned transform create/readback | PASS | [Seed response](../../spikes/m0-001/evidence/m0-002/inventory-seed-response.json), [transform response](../../spikes/m0-001/evidence/m0-002/transform-create-response.json), [readback](../../spikes/m0-001/evidence/m0-002/transform-readback.json) |
| Plain, marked, edit/re-add, mixed cart | Native storefront Ajax cart and Function logs | PASS | [Cart projections](../../spikes/m0-001/evidence/m0-002/cart-mixed-A.json), [Function log projection](../../spikes/m0-001/evidence/m0-002/function-runs-projected.json), [cart screenshot](../../spikes/m0-001/evidence/m0-002/cart-mixed-A.png) |
| Test-only checkout A and reservation | Native Online Store checkout with Bogus gateway, then direct order/inventory reads | PASS | [Order A](../../spikes/m0-001/evidence/m0-002/order-A-accepted.json), [inventory](../../spikes/m0-001/evidence/m0-002/after-order-A.json) |
| Partial fulfillment selects only one marked Small | Native Admin form/action, direct fulfillment/order/inventory reads | **FAIL**: unchecked plain Small also fulfilled | [Selection projection](../../spikes/m0-001/evidence/m0-002/fulfillment-A-partial-ui-before.json), [fulfillment receipt](../../spikes/m0-001/evidence/m0-002/fulfillment-A-response.json), [inventory](../../spikes/m0-001/evidence/m0-002/after-partial-A.json) |
| Dependent remainder, refunds/restock, order B | Stopped after failed partial fulfillment | NOT_RUN | [Matrix and dependency](../../spikes/m0-001/evidence/m0-002/README.md) |
| Receipt integrity/cleanup | `python3 scripts/check-m0-002-evidence.py`; manifest SHA-256 inventory; direct post-cleanup read | PASS evidence consistency, **not semantic pass** | [Verification](../../spikes/m0-001/evidence/m0-002/verification.json), [manifest](../../spikes/m0-001/evidence/m0-002/manifest.json), [post-cleanup](../../spikes/m0-001/evidence/m0-002/post-cleanup.json) |

API version `2026-07`, Shopify CLI `4.8.2`, staging Basic development store and USD. Function upload came from the unchanged reviewed source; Shopify does not expose its remote binary hash. Exact owned IDs, timestamps, resource residues and per-file hashes are in the manifest. CI run status belongs in the PR metadata after push.

## Local pre-review

Spec review: a fresh sequential read-only `gpt-6-sol`/`high` session read the required instructions and reviewed fixed base `523efa4e0248cb2c64ed846e0b37af0067f01d9c` against candidate `455dbabe4c7afb6dfa557d9297c193b96c85bc15`. It found missing local receipt capture times and one misclassified local checker output. Both are corrected in the follow-up commit; the final fixed-ref review result belongs in PR metadata.
Correctness review: the same read-only session found that the automated checker did not compare order variant GIDs. It now checks both owned variant GIDs. This was a sequential local review, not independent principal review.
Unresolved findings: native Admin partial fulfillment line-identity/quantity mismatch; no workaround was applied. Distribution and ordinary public-app/non-Plus qualification remain unverified.

## Compatibility and safety

The new scope configuration adds only `read_orders` and `read_merchant_managed_fulfillment_orders`. Actual granted read counterparts were confirmed through the same installation. There is no API contract, database, migration, renderer or price algorithm change. Money and group identity are the point of the failed native lifecycle check. The stock seed was guarded and recorded separately from order inventory; no compensating stock/refund manipulation occurred. The evidence checker is read-only and asserts the observed failure. Synthetic buyer/contact data, cart/checkout tokens, credentials, raw authenticated traces and raw Function logs are excluded from Git; projection provenance is in the manifest. The storefront password remained enabled.

One Bogus paid test order `gid://shopify/Order/7184619962526` and fulfillment `gid://shopify/Fulfillment/6511606562974` remain. The order has two Small and two Medium unfulfilled commitments, and the fixture is archived/unpublished. Owned transform and preview were removed; unrelated preview/version and installation remained.

## Principal decision — principal/user completes externally

Verdict: PENDING.
Bound repository/PR/base/head: pending actual PR metadata.
Gate result separately accepted: none.
Required corrections/conditions: principal to assess the native fulfillment failure.
Authorization for next slice: NONE.
