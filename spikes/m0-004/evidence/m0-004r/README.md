# M0-004R corrected local evidence

25 September 2026 UTC. Existing PR #7; reviewed base/effective merge base `4591d102bb7368681622221253dbd4c997df1ad4`, reviewed head `d5e18b9a1dec9492f76b8a006f4b62ffc9c1dfae`. These are synthetic, off-store local runs. They do not establish a deployable capacity, live enforcement or a gate pass.

## Reproduce and provenance

The [capacity manifest](capacity-manifest.json) records source, runner, CLI-built Wasm and row-file SHA-256 hashes for the corrected baseline and three bounded optimizations. Starting from the reviewed head, apply the four Rust source deltas in order: [baseline](baseline-source-delta.patch), [optimization 1](opt1-source-delta.patch), [optimization 2](opt2-source-delta.patch), [optimization 3](opt3-source-delta.patch). Each delta changes only the core Rust verifier and/or two target adapters. A clean scratch application reconstructed every measured source hash. Optimization 3 is the committed Rust source. The builds used pinned Rust 1.98.1, Shopify CLI 4.8.2, function-runner 9.2.2 and Node 24.21.0. The final rows are from a clean target build: a second clean build reproduced both opt3 Wasm SHA-256 hashes and all 58 rows exactly. Rebuilding without cleaning changed the same target artifacts during CLI postprocessing; [repeat-build rows](repeat-build-bench.json) and [CLI output](repeat-build-cli.log) retain that observation separately. It is the same source/configuration, not a fourth optimization. Do not call arbitrary repeated builds byte-reproducible.

The files named `baseline`, `opt1`, `opt2`, `opt3` and `final` each contain [16 smoke](final-smoke.json) and [42 benchmark](final-bench.json) full-target rows. The original 28 benchmark cases retain order and all compared input/output dimensions; 14 adversarial and ordinary-cart rows were appended. Every row has `runnerError: null`; expected over-limit rows remain `withinMeasuredReferenceLimits: false`. The known missing-policy unsigned allow path is explicitly flagged in smoke output. Inputs are schema-valid synthetic projections, not captured Shopify checkout inputs. Each result is per target invocation; Transform and Validation instruction counts must not be added together.

Run the integrated candidate from `spikes/m0-004` with project-local tools on `PATH`, Rust 1.98.1 and the configured native linker:

```bash
./scripts/check-local.sh
PATH="$PWD/node_modules/.bin:$PATH" SHOPIFY_CLI_NO_ANALYTICS=1 node scripts/target-runner.mjs smoke
PATH="$PWD/node_modules/.bin:$PATH" SHOPIFY_CLI_NO_ANALYTICS=1 node scripts/target-runner.mjs bench
```

The [full check log](full-local-check.log) records exit 0: 77 TypeScript tests; Rust fmt and Clippy `-D warnings`; 18 core behavior tests, 2 cross-language vector tests and 1 test per native target; both CLI Wasm builds; 16 smoke and 42 benchmark executions. The historical M0-001 suite was separately rerun with `cd spikes/m0-001 && corepack pnpm test`: [11 tests passed](historical-m0-001-test.log). Old evidence files were not overwritten.

The repeat build still has 16 smoke/42 benchmark rows with zero runner errors and the same expected outputs. Its 10-signed instructions are 22,023,840/21,976,287, still over 11M; the 64-bucket Transform output remains 32,775 bytes. Its binary hashes and sizes differ from the clean final artifact, so the clean build hashes in the manifest must be used when binding the primary capacity result. Final-head CI needs its own build-hash comparison; a green workflow does not mean an over-limit row passed.

## Correctness regressions

- The pinned Node 24.21.0 ASCII decoder previously accepted all 15 independently signed high-bit `ISG1` variants. The parser now compares raw bytes; each new TS and Rust vector asserts header-stage rejection. The unresigned tampering control remains.
- The [pinned Node strict-profile probe](strict-profile-node.json) rejects identity-key/R=identity/S=0, the same forgery under a normal key, and a valid signature's original R paired with S+L; the canonical signature succeeds. Rust `ed25519-dalek` 2.2.0 strict verification rejects these named cases. Rust admits only parsed nonweak trusted keys and reuses that parsed key for every signed member. This is a tested profile, not a general cross-runtime equivalence claim.
- Both verifiers accept an independently supplied current day only in the inclusive `E-2..E` interval, after checked ordering. Tests cover `E-3`, `E+1`, far-future E and `u32` boundaries. The token bytes and signing domain did not change. The wire payload lacks issuance day, so the actual signing time cannot be independently proved by the offline Function.
- Missing product-policy projection still permits an unsigned line that should require authorization. The regression deliberately records this negative capability. Publication and fail-closed policy rollout remain a live enforcement blocker.

## Capacity investigation

Reference limits used by the runner for a cart of at most 200 lines: 11,000,000 instructions per Function, 20,000 output bytes, 128,000 input bytes, 256,000 binary bytes, 10,000,000 linear-memory bytes and 512,000 stack bytes. Numeric query cost and stack peak were unavailable. Transform/Validation query text is 573/642 bytes; final CLI-built binaries are 156,805/158,188 bytes. The runner reports 1,152–1,536 KiB linear memory in the selected cases.

| Full-target case, Transform / Validation instructions | Corrected baseline | Optimization 1 | Optimization 2 | Retained optimization 3 / final |
|---|---:|---:|---:|---:|
| 10 signed, 0 ordinary | 23,708,560 / 23,425,227 | 22,190,626 / 22,143,047 | 22,190,719 / 22,143,047 | **22,024,958 / 21,977,289**, over 11M |
| 3 signed, 197 ordinary | 11,315,748 / 11,374,701 | 9,966,123 / 10,281,252 | 9,971,487 / 10,281,252 | 9,805,740 / 10,115,508 |
| 0 signed, 200 ordinary | 4,301,558 / 2,960,316 | 3,288,452 / 2,960,316 | 1,725,070 / 2,960,316 | 1,725,070 / 2,960,316 |
| 64 signed output bytes (Transform) | 32,775 | 32,775 | 32,775 | **32,775**, over 20,000 |

The first optimization moves structural/context/count/duplicate/quantity rejection before expensive signatures and reuses decoded claims. The second avoids unnecessary ordinary-line allocation/traversal. The third stores each nonweak parsed trusted key at config admission, so verification does not parse the selected key again. All retain strict verification for every complete accepted signed member and fail closed without partial Transform output. Invalid first signature costs about 3M instructions; an invalid tenth still costs about 22M, as the preceding nine signatures must be checked. A missing tenth member rejects before signatures at about 0.63M/0.66M instructions. Five 2,000-unit buckets (10,000 units) still cost 11,092,566/11,070,692 instructions and fail the reference budget. Four signed buckets in a 200-line mixed cart still fail; a two-bucket mixed cart fits measured limits. No tiny product cap was chosen.

A diagnostic native microbenchmark on optimization 2 measured 50,230 ns strict verify, 4,679 ns key parse and 780 ns token decode per operation on a retained exit-0 rerun. The [source](diagnostic-microbench.rs) and [actual output](diagnostic-microbench-output.txt) are retained. Copy the source to `rust/authorization/examples/microbench.rs` in an isolated optimization-2 scratch tree and run `cargo run --offline --locked --release --example microbench` there. This locates the dominant signed-line cost; complete Wasm targets above decide feasibility.

The 64-bucket Transform output failure is independent of signature execution. Stack peak, numeric query cost, actual checkout transport, live post-Transform pre-discount Validation semantics and policy propagation are unverified. G2/G3/G5 remain IN_PROGRESS, G6 is not established, and the protocol is not frozen.
