import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { adminFrameAncestors } from '../../src/server/admin/frame-ancestors.ts';

const request = (search: string) => new URL(`https://insignia.example/admin/home${search}`);

test('a valid shop may frame its embedded admin page alongside unified admin', () => {
  assert.equal(
    adminFrameAncestors(request('?embedded=1&shop=insignia-rewrite-dev.myshopify.com&host=abc')),
    'frame-ancestors https://insignia-rewrite-dev.myshopify.com https://admin.shopify.com',
  );
});

test('a missing, malformed or hostile shop falls back to unified admin only', () => {
  for (const search of [
    '',
    '?shop=',
    '?shop=evil.com',
    '?shop=x.myshopify.com.evil.com',
    '?shop=evil.com%2Fx.myshopify.com',
    '?shop=Shop.myshopify.com',
    '?shop=-shop.myshopify.com',
    '?shop=*.myshopify.com',
    '?shop=a.b.myshopify.com',
    '?shop=x.myshopify.com%20https://evil.com',
    '?shop=x.myshopify.com;%20script-src%20*',
    '?shop=x.myshopify.com%0d%0aSet-Cookie:%20a=b',
    '?shop=x.myshopify.com%0a',
    '?shop=x.myshopify.com%00',
    `?shop=${'a'.repeat(64)}.myshopify.com`,
    '?shop=evil.com&shop=x.myshopify.com',
    '?shop=a.myshopify.com&shop=b.myshopify.com',
  ]) {
    assert.equal(adminFrameAncestors(request(search)), 'frame-ancestors https://admin.shopify.com', search);
  }
});

test('every rendered embedded admin page derives frame-ancestors from the request', async () => {
  const root = fileURLToPath(new URL('../../src/pages/admin/', import.meta.url));
  const pages: string[] = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true }))
    if (entry.isFile() && entry.name.endsWith('.astro')) pages.push(join(entry.parentPath, entry.name));
  let rendered = 0;
  for (const page of pages) {
    const source = await readFile(page, 'utf8');
    const name = relative(root, page);
    assert.doesNotMatch(source, /frame-ancestors\s/, `${name} hard-codes frame-ancestors`);
    // Redirect-only routes return no document, so there is nothing to frame.
    if (/^return new Response\(null, \{ status: 302, headers: Astro\.response\.headers \}\);$/m.test(source)) continue;
    rendered++;
    assert.match(source, /Content-Security-Policy/, `${name} sets a CSP`);
    assert.match(source, /; \$\{adminFrameAncestors\(Astro\.url\)\}; /, `${name} uses the per-request helper`);
  }
  assert.equal(rendered, 15, 'every rendered admin page is covered');
});
