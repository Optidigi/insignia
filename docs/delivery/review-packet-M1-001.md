# Principal review packet — M1-001

## Identity and outcome

Repository: `Optidigi/insignia`. Slice: [M1-001 workspace and boundaries](prompts/M1-001-WORKSPACE-AND-BOUNDARIES.md) under the [limited entry decision](M1-ENTRY-DECISION.md). Base/effective merge base: `a467afcce5f0324a13fd3bfe647d3543eae159a4`, the verified PR #19 normal merge. The final PR URL/head and final-head workflow IDs belong in the PR body because committing them here would change the head they identify. Required next action: principal review of this one foundation PR; no M1 PR merge or M2 start.

The single outcome is a root pnpm/Cargo workspace with explicit package exports, executable browser/server and domain boundaries, minimal local Astro/Preact storefront/Sharp worker surfaces, and current-source experimental-v2 Function builds. [Dependency map](M1-001-dependency-map.md) names present and deferred responsibilities. There is no merchant-authenticated code path, producer signer, database readiness claim, Shopify mutation or live capacity result from this package. The v1.3 architecture and historical source/receipts remain unchanged.

## Acceptance evidence

| Criterion | Actual command/procedure | Result | Bound evidence |
|---|---|---|---|
| Frozen independent checkout | Detached worktree at initial integrated commit; `corepack pnpm install --frozen-lockfile`; `corepack pnpm check` | PASS | Clean worktree built/tested from source with separate root locks; later final-head CI remains authoritative. |
| JS/TS format, lint, type and runtime builds | `corepack pnpm check:style`; root `build` | PASS locally | Biome 2.5.14; TypeScript 5.9.3; Astro 7.3.5/Preact 10.29.8; storefront Vite 8.3.1 and worker Sharp 0.35.4. |
| Domain, browser, exports and negative boundaries | `corepack pnpm check:boundaries`; deliberate domain→`node:fs` insertion then normal command | PASS/REJECT as intended | Dependency-cruiser real graph, type-only and transitive re-export probes, broad Node-core controls, two rejected browser bundles, explicit exports; injected normal command exited 1. |
| Production/test source separation | `corepack pnpm check:secrets`; synthetic token marker inserted in an app test file | PASS/REJECT as intended | Production/browser outputs and 20 test/fixture files scanned separately; RFC 8032 and 0x01 synthetic seeds explicitly bound. |
| Local runtimes and browser interaction | `corepack pnpm build`, `corepack pnpm test:unit`, `corepack pnpm test:browser` | PASS locally | Public SSR liveness, local Preact interaction, Shadow DOM mount/unmount/event isolation, graceful worker start/stop, Sharp synthetic derivative. The stripped host needed project-local browser libraries and fonts; no host package or sandbox change. |
| Exact synthetic TS/Rust/Function semantics | `corepack pnpm test:vectors`; `cargo fmt --all -- --check`; `cargo clippy --workspace --all-targets --locked -- -D warnings`; `cargo test --workspace --locked`; `bash scripts/m1-functions/check.sh` | PASS locally | One TS/Node byte/signature vector; 57 native Rust tests; 8 Transform and 18 Validation offline runner rows, including `/0`, exact price, corrupt/missing/duplicate/unsigned cases, repair, 32+168, 33 rejection and 10,000 units. |
| Current-source Wasm and build provenance | `bash scripts/m1-functions/build-wasm.sh transform/validation`; `python3 -B scripts/m1-functions/artifact-manifest.py` | PASS locally | Transform raw/final SHA-256 `89fbfdd4…` / `ef6788a4…`; Validation raw/final `704db583…` / `e4247608…`; final sizes 179,505 / 181,047 bytes. Pinned public trampoline and runner checksums passed. The ignored generated manifest contains full hashes, sizes, source/query/schema and 24 required files. |
| Historical integrity | `python3 -B spikes/m0-007/scripts/check-history.py`; `python3 -B spikes/m0-014/scripts/check-live-setup.py` | PASS | v1.3 plan/ledger hashes remain `b730c0dc…` / `d4297182…`; 120 unchanged historical receipts; 14 hashed live setup receipts. |
| Archived Cargo isolation | `python3 -B scripts/boundaries/check-cargo-workspace.py`; `cargo fmt --manifest-path spikes/m0-008/consumer-projection/Cargo.toml --all -- --check` | PASS locally | Root Cargo excludes the whole archived `spikes` tree. All 20 historical manifests resolve as independent workspace roots; archived manifests and lockfiles remain unchanged. |

The runner reported peak 6,835,169 Transform and 6,994,490 Validation instructions across these local rows. Stack telemetry remains unavailable. These are source/artifact measurements, not a merchant capacity commitment. The local Polaris-tag interaction uses visible fallback CSS because the Admin host does not upgrade the component in a standalone fixture; prior actual embedded Admin evidence stays qualified in its historical receipt. No Shopify/provider call was made for M1-001.

## Local pre-review and corrections

Fresh read-only Spec and Standards/security reviews inspected initial integrated commit `ad1f6c7165f7bd8eb808ac08b94bc5f7fb4afa5b` against the verified base. Spec found incomplete Node-core coverage, hardcoded source roots, skipped test/fixture scans and absent JS/TS style checks. Security independently found the Node-core gap and an unqualified old state row. The correction adds a core-module rule with web-island/bundle controls, dynamic source discovery, separate test/fixture scans, pinned Biome checks and a dated historical state row. Ordinary local checks passed after correction; final rereview and final-head CI disposition are recorded in the PR body, which can identify the immutable final head.

The first final-head CI run exposed Cargo's parent-workspace detection for archived spike crates. The root `exclude = ["spikes"]` boundary and the 20-manifest checker address that concrete failure without changing any spike source or lockfile. Final CI disposition remains in the PR body.

The same CI run reached the historical integrity checker, which needs an archived merge ref unavailable in GitHub's default shallow checkout. The foundation workflow now fetches full Git history for that fixed-ref check. This changes CI checkout depth only; it does not rewrite the archived verifier or its reference.

## Compatibility and safety

The v2 wire bytes and strict verifier were copied only as experimental internal candidate code; no production protocol adoption, signer, merchant keys or live trust defaults are added. No SQL migration, tenant record, billing command, cart mutation, artwork upload or provider API change is introduced. Synthetic fixtures contain public test keys only. Root build scripts fetch pinned public Function tools and perform offline replays without Shopify CLI authentication. The unfinished gate obligations remain in [the milestone register](M1-UNRESOLVED-ACCEPTANCE.md).

## Principal decision — external

Verdict, gate acceptance, bound final PR refs and authorization for any next slice are reserved for the principal and owner. This packet is local implementation evidence, not principal approval.
