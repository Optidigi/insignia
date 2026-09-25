# Insignia — current delivery state

Updated: 24 September 2026 UTC, M0-002 evidence pending principal review. This is an operational index, not decision authority.

| Field | Current state |
|---|---|
| Architecture | Version 1.1 implementation plan and decision ledger unchanged; SHA-256 `c0432288deb778c4d717871d6f771f95e401d00b6a3caf1b878155cbf0e5422d` and `0c6c02bab83fb5032548c3d1be1f86ea1492ae3cfd26b6cacc8410f7d08737bb`. |
| Repository routing | `Optidigi/insignia` is the rewrite; `Optidigi/insignia-legacy` is the storefront visual reference only. |
| Current authorization | [M0-002 real cart/order lifecycle](prompts/M0-002-real-cart-order-lifecycle.md). The owner delegated the exact PR #3 normal merge and a bounded continuation on the existing app, staging shop and fixture. No next slice is authorized. |
| Predecessor approval | [Principal's attributed external PR #3 review](PR-003-principal-review.md) covers base/effective merge base `0f87be149247ea6720984f2cefdc557423001661`, head `a64f5939f9f9871e274868d4d9c10ed3dbbd890b` and successful CI. It is not a native GitHub approval. [Verification metadata](PR-003-verification.json). |
| PR #3 merge and branch | Normal merge commit `523efa4e0248cb2c64ed846e0b37af0067f01d9c` has the approved base/head as its exact parents. Fetched remote `main` matched. `spike/m0-002-real-lifecycle` started from that remote commit. |
| Execution | Explicit `gpt-6-sol`/`high` client route, sequential staging operator and fresh read-only fixed-ref review. Native subagents remain disabled. Isolated Rust 1.98.1/Zig linker and the existing local harness are used. |
| Named resources | Existing app `insignia`, client ID `942e6668fd1177524c0fc48b104b0ac3`, installation `gid://shopify/AppInstallation/781307904158`; `insignia-staging.myshopify.com`, shop `gid://shopify/Shop/78935261342`, Basic dev, USD; Shop location `gid://shopify/Location/89465290910`; owned product `gid://shopify/Product/10294344482974`. Distribution UNVERIFIED. |
| Gate evidence | [G1 record](../../spikes/evidence/G1.md) and [M0-002 direct evidence](../../spikes/m0-001/evidence/m0-002/README.md). Real Ajax cart and Bogus test order A passed exact money/quantity checks. Native Admin partial fulfillment **FAILED**: unchecked plain Small was fulfilled alongside the selected marked Small. Dependent refund/remainder/order B stopped. G1 remains IN_PROGRESS; G2–G8 NOT_RUN. |
| Cleanup/residue | Owned transform deleted; own dev preview stopped/cleaned; fixture unpublished and archived; storefront password kept. One PAID test order `gid://shopify/Order/7184619962526` remains partially fulfilled, with four fixture units committed. No manual reconciliation or second order. Nine justified app scopes remain. |
| Next review | One M0-002 implementation/evidence PR, principal verdict PENDING. Do not merge it, execute M1/G2–G8 or deploy. |

The M0-001 record remains historical. PostgreSQL, R2 and billing are later prerequisites outside this DB-free spike.
