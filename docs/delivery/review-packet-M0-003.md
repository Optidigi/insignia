# Principal review packet — M0-003

## Identity

Repository: `Optidigi/insignia`.
PR/base/head/effective merge base: final refs in PR metadata and external handoff; candidate base is verified remote-main PR #4 merge `895aef65179267a9944c57c40478eeb704a8b65a`.
Slice/spec: [M0-003](prompts/M0-003-fulfillment-selection-diagnosis.md).
Required next action: principal review of the request-capture blocker and supported diagnostic continuation route. No G1 PASS or next-slice authorization is requested.

## Outcome and scope

The historical selected-one/aggregate-two UI projection is rejected by a new fail-closed form guard. Direct reads before and after the diagnostic preserve the existing order, fulfillment, commitments, fixture, scopes and transform absence. The shared browser's exposed tool surface cannot capture or intercept an actual outgoing native fulfillment request body. The prompt requires that request-to-line mapping before a new fulfillment submit; therefore no C/R/B cart, checkout, fulfillment or refund was initiated. Original M0-002 root cause remains undetermined. This is a bounded BLOCKED_CAPTURE diagnostic result, not evidence of a new Shopify failure.

Changed paths are limited to the existing spike's local guard/tests/receipt verifier/check script and M0-003 evidence, the existing CI check path, AGENTS/current-state/G1 pointers, and the exact principal prompt/review/verification artifacts. The implementation plan, decision ledger, Function implementation/schema/price operation, M0-001/M0-002 receipts and app configuration are unchanged. No generated application code or migration was added.

## Acceptance evidence

| Criterion | Executed procedure | Result | Evidence |
|---|---|---|---|
| Exact predecessor approval and merge | Verify PR #4 base/head/effective merge base, principal external verdict, exact-head CI, normal merge and remote parents | PASS | [Current state](state.md), merge `895aef65179267a9944c57c40478eeb704a8b65a` |
| Protected app/shop/product/order baseline | Shopify CLI 4.8.2 app-specific Admin GraphQL `2026-07 --output-file`; authenticated shared Admin page; anonymous storefront GET | PASS read-only | [M0-003 evidence index](../../spikes/m0-001/evidence/m0-003/README.md), [API baseline](../../spikes/m0-001/evidence/m0-003/baseline.json), [order](../../spikes/m0-001/evidence/m0-003/protected-order.json), [fulfillment](../../spikes/m0-001/evidence/m0-003/protected-fulfillment.json) |
| Historical form guard | `python3 -B -m unittest discover -s tests -v`; direct CLI runs on historical and coherent fixtures | PASS local guard, no store operation | [Guard source](../../spikes/m0-001/scripts/guard_fulfillment.py), [fixtures](../../spikes/m0-001/gates/fulfillment-diagnosis/), [test source](../../spikes/m0-001/tests/test_guard_fulfillment.py) |
| Historical and new receipt integrity | Existing 36-check M0-002 checker; 19-check protected baseline/post-check; exact file-set/length/SHA-256 manifest verifier | PASS read-only consistency, no native lifecycle PASS | [M0-003 verification](../../spikes/m0-001/evidence/m0-003/verification.json), [manifest](../../spikes/m0-001/evidence/m0-003/manifest.json) |
| Actual native request capture | Inspect exposed collaborative browser tools, page ResourceTiming properties, video-recording output and retained historical artifacts | BLOCKED_CAPTURE: no supported scoped request-body interception tool or original request body | [Capability probe](../../spikes/m0-001/evidence/m0-003/capture-capability.json), [limits](../../spikes/m0-001/evidence/m0-003/README.md) |
| C/R comparison, optional B and dependent native lifecycle | Stop before payment/mutation when request cannot be captured/correlated | NOT_RUN_DEPENDENT | [Matrix](../../spikes/m0-001/evidence/m0-003/README.md) |
| Local Function/Wasm and CI | `./scripts/check-local.sh` with isolated Rust 1.98.1/Zig linker; GitHub Actions Function workflow | Local PASS: fmt/clippy, two native tests, eleven Wasm fixtures, seven Python guard/manifest tests, 36 historical and 19 new receipt assertions, both manifests (44 and 16 files). CI status belongs in PR metadata after push. | [Check script](../../spikes/m0-001/scripts/check-local.sh) |

## Local pre-review

A fresh sequential read-only `gpt-6-sol`/`high` session reviewed base `895aef65179267a9944c57c40478eeb704a8b65a` against initial candidate `2444fcbf2a10bdbcc0269c363b8aecd5d41ea318`. It found three PR issues: the guard accepted two target units or a checked zero-quantity bystander; CI could skip the new manifest; and a browser-process detail lacked retained provenance. The guard now rejects both ambiguous form states in red-then-green tests, CI requires the manifest, and the browser claim is narrowed to the exposed tool inventory. A fresh review of the final candidate belongs in PR metadata. Native subagents are unavailable; local review cannot replace the principal's independent adjudication.

## Compatibility and safety

No runtime Function, schema, catalog, price, API contract, database or migration change. The local guard validates exact FulfillmentOrderLineItem/LineItem identities, effective quantities, checked/disabled/indeterminate state and aggregate selection. Its output always says `submissionAuthorized:false`; form agreement is insufficient without a separately captured outgoing native request. The manifest verifier rejects path traversal, symlinks, duplicate JSON keys, missing/extra files, byte-length and SHA mismatches. CI helpers read only repository files and do not access credentials or staging.

Order #1001 and fulfillment `gid://shopify/Fulfillment/6511606562974` remain read-only and unchanged. Direct before/after reads match. Product remains archived/unpublished, no transform or M0-003 preview exists, storefront password remains enabled and no new order/stock residue exists. Synthetic historical order/stock commitments remain as documented. No raw authenticated trace, credential, buyer detail or browser recording is in Git. Captured browser capability fields are narrow and nonsecret.

## Principal decision — principal/user completes externally

Verdict: PENDING.
Bound repository/PR/base/head: pending actual PR metadata.
Gate result separately accepted: none; G1 remains IN_PROGRESS.
Required corrections/conditions: decide a supported scoped native request-capture/abort route before new order lifecycle work.
Authorization for next slice: NONE.
