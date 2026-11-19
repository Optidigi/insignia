import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withEmbeddedContext } from '../../src/shared/embedded-context.ts';

const loaded =
  'https://app.insigniacustomizer.com/admin/products?embedded=1&hmac=abc&host=YWRtaW4&id_token=tok&locale=en&session=s&shop=demo.myshopify.com&timestamp=1';

test('app-owned navigation keeps shop, host and embedded but never tokens or signatures', () => {
  const next = new URL(withEmbeddedContext('/admin/products/1/config?locale=nl', loaded), loaded);
  assert.equal(next.pathname, '/admin/products/1/config');
  assert.equal(next.searchParams.get('shop'), 'demo.myshopify.com');
  assert.equal(next.searchParams.get('host'), 'YWRtaW4');
  assert.equal(next.searchParams.get('embedded'), '1');
  assert.equal(next.searchParams.get('locale'), 'nl');
  for (const secret of ['id_token', 'hmac', 'session', 'timestamp']) assert.equal(next.searchParams.has(secret), false);
});

test('existing values, other origins, non-admin paths and pages without context are left alone', () => {
  assert.equal(
    new URL(withEmbeddedContext('/admin/home?shop=other.myshopify.com', loaded), loaded).searchParams.get('shop'),
    'other.myshopify.com',
  );
  assert.equal(
    withEmbeddedContext('https://admin.shopify.com/store/demo', loaded),
    'https://admin.shopify.com/store/demo',
  );
  assert.equal(withEmbeddedContext('/api/admin/products', loaded), '/api/admin/products');
  assert.equal(withEmbeddedContext('/admin/home', 'https://app.insigniacustomizer.com/admin/settings'), '/admin/home');
  assert.equal(withEmbeddedContext('#section', loaded), '#section');
});
