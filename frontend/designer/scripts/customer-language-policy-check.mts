import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: [new URL('../src/customer-language-policy.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm' });
const { resolveCustomerHostLocale } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`) as typeof import("../src/customer-language-policy");

test('the active storefront locale wins over browser detection, including valid unsupported store languages', () => {
  assert.equal(resolveCustomerHostLocale('fr-CA', ['de-CH', 'nl']), 'fr-CA');
  assert.equal(resolveCustomerHostLocale('el-GR', ['de-CH']), 'el-GR');
});
test('missing or malformed host context uses the first supported browser language, then English', () => {
  assert.equal(resolveCustomerHostLocale(undefined, ['sv-SE', 'nl-BE', 'de']), 'nl-BE');
  assert.equal(resolveCustomerHostLocale('not a locale', ['de-CH']), 'de-CH');
  assert.equal(resolveCustomerHostLocale('', ['invalid locale', 'fr-CA']), 'fr-CA');
  assert.equal(resolveCustomerHostLocale(null, ['sv-SE', 'ar']), 'en');
  assert.equal(resolveCustomerHostLocale(undefined, []), 'en');
});
