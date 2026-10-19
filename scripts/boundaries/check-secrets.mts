import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const forbidden =
  /1443cf6d03d39edae7c101a943c5c684|429028933633|_insignia_fixture_role|shpat_|shpss_|BEGIN (?:RSA |EC )?PRIVATE KEY|SHOPIFY_PARTNER_API_TOKEN|SHOPIFY_APP_CLIENT_SECRET|SHOPIFY_API_SECRET/i;
const checked: string[] = [];

function scan(relative: string) {
  const full = resolve(root, relative);
  if (statSync(full).isDirectory()) {
    for (const child of readdirSync(full)) {
      if (['node_modules', 'dist', 'target', '.astro', 'test', 'fixtures'].includes(child)) continue;
      scan(`${relative}/${child}`);
    }
    return;
  }
  if (!/\.(?:ts|tsx|mts|cts|js|mjs|rs|toml|astro|liquid)$/.test(relative)) return;
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
  'packages/application/src',
  'packages/database/src',
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
let browserArtifacts = 0;
function scanClient(relative: string) {
  const full = resolve(root, relative);
  if (statSync(full).isDirectory()) {
    for (const child of readdirSync(full)) scanClient(`${relative}/${child}`);
  } else if (relative.endsWith('.js')) {
    assert.ok(!forbidden.test(readFileSync(full, 'utf8')), `browser artifact contains forbidden marker: ${relative}`);
    browserArtifacts++;
  }
}
scanClient('apps/web/dist/client');
scanClient('apps/storefront/dist');
scanClient('extensions/insignia-theme/assets');
const vector: unknown = JSON.parse(
  readFileSync(resolve(root, 'crates/cart-authorization/fixtures/vectors.json'), 'utf8'),
);
assert(
  vector &&
    typeof vector === 'object' &&
    'provenance' in vector &&
    typeof vector.provenance === 'string' &&
    'seedHex' in vector,
);
assert.match(vector.provenance, /Synthetic RFC 8032 test seed/);
assert.equal(vector.seedHex, '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
const fixtureFiles: string[] = [];
function scanFixture(relative: string) {
  const full = resolve(root, relative);
  if (statSync(full).isDirectory()) {
    for (const child of readdirSync(full)) scanFixture(`${relative}/${child}`);
    return;
  }
  if (!/\.(?:ts|tsx|mts|cts|js|mjs|rs|json|py)$/.test(relative)) return;
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
// Sealed provider-response records preserve public identities and exact hashes.
// Unlike synthetic package fixtures, these offline records may contain public IDs, never credentials.
const recordedCredential =
  /_insignia_fixture_role|shpat_|shpss_|BEGIN (?:RSA |EC )?PRIVATE KEY|SHOPIFY_PARTNER_API_TOKEN|SHOPIFY_APP_CLIENT_SECRET|SHOPIFY_API_SECRET|"(?:seedHex|privateKey|clientSecret)"\s*:/i;
function scanRecordedFixture(relative: string) {
  const full = resolve(root, relative);
  if (statSync(full).isDirectory()) {
    for (const child of readdirSync(full)) scanRecordedFixture(`${relative}/${child}`);
    return;
  }
  assert.ok(
    !recordedCredential.test(readFileSync(full, 'utf8')),
    `recorded fixture contains credential material: ${relative}`,
  );
  fixtureFiles.push(relative);
}
scanRecordedFixture('fixtures');
scanFixture('packages/domain/src/money.test.ts');
scanFixture('scripts/functions/generate-fixtures.mts');
scanFixture('scripts/functions/replay.mts');
scanFixture('scripts/functions/vector.test.mts');
const fixtureGenerator = readFileSync(resolve(root, 'scripts/functions/generate-fixtures.mts'), 'utf8');
assert.match(fixtureGenerator, /Buffer\.alloc\(32,\s*1\)/);
assert.match(fixtureGenerator, /Never use this synthetic seed for runtime keys/);
console.log(
  `Secret/fixture provenance check passed: ${checked.length} production source files, ${fixtureFiles.length} separately scanned test/fixture files, ${browserArtifacts} browser artifacts, 2 explicitly synthetic seeds.`,
);
