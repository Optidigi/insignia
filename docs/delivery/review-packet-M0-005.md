# Principal review packet — M0-005

## Identity and decision boundary

Repository: `Optidigi/insignia`. PR: https://github.com/Optidigi/insignia/pull/8. Target: `main`. Verified branch start and effective merge base: `878c9b9b58cc7aeae81b2393847eb18ef91e2540`, the exact normal merge of externally approved PR #7. Source/evidence head independently reviewed: `984e39844e2d235a00bf7fd8e0362aea64fa7514`; the final documentation commit and exact PR head are recorded in the PR body after publication. Required next action: principal review of the proposed protocol exception and its unresolved evidence, not gate acceptance.

The owner authorized this one local M0-005 prototype after PR #7's exact merge. The principal's PR-007R verdict was external; it was not represented as a native GitHub approval. The architecture [plan](../architecture/implementation-plan.md), [decision ledger](../architecture/decision-ledger.md), M0-004 source/contract, and historical failed evidence have no edits in this branch.

## Outcome and scope

The isolated [v2 candidate](../../spikes/m0-005/contract.md) uses one ordinary Ed25519 signature over a complete ordered accepted quote, a shared cart envelope and compact authenticated line records. TypeScript issues/encodes, the Rust core verifies the complete set, and both complete local Function targets independently invoke that verifier. No current protocol is replaced. The [draft decision proposal](../../spikes/m0-005/draft-decision-proposal.md) recommends **FURTHER_EVIDENCE**, not adoption.

Changed packages are `spikes/m0-005/`, this operational packet/state, and the scoped off-store CI workflow. Generated synthetic target fixtures are identified by `spikes/m0-005/extensions/fixtures/generate.py`; no merchant data or credentials are included. The branch has no Shopify API call, resource mutation, staging order, deployment, or distribution change.

## Acceptance evidence

| Criterion | Actual check | Result | Durable evidence |
|---|---|---|---|
| PR #7 ancestry | GitHub refs, merge parents/tree, fetch of remote `main` | PASS | [Operational state](state.md): merge `878c9b9b58cc7aeae81b2393847eb18ef91e2540` has approved base/head parents |
| Canonical shared statement and exact money | `python3 -B fixtures/check-vectors.py`; `corepack pnpm check:ts` | PASS | Independent Python vector and 10 TypeScript issuer/codec tests in [local log](../../spikes/m0-005/evidence/local-check.log) |
| Strict complete-set verification | `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings`, `cargo test --locked` for core and both targets | PASS | 13 Rust core tests and 5 native tests per Function target in the same log; noncanonical key, weak/revoked/window, tampering and observed-price controls |
| Mandatory v2 key admission | Each target removes `revoked`, `firstDay`, `lastDay` in native tests; 6 full-target smoke cases | PASS | [28 smoke rows](../../spikes/m0-005/evidence/smoke.json) and [exact inputs/expectations](../../spikes/m0-005/evidence/cases-smoke.jsonl). Transform emits no price operation; Validation rejects checkout. |
| Full-target stress and limits | Two Shopify CLI Wasm builds; schema-validated Function runner | MIXED | [42 benchmark rows](../../spikes/m0-005/evidence/bench.json), [exact inputs/expectations](../../spikes/m0-005/evidence/cases-bench.jsonl). At 10 signed + 190 ordinary: Transform 6,055,185 instructions / 3,446 bytes; Validation 6,324,982 / 17, below 8.8M / 16,000. At 64 signed + 136 ordinary, Transform output **21,968 bytes**, above 20,000. |
| Cold-build reproducibility and provenance | Clean target rebuild; byte comparison of two Wasm and all 70 row/case files; `node scripts/capture-manifest.mjs` | PASS locally | [Manifest](../../spikes/m0-005/evidence/manifest.json) binds source `ff8ebd5f5907d79ba59157aa4e6c833e940c8217`, 46 source files, tools, runner, artifacts and case/result files. [Repeat log](../../spikes/m0-005/evidence/repeat-check.log) and repeat row files are byte-identical. |
| Exact final-head CI | GitHub Actions `M0-005 off-store whole-quote feasibility` | PENDING at packet commit | The workflow retains its own source-bound manifest, Wasm, rows and exact cases. Record the successful final-head run, artifact digests and any cross-machine difference in the PR body before handoff. |
| Live carrier, child price and required-product rollout | No authorized store access in this package | NOT_RUN / OPEN | [Evidence limits](../../spikes/m0-005/evidence/README.md); the missing-policy unsigned allow case is retained. Stack peak and numeric query cost were unavailable. |

The local toolchain was Node 24.21.0, pnpm 12.6.0, Rust 1.98.1, Shopify CLI 4.8.2, `shopify_function` 2.2.0 and pinned 2026-07 schemas. The manifest records binary hashes. The final Transform/Validation Wasm SHA-256 values are `5a09cb507ebd95ed78c2d70a9d7ba6b143a6c80ea36906b115665e2e81801c2a` / `f44aae83e2bdc15f6225a50fe4a15f9d759f28714eef2fb396c082a3d1f2aa17`. CI may differ by environment; behavior and artifacts must be compared explicitly.

## Local pre-review and dispositions

Two separate restricted `gpt-6-sol`/high read-only Codex sessions reviewed the first fixed implementation head. The Spec review found missing committed provenance, unretained case inputs/expectations, a 500-unit benchmark that bypassed the allocator, and incomplete Rust key admission. The Standards/security review found noncanonical-key admission, the same key gap, bespoke TypeScript curve checks and missing provenance. Corrections are in the current branch: committed source-bound manifest, all exact cases with hashes, allocator-derived tier, maintained-primitive canonical key admission, explicit revocation/window fields, and TypeScript issuer-only code. Neither review was principal approval.

Fresh follow-ups on source/evidence head `984e39844e2d235a00bf7fd8e0362aea64fa7514` found no new implementation or security defect. Spec session `01a0da13-81bb-7fd3-9506-37d6cd464bdb` independently audited 70 row/case hashes and kept final-head CI and this packet open as handoff evidence. Standards/security session `01a0da13-81ab-7f91-bfff-70fe70d12060` verified mandatory key fields, 46 source hashes, Wasm hashes, runner and native test executables (13/5/5 pass). Its attempted read-only Shopify CLI replay failed to obtain Function info (`ENOENT`, then empty JSON); it did not claim a fresh Wasm replay. The orchestrator's full local CLI build/runner and repeat were successful and are separately recorded above. CI closes the remaining provenance item.

## Compatibility, safety and principal decision

This distinct v2 magic/domain cannot silently upgrade M0-004 per-line tokens; its installation, dual-version rollout and live carrier behavior are unimplemented. Exact allocation remains based on the unchanged M0-004 allocator. No production key or secret was used; the vector seeds are public synthetic test material. The missing required-product policy permits an unsigned required product when its independent policy input is absent, and the 64-bucket output failure remains. There is no product-facing cap, protocol freeze, completed G2/G3/G5/G6 gate, or live checkout qualification.

Principal verdict, bound final refs, gate result and any next-slice authority: **principal/user to complete externally**. This agent does not approve or merge PR #8. G1 remains IN_PROGRESS with its earlier limited C/R/B adjudication; G2/G3/G5 remain IN_PROGRESS; G4/G6/G7/G8 and M1 are not accepted by this local package.
