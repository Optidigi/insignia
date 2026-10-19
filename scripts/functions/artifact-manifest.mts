/** Bind current build outputs, full theme assets and replay receipts to source; fail on missing output. */
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileHash, jsonFile, ROOT, record } from './runtime.mts';
import { collectThemeArtifacts } from './theme-artifacts.mts';

const requiredInputs: string[] = [
  'Cargo.lock',
  'pnpm-lock.yaml',
  'crates/cart-authorization/src/lib.rs',
  'crates/cart-authorization/src/whole.rs',
  'crates/cart-authorization/tests/production_vectors.rs',
  'crates/cart-authorization/tests/currency_matrix.rs',
  'packages/cart-authorization/src/whole-quote.ts',
  'packages/cart-authorization/src/admission.ts',
  'packages/cart-authorization/src/currency.ts',
  'packages/application/src/quote/accept-quote.ts',
  'packages/database/migrations/20260929000300_authorization_generation.sql',
  'packages/database/migrations/20260929000400_accepted_quote.sql',
  'packages/domain/src/pricing/lean.ts',
  'packages/shopify/src/primary-market.ts',
  'packages/shopify/src/shop-context.ts',
  'apps/web/src/server/quote-composition.ts',
  'scripts/functions/production-vectors.mts',
  'scripts/functions/public-config.mts',
  'packages/application/src/keys/public-config.ts',
  'crates/cart-transform/src/main.rs',
  'crates/cart-validation/src/main.rs',
  'extensions/insignia-cart-transform/schema.graphql',
  'extensions/insignia-cart-validation/schema.graphql',
  'extensions/insignia-cart-transform/src/cart_transform_run.graphql',
  'extensions/insignia-cart-validation/src/cart_validations_generate_run.graphql',
  'extensions/insignia-cart-transform/target/cart-transform.raw.wasm',
  'extensions/insignia-cart-transform/target/cart-transform.wasm',
  'extensions/insignia-cart-validation/target/cart-validation.raw.wasm',
  'extensions/insignia-cart-validation/target/cart-validation.wasm',
  'extensions/insignia-theme/assets/insignia-storefront.js',
  'apps/storefront/dist/insignia-storefront.js',
  'apps/web/dist/server/entry.mjs',
  'apps/worker/dist/main.js',
  '.m1-artifacts/replay.json',
  '.m4-002-artifacts/production-vectors-replay.json',
  '.m1-artifacts/m4-003-public-config-replay.json',
  'packages/cart-authorization/fixtures/currency-matrix-v1.json',
  'packages/cart-authorization/fixtures/whole-quote-v2.json',
  'packages/cart-authorization/fixtures/accepted-quote-example.json',
  'packages/cart-authorization/fixtures/persisted-negative-vector.json',
  'packages/cart-authorization/fixtures/QUOTE-PROVENANCE.json',
];
export function artifactManifest(root = ROOT): number {
  const required = [
    ...requiredInputs,
    ...readdirSync(join(root, 'scripts/functions'))
      .filter((name) => name.endsWith('.mts'))
      .map((name) => `scripts/functions/${name}`),
  ];
  const clients = readdirSync(join(root, 'apps/web/dist/client'), { recursive: true, encoding: 'utf8' }).filter(
    (name) => name.endsWith('.js'),
  );
  assert(clients.length > 0, 'missing required artifact pattern: apps/web/dist/client/**/*.js');
  required.push(...clients.map((name) => `apps/web/dist/client/${name}`), ...collectThemeArtifacts(root));
  const records: Record<string, { bytes: number; sha256: string }> = {};
  for (const path of [...new Set(required)].sort()) {
    const source = join(root, path),
      info = statSync(source);
    assert(info.isFile() && info.size > 0, `missing/empty required artifact: ${path}`);
    records[path] = { bytes: info.size, sha256: fileHash(source) };
  }
  assert.equal(
    records['extensions/insignia-theme/assets/insignia-storefront.js']?.sha256,
    records['apps/storefront/dist/insignia-storefront.js']?.sha256,
    'theme asset differs from current storefront build',
  );
  const replay = record(jsonFile(join(root, '.m1-artifacts/replay.json')));
  for (const target of ['transform', 'validation'])
    assert.equal(
      record(replay[target]).finalWasmSha256,
      records[`extensions/insignia-cart-${target}/target/cart-${target}.wasm`]?.sha256,
      `${target} replay is not bound to final Wasm`,
    );
  const destination = join(root, '.m1-artifacts/manifest.json');
  mkdirSync(join(root, '.m1-artifacts'), { recursive: true });
  writeFileSync(destination, `${JSON.stringify({ version: 1, artifacts: records }, null, 2)}\n`);
  console.log(`${Object.keys(records).length} required files hashed: ${relative(root, destination)}`);
  return Object.keys(records).length;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) artifactManifest();
