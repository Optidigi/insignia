# M0-005 off-store evidence

25 September 2026 UTC. Synthetic, schema-validated local Function inputs only. The reviewed M0-004R baseline, including its failed results, is preserved in [`spikes/m0-004/evidence/m0-004r/`](../../m0-004/evidence/m0-004r/). The owner authorized the exact PR #7 merge and this isolated M0-005 prototype. Remote `main` merge `878c9b9b58cc7aeae81b2393847eb18ef91e2540` has the approved base `4591d102bb7368681622221253dbd4c997df1ad4` and head `f1bf2484a8805138bef4b95cfa0b90e60f8da7f3` as parents. The principal's verdict was external; native approval failed HTTP 403.

## Reproduction and provenance

The integrated local check used Node 24.21.0, pnpm 12.6.0, Rust 1.98.1, Shopify CLI 4.8.2, `shopify_function` 2.2.0 and the pinned 2026-07 generated schemas. The exact CLI-built Wasm is run by the pinned Function runner; a direct Cargo Wasm output is not interchangeable. The local command was:

```sh
cd spikes/m0-005
PATH=/home/serveradmin/insignia-pf001-tools/rust/cargo/bin:$PATH \
CARGO_HOME=/home/serveradmin/insignia-pf001-tools/rust/cargo \
RUSTUP_HOME=/home/serveradmin/insignia-pf001-tools/rust/rustup \
RUSTUP_TOOLCHAIN=1.98.1 \
CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=/home/serveradmin/insignia-pf002-rust-smoke/cc-zig \
ZIG_GLOBAL_CACHE_DIR=/tmp/m0-005-zig-cache \
./scripts/check-local.sh
```

`check-local.sh` exited 0 after 10 TypeScript issuer/codec tests, 13 Rust core tests, 5 native tests per complete Function target, Rust formatting and Clippy `-D warnings`, two local Shopify CLI builds, 28 smoke rows and 42 benchmark rows. [The check log](local-check.log), [smoke rows](smoke.json) and [benchmark rows](bench.json) preserve outputs; every runner row had `runnerError: null`. Exact [smoke inputs and expected outputs](cases-smoke.jsonl) and [benchmark inputs and expected outputs](cases-bench.jsonl) are retained as synthetic JSON Lines, with matching per-row SHA-256 digests and manifest hashes. Transform expected prices come from independent case prices, not decoded member bytes. The independent [Python golden check](../fixtures/check-vectors.py) exited 0 with `cryptography` 46.0.5. Python, the TypeScript issuer and Rust agree on the shared €91 header, records, signature and carriers. Fifteen independently re-signed raw magic high-bit combinations reject in TypeScript decoding and Rust verification; Rust also tests noncanonical public points and revoked/out-of-window keys. The v2 key projection requires explicit revocation and day bounds; six full-target smoke rows reject omitted fields. TypeScript contains no custom curve verifier.

The pinned schemas expose the queried cart and line attributes. Synthetic query/fixture validation and successful target execution are not a live transport observation. The runner uses UUID-length cart-line IDs in its complete JSON measurements and includes child attribute names/values, price and structural overhead. Native host tests with shorter 16-digit numeric IDs have separate output sizes in the [target note](../extensions/README.md). [Shopify's 2026-07 Function limits](https://shopify.dev/docs/api/functions/latest#limitations) list 11M instructions, 128kB input and 20kB output for up to 200 cart lines, plus independent binary/memory/query limits.

## Full-target result

The engineering target is 8.8M instructions and 16,000 output bytes (20% headroom under the published 11M / 20,000 references) for 10 signed buckets with 190 ordinary lines. Both complete targets pass that local synthetic target. The same Function invocation is measured independently for each target; instruction counts are not added.

| Synthetic case | Transform instructions / output bytes | Validation instructions / output bytes | Result |
|---|---:|---:|---|
| 0 signed + 200 ordinary | 1,765,167 / 17 | 2,991,825 / 17 | Within reference |
| 1 signed + 199 ordinary | 5,873,285 / 359 | 6,201,853 / 17 | Within reference |
| 3 signed + 197 ordinary | 5,942,188 / 1,045 | 6,258,123 / 17 | Within reference |
| 4 signed + 196 ordinary | 5,916,364 / 1,388 | 6,224,901 / 17 | Within reference |
| **10 signed + 190 ordinary** | **6,055,185 / 3,446** | **6,324,982 / 17** | **Meets engineering headroom** |
| 32 signed + 168 ordinary | 6,491,192 / 10,992 | 6,619,612 / 17 | Within reference |
| **64 signed + 136 ordinary** | **7,114,868 / 21,968** | **7,037,769 / 17** | **Transform output fails 20,000-byte reference** |
| 10,000 physical units in five buckets | 2,806,568 / 1,731 | 2,785,835 / 17 | Within reference |
| 500-unit two-group tier | 2,683,369 / 702 | 2,675,450 / 17 | Exact allocator-derived 1,458,500 minor-unit total |
| €91 allocation | 2,717,558 / 632 | 2,709,756 / 17 | Exact 9,100 minor-unit total |

The 10/32/64 isolated signed cases are also retained in [bench.json](bench.json): Transform 2,985,888 / 3,777,770 / 4,918,003 instructions and Validation 2,938,824 / 3,626,463 / 4,615,061. Isolated 64 likewise fails output at 21,968 bytes. Early/late malformed and tampered members, duplicate/missing members and trusted-capacity rejections are measured in both full targets. The known absent-policy unsigned allow path is named in [smoke.json](smoke.json), beside optional plain and known-required unsigned controls; their exact input and expectation are in the case file.

The corrected M0-004R baseline took 22,024,958 / 21,977,289 instructions for 10 isolated signed buckets, and 139,637,529 / 139,330,027 for 64 isolated; its 64-bucket Transform output was 32,775 bytes. These are exact signed-count comparisons, but the new runner uses longer UUID-length cart-line IDs and a different candidate wire format, so output bytes are not a same-ID byte experiment. The old mixed-cart rows used 10 signed + 180 ordinary rather than the new 10 + 190; do not report them as an exact pair. The prior 16 smoke and 42 benchmark results remain unchanged.

At this local build, CLI Wasm was 163,952 bytes for Transform and 165,189 for Validation; the largest selected mixed-cart input was 78,184 bytes, and runner memory was at most 1,536 KiB. Query text was 638 / 707 bytes. Stack peak and numeric query cost were unavailable. The [manifest](manifest.json) binds the final source revision, locks, tool binaries, runner, artifacts, case files and row files. A second controlled clean build produced the same Transform SHA-256 `5a09cb507ebd95ed78c2d70a9d7ba6b143a6c80ea36906b115665e2e81801c2a` and Validation SHA-256 `f44aae83e2bdc15f6225a50fe4a15f9d759f28714eef2fb396c082a3d1f2aa17`. Its [28 smoke](repeat-smoke.json) and [42 benchmark](repeat-bench.json) rows, and both case files, were byte-identical to the first run; the [repeat check log](repeat-check.log) exited 0. The smoke/benchmark result SHA-256 digests were `d753c9ef3cb4157785afe49140cc709eb4276a806936b9475391e8385f48053f` / `8c89153c1c94f1690de9aaa828a457e39b3274f0f99f6037021eea9e617aad4b`. This local repeat does not establish cross-machine binary identity; final-head CI records its own hashes and retains its own case/result files and Wasm as a run artifact.

## Limits and disposition

The schema-valid shared cart envelope may not survive actual Transform, checkout or order representations. The Validation subtotal may not be a universally independent pre-discount child-price source after discounts. Required unsigned products can still pass when the independent required-product policy is absent; the negative capability is preserved, not relabeled secure. Key projection rollout and all hostile-key cross-runtime equivalence are not established. No product-facing maximum, protocol freeze, G2/G3/G5 pass or G6 enforcement claim follows. G1 remains IN_PROGRESS; G4/G7/G8/M1 are outside this local package. The [draft decision proposal](../draft-decision-proposal.md) recommends further evidence for principal adjudication.
