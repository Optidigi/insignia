import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertPathIndependent, wasmBuildEnvironment } from './build-wasm.mts';

test('Wasm builds remap CARGO_HOME and ignore ambient RUSTFLAGS', () => {
  const env = wasmBuildEnvironment('/work/crates/cart-transform', {
    CARGO_HOME: '/home/runner/.cargo',
    RUSTFLAGS: '-C debuginfo=2',
  });
  assert.equal(env.CARGO_ENCODED_RUSTFLAGS, '--remap-path-prefix=/home/runner/.cargo=/cargo');
  assert.equal(env.CARGO_TARGET_DIR, '/work/crates/cart-transform/target');
  assert.equal(env.CARGO_PROFILE_RELEASE_STRIP, 'true');
});

test('a Wasm module embedding a build-machine path is rejected', () => {
  const bytes = Buffer.from('\0asm/cargo/registry/src/x.rs\0crates/cart-authorization/src/lib.rs');
  assert.doesNotThrow(() => assertPathIndependent(bytes, ['/home/runner', '/work']));
  assert.throws(
    () => assertPathIndependent(Buffer.from('/home/runner/.cargo/registry/src/x.rs'), ['/home/runner']),
    /machine-specific path/,
  );
});
