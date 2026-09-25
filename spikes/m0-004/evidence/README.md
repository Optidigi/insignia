# M0-004 local proof — evidence and limits

Run date: 25 September 2026 UTC. Repo: `Optidigi/insignia`. Branch: `spike/m0-004-local-authorization`, started from verified PR #6 normal merge `4591d102bb7368681622221253dbd4c997df1ad4`. This is a **local synthetic outcome with a material G2 capacity failure**, not a deployed Function, full gate pass or protocol freeze.

## Reproduce

From `spikes/m0-004`, with Node 24.21.0, pnpm 12.6.0, Rust 1.98.1 + `wasm32-unknown-unknown`, and an available native linker:

```bash
./scripts/check-local.sh
```

The command installs from frozen project locks, checks strict TypeScript, runs Rust fmt/Clippy/native tests, builds both pinned 2026-07 target binaries through Shopify CLI 4.8.2, validates synthetic query/input/output shapes and runs target smoke and benchmark paths through function-runner 9.2.2. The CLI build is essential: direct Cargo Wasm artifacts retain imports that the local runner does not recognize; CLI postprocessing yields runnable artifacts. The committed `shopify.app.toml` has a synthetic zero client ID and no scopes; these local commands do not access the designated merchant app or staging store. The project's historical M0-001 local suite was rerun separately and passed 11 fixtures; its source/receipts were not changed.

Observed package check: exit 0. Strict TypeScript: 57 tests. Rust core: 15 behavior tests + 2 independent/cross-language vector tests, all passed. Each target: 1 native SDK Context test covering multiple positive/negative assertions, passed. Fmt and Clippy `-D warnings`: passed for all three crates. Both CLI builds and seven Wasm smoke executions: passed. The benchmark command completed and captured expected outputs even where the runner's measured instructions or output exceed Shopify's published limits. The [same-launch high host record](runtime.json) is host-reported client configuration, not private model attestation. The separate Rust writer worked in its own worktree; the read-only schema scout made no edits or merchant calls.

Inputs are labelled **schema-valid synthetic projection** in [smoke rows](runner-smoke.json) and [benchmark rows](runner-bench.json). The JSON fixture container is not the authorization wire format. The [golden corpus](../fixtures/vectors.json) has independent Python/cryptography Ed25519 bytes/signatures from RFC 8032 test seed 1, 3 valid and 22 invalid vectors. Node and Rust match their canonical byte/verification outcomes. The 2026-07 Transform and Validation schemas and queries are committed, along with TS/pnpm/Cargo locks; [contract and source mapping](../contract.md) records the trust boundary. All test keys are public standard examples and never merchant keys.

## Complete-target resource result

The following rows execute full signature, set and target-output paths on the pinned local runner. Shopify's [published Function limits](https://shopify.dev/docs/api/functions/2026-07) are 256,000 binary bytes, 10,000,000 linear-memory bytes, 512,000 stack bytes, and for carts up to 200 lines 11,000,000 instructions, 128,000 input bytes and 20,000 output bytes. The 2026-07 URL may redirect to the current reference; committed schemas fix the actual query contract. The CLI helper reports instructions and memory KiB; stack peak and numeric query cost were unavailable. Query text is 573 bytes Transform / 642 bytes Validation, below the 3,000-byte limit; cost remains UNKNOWN. Final CLI-built binaries are 156,148 / 157,018 bytes, SHA-256 in the verification manifest. Reported linear memory is 1,152 KiB in these runs.

| Signed buckets / ordinary lines | Transform instructions | Validation instructions | Measured-limit result |
|---|---:|---:|---|
| 1 / 0 | 2,356,494 | 2,329,288 | within measured limits |
| 4 / 0 | 9,436,004 | 9,323,243 | within measured limits; only 14.2% Transform instruction headroom |
| 10 / 0 | 23,542,618 | 23,259,244 | **over** 11M instruction limit |
| 32 / 0 | 74,974,685 | 74,067,814 | **over** 11M |
| 64 / 0 | 150,247,062 | 148,432,217 | **over** 11M; Transform output 32,775 bytes also over 20k |
| 2 / 198 | 8,815,594 | 8,903,682 | within measured limits at 200 cart lines |
| 3 / 197 | 11,149,862 | 11,208,408 | **over** 11M at 200 lines |
| 5 / 0, 2,000 units each | 11,768,201 | 11,628,471 | **over** 11M; 10,000 physical units represented without per-unit objects |

Review corrections added a shared 10,000-unit trusted quantity bound, raw-byte ASCII checks, bounded D+2 issuance, common key ID, marked-line parity, allocation-to-issued-set coverage, codec-level declared-total parity and panic-free non-ASCII config rejection. The D+2 issuance day is not independently provable from the candidate wire payload. A missing required-product policy projection could make an unsigned line appear optional; publication/rollout must be proven before enforcement reliance. The local runner returned schema-valid outputs for over-limit cases; this does **not** make those cases deployable. A tenth-member bad signature also exceeded 23M instructions before rejection. The 200-line result means even the measured four-bucket isolated case is not a general cart capacity. No product-facing capacity has been accepted. This reproduces a G2 architecture/capacity issue for principal review. Further capacity work may need a different verifier/runtime strategy or protocol granularity, which cannot be silently substituted in this slice.

## What this proof does and does not establish

- **Local G3:** canonical 178-byte/238-character candidate, strict Rust Ed25519, trusted public-key lookup, set completeness and mutation rejection across languages. No actual Ajax/property/checkout/order token transport occurred; G3 remains IN_PROGRESS.
- **Local G5:** fixed accepted-price allocation conserves minor units in EUR 91, 500-unit and 10,000-unit vectors; exact lexical scalar SDK path is exercised natively and in Wasm. `subtotalAmount` is read from an independent synthetic input field, but live post-Transform pre-discount semantics across discounts/Markets are unverified. No real allocated-bucket lifecycle ran; G5 remains IN_PROGRESS.
- **Local G2:** both real exported target entrypoints build and run, and the measured budget failure is retained. Stack peak/query cost, live Function input shape, public-app qualification and deployment are not proved. G2 remains IN_PROGRESS, not PASS.

The plan/decision ledger hashes remain `c0432288deb778c4d717871d6f771f95e401d00b6a3caf1b878155cbf0e5422d` / `0c6c02bab83fb5032548c3d1be1f86ea1492ae3cfd26b6cacc8410f7d08737bb`. G1 retains the principal's limited observed C/R/B acceptance, immediate-R raw-capture gap and #1001 cause UNDETERMINED. Orders #1001–#1004, app/store settings, inventory, the old Function/schema and historical receipts were untouched. G4/G6/G7/G8 and M1 were not run here.

## Local review and principal boundary

Fresh restricted Spec and Standards/correctness review findings, fixes and final-diff follow-up are recorded in the review packet. Principal gate acceptance, architecture direction and PR review remain external. The outcome PR is not authorized to merge.
