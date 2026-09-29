#!/usr/bin/env bash
# Local source build only. This script never invokes Shopify CLI or an account.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
target="${1:?expected transform or validation}"
case "$target" in transform|validation) ;; *) exit 2 ;; esac
crate="$repo/crates/cart-$target"
extension="$repo/extensions/insignia-cart-$target"
case "$target" in
  transform) query=cart_transform_run.graphql ;;
  validation) query=cart_validations_generate_run.graphql ;;
esac
cmp "$crate/src/$query" "$extension/src/$query"
cmp "$crate/schema.graphql" "$extension/schema.graphql"
tools_dir="$crate/target/m1-tools"
trampoline="${M1_FUNCTION_TRAMPOLINE:-$tools_dir/shopify-function-trampoline-2.0.1}"
expected='1b9e07e930353a21282820362e6d0fb475766f773d6ad27b79f295b9a628248c'
if [[ ! -f "$trampoline" ]]; then
  mkdir -p "$tools_dir"
  curl -fLsS 'https://github.com/Shopify/shopify-function-wasm-api/releases/download/shopify_function_trampoline/v2.0.1/shopify-function-trampoline-x86_64-linux-v2.0.1.gz' -o "$tools_dir/trampoline.gz"
  gzip -dc "$tools_dir/trampoline.gz" > "$trampoline"
  chmod 0755 "$trampoline"
  rm "$tools_dir/trampoline.gz"
fi
printf '%s  %s\n' "$expected" "$trampoline" | sha256sum -c -

# Keep both build intermediates and the final artifact inside this worktree.
export CARGO_TARGET_DIR="$crate/target"
export CARGO_PROFILE_RELEASE_LTO=true
export CARGO_PROFILE_RELEASE_OPT_LEVEL=3
export CARGO_PROFILE_RELEASE_STRIP=true
lock_args=()
if [[ -f "$repo/Cargo.lock" ]]; then
  lock_args+=(--locked)
fi
cargo build --manifest-path "$crate/Cargo.toml" --target wasm32-unknown-unknown --release "${lock_args[@]}"
raw="$crate/target/wasm32-unknown-unknown/release/cart-$target.wasm"
mkdir -p "$extension/target"
cp "$raw" "$extension/target/cart-$target.raw.wasm"
"$trampoline" -i "$raw" -o "$extension/target/cart-$target.wasm"
sha256sum "$extension/target/cart-$target.raw.wasm" "$extension/target/cart-$target.wasm"
wc -c "$extension/target/cart-$target.raw.wasm" "$extension/target/cart-$target.wasm"
