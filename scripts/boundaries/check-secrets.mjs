import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const forbidden =
  /1443cf6d03d39edae7c101a943c5c684|429028933633|_insignia_fixture_role|shpat_|shpss_|BEGIN (?:RSA |EC )?PRIVATE KEY|SHOPIFY_PARTNER_API_TOKEN|SHOPIFY_APP_CLIENT_SECRET|SHOPIFY_API_SECRET/i;
const checked = [];

function scan(relative) {
  const full = resolve(root, relative);
  if (statSync(full).isDirectory()) {
    for (const child of readdirSync(full)) {
      if (['node_modules', 'dist', 'target', '.astro', 'test', 'fixtures'].includes(child)) continue;
      scan(`${relative}/${child}`);
    }
    return;
  }
  if (!/\.(?:ts|tsx|js|mjs|rs|toml|astro|liquid)$/.test(relative)) return;
  assert.ok(
    !forbidden.test(readFileSync(full, 'utf8')),
    `production source contains forbidden identity or credential marker: ${relative}`,
  );
  checked.push(relative);
}
for (const path of [
  'apps/web/src',
  'apps/storefront/src',
  'apps/worker/src',
  'packages/domain/src',
  'packages/contracts/src',
  'crates/cart-authorization/src',
  'crates/cart-transform/src',
  'crates/cart-validation/src',
  'extensions/insignia-cart-transform/shopify.extension.toml',
  'extensions/insignia-cart-validation/shopify.extension.toml',
])
  scan(path);
for (const path of [
  'apps/storefront/dist/insignia-storefront.js',
  'extensions/insignia-theme/assets/insignia-storefront.js',
]) {
  assert.ok(
    !forbidden.test(readFileSync(resolve(root, path), 'utf8')),
    `browser artifact contains forbidden marker: ${path}`,
  );
}
function scanClient(relative) {
  const full = resolve(root, relative);
  if (statSync(full).isDirectory()) {
    for (const child of readdirSync(full)) scanClient(`${relative}/${child}`);
  } else if (relative.endsWith('.js')) {
    assert.ok(!forbidden.test(readFileSync(full, 'utf8')), `browser artifact contains forbidden marker: ${relative}`);
  }
}
scanClient('apps/web/dist/client');
const vector = JSON.parse(readFileSync(resolve(root, 'crates/cart-authorization/fixtures/vectors.json'), 'utf8'));
assert.match(vector.provenance, /Synthetic RFC 8032 test seed/);
assert.equal(vector.seedHex, '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
const fixtureFiles = [];
function scanFixture(relative) {
  const full = resolve(root, relative);
  if (statSync(full).isDirectory()) {
    for (const child of readdirSync(full)) scanFixture(`${relative}/${child}`);
    return;
  }
  if (!/\.(?:ts|tsx|js|mjs|rs|json|py)$/.test(relative)) return;
  const content = readFileSync(full, 'utf8');
  assert.ok(!forbidden.test(content), `test/fixture contains forbidden identity or credential marker: ${relative}`);
  if (relative !== 'crates/cart-authorization/fixtures/vectors.json') {
    assert.ok(
      !/"(?:seedHex|privateKey|clientSecret)"\s*:/i.test(content),
      `unproven test credential material: ${relative}`,
    );
  }
  fixtureFiles.push(relative);
}
for (const top of ['apps', 'packages', 'crates']) {
  for (const name of readdirSync(resolve(root, top))) {
    for (const leaf of ['test', 'tests', 'fixtures']) {
      const path = `${top}/${name}/${leaf}`;
      if (existsSync(resolve(root, path))) scanFixture(path);
    }
  }
}
scanFixture('packages/domain/src/money.test.ts');
scanFixture('scripts/m1-functions/generate-synthetic-fixtures.py');
scanFixture('scripts/m1-functions/replay.py');
scanFixture('scripts/m1-functions/check-vector.test.ts');
const fixtureGenerator = readFileSync(resolve(root, 'scripts/m1-functions/generate-synthetic-fixtures.py'), 'utf8');
assert.match(fixtureGenerator, /SEED = bytes\(\[1\]\) \* 32/);
assert.match(fixtureGenerator, /Never use this seed for runtime keys/);
console.log(
  `Secret/fixture provenance check passed: ${checked.length} production source files, ${fixtureFiles.length} separately scanned test/fixture files, 2 browser artifacts, 2 explicitly synthetic seeds.`,
);
