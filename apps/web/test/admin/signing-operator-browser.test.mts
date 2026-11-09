import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { build } from '../../../../frontend/admin/node_modules/esbuild/lib/main.js';

test('real Polaris setup is keyboard accessible at 320px and reload retains read-only custody', {
  timeout: 30000,
}, async () => {
  const bundle = await build({
    stdin: {
      contents:
        "import {render} from 'preact'; import Operator from './src/islands/SigningOperator'; render(<Operator/>,document.body);",
      resolveDir: new URL('../../../../frontend/admin/', import.meta.url).pathname,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    jsxImportSource: 'preact',
  });
  const polaris = await readFile(
    new URL('../../../../frontend/admin/examples/fixtures/polaris-2.0-rc.snapshot', import.meta.url),
    'utf8',
  );
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 700 } });
    let posts = 0;
    await page.route('https://operator.invalid/**', async (route) => {
      if (new URL(route.request().url()).pathname === '/api/admin/signing') {
        if (route.request().method() === 'POST') {
          posts++;
          assert.equal(route.request().postData(), '{"action":"setup"}');
          await route.abort();
          return;
        }
        return route.fulfill({
          json: {
            version: 'm5-signing-owner-action-v1',
            state: 'READY',
            actionAvailable: true,
            retryAuthorized: false,
            quoteIssuanceAuthorized: false,
          },
        });
      }
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>',
      });
    });
    const open = async () => {
      await page.goto('https://operator.invalid/admin/signing');
      await page.evaluate(() => {
        (window as any).shopify = {
          idToken: async () => `synthetic.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 120 }))}.synthetic`,
        };
      });
      await page.addScriptTag({ content: polaris });
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    };
    await open();
    const setup = page.getByRole('button', { name: 'Set up signing configuration', exact: true });
    await setup.waitFor();
    await page.waitForFunction(() => !document.querySelector('s-button')?.hasAttribute('disabled'));
    assert.equal(posts, 0);
    await setup.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('status').filter({ hasText: 'uncertain' }).waitFor();
    assert.equal(posts, 1);
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Ready for' }).waitFor();
    assert.equal(await setup.isDisabled(), true);
    await open();
    await page.getByRole('status').filter({ hasText: 'Ready for' }).waitFor();
    assert.equal(await setup.isDisabled(), true);
    assert.equal(posts, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.ok(!(await page.locator('body').innerText()).includes('synthetic.'));
  } finally {
    await browser.close();
  }
});
