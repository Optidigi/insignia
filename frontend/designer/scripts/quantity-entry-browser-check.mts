import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, type Browser, type BrowserType, type Page } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
let origin: string;
let vite: ViteDevServer | undefined;
let cacheDir: string;
const browsers = new Map<string, Browser>();
const engines: [string, BrowserType][] = [['chromium', chromium], ['firefox', firefox]];

before(async () => {
  // Concurrent suites must not replace each other's optimized dependency cache.
  cacheDir = await mkdtemp(join(tmpdir(), 'insignia-quantity-entry-'));
  vite = await createServer({
    root,
    cacheDir,
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error',
  });
  await vite.listen();
  const url = vite.resolvedUrls?.local[0];
  assert.ok(url, 'quantity fixture should expose its loopback URL');
  origin = url.replace(/\/$/, '');
  for (const [name, engine] of engines) browsers.set(name, await engine.launch({ headless: true }));
});
after(async () => {
  for (const browser of browsers.values()) await browser.close();
  await vite?.close();
  if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
});

// The fixture prices one item at €12.00.
// `compact` renders stepper fields (two colours, one size); `grid` renders plain fields (four sizes).
const layouts = { compact: '', grid: '&sizes=4' } as const;
const field = '#quantity-white-small';

async function openQuantities(engine: string, layout: keyof typeof layouts): Promise<Page> {
  const page = await browsers.get(engine)!.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${origin}/scripts/fixtures/preview-selectors.html?views=2${layouts[layout]}`);
  await page.locator('.steps button').nth(1).click();
  await page.locator(`.app[data-step="1"] .quantity-entry-${layout}`).waitFor();
  return page;
}

/** Selects the field's current text, then presses the keys one at a time like a shopper. */
async function typeKeys(page: Page, keys: string) {
  await page.locator(field).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(keys);
}

async function observe(page: Page) {
  const quantity = page.locator(field);
  return {
    text: await quantity.inputValue(),
    invalid: await quantity.getAttribute('aria-invalid') === 'true',
    error: (await page.locator('.quantity-error').allInnerTexts()).join(' '),
    price: (await page.locator('.footer-price').innerText()).replace(/\s+/g, ' '),
  };
}

const unpriced = { invalid: true, error: 'Use whole numbers from 0 to 99.', price: 'Per item €12.00' };
const priced = (count: number) => ({
  invalid: false, error: '', price: `${count} ${count === 1 ? 'item' : 'items'} €${(12 * count).toFixed(2)}`,
});

async function assertBlocked(page: Page, message: string) {
  await page.locator('.panel-footer .primary-button').click();
  assert.equal(await page.locator('.app').getAttribute('data-step'), '1', `${message} must not continue to Review`);
}

for (const [engine] of engines) for (const layout of Object.keys(layouts) as (keyof typeof layouts)[]) {
  test(`${engine} ${layout}: typed decimals and other non-whole text stay as typed, invalid and unpriced (#416)`, async () => {
    for (const keys of ['1.5', '1,5', '.5', '1.05', '1.55', '1.', '1.0', '1e3', '1e1', '-1', '2x']) {
      const page = await openQuantities(engine, layout);
      try {
        await typeKeys(page, keys);
        assert.deepEqual(await observe(page), { text: keys, ...unpriced }, `${keys} while focused`);
        await page.locator(field).blur();
        assert.deepEqual(await observe(page), { text: keys, ...unpriced }, `${keys} after blur`);
        await assertBlocked(page, keys);

        await typeKeys(page, '2');
        assert.deepEqual(await observe(page), { text: '2', ...priced(2) }, `${keys} corrected to 2`);
        await page.locator('.panel-footer .primary-button').click();
        await page.locator('.app[data-step="2"]').waitFor();
      } finally { await page.close(); }
    }
  });

  test(`${engine} ${layout}: pasted decimals are rejected like typed ones`, async () => {
    const page = await openQuantities(engine, layout);
    try {
      await page.locator(field).click();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.insertText('1.5');
      assert.deepEqual(await observe(page), { text: '1.5', ...unpriced }, 'pasted 1.5');
      await assertBlocked(page, 'pasted 1.5');
      await typeKeys(page, '');
      await page.keyboard.insertText('7');
      assert.deepEqual(await observe(page), { text: '7', ...priced(7) }, 'pasted 7');
    } finally { await page.close(); }
  });

  test(`${engine} ${layout}: whole numbers type, edit, blur and advance as before`, async () => {
    const page = await openQuantities(engine, layout);
    try {
      await typeKeys(page, '2');
      assert.deepEqual(await observe(page), { text: '2', ...priced(2) });
      await typeKeys(page, '12');
      assert.deepEqual(await observe(page), { text: '12', ...priced(12) });
      await page.keyboard.press('Backspace');
      assert.deepEqual(await observe(page), { text: '1', ...priced(1) }, 'backspace');
      await page.keyboard.type('.');
      assert.deepEqual(await observe(page), { text: '1.', ...unpriced }, 'a separator is not yet a whole number');
      await page.keyboard.press('Backspace');
      assert.deepEqual(await observe(page), { text: '1', ...priced(1) }, 'removing the separator restores 1');
      await typeKeys(page, '012');
      assert.deepEqual(await observe(page), { text: '012', ...priced(12) }, 'leading zero is kept while typing');
      await page.locator(field).blur();
      assert.deepEqual(await observe(page), { text: '12', ...priced(12) }, 'settles to 12 on blur');

      await typeKeys(page, '3');
      await page.keyboard.press('Enter');
      assert.equal(await page.locator(field).evaluate((input) => input === document.activeElement), false, 'Enter moves on');
      assert.deepEqual(await observe(page), { text: '3', ...priced(3) }, 'value kept after Enter');

      await typeKeys(page, '');
      await page.keyboard.press('Backspace');
      await page.locator(field).blur();
      assert.deepEqual(await observe(page), { text: layout === 'compact' ? '0' : '', invalid: false, error: '', price: 'Per item €12.00' }, 'cleared field');

      if (layout === 'compact') {
        const increase = page.getByRole('button', { name: /Increase/ }).first();
        await increase.click();
        await increase.click();
        assert.deepEqual(await observe(page), { text: '2', ...priced(2) }, 'stepper increases');
        await page.getByRole('button', { name: /Decrease/ }).first().click();
        assert.deepEqual(await observe(page), { text: '1', ...priced(1) }, 'stepper decreases');
      }
      await typeKeys(page, '4');
      await page.locator('.panel-footer .primary-button').click();
      await page.locator('.app[data-step="2"]').waitFor();
    } finally { await page.close(); }
  });
}
