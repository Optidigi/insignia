#!/usr/bin/env bash
# Build the M0-014R source that the extension will upload. Historical M0-013
# binaries remain in artifacts/{transform,validation}.wasm.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
target="${1:?expected transform or validation}"
mode="${2:-verify}"
case "$target" in transform|validation) ;; *) exit 2 ;; esac
case "$mode" in record|verify) ;; *) exit 2 ;; esac

cargo="${M0_014_CARGO:-cargo}"
trampoline="$repo/spikes/m0-005/node_modules/.pnpm/@shopify+cli@4.8.2/node_modules/@shopify/cli/bin/shopify-function-trampoline-2.0.1"

# A per-checkout Cargo build changes binary metadata even when path strings are
# remapped. Build from one fixed scratch path and serialize its shared use.
# rsync omits target/ and removes stale source files from an earlier run.
build_root=/tmp/insignia-m0-014r-fixed-build
mkdir -p "$build_root/spikes/m0-014/rust"
exec 9>"$build_root/.build.lock"
flock -x 9
if [[ ! -x "$trampoline" ]]; then
  # A clean pnpm install leaves CLI's lazy native download absent. Fetch the
  # exact CLI 4.8.2 trampoline release and verify its executable bytes before
  # source build or upload; Shopify CLI later uses this same path.
  tmp_gz="$build_root/trampoline-2.0.1.gz"
  tmp_bin="$build_root/trampoline-2.0.1"
  curl -fLsS 'https://github.com/Shopify/shopify-function-wasm-api/releases/download/shopify_function_trampoline/v2.0.1/shopify-function-trampoline-x86_64-linux-v2.0.1.gz' -o "$tmp_gz"
  gzip -dc "$tmp_gz" > "$tmp_bin"
  echo "1b9e07e930353a21282820362e6d0fb475766f773d6ad27b79f295b9a628248c  $tmp_bin" | sha256sum -c -
  install -m 0755 "$tmp_bin" "$trampoline"
  rm -f "$tmp_gz" "$tmp_bin"
fi
echo "1b9e07e930353a21282820362e6d0fb475766f773d6ad27b79f295b9a628248c  $trampoline" | sha256sum -c -
rsync -a --delete --exclude='target/' "$repo/spikes/m0-014/rust/" "$build_root/spikes/m0-014/rust/"
unset CARGO_TARGET_DIR
cargo_home="${CARGO_HOME:-$HOME/.cargo}"
rustup_home="${RUSTUP_HOME:-$HOME/.rustup}"
export RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }--remap-path-prefix=$build_root=/insignia --remap-path-prefix=$cargo_home=/cargo --remap-path-prefix=$rustup_home=/rustup"

manifest="$build_root/spikes/m0-014/rust/$target/Cargo.toml"
release="$build_root/spikes/m0-014/rust/$target/target/wasm32-unknown-unknown/release/m0-013-cart-$target.wasm"
upload="$repo/spikes/m0-014/rust/$target/target/wasm32-unknown-unknown/release/m0-013-cart-$target.wasm"
artifact="$repo/spikes/m0-014/artifacts/m0-014r/$target.wasm"
raw_artifact="$repo/spikes/m0-014/artifacts/m0-014r/$target.raw.wasm"

# The trampoline mutates Cargo's output in place. Force a fresh pre-trampoline
# executable on every invocation so repeated CLI builds cannot double-wrap it.
"$cargo" clean --manifest-path "$manifest" --target wasm32-unknown-unknown --release
"$cargo" build --manifest-path "$manifest" --target wasm32-unknown-unknown --release --locked
if [[ "$mode" == record ]]; then
  mkdir -p "$(dirname "$artifact")"
  cp "$release" "$raw_artifact"
else
  cmp "$release" "$raw_artifact"
fi
"$trampoline" -i "$release" -o "$release"
if [[ "$mode" == record ]]; then
  cp "$release" "$artifact"
else
  cmp "$release" "$artifact"
fi
mkdir -p "$(dirname "$upload")"
cp "$release" "$upload"
cmp "$upload" "$artifact"
printf '%s raw/final sha256: ' "$target" >&2
sha256sum "$raw_artifact" "$artifact" >&2
