/** Local source build only; never invokes Shopify CLI or an account. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileHash, ROOT, TARGETS, type Target, text } from './runtime.mts';
import { ensurePinnedTool } from './tools.mts';

/**
 * Panic locations embed dependency source paths as data, so `strip` keeps them.
 * Workspace crates are already relative and std is already `/rustc/<hash>`; only
 * `$CARGO_HOME/registry` (and git checkouts) carry a machine-specific prefix.
 * Remapping it to `/cargo` makes CI and local builds byte-identical. The encoded
 * flags replace any ambient RUSTFLAGS so the bytes depend only on the source.
 */
const cargoHome = (env: NodeJS.ProcessEnv) => resolve(env.CARGO_HOME || join(homedir(), '.cargo'));
export function wasmBuildEnvironment(crate: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    CARGO_TARGET_DIR: join(crate, 'target'),
    CARGO_PROFILE_RELEASE_LTO: 'true',
    CARGO_PROFILE_RELEASE_OPT_LEVEL: '3',
    CARGO_PROFILE_RELEASE_STRIP: 'true',
    CARGO_ENCODED_RUSTFLAGS: `--remap-path-prefix=${cargoHome(env)}=/cargo`,
  };
}
/** Rejects a Wasm module that still embeds a machine-specific build path. */
export function assertPathIndependent(bytes: Buffer, prefixes: readonly string[]): void {
  for (const prefix of prefixes)
    assert(!bytes.includes(Buffer.from(prefix)), `Wasm embeds a machine-specific path: ${prefix}`);
}
export async function buildWasm(target: Target): Promise<void> {
  const crate = join(ROOT, `crates/cart-${target}`),
    extension = join(ROOT, `extensions/insignia-cart-${target}`),
    query = target === 'transform' ? 'cart_transform_run.graphql' : 'cart_validations_generate_run.graphql';
  for (const file of [`src/${query}`, 'schema.graphql'])
    assert.deepEqual(
      readFileSync(join(crate, file)),
      readFileSync(join(extension, file)),
      `Function source input drift: ${file}`,
    );
  const trampoline = await ensurePinnedTool(
    process.env.M1_FUNCTION_TRAMPOLINE ?? join(crate, 'target/m1-tools/shopify-function-trampoline-2.0.1'),
    'trampoline',
  );
  const environment = wasmBuildEnvironment(crate);
  execFileSync(
    'cargo',
    [
      'build',
      '--manifest-path',
      join(crate, 'Cargo.toml'),
      '--target',
      'wasm32-unknown-unknown',
      '--release',
      ...(existsSync(join(ROOT, 'Cargo.lock')) ? ['--locked'] : []),
    ],
    { cwd: ROOT, env: environment, stdio: 'inherit' },
  );
  const raw = join(crate, `target/wasm32-unknown-unknown/release/cart-${target}.wasm`);
  mkdirSync(join(extension, 'target'), { recursive: true });
  const outputRaw = join(extension, `target/cart-${target}.raw.wasm`),
    output = join(extension, `target/cart-${target}.wasm`);
  copyFileSync(raw, outputRaw);
  execFileSync(trampoline, ['-i', raw, '-o', output], { stdio: 'inherit' });
  for (const path of [outputRaw, output])
    assertPathIndependent(readFileSync(path), [ROOT, cargoHome(process.env), homedir()]);
  for (const path of [outputRaw, output]) console.log(`${fileHash(path)} ${statSync(path).size} ${path}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = text(process.argv[2]);
  assert(
    TARGETS.some((target) => target === value),
    'Expected transform or validation',
  );
  if (value === 'transform' || value === 'validation') await buildWasm(value);
}
