# M0-004R — corrected PR #7 review packet

25 September 2026 UTC. This is the full corrected diff on [existing PR #7](https://github.com/Optidigi/insignia/pull/7), following the [principal's attributed CHANGES_REQUESTED verdict](PR-007-principal-review.md) at base/effective merge base `4591d102bb7368681622221253dbd4c997df1ad4` and reviewed head `d5e18b9a1dec9492f76b8a006f4b62ffc9c1dfae`. No native GitHub principal approval was posted. PR #7 is not authorized to merge.

## Result and scope

R1's raw magic bug is closed: all 15 separately signed high-bit variants now fail at the parser in both language paths. R2's named pinned-runtime weak-key profile is closed by executable Node/Rust probes and Rust trusted-key admission. The fixed `E-2..E` validity interval now applies to independently supplied current day in both verifiers without changing token bytes. Exact-money and earlier Function behavior remain. The missing-policy projection gap is retained and explicitly tested as an enforcement blocker.

The bounded capacity study used one corrected baseline and two justified same-protocol optimizations; the second is retained. Ten signed buckets still exceed the 11M instruction reference (Transform 22,190,719; Validation 22,143,047). A 64-bucket Transform still produces 32,775 bytes against the 20,000-byte reference. The [complete measurement packet](../../spikes/m0-004/evidence/m0-004r/README.md) includes all source deltas, source/runner/build hashes, 16 smoke and 42 benchmark rows per configuration, failed rows, final integrated build and diagnostic results. No product capacity, full gate pass or protocol freeze is claimed.

## Actual local verification

| Check | Command / evidence | Result |
|---|---|---|
| Full off-store candidate | `cd spikes/m0-004 && ./scripts/check-local.sh` with project-local Rust 1.98.1, configured native linker and Shopify CLI 4.8.2; [output](../../spikes/m0-004/evidence/m0-004r/full-local-check.log) | Exit 0; 77 TS tests, Rust fmt/Clippy, 18 core + 2 cross-language + 1 per target native tests, both CLI-built Wasm targets, 16 smoke and 42 benchmark rows; expected capacity failures preserved |
| Final full-target rerun | `node scripts/target-runner.mjs smoke` and `bench` with local CLI on `PATH`; [final smoke](../../spikes/m0-004/evidence/m0-004r/final-smoke.json), [final benchmark](../../spikes/m0-004/evidence/m0-004r/final-bench.json) | 16/42 rows, zero runner errors; final instruction/input/output counts match optimization 2; final Wasm byte hashes differ by build path and are recorded |
| Historical unchanged Function | `cd spikes/m0-001 && corepack pnpm test`; [receipt](../../spikes/m0-004/evidence/m0-004r/historical-m0-001-test.log) | Exit 0, 11 tests |
| Retained old matrix | Compare original `runner-bench.json` to first 28 corrected rows by case/order/input/output dimensions | 28 of 28 retained; 14 new negative and ordinary-cart rows appended |
| Plan, ledger, old evidence | SHA-256 comparison to reviewed snapshot | Unchanged; plan `c0432288…`, ledger `0c6c02ba…`; old benchmark `21f9de2b…`, smoke `6e1aa68c…`, verification `472fc0cc…` |

The substantive orchestrator's host reports `gpt-6-sol`/high. The Rust writer ran actual `codex exec -m gpt-6-sol -c 'model_reasoning_effort="high"' -s workspace-write` in its separate worktree. That restricted session could edit its assigned files but could not create a Git index lock in metadata outside its sandbox; the integration owner copied only the four assigned source files and separately integrated the shared cross-language test. The integration owner's host had unrestricted filesystem access and is not described as sandboxed. Scratch experiments were off-store and used public test keys; no merchant connector, store resource or credentials were touched.

## Remaining boundaries

G2/G3/G5 local portions remain IN_PROGRESS. G2 capacity fails on important full-target cases even after optimization; stack peak and numeric query cost were unavailable. G3 has no live Ajax/property/checkout/order token transport or key-rollout proof. G5's live post-Transform pre-discount Validation amount semantics remain unverified. G6 enforcement cannot rely on absent policy projections. Shopify app/store settings, staging orders #1001–#1004, prior Function/schema, historical receipts, the implementation plan and decision ledger were untouched. No M1, G2–G8 gate acceptance, deployment or merge follows from this packet.

Fresh restricted Spec and Standards/correctness review findings and dispositions will be recorded below before final-head publication.
