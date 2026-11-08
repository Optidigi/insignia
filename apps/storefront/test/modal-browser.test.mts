import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { serverPort } from './support.mts';

test('the loading modal immediately contains focus, cancels on Escape and restores the host', async (t) => {
  const output = await build({
    stdin: {
      contents: `import {createDesignerModal} from './src/designer/modal'; window.openModal=()=>{window.modal=createDesignerModal({locale:'en',onCancel(){window.cancelled=true;window.modal.destroy();}});};`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
  });
  const script = output.outputFiles[0];
  assert(script);
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/entry.js' ? 'text/javascript' : 'text/html');
    response.end(
      request.url === '/entry.js'
        ? script.text
        : '<button id="trigger" onclick="openModal()">Customize</button><button id="underneath">Underlying theme</button><script src="/entry.js"></script>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${serverPort(server)}/`);
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await page.getByRole('status').waitFor();
  assert.equal(await page.locator('dialog:modal').count(), 1);
  await page.evaluate(() => document.getElementById('underneath')?.focus());
  assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'underneath');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog:modal').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'trigger');
});

declare global {
  interface Window {
    openModal(): void;
    modal: { destroy(): void };
    cancelled?: boolean;
  }
}
