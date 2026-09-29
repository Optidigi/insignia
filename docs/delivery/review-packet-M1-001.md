# Principal review packet — M1-001

## Identity and outcome

Repository: `Optidigi/insignia`. Slice: [M1-001 workspace and boundaries](prompts/M1-001-WORKSPACE-AND-BOUNDARIES.md), with [M1-001R correction](prompts/M1-001R-BOUNDARY-AND-UI-CHECKS.md) on the same PR under the [limited entry decision](M1-ENTRY-DECISION.md). Base/effective merge base: `a467afcce5f0324a13fd3bfe647d3543eae159a4`, the verified PR #19 normal merge. The final PR URL/head and final-head workflow IDs belong in the PR body because committing them here would change the head they identify. Required next action: principal re-review of this one foundation PR; no M1 PR merge or M2 start.

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

The runner reported peak 6,835,169 Transform and 6,994,490 Validation instructions across these local rows. Stack telemetry remains unavailable. These are source/artifact measurements, not a merchant capacity commitment. The original local Polaris-tag test could pass with a plain unupgraded tag; M1-001R closes that test gap below. Prior actual embedded Admin evidence stays qualified in its historical receipt. No Shopify/provider call was made for M1-001 or M1-001R.

## M1-001R correction evidence

[The attributed principal review](PR-020-principal-review.md) returned **CHANGES_REQUESTED** at old head `87a6f7557774a31ca6813ad865f028bb79b3af2e`; [source provenance](M1-001R-provenance.md) preserves its scope. The correction remains on the existing PR #20.

| Finding | Pre-fix reproduction | Corrected check and result | Limit |
|---|---|---|---|
| R1 implicit domain effects | Six formatted, never-invoked exports appended to compiled `money.ts`; pinned Node 24.21.0/pnpm 12.6.0 `corepack pnpm check` exited **0**. This establishes the original normal-path gap; the principal's separate Node 22/TS 5.8 compiler probes are not substituted for it. | Domain `lib: ["ES2022"]`, `types: []`, and production-source inclusion isolate ambient compiler types; `fetch` then fails compilation. Syntax-aware TypeScript AST scan runs in `check:boundaries`. Seven injected production-source cases—six principal forms plus a nested helper—each made `corepack pnpm check:boundaries` exit **1** with the expected clock, random or ambient-API rule. Thirteen permanent AST cases pass, including computed access, aliases, `import.meta`, deterministic Math/BigInt and explicit date values. The original two money tests remain green. | Common static syntax only; this is not a sandbox or arbitrary alias/dataflow proof. UI/worker/test clocks remain allowed. |
| R2 real Polaris element | Blocking the pinned CDN request still let the old plain-tag click increment the Preact counter; the new negative control initially failed with `Missing expected rejection`. | The page retains the documented `polaris-1.1.js` pin and removes the clickable fallback CSS. The browser test verifies a 739,944-byte public script snapshot at SHA-256 `912455ad068713e7595f5a506fb7433a078554c327cf0fd30ce86ccb214818fe`, serves it at the same URL, requires `customElements.get('s-button')`, actual upgrade and the public `disabled` property before click, and observes the counter. Blocking that URL fails the same finite readiness assertion even though the plain tag can still be clicked. Built Astro/Preact browser test passes. | This is a deterministic localhost library test, not live embedded Admin authentication or live CDN availability. |

`corepack pnpm install --frozen-lockfile && corepack pnpm check` passed on the integrated correction locally. Both current-source Wasm builds and 8/18 offline replays remain green with unchanged local final binary hashes `ef6788a4…` / `e4247608…`; archived history checks and v1.3 plan/ledger hashes remain unchanged. Final-head CI and fresh local-review dispositions are recorded in the PR body after the final head is known.

## Local pre-review and corrections

Fresh read-only Spec and Standards/security reviews inspected initial integrated commit `ad1f6c7165f7bd8eb808ac08b94bc5f7fb4afa5b` against the verified base. Spec found incomplete Node-core coverage, hardcoded source roots, skipped test/fixture scans and absent JS/TS style checks. Security independently found the Node-core gap and an unqualified old state row. The correction adds a core-module rule with web-island/bundle controls, dynamic source discovery, separate test/fixture scans, pinned Biome checks and a dated historical state row. Ordinary local checks passed after correction; final rereview and final-head CI disposition are recorded in the PR body, which can identify the immutable final head.

The first final-head CI run exposed Cargo's parent-workspace detection for archived spike crates. The root `exclude = ["spikes"]` boundary and the 20-manifest checker address that concrete failure without changing any spike source or lockfile. Final CI disposition remains in the PR body.

The same CI run reached the historical integrity checker, which needs an archived merge ref unavailable in GitHub's default shallow checkout. The foundation workflow now fetches full Git history for that fixed-ref check. This changes CI checkout depth only; it does not rewrite the archived verifier or its reference.

## Compatibility and safety

The v2 wire bytes and strict verifier were copied only as experimental internal candidate code; no production protocol adoption, signer, merchant keys or live trust defaults are added. No SQL migration, tenant record, billing command, cart mutation, artwork upload or provider API change is introduced. Synthetic fixtures contain public test keys only. Root build scripts fetch pinned public Function tools and perform offline replays without Shopify CLI authentication. The unfinished gate obligations remain in [the milestone register](M1-UNRESOLVED-ACCEPTANCE.md).

## Principal decision — external

Verdict, gate acceptance, bound final PR refs and authorization for any next slice are reserved for the principal and owner. This packet is local implementation evidence, not principal approval.
