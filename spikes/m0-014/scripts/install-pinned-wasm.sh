#!/usr/bin/env bash
set -euo pipefail

target="${1:?expected transform or validation}"
case "$target" in
  transform) expected=cebca846a17013a42dc590c18069ef5d9f0432452eb702d29bc46bbc1985590b ;;
  validation) expected=93148de17900a68732712ce687393ec920f903e55649115f23b9aa3b667a4ebd ;;
  *) exit 2 ;;
esac
source="../../artifacts/$target.wasm"
actual="$(sha256sum "$source" | cut -d' ' -f1)"
test "$actual" = "$expected"
mkdir -p target/wasm32-unknown-unknown/release
cp "$source" "target/wasm32-unknown-unknown/release/m0-013-cart-$target.wasm"
test "$(sha256sum "target/wasm32-unknown-unknown/release/m0-013-cart-$target.wasm" | cut -d' ' -f1)" = "$expected"
