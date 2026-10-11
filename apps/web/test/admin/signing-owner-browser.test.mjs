import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('normal embedded signing action keeps synthetic token in header and recovers denial without POST retry', async () => {
  const bundle = await build({
    stdin: {
      contents:
        "import {render,h} from 'preact'; import SigningSetup from './src/islands/SigningSetup.tsx'; render(h(SigningSetup, {onAuthorizationDenied:()=>{window.denials=(window.denials||0)+1;}}), document.body);",
      resolveDir: new URL('../..', import.meta.url).pathname,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    jsxImportSource: 'preact',
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let posts = 0;
    let requests = 0;
    await page.addInitScript(() => {
      window.tokenCalls = 0;
      window.shopify = {
        idToken: async () => {
          window.tokenCalls++;
          return 'SYNTHETIC_BROWSER_ID_TOKEN';
        },
      };
    });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) requests++;
      if (url.pathname === '/')
        return route.fulfill({
          contentType: 'text/html',
          body: `<html><body><script>${bundle.outputFiles[0].text}</script></body></html>`,
        });
      if (url.pathname === '/api/admin/signing/functions')
        return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
      if (url.pathname === '/api/admin/signing') {
        assert.equal(route.request().headers().authorization, 'Bearer SYNTHETIC_BROWSER_ID_TOKEN');
        if (route.request().method() === 'POST') {
          posts++;
          assert.deepEqual(route.request().postDataJSON(), { action: 'setup' });
          return route.fulfill({ status: 401, json: { error: 'Authentication required' } });
        }
        return route.fulfill({
          json: {
            version: 'm5-signing-owner-action-v1',
            state: posts ? 'UNCERTAIN' : 'READY',
            actionAvailable: !posts,
            retryAuthorized: false,
            quoteIssuanceAuthorized: false,
          },
        });
      }
      return route.abort();
    });
    await page.goto('http://signing.synthetic.test/');
    await page.getByText('Check signing setup to view its status.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.tokenCalls), 0);
    assert.equal(requests, 0);
    await page.getByText('Check signing setup', { exact: true }).click();
    await page.getByText('Set up signing', { exact: true }).click();
    await page
      .getByText('Signing setup result is uncertain. Contact support before trying again.', { exact: true })
      .waitFor();
    assert.equal(posts, 1);
    assert.equal(await page.evaluate(() => window.denials), 1);
    assert.equal(await page.getByText('Set up signing', { exact: true }).count(), 0);
    await page.getByText('Check status', { exact: true }).click();
    assert.equal(posts, 1);
    assert.ok(!(await page.content()).includes('SYNTHETIC_BROWSER_ID_TOKEN'));
  } finally {
    await browser.close();
  }
});
