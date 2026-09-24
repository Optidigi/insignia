# Insignia — current delivery state

Updated: 24 September 2026, M0-001 in progress. This is an operational index, not decision authority.

| Field | Current state |
|---|---|
| Architecture | Version 1.1 implementation plan and decision ledger remain unchanged; SHA-256 `c0432288deb778c4d717871d6f771f95e401d00b6a3caf1b878155cbf0e5422d` and `0c6c02bab83fb5032548c3d1be1f86ea1492ae3cfd26b6cacc8410f7d08737bb`. |
| Repository routing | `Optidigi/insignia` is the rewrite; `Optidigi/insignia-legacy` is the storefront visual reference only. |
| Current authorization | [M0-001 same-variant development lifecycle](prompts/M0-001-same-variant-dev-lifecycle.md). The user explicitly authorized the exact PR #2 merge and this prompt's named-resource staging envelope. M0-001 may collect G1 development evidence; G2–G8 remain NOT_RUN. |
| Predecessor approval | [Principal's external PR #2 review](PR-002-principal-review.md) APPROVED only the PF-002 documentation/readiness checkpoint at base/effective merge base `bd4b0c12dc6d6c38e155ec6a1ce40fc215b4d6bb`, head `dda65d4f0570123035dd09ec3c9f9922d6df4ebf`. Native APPROVE returned HTTP 403 and was not posted. [Verification metadata](PR-002-verification.json) is an attributed artifact, not a native review. |
| PR #2 merge and branch | User delegated a normal merge after exact-ref verification. GitHub reports merge commit `0f87be149247ea6720984f2cefdc557423001661`, whose parents are the approved base and head. Fetched remote `main` matched; `spike/m0-001-same-variant` branches from it. PR #2 head was unchanged. |
| Execution | Explicit `gpt-6-sol`/`high` client launch flags and bounded reviewer/writer routes were verified in PF-002. Native subagents remain disabled; use one writer, one serialized staging operator and fresh sequential read-only review. Rust 1.98.1 with explicit local Zig host linker was verified. |
| Test resources | Existing `insignia` app, OAuth client ID `942e6668fd1177524c0fc48b104b0ac3`, organization `212732011`; owner-attested Dashboard resource `427859050497`. Only `insignia-staging.myshopify.com`, shop ID `gid://shopify/Shop/78935261342`, Basic development store, USD. App-specific API confirms installation `gid://shopify/AppInstallation/781307904158` and seven scopes remain. The owned transform was deleted, preview cleaned and fixture product archived with zero stock; exact IDs are in G1 evidence. Distribution remains UNVERIFIED. |
| Gate evidence | [G1 same-variant spike](../../spikes/evidence/G1.md) is IN_PROGRESS. Local 2026-07 schema/Function tests and staging activation passed. Online Store cart/checkout and later lifecycle steps are blocked by missing native Admin/storefront access, product publication and designated stock location. No full G1 PASS can follow from a development store. |
| Next review | One M0-001 implementation/evidence PR; principal verdict PENDING. Do not merge M0-001 or start another slice. |

The staging operator recorded the owned IDs and verified cleanup; no carts or orders were created. No distribution selection or app deploy occurred. PostgreSQL, R2 and billing remain later prerequisites outside this DB-free spike.
