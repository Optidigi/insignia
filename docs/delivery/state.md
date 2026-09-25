# Insignia — current delivery state

Updated: 25 September 2026 UTC, M0-003 diagnostic checkpoint pending principal review. This is an operational index, not decision authority.

| Field | Current state |
|---|---|
| Architecture | Version 1.1 implementation plan and decision ledger unchanged; SHA-256 `c0432288deb778c4d717871d6f771f95e401d00b6a3caf1b878155cbf0e5422d` and `0c6c02bab83fb5032548c3d1be1f86ea1492ae3cfd26b6cacc8410f7d08737bb`. |
| Repository routing | `Optidigi/insignia` is the rewrite; `Optidigi/insignia-legacy` is the storefront visual reference only. |
| Current authorization | [M0-003 fulfillment selection diagnosis](prompts/M0-003-fulfillment-selection-diagnosis.md). The owner delegated only the exact PR #4 normal merge and bounded named-resource diagnostic continuation. No next slice is authorized. |
| Predecessor approval | [Principal's attributed external PR #4 review](PR-004-principal-review.md) accepted the evidence checkpoint at base/effective merge base `523efa4e0248cb2c64ed846e0b37af0067f01d9c`, head `1bfe9a13357b9c49042627f68fcca9daec93b1f5`, CI `36076245450`. Native APPROVE failed HTTP 403; no native approval was posted. [Verification metadata](PR-004-verification.json). |
| PR #4 merge and branch | Normal merge `895aef65179267a9944c57c40478eeb704a8b65a` has the approved base/head as exact parents. Fetched remote `main` matched. `spike/m0-003-fulfillment-diagnosis` started from that merge. |
| Named resources | Existing `insignia` app, client `942e6668fd1177524c0fc48b104b0ac3`, installation `gid://shopify/AppInstallation/781307904158`; `insignia-staging.myshopify.com`, shop `gid://shopify/Shop/78935261342`, Basic dev, USD; Shop location `gid://shopify/Location/89465290910`; archived fixture `gid://shopify/Product/10294344482974`. Distribution UNVERIFIED. |
| Protected history | Order `#1001`, `gid://shopify/Order/7184619962526`, and fulfillment `gid://shopify/Fulfillment/6511606562974` are read-only. The direct M0-003 before/after reads match: Small 8 available/2 committed/10 on_hand, Medium 10/2/12; two Small and two Medium remain unfulfilled. |
| Diagnostic outcome | [M0-003 evidence](../../spikes/m0-001/evidence/m0-003/README.md): a fail-closed local form guard rejects the recorded selected-one/aggregate-two fixture; one-target/one-summary control passes locally. The shared browser lacks a supported native request-body interception tool. No new C/R/B order or staging mutation was attempted because outgoing fulfillment line/quantity mapping could not be checked before submission. Original cause UNDETERMINED. |
| Gate and cleanup | G1 IN_PROGRESS. C/R/B and dependent lifecycle steps BLOCKED_CAPTURE/NOT_RUN. G2–G8 NOT_RUN. The fixture remains archived/unpublished, no Cart Transform is active, no M0-003 preview, order, stock adjustment or cleanup mutation occurred. Password protection remains. |
| Next review | One M0-003 diagnostic/evidence PR; principal verdict PENDING. Do not merge it, execute M1/G2–G8 or deploy. |

The M0-001/M0-002 records remain historical. PostgreSQL, R2 and billing are later prerequisites outside this DB-free diagnostic slice.
