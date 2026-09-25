# Principal review packet — M0-004

## Identity and boundary

Repository: `Optidigi/insignia`. Slice: [M0-004](prompts/M0-004-authorization-exact-money.md). PR base candidate and effective merge base: verified PR #6 merge `4591d102bb7368681622221253dbd4c997df1ad4`. Final PR URL and head belong in the PR metadata after the commit. Required next action: principal review of the local proof and measured capacity failure. No gate pass, protocol freeze, M1 authorization or next PR merge is requested.

PR #6 was normally merged after exact base/head/effective-merge-base, external principal approval and final-head passing CI checks. Its merge has parents `a9398ebf8d069f3556c0b359be1372d94d45f82e` and `16444b19823d044b1e5f4cf3a547ae465a3be3d0`. The current package branches from the verified remote merge. The substantive orchestrator's same-launch host record reports `gpt-6-sol`/high; it is an observable client setting, not provider-private attestation.

## Outcome and acceptance evidence

The package implements the unchanged plan's 114-byte candidate payload, ordinary Ed25519 signature, strict cross-language decode/verification, fixed-vector exact-money allocation, complete-set checks, and two pinned 2026-07 local Function target adapters. It adds only an isolated spike, off-store CI and current-slice delivery/gate pointers. There is no full app scaffold, merchant call, Shopify mutation, real signing key or deployment. The implementation plan, decision ledger, older Function/schema and receipts are unchanged.

| Criterion | Executed command/procedure | Result | Evidence |
|---|---|---|---|
| Exact predecessor merge | GitHub exact-ref/CI check, normal merge, remote parent verification | PASS | [State](state.md), merge `4591d102bb7368681622221253dbd4c997df1ad4` |
| Canonical vectors and amount/set tests | `cd spikes/m0-004 && ./scripts/check-local.sh` in isolated tool environment | PASS: 57 TS; 13 Rust behavior + 2 cross-language; 1 native test per target; fmt/Clippy | [Verification manifest](../../spikes/m0-004/evidence/verification.json), [vector corpus](../../spikes/m0-004/fixtures/vectors.json) |
| Both 2026-07 Wasm targets | Same command, Shopify CLI 4.8.2 build and function-runner 9.2.2 | PASS locally: 7 schema-valid synthetic smoke rows | [Smoke rows](../../spikes/m0-004/evidence/runner-smoke.json), [contract/source map](../../spikes/m0-004/contract.md) |
| Complete target capacity | Same command; 28 synthetic benchmark rows | **FAIL product capacity:** 10 isolated signed buckets exceed 23M instructions per target against 11M reference; three signed plus 197 ordinary lines exceed 11M; 64-bucket Transform output exceeds 20k bytes | [Benchmark rows](../../spikes/m0-004/evidence/runner-bench.json), [analysis](../../spikes/m0-004/evidence/README.md) |
| Historical local G1 suite | Separate unchanged M0-001 local check | PASS: 11 fixtures; not rerun as live staging | [Local evidence](../../spikes/m0-004/evidence/README.md) |
| Live transport, allocated order lifecycle, Validation child-price semantics, G6 enforcement | No merchant access authorized | NOT_RUN / UNVERIFIED | [G2](../../spikes/evidence/G2.md), [G3](../../spikes/evidence/G3.md), [G5](../../spikes/evidence/G5.md) |

The repo-local command used Node 24.21.0, pnpm 12.6.0, Rust 1.98.1, pinned locks and the verified native Zig linker. The manifest carries source, fixture, built artifact and runner-output SHA-256s. Its 28 benchmark rows are completed measurements, including over-limit output; a runner return does not override Shopify's published limit. Stack peak and numeric query cost were unavailable. Final-head CI belongs in actual PR metadata.

## Local pre-review

Two fresh restricted, read-only `gpt-6-sol`/high sessions reviewed the first integrated candidate `db0e260db20925a4e6af2c3d5f09c09614ac0861` against the verified merge base. Spec session `01a0d95e-ab2b-74d2-b168-3b40b2d72bce` found a zero-variant TS/Rust mismatch, missing Rust physical-quantity cap and untested allocation-to-issuance seam. Standards/correctness session `01a0d95e-ab30-7140-be90-f3233d5191b9` found raw high-bit currency/country decode mismatch, unbounded issuance validity, mixed-key sets and a missing marked-line distinction in TypeScript. The corrections and adversarial tests are in this candidate. Both reviewers separately upheld the disclosed instruction-limit failure and unverified live Validation semantics; neither gave gate or PR approval.

The payload has no issuance-day field, so the Function cannot prove D from the wire even though the signer enforces D+2. An absent policy projection on a product that requires authorization could make an unsigned line appear optional. Those are retained limits for principal and live rollout adjudication. Fresh final-diff follow-up is recorded in PR metadata after the commit; any additional findings must be resolved before handoff.

## Compatibility and safety

The candidate bytes are new and unfrozen. Strict decoding, a single key ID per set, trusted generation/epoch/current context, measured bucket/quantity bounds, marker presence and exact lexical money checks are local-only. A renewed offer uses a new set ID; complete valid sets remain reusable until expiry. Synthetic public RFC test keys are never merchant keys. No schema migration, product/catalog change, pricing-mechanism change, store settings, stock, order, payment, app configuration or browser session was touched. Protected orders #1001–#1004 remain outside this package. The existing G1 C/R/B acceptance is narrow; immediate-R raw capture and #1001's cause remain undetermined. No secrets or authenticated traces are included.

## Principal decision — principal completes externally

Verdict: PENDING. Bound PR/head: pending actual PR metadata. Gate result accepted: none; G2/G3/G5 remain IN_PROGRESS, G1 remains IN_PROGRESS. Product capacity and candidate protocol are not accepted. Authorization for next slice: NONE.
