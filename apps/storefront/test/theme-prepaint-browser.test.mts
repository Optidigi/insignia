import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Liquid } from 'liquidjs';
import { type Browser, chromium, type Page } from 'playwright';
import { createStorefrontTestServer, serverPort } from './support.mts';

/**
 * Manual Customise block + app embed: the native purchase controls the embed script hides are already hidden at
 * first paint, so the server-rendered Customise button does not move when the script arrives. The pre-paint rule
 * never hides controls the script would keep, and the script alone owns them once it runs.
 */
const BROWSER_TEST_TIMEOUT_MS = 60_000;
const generation = 'a'.repeat(32);

async function renderBlocks(
  mode: 'required' | 'optional' | null,
  embedSettings: Record<string, unknown> = {},
): Promise<{ manual: string; embed: string }> {
  const source = new URL('../../../extensions/insignia-theme/', import.meta.url);
  const engine = new Liquid({
    root: new URL('snippets/', source).pathname,
    extname: '.liquid',
    globals: {
      shop: {
        name: 'Demo',
        metafields: { $app: { insignia_public_config_v2: { value: { generationHex: generation } } } },
      },
      routes: { root_url: '/' },
      localization: { country: { iso_code: 'US' }, market: { id: '42' } },
      request: { locale: { iso_code: 'en' }, design_mode: false },
    },
  });
  engine.registerFilter('t', () => 'Customise');
  const product = {
    id: '111',
    variants: [{ id: '101' }],
    metafields: { $app: mode ? { insignia_policy_v2: { value: `${generation}:1:${mode}` } } : {} },
  };
  const settings = {
    proxy_prefix: 'insignia',
    button_label: '',
    button_style: 'auto',
    button_width: 'theme',
    override_radius: false,
    override_border: false,
    button_spacing: 0,
  };
  const render = async (name: string, blockSettings: Record<string, unknown>) =>
    String(
      await engine.parseAndRender(
        (await readFile(new URL(`blocks/${name}.liquid`, source), 'utf8')).replace(
          /{% schema %}[\s\S]*?{% endschema %}/g,
          '',
        ),
        { product, block: { shopify_attributes: '', settings: blockSettings } },
      ),
    );
  return {
    manual: await render('customize', settings),
    embed: await render('cart-repair', { ...settings, auto_placement: true, ...embedSettings }),
  };
}

const css = `<style>
  body{margin:0;font:16px/1.5 sans-serif}.product{display:flex;flex-direction:column;gap:8px;padding:16px;max-width:380px}
  .button,.shopify-payment-button button{display:flex;align-items:center;justify-content:center;width:100%;min-height:44px;border:1px solid #000;background:#000;color:#fff;font:inherit}
  footer{height:300px;background:#eee}
</style>`;

/** Horizon-like product section: the payment button sits above the manual block, as on rewrite-dev. */
function productPage(blocks: { manual: string; embed: string }, form = 'action="/cart/add"') {
  return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=412">${css}</head><body>
    <main><div class="shopify-section"><section class="product"><h1>Shirt</h1>
      <product-form-component data-product-id="111"><form ${form}><input type="hidden" name="id" value="101">
        <button type="submit" name="add" class="button">Add to cart</button>
        <div class="shopify-payment-button"><button type="button">Buy it now</button></div>
      </form></product-form-component>
      ${blocks.manual}
    </section></div></main>
    <footer>Footer</footer>${blocks.embed}</body></html>`;
}

async function open(browser: Browser, origin: string, body: string): Promise<Page> {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const shifts: number[] = [];
    Reflect.set(window, '__shifts', shifts);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) shifts.push(Reflect.get(entry, 'value') as number);
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.route('**/cart.js', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/apps/insignia/v1/eligibility?*', (route) => {
    const id = new URL(route.request().url()).searchParams.get('productId');
    return route.fulfill({ json: { productId: id, configured: false } });
  });
  // The theme page arrives without the Insignia script, as on a slow storefront; the test loads it later.
  await page.route(`${origin}/product`, (route) => route.fulfill({ contentType: 'text/html', body }));
  await page.goto(`${origin}/product`);
  return page;
}

async function loadScript(page: Page) {
  await page.evaluate(async () => {
    await import(/* @vite-ignore */ `${location.origin}/src/main.ts`);
    await customElements.whenDefined('insignia-theme-integration');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

const box = (page: Page) =>
  page.locator('insignia-buyer:not([data-insignia-auto]) button[slot="trigger"]').evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
const visible = (page: Page) =>
  page.evaluate(() =>
    ['button[name="add"]', '.shopify-payment-button'].map(
      (selector) => !!document.querySelector<HTMLElement>(selector)?.getClientRects().length,
    ),
  );

test('manual Customise block + app embed: purchase controls are hidden at first paint and nothing shifts', {
  timeout: BROWSER_TEST_TIMEOUT_MS,
}, async (t) => {
  const server = await createStorefrontTestServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await server.close();
  });
  const origin = `http://127.0.0.1:${serverPort(server.httpServer)}`;
  for (const embedSettings of [{ auto_placement: true }, { auto_placement: false }]) {
    const page = await open(browser, origin, productPage(await renderBlocks('required', embedSettings)));
    const firstPaint = await visible(page);
    const before = await box(page);
    assert.ok(before.width > 0 && before.height > 0);
    await loadScript(page);
    assert.deepEqual(await box(page), before, `${JSON.stringify(embedSettings)} keeps the first-paint box`);
    // The script now owns the controls: the same ones hidden, by its own inline style.
    assert.deepEqual(await visible(page), [false, false]);
    assert.equal(
      await page.locator('button[name="add"]').evaluate((button) => button.style.getPropertyPriority('display')),
      'important',
    );
    assert.equal(await page.locator('insignia-buyer[data-insignia-auto]').count(), 0, 'no duplicate button');
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, '__shifts')), [], 'no layout shift');
    assert.deepEqual(firstPaint, [false, false], 'native controls are hidden before any script');
    await page.close();
  }
});

test('the pre-paint rule never hides controls the embed script keeps, and yields to the script once it runs', {
  timeout: BROWSER_TEST_TIMEOUT_MS,
}, async (t) => {
  const server = await createStorefrontTestServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await server.close();
  });
  const origin = `http://127.0.0.1:${serverPort(server.httpServer)}`;
  // Ordinary and optional products: no rule, controls stay (the manual block renders nothing for them).
  for (const mode of [null, 'optional'] as const) {
    const blocks = await renderBlocks(mode);
    assert.equal(blocks.embed.includes('data-insignia-prepaint'), false);
    const page = await open(browser, origin, productPage(blocks));
    assert.deepEqual(await visible(page), [true, true], `${mode}: before the script`);
    await page.close();
  }
  const required = await renderBlocks('required');
  // Embed only (automatic placement): unchanged, the script hides the controls and inserts its own button.
  {
    const page = await open(browser, origin, productPage({ manual: '', embed: required.embed }));
    assert.deepEqual(await visible(page), [true, true], 'automatic placement is unchanged before the script');
    await page.close();
  }
  // Manual block alone: the embed is not enabled, so nothing hides the theme's controls.
  {
    const page = await open(browser, origin, productPage({ manual: required.manual, embed: '' }));
    assert.deepEqual(await visible(page), [true, true], 'manual block alone keeps the controls');
    await page.close();
  }
  // A form for another product, a cross-origin form or a manual block outside the form's own section is left
  // alone (with automatic placement off, the script would not hide these either).
  const manualOnly = await renderBlocks('required', { auto_placement: false });
  for (const body of [
    productPage(manualOnly).replace('data-product-id="111"', 'data-product-id="222"'),
    productPage(manualOnly, 'action="//other.example/cart/add"'),
    productPage(manualOnly)
      .replace('<form action="/cart/add">', '<section class="nested"><form action="/cart/add">')
      .replace('</form></product-form-component>', '</form></section></product-form-component>'),
  ]) {
    const page = await open(browser, origin, body);
    assert.deepEqual(await visible(page), [true, true], 'the script would not hide these controls');
    await page.close();
  }
  // CSS cannot see a manual button the theme hides with its own stylesheet; the script can. Once the script runs it
  // alone decides, so its "keep the controls" wins over the pre-paint rule.
  const page = await open(
    browser,
    origin,
    productPage(manualOnly).replace('</head>', '<style>.insignia-customise{display:none}</style></head>'),
  );
  await loadScript(page);
  assert.equal(await page.locator('insignia-buyer[data-insignia-auto]').count(), 0);
  assert.deepEqual(await visible(page), [true, true], 'the script keeps the controls and the rule yields');
  await page.close();
});
