# M0-004R — verifier corrections and bounded capacity investigation

Principal-issued continuation of M0-004, 25 September 2026. Work on existing PR #7; no merge authority. This prompt narrows and extends ordinary local implementation tactics only; locked product decisions and protocol shape are unchanged.

## Outcome

Return ONE corrected PR with raw-byte and strict-profile regressions closed, a bounded validity-window check, preserved exact-money behavior, and an evidence-backed answer about how much capacity can be recovered without changing the token/signature architecture. Capacity is allowed to remain failed; do not manufacture a product cap or claim an unrun gate passed.

## Start and authority

1. Verify `Optidigi/insignia` PR #7, base/effective merge base `4591d102bb7368681622221253dbd4c997df1ad4`, reviewed head `d5e18b9a1dec9492f76b8a006f4b62ffc9c1dfae`, and the existing working tree. Preserve any newer legitimate local work; investigate unexpected remote changes rather than reset or force-push. Continue on the PR branch with ordinary commits. PR #7 is NOT approved to merge.
2. Read AGENTS, the ledger, current state, original M0-004 prompt, relevant plan sections, `spikes/m0-004/contract.md` and the attached principal review. Use pinned writing-for-agents, tdd, diagnosing-bugs and code-review skills where relevant; their defaults do not grant authority or require a fresh product interview. Store this review and prompt under the existing delivery conventions; update only operational pointers needed for this continuation.
3. Use the established actual gpt-6-sol/high execution route. At most two non-overlapping writers, separate worktrees, one integration owner. Fresh Spec and Standards/correctness review follows integration. Read-only reviewers have no merchant connectors or merge authority. A worktree is not an OS sandbox; report actual permissions honestly and use the proven restricted routes for delegated execution. No general preflight, new agent framework or global security changes.

## Workstream A — canonical protocol and trust-boundary corrections

**R1 raw magic:** compare the four bytes exactly, not through Node's ASCII decoder. Reproduce the supplied fifteen high-bit variants on pinned Node 24.21.0 before fixing. Add parser regressions and independently signed malformed-header fixtures in both language paths. Tests must fail for invalid format even with a deliberately valid test signature. Preserve all prior valid vector bytes; append negative vectors rather than regenerate existing accepted values. Keep the unre-signed tampering control to distinguish the parser defect from signature forgery.

**R2 strict verification:** run the identity-key/R=identity/S=0 probe under pinned Node/OpenSSL and through Rust. Record exact key, signature and expected rejection stage without merchant material. Add shared-key-aware vectors, malformed/noncanonical scalar cases and normal-key controls. Make weak-key rejection an executable key-admission or verifier invariant in both paths. If the pinned runtime already rejects, test and document it. Otherwise select the smallest maintained validation/verifier route with documented semantics; project-local pinned dependencies are allowed if necessary. Do not weaken `verify_strict`, use handwritten elliptic-curve code, or rely on type branding without validation. Do not claim wider hostile-key equivalence than the tested profile establishes.

**Validity interval:** retain E=D+2 at issuance from an explicit trusted shop-local day. Verify in both full-set paths that the current day belongs to E-2 through E, using validated unsigned dates and subtraction only after ordering checks. Cover D-1, D, D+1, D+2, D+3, excessive future expiry and integer boundaries, plus existing DST/calendar cases. This is effective validity, not independent proof of historical signing time; no wire field, protocol version or timestamping service is needed.

**Policy regression:** add a clearly labelled local negative-capability test showing the actual missing-policy/unsigned-line allow path, paired with ordinary optional and known-required controls. Retain it as a disclosed pre-live enforcement blocker. State which independent fact is absent and what a later rollout proof must supply. This package does not authorize changing the whole catalog policy model or making all ordinary merchandise fail closed.

Completion: golden and behavioral tests exercise current repository code, the strict profile is stated and tested on the pinned runtimes, historical valid vectors remain unchanged, and outstanding live assumptions are not presented as proved.

## Workstream B — bounded same-protocol resource investigation

Preserve the submitted baseline measurements, source/build/config/runner hashes and rejected capacity conclusion. New results go in clearly named corrected-baseline/experiment artifacts with source refs and provenance; do not overwrite the failed evidence to make it disappear.

1. Obtain one corrected baseline on the complete CLI-built targets. Separate binary size, instructions, output/input, memory, unknown stack/query cost and actual runner errors. Benchmark signature/key parsing, target input traversal and serialization sufficiently to locate the dominant work. Diagnostic microbenchmarks explain cost; complete targets determine feasibility.
2. Implement low-risk, behavior-preserving improvements supported by that evidence: reject structural/context/count/duplicate/quantity failures before expensive signature work; parse/validate each trusted public key once per invocation; reuse decoded claims rather than decoding again for output; avoid unnecessary traversal/allocation of ordinary lines. Every accepted signed member must still receive strict verification. Return the original safe empty/reject outcomes on failure; do not emit partial authorized transforms.
3. Test no more than THREE justified optimized configurations after the corrected baseline. Current release builds already use opt-level 3 and LTO. Feature/backend alternatives must be supported by the pinned dependency/toolchain and retain verification semantics; do not enable legacy compatibility or randomness-dependent batch behavior merely to get under budget. Review source/docs for any feature tradeoff and measure binary size as well as instructions.
4. Retain the original 28-row benchmark matrix and add zero-signed ordinary-cart and malformed/over-capacity negative controls. In particular preserve 10 signed buckets; mixed carts with 200 total lines; 32/64 signed probes; first/last invalid signature; missing/duplicate members; and 10,000 units represented in five schema-legal 2,000-quantity buckets. Do not remove hard rows or repeat signatures to claim independent signed-line capacity.
5. Keep the 64-bucket output-size failure separate from signature execution cost. The one-token-per-child representation's >20k output is not solved by faster verification. No output omission or transport/protocol change is authorized here.

Completion: a small ranked experiment table compares equivalent full-path cases. Keep only a justified safe optimization in the working implementation; optional diagnostic variants remain clearly non-deployable. If the envelope is still insufficient, stop optimization and report the limiting operation and realistic design options for principal adjudication. Do not implement a different signature algorithm, aggregate/shared-set commitment, Merkle proof, prehashed signature variant, unsigned trust shortcut, or pricing architecture. Do not choose a two-/four-bucket product limit. No particular performance gain or complete G2 pass is required to return an honest result.

## Integration, verification and handoff

The orchestrator owns common fixtures/contracts, shared manifests, dependency locks, CI and state. Workers can proceed in parallel only on agreed non-overlapping paths; common changes are integrated by that owner. Complete tests, corrections and fresh local reviews inside this authorized package rather than stopping at each ordinary step.

Run the full off-store check on the final candidate and refresh final-head CI. Preserve historical tests and the unchanged M0-001 Function. The returned packet distinguishes code correctness, benchmark execution, capacity verdict and live unverified claims. Bind every measurement to the correct code/build; differences between local and CI binaries are reported rather than labelled byte-reproducible. A green workflow may contain correctly recorded failed capacity rows, but must not relabel them passed.

Report R1/R2 closure with exact new tests and pinned-runtime results, the validity-window tests, policy regression, experiment table, remaining input/output/live limitations, reviewer findings/dispositions and actual PR/base/head/effective merge base. The principal reviews the FULL corrected diff, not only the latest summary. Do not merge, mark gates complete, freeze protocol or start another package.

## Permission envelope

Allowed: scoped local files/builds/tests, necessary maintained pinned development/validation dependencies, public documentation/schema/source reads, public test keys, isolated experiments, off-store CI and ordinary updates to the existing PR. Reference copies of old probes are evidence, not production code.

Keep the architecture plan and decision ledger unchanged. Keep token length/layout/signing domain/ordinary Ed25519-per-line semantics unchanged. No live Shopify call or mutation, merchant credentials, browser/staging work, deployment, scope/key publication, real payment, model/host security downgrade or M1 scaffold. Leave staging orders #1001–#1004 and the earlier evidence untouched.
