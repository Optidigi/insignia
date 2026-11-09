import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'http://127.0.0.1:4188';
let vite: ChildProcess | undefined;
let browser: Browser;
before(async () => {
  vite = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
    '--host', '127.0.0.1', '--port', '4188', '--strictPort', '--force'], { cwd: root, stdio: 'ignore' });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${origin}/scripts/fixtures/preview-selectors.html`)).ok) { ready = true; break; } } catch { /* Server is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, 'selector fixture should start');
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); vite?.kill('SIGTERM'); });

test('phone view and colour names fit together, retain full labels and dispatch actual selections', async () => {
  for (const width of [320, 390]) for (const views of [2, 3, 4]) for (const palette of ['swatch', 'named', 'missing']) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    try {
      await page.goto(`${origin}/scripts/fixtures/preview-selectors.html?views=${views}&palette=${palette}`);
      const select = page.getByRole('combobox', { name: 'Product view', exact: true });
      await select.waitFor({ state: 'visible' });
      assert.equal(await select.locator('option').count(), views);
      assert.equal(await select.getAttribute('title'), 'Front with a very long merchant supplied view name');
      assert.equal(await select.evaluate(el => getComputedStyle(el).textOverflow), 'ellipsis');
      const trigger = page.locator('.mobile-color-trigger');
      const box = await trigger.boundingBox();
      assert.ok(box && box.height >= 44 && box.width >= 44);
      assert.equal(await trigger.locator('.color-dot').count(), palette === 'swatch' ? 1 : 0);
      if (palette !== 'swatch') {
        assert.ok(box.width > 56 && box.width <= 112, 'named choices get more space than dots without crowding the view');
        assert.equal(await trigger.locator('.mobile-option-name').evaluate(el => el.scrollWidth > el.clientWidth), true);
        assert.equal(await trigger.locator('.mobile-option-name').evaluate(el => getComputedStyle(el).textOverflow), 'ellipsis');
      }
      assert.match(await trigger.getAttribute('aria-label') ?? '', /Warm white with a very long merchant supplied finish name/);
      assert.equal(await page.locator('.preview-toolbar').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await trigger.click();
      const dialog = page.getByRole('dialog');
      const navy = dialog.getByRole('button', { name: /Midnight navy with a very long merchant supplied finish name/ });
      await navy.click();
      await dialog.waitFor({ state: 'hidden' });
      assert.match(await trigger.getAttribute('title') ?? '', /Midnight navy with a very long merchant supplied finish name/);
      await select.selectOption('back');
      assert.equal(await select.inputValue(), 'back');
      assert.equal(await select.getAttribute('title'), 'Back with a very long merchant supplied view name');
      await page.getByRole('img', { name: /Back with a very long merchant supplied view name/ }).waitFor();
    } finally { await page.close(); }
  }
});

test('desktop retains up to three view tabs and uses a select for four views', async () => {
  for (const views of [1, 2, 3, 4]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(`${origin}/scripts/fixtures/preview-selectors.html?views=${views}`);
      await page.locator('.app').waitFor();
      assert.equal(await page.getByRole('group', { name: 'Product view', exact: true }).isVisible(), views === 2 || views === 3);
      assert.equal(await page.getByRole('combobox', { name: 'Product view', exact: true }).isVisible(), views === 4);
    } finally { await page.close(); }
  }
});
