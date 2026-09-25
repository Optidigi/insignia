# Insignia — current delivery state

Updated: 25 September 2026 UTC, M0-003R version 1.1 in progress. This is an operational index, not decision authority.

| Field | Current state |
|---|---|
| Architecture | Version 1.1 implementation plan and decision ledger unchanged; SHA-256 `c0432288deb778c4d717871d6f771f95e401d00b6a3caf1b878155cbf0e5422d` and `0c6c02bab83fb5032548c3d1be1f86ea1492ae3cfd26b6cacc8410f7d08737bb`. |
| Repository routing | `Optidigi/insignia` is the rewrite; `Optidigi/insignia-legacy` is the storefront visual reference only. |
| Current authorization | [M0-003R native outcome continuation, version 1.1](prompts/M0-003R-native-outcome-continuation.md). The owner delegated the exact PR #5 normal merge and the prompt's bounded named-resource comparison. No later slice is authorized. |
| Predecessor approval | [Principal's attributed external PR #5 review](PR-005-principal-review.md) accepted the diagnostic checkpoint at base/effective merge base `895aef65179267a9944c57c40478eeb704a8b65a`, head `afce3b668240d3a6b87741c173d1be0547ef4821`; CI run `36079496495` succeeded on that head. Native APPROVE failed HTTP 403; no native approval was posted. [Verification metadata](PR-005-verification.json). |
| PR #5 merge and branch | Normal merge `a9398ebf8d069f3556c0b359be1372d94d45f82e` has the approved base/head as exact parents. Fetched remote `main` matched. `spike/m0-003r-native-outcome` started from that merge. |
| Named resources | Existing `insignia` app, client `942e6668fd1177524c0fc48b104b0ac3`, installation `gid://shopify/AppInstallation/781307904158`; `insignia-staging.myshopify.com`, shop `gid://shopify/Shop/78935261342`, Basic dev, USD; Shop location `gid://shopify/Location/89465290910`; archived fixture `gid://shopify/Product/10294344482974`. Distribution UNVERIFIED. |
| Protected history | Order `#1001`, `gid://shopify/Order/7184619962526`, and fulfillment `gid://shopify/Fulfillment/6511606562974` are read-only. The direct M0-003 before/after reads match: Small 8 available/2 committed/10 on_hand, Medium 10/2/12; two Small and two Medium remain unfulfilled. |
| Prior diagnostic outcome | [M0-003 evidence](../../spikes/m0-001/evidence/m0-003/README.md): the fail-closed form guard rejects the recorded selected-one/aggregate-two fixture. No new C/R/B order or staging mutation occurred in M0-003. Original cause UNDETERMINED. M0-003R supersedes its unconditional request-capture prerequisite. |
| Gate and cleanup | G1 IN_PROGRESS; G2–G8 NOT_RUN. M0-003R C/R/B is pending a currently active test-only gateway and the prompt's fresh native-control checks. The fixture remains archived/unpublished, no Cart Transform is active, and password protection remains. |
| M0-003R live readiness | [New direct baseline](../../spikes/m0-001/evidence/m0-003r/) matches the protected M0-003 shop, stock, order and fulfillment JSON exactly. Authenticated Admin is available. Payments currently asks to activate a test provider; an active Bogus route has not been established. No new order or staging mutation has occurred. The owner was asked to activate only the test gateway. |
| Next review | One M0-003R outcome/evidence PR; principal verdict PENDING. Do not merge it, execute M1/G2–G8 or deploy. |

The M0-001/M0-002 records remain historical. PostgreSQL, R2 and billing are later prerequisites outside this DB-free diagnostic slice.
