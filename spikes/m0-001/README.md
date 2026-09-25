# M0-001 same-variant development spike

This is the minimal `2026-07` Cart Transform experiment for the existing `insignia` app. The Rust Function expands a marked, allowlisted real variant into one child of the same variant at a fixed 30.00 shop-currency unit price. The line marker is a fixture correlation value, not buyer authorization. The price operation remains only `lineExpand`.

## Local checks

Use Rust 1.98.1 with `wasm32-unknown-unknown`, Node 24, pnpm 12.6.0 and Shopify CLI 4.8.2. The host must supply a working C linker for native Rust; if the system has no `cc`, set `CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER` to an inspected local wrapper. Keep `CARGO_HOME`, `RUSTUP_HOME` and `RUSTUP_TOOLCHAIN` explicit for the pinned isolated toolchain.

```sh
corepack pnpm install --frozen-lockfile
./scripts/check-local.sh
```

The script checks Rust formatting, clippy, native tests, the release Wasm build and the Shopify test helper's schema-validated Wasm fixtures. It does not contact a store or deploy an app. The fixture IDs are synthetic; stage-specific real variant IDs belong in the spike-owned Cart Transform metafield after installation.

Use `corepack pnpm`, which selects the exact `packageManager` version in `package.json`. Project-local `pmOnFail: ignore` turns off pnpm's second package-manager resolver; Corepack retains the version pin and the lockfile stays a single YAML document for CI and dependency scanners.

The [M0-001 prompt](../../docs/delivery/prompts/M0-001-same-variant-dev-lifecycle.md) records the original harness scope. The current [M0-002 prompt](../../docs/delivery/prompts/M0-002-real-cart-order-lifecycle.md), [direct receipt index](evidence/m0-002/README.md) and [G1 evidence](../evidence/G1.md) distinguish local checks, the real development-store outcome and outstanding public-app qualification.
