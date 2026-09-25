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

`check-local.sh` exited 0 after 18 TypeScript tests, 12 Rust core tests, 4 native tests per complete Function target, Rust formatting and Clippy `-D warnings`, two local Shopify CLI builds, 22 smoke rows and 42 benchmark rows. [The check log](local-check.log), [smoke rows](smoke.json) and [benchmark rows](bench.json) preserve outputs; every runner row had `runnerError: null`. The independent [Python golden check](../fixtures/check-vectors.py) exited 0 with `cryptography` 46.0.5. All three implementations agree on the shared €91 header, records, signature and carriers. Fifteen independently re-signed raw magic high-bit combinations reject in TypeScript and Rust.

The pinned schemas expose the queried cart and line attributes. Synthetic query/fixture validation and successful target execution are not a live transport observation. The runner uses UUID-length cart-line IDs in its complete JSON measurements and includes child attribute names/values, price and structural overhead. Native host tests with shorter 16-digit numeric IDs have separate output sizes in the [target note](../extensions/README.md). [Shopify's 2026-07 Function limits](https://shopify.dev/docs/api/functions/latest#limitations) list 11M instructions, 128kB input and 20kB output for up to 200 cart lines, plus independent binary/memory/query limits.

## Full-target result

The engineering target is 8.8M instructions and 16,000 output bytes (20% headroom under the published 11M / 20,000 references) for 10 signed buckets with 190 ordinary lines. Both complete targets pass that local synthetic target. The same Function invocation is measured independently for each target; instruction counts are not added.

| Synthetic case | Transform instructions / output bytes | Validation instructions / output bytes | Result |
|---|---:|---:|---|
| 0 signed + 200 ordinary | 1,765,507 / 17 | 2,991,595 / 17 | Within reference |
| 1 signed + 199 ordinary | 5,593,520 / 359 | 5,922,165 / 17 | Within reference |
| 3 signed + 197 ordinary | 5,662,088 / 1,045 | 5,978,440 / 17 | Within reference |
| 4 signed + 196 ordinary | 5,636,599 / 1,388 | 5,945,218 / 17 | Within reference |
| **10 signed + 190 ordinary** | **5,775,425 / 3,446** | **6,045,299 / 17** | **Meets engineering headroom** |
| 32 signed + 168 ordinary | 6,211,092 / 10,992 | 6,340,269 / 17 | Within reference |
| **64 signed + 136 ordinary** | **6,834,793 / 21,968** | **6,758,426 / 17** | **Transform output fails 20,000-byte reference** |
| 10,000 physical units in five buckets | 2,526,924 / 1,731 | 2,506,147 / 17 | Within reference |
| 500-unit two-group tier | 2,403,564 / 702 | 2,395,775 / 17 | Exact 1,458,500 minor-unit total |
| €91 allocation | 2,437,796 / 632 | 2,430,085 / 17 | Exact 9,100 minor-unit total |

The 10/32/64 isolated signed cases are also retained in [bench.json](bench.json): Transform 2,706,221 / 3,498,292 / 4,638,541 instructions and Validation 2,659,136 / 3,346,435 / 4,335,033. Isolated 64 likewise fails output at 21,968 bytes. Early/late malformed and tampered members, duplicate/missing members and trusted-capacity rejections are measured in both full targets. The known absent-policy unsigned allow path is named in [smoke.json](smoke.json), beside optional plain and known-required unsigned controls.

The corrected M0-004R baseline took 22,024,958 / 21,977,289 instructions for 10 isolated signed buckets, and 139,637,529 / 139,330,027 for 64 isolated; its 64-bucket Transform output was 32,775 bytes. These are exact signed-count comparisons, but the new runner uses longer UUID-length cart-line IDs and a different candidate wire format, so output bytes are not a same-ID byte experiment. The old mixed-cart rows used 10 signed + 180 ordinary rather than the new 10 + 190; do not report them as an exact pair. The prior 16 smoke and 42 benchmark results remain unchanged.

At this local build, CLI Wasm was 162,584 bytes for Transform and 163,827 for Validation; the largest selected mixed-cart input was 78,129 bytes, and runner memory was at most 1,536 KiB. Query text was 638 / 707 bytes. Stack peak and numeric query cost were unavailable. The exact artifact/result/source hashes are recorded separately in the manifest. No cross-machine binary identity is claimed; final-head CI records its own hashes.

## Limits and disposition

The schema-valid shared cart envelope may not survive actual Transform, checkout or order representations. The Validation subtotal may not be a universally independent pre-discount child-price source after discounts. Required unsigned products can still pass when the independent required-product policy is absent; the negative capability is preserved, not relabeled secure. Key projection rollout and all hostile-key cross-runtime equivalence are not established. No product-facing maximum, protocol freeze, G2/G3/G5 pass or G6 enforcement claim follows. G1 remains IN_PROGRESS; G4/G7/G8/M1 are outside this local package. The [draft decision proposal](../draft-decision-proposal.md) recommends further evidence for principal adjudication.
