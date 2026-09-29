import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const forbidden = /1443cf6d03d39edae7c101a943c5c684|429028933633|_insignia_fixture_role|shpat_|shpss_|BEGIN (?:RSA |EC )?PRIVATE KEY|SHOPIFY_PARTNER_API_TOKEN|SHOPIFY_APP_CLIENT_SECRET|SHOPIFY_API_SECRET/i;
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
  assert.ok(!forbidden.test(readFileSync(full, 'utf8')), `production source contains forbidden identity or credential marker: ${relative}`);
  checked.push(relative);
}
for (const path of ['apps/web/src', 'apps/storefront/src', 'apps/worker/src', 'packages/domain/src', 'crates/cart-authorization/src', 'crates/cart-transform/src', 'crates/cart-validation/src', 'extensions/insignia-cart-transform/shopify.extension.toml', 'extensions/insignia-cart-validation/shopify.extension.toml']) scan(path);
for (const path of ['apps/storefront/dist/insignia-storefront.js', 'extensions/insignia-theme/assets/insignia-storefront.js']) {
  assert.ok(!forbidden.test(readFileSync(resolve(root, path), 'utf8')), `browser artifact contains forbidden marker: ${path}`);
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
console.log(`Secret/fixture provenance check passed: ${checked.length} production source files, 2 browser artifacts, 1 explicitly synthetic seed.`);
