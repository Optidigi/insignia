# PR #7 — principal review

Date: 25 September 2026. Verdict: **CHANGES_REQUESTED**.
Repository: `Optidigi/insignia`; PR #7.
Reviewed base/effective merge base: `4591d102bb7368681622221253dbd4c997df1ad4`.
Reviewed head: `d5e18b9a1dec9492f76b8a006f4b62ffc9c1dfae`.

Native REQUEST_CHANGES submission for this exact head returned HTTP 403 (Resource not accessible by integration); it was not posted. This document and the accompanying chat response are the external principal verdict. They do not authorize merging, deploying, or beginning M1. Correct the existing PR, then return its new head for review. A failed capacity experiment is useful evidence; the merge objection is the remaining canonical-decoding defect and unresolved strict-verification profile coverage, not the fact that the capacity experiment failed.

## Findings requiring correction

### R1 — compare the raw magic bytes (confirmed; medium)

`spikes/m0-004/ts/authorization.ts:117` compares `b.toString('ascii', 0, 4)` with `ISG1`. Node's ASCII decoder clears the high bit. Consequently `c9 53 47 31` passes the same check as canonical `49 53 47 31`; Rust's raw-byte comparison rejects it.

The principal ran the actual reviewed TypeScript source under Node v22.16.0 with type stripping. Its 7,870 bytes have Git blob `b888e023840887bdafb46eb43b4c434798a7498f`, matching the fetched PR file. All fifteen nonempty high-bit masks over the four magic bytes passed both payload decoding and token verification when deliberately signed with the public RFC 8032 test seed. The same mutations WITHOUT re-signing were rejected. This is canonical-format/interoperability failure, not a demonstrated signature bypass against a valid merchant key. Node 24 documentation specifies the same ASCII decoding behavior.

Use raw-byte equality. Add independent, deliberately signed malformed-header vectors and direct parser regressions in TypeScript and Rust. Preserve the existing valid token bytes and signing domain. The attached reproduction snapshots characterize the old implementation; new regression tests must exercise the corrected repository module, not the attached copy.

Sources: reviewed [TypeScript](https://github.com/Optidigi/insignia/blob/d5e18b9a1dec9492f76b8a006f4b62ffc9c1dfae/spikes/m0-004/ts/authorization.ts), [Rust](https://github.com/Optidigi/insignia/blob/d5e18b9a1dec9492f76b8a006f4b62ffc9c1dfae/spikes/m0-004/rust/authorization/src/lib.rs), [Node 24 Buffer documentation](https://nodejs.org/docs/latest-v24.x/api/buffer.html).

### R2 — make weak-key/strict-verification parity executable (medium; pinned-runtime confirmation required)

The TypeScript key import at lines 155–158 checks byte shape but does not establish a strong-key admission policy. It delegates verification at line 186 to Node/OpenSSL. Rust uses `verify_strict`.

Against the actual reviewed TS module, the principal's Node v22.16.0 / OpenSSL 3.0.16 accepted the compressed identity public key `01` followed by 31 zero bytes with signature R=identity, S=0. A normal RFC-test public key rejected the identical signature, and its genuine signature was accepted. The weak-key acceptance requires the TRUSTED registry to admit the weak key; it is not evidence that a buyer can replace the merchant key. The principal did not execute this on the pinned Node 24.21.0 runtime or run the Rust crate locally. Dalek 2.2.0 documents that `verify_strict` rejects weak keys.

Run the supplied case on the pinned runtime. Add cross-language vectors with the appropriate per-case key, plus strong-key negative controls and noncanonical-scalar cases. Both application paths must reject weak keys at a documented admission/verification boundary. If Node 24 already rejects this exact case, preserve the regression and report that result; do not swap libraries unnecessarily. Otherwise use a maintained validation/verifier implementation consistent with the strict application profile. A TypeScript type assertion or a claim that keys are normally well generated is not runtime admission validation. Do not relax Rust verification or implement curve arithmetic to obtain agreement.

Sources: reviewed TypeScript/Rust above; [Dalek 2.2.0 VerifyingKey](https://docs.rs/ed25519-dalek/2.2.0/ed25519_dalek/struct.VerifyingKey.html). Local repro scripts/results are included with this review.

## Capacity adjudication

Accept the reported complete-target measurements as negative local G2 evidence. No usable product capacity is accepted. At ten isolated signed buckets, Transform uses 23,542,618 and Validation 23,259,244 instructions. Three signed plus 197 ordinary lines use 11,149,862 and 11,208,408. Five 2,000-unit buckets also exceed 11M. At 64 buckets, Transform output is 32,775 bytes, independently over the 20,000-byte reference.

The published limits apply per invocation; do not add the two Functions' costs together or use a successful unmetered/local runner return as deployability proof. The four-bucket isolated result is not permission to impose a four-bucket product cap. The 64-bucket output problem cannot be repaired by faster signature arithmetic alone.

Authorize the attached bounded, wire-preserving profiling/optimization continuation in this SAME PR. First close R1/R2; then measure safe structural prechecks, invocation-local parsed-key reuse, decoded-claim reuse and documented compatible backend/build options. Preserve strict verification of every accepted signature. At most three justified configurations after the corrected baseline; a remaining failure is a valid stopping result. No alternate algorithm, signature aggregation, shared-set signing, weaker verification or changed materialization/transport format is authorized.

Sources: [retained benchmark](https://github.com/Optidigi/insignia/blob/d5e18b9a1dec9492f76b8a006f4b62ffc9c1dfae/spikes/m0-004/evidence/runner-bench.json), [current Shopify Function limits](https://shopify.dev/docs/api/functions/2026-07).

## Other disclosed limits

**Validity window:** a separate issuance-day field is not required to establish a fixed three-calendar-date validity interval. Keep the trusted issuer rule E=D+2; add overflow-safe checks equivalent to `today <= E && E - today <= 2`, with the existing date domain validated. This defines the effective interval E-2 through E; it does not prove the physical moment the signer ran. The backend must derive D from its trusted shop-local clock and retain issuance history. Do not change the wire format or introduce timestamp attestation.

**Required-product policy:** missing policy plus absent token currently reaches an allow path. This is a known unsafe deployment assumption, not evidence of G6 enforcement. Preserve a named synthetic test documenting this limitation and the pre-live dependency on independent product identity/policy availability, safe publication ordering and reconciliation. Do not classify all unrelated ordinary products as required, and do not pretend a second copy of the same missing field proves policy completeness. No production policy architecture is being silently selected in this repair.

**Validation economics and transport:** the lexical scalar experiment is valuable, but live post-transform pre-discount meaning, actual token propagation and allocated-bucket lifecycle remain unverified. G3/G5 are not complete; G6 is not passed.

**Execution:** the current runtime record reports gpt-6-sol/high, resolving the prior effort mismatch at that evidence level. It also reports an unrestricted parent host. Do not call that parent sandboxed; worktree/task boundaries are not security isolation. Use the proven restricted writer/reviewer routes for delegated work and keep the off-store/no-merchant-credential envelope. No global security change is authorized.

## Verification performed and limits

Inspected the PR metadata, 58-file inventory/comparison, relevant TypeScript/Rust source and tests, target adapters, fixture generator, candidate contract, runner, evidence/review/runtime records and actual final-head CI job log. The successful run is 36162870630, job 108163453936; its checkout log identifies the reviewed base/head pair. It exercises 57 TS tests, 15+2 Rust core tests, two native target tests, both CLI builds and seven/28 smoke/benchmark rows. Green CI means that the checks and measurements ran; it does not mean capacity passed.

The principal executed only the attached Node v22.16.0 reprobes here, not the full Rust/Wasm suite or a Shopify call. No local clone, production key, stage mutation or independent remeasurement of all resource rows is claimed. Local and CI binary sizes differ, so keep each artifact hash bound to its actual build; do not claim cross-host byte reproducibility from equal instruction counts.

Architecture records retain the approved Git blob identities: plan `d3d7d9c155cdcdcc3b88aeaaa77eebb10d8a767d`, ledger `3544e054bb52c11713b2bc1c96cdf6d7a2264936`; neither appears in the changed-file comparison. The candidate remains unfrozen. G2/G3/G5 stay IN_PROGRESS with the capacity failure explicitly retained; G1's accepted limited evidence is unaffected.

The next action is the attached **M0-004R correction on PR #7**, not a merge and not M0-005. Re-review is required at the corrected head, even if all local reviewers approve it.
