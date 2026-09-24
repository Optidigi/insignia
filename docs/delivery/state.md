# Insignia — current delivery state

Updated: 24 September 2026, PF-002 readiness closure in progress. This is a progress index, not decision authority.

| Field | Current state |
|---|---|
| Architecture | Version 1.1 plan and decision ledger remain unchanged; product and architecture audit closed. |
| Repository routing | `Optidigi/insignia` is the rewrite; `Optidigi/insignia-legacy` is the storefront visual reference only. |
| Current authorization | [PF-002 readiness closure](prompts/PF-002-readiness-closure.md) only. M0-001 and G1–G8 remain unauthorized and NOT_RUN. |
| Predecessor verdict | [Principal's external review](PR-001-principal-review.md) APPROVED the docs/config bootstrap at PR #1 base `38a711ad46aec63b8f410519f30352a88e4113c7`, head `722afb3990468b7963407f9c6706127974d7a8fd`. Native GitHub approval/comment attempts returned HTTP 403; neither was posted. |
| Predecessor merge | User explicitly delegated the merge of exact PR #1. Normal merge completed at `bd4b0c12dc6d6c38e155ec6a1ce40fc215b4d6bb`; remote `main` and both merge parents verified. No protection bypass or added PR commits. |
| PF-002 branch | `docs/pf-002-readiness-closure` was created from fetched remote `main` at the merge commit. This branch holds only PF-002 documentation/configuration evidence; its final PR refs belong in PR metadata and the handoff. |
| Restricted agent workflow | **VERIFIED with explicit launch overrides.** After the maintainer installed distro `bubblewrap`, read-only and workspace-write sandbox probes passed; fresh reviewer/writer sessions read the active instructions, a reviewer read the pinned skill with line citations, a scratch write/test passed, and canary writes outside policy were denied. Codex 0.156.1 resolves `gpt-6-sol`/`high` through app-server `config/read`. The project config layer is still not shown as loaded, so future runs need explicit flags. Shell sandbox results do not certify connector permissions. |
| Rust host and Wasm | **VERIFIED with explicit isolated linker.** Rust 1.98.1, Wasm compile, native `cargo test`, executed build script and proc macro passed using pinned local Zig 0.16.0 as C linker. Default host `cc` remains absent; use the recorded linker setting for future local Rust tests unless host tooling changes. |
| Shopify test context | CLI imported the named existing `insignia` app in private scratch and returned OAuth client ID `942e6668fd1177524c0fc48b104b0ac3`. `insignia-staging.myshopify.com` remains the verified Basic dev store. Read-only app Admin query reported **not installed**; requested scopes are empty. Binding to the exact numeric Dashboard resource and distribution are **UNVERIFIED**: CLI omits the resource number/status and user reports no Distribution section. |
| Evidence | [PF-002 three-outcome record](evidence/pf002-readiness.md); PF-001/PF-001R passing checks retained at their recorded scope. PostgreSQL, R2 and billing are later prerequisites, not blockers for the fixed-input DB-free M0 harness. |
| Principal review and merge | PF-002 verdict PENDING; PF-002 PR must not be merged without its own review and user authorization. |

The app owner can confirm the nonsecret Client ID at the designated Dashboard URL and supply only a narrow distribution-status read if one exists. The user relays the eventual PF-002 PR and exact head to the principal. No application scaffold, deployment, store mutation, production action or gate work occurred.
