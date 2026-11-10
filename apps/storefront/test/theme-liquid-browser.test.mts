import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { Liquid } from 'liquidjs';
import { chromium } from 'playwright';
import { createStorefrontTestServer, serverPort } from './support.mts';

async function renderTheme(t: TestContext, mode: 'required' | 'optional' | null, manual = false) {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-liquid-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = new URL('../../../extensions/insignia-theme/', import.meta.url);
  // Observed Shopify app-render boundary, separate from Liquid syntax rendering.
  // Shopify inserts these comments around each snippet, including inside captures.
  for (const name of await readdir(new URL('snippets/', source))) {
    const content = await readFile(new URL(`snippets/${name}`, source), 'utf8');
    await writeFile(
      join(directory, name),
      `<!-- BEGIN app snippet: ${name.replace(/\.liquid$/, '')} -->${content}<!-- END app snippet -->`,
    );
  }
  const generation = 'a'.repeat(32);
  const engine = new Liquid({
    root: directory,
    partials: directory,
    extname: '.liquid',
    globals: {
      shop: {
        name: 'Demo & Co.',
        metafields: { $app: { insignia_public_config_v2: { value: { generationHex: generation } } } },
      },
      routes: { root_url: '/' },
      localization: { country: { iso_code: 'US' }, market: { id: '42' } },
      request: { locale: { iso_code: 'en' }, design_mode: false },
    },
  });
  const translations: Record<string, string> = {
    'insignia.customise': 'Customise',
    'insignia.cart_review.label': 'Review customized items',
    'insignia.cart_review.message': 'Customized items changed & need review.',
    'insignia.cart_review.renew_label': 'Renew prices',
    'insignia.cart_review.expired_message': 'Customization prices expired.',
    'insignia.cart_review.context_message': 'Country or currency changed.',
    'insignia.cart_review.renew_failed_message': 'Prices could not be renewed.',
  };
  engine.registerFilter('t', (key: unknown) => {
    assert.ok(typeof key === 'string' && key in translations, `unexpected translation key ${String(key)}`);
    return translations[key as string];
  });
  const values = {
    product: {
      id: '111',
      variants: [{ id: '101' }],
      metafields: { $app: mode ? { insignia_policy_v2: { value: `${generation}:1:${mode}` } } : {} },
    },
    block: {
      shopify_attributes: 'data-shopify-editor-block="synthetic"',
      settings: {
        proxy_prefix: 'insignia',
        auto_placement: true,
        button_label: 'Customise & draw',
        button_style: 'auto',
        button_width: 'theme',
        override_radius: false,
        override_border: false,
        button_spacing: 0,
      },
    },
  };
  const render = async (name: string) => {
    const template = (await readFile(new URL(`blocks/${name}.liquid`, source), 'utf8')).replace(
      /{% schema %}[\s\S]*?{% endschema %}/g,
      '',
    );
    const result: unknown = await engine.parseAndRender(template, values);
    assert.equal(typeof result, 'string');
    return String(result);
  };
  return `${manual ? await render('customize') : ''}${await render('cart-repair')}`;
}

async function browserFixture(t: TestContext) {
  const server = await createStorefrontTestServer({ server: { host: '127.0.0.1', port: 0, strictPort: true } });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  t.after(async () => {
    await browser?.close();
    await server.close();
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('**/cart.js', (route) => route.fulfill({ json: { items: [] } }));
  await page.goto(`http://127.0.0.1:${serverPort(server.httpServer)}`);
  return page;
}

test('rendered theme Liquid retains valid attributes and native Customise placement across Shopify snippet comments', async (t) => {
  const html = await renderTheme(t, 'required');
  const page = await browserFixture(t);
  await page.evaluate(
    (markup) =>
      document.body.insertAdjacentHTML(
        'beforeend',
        `
    <section><product-form-component data-product-id="111"><form action="/cart/add"><input name="id" value="101"><button name="add" type="submit" class="button">Buy</button></form></product-form-component></section>${markup}`,
      ),
    html,
  );
  const integration = page.locator('insignia-theme-integration');
  assert.equal(await integration.getAttribute('auto-placement'), 'true');
  assert.equal(await integration.getAttribute('proxy-base'), '/apps/insignia');
  assert.equal(await integration.getAttribute('trigger-label'), 'Customise & draw');
  assert.equal(await integration.getAttribute('known-required'), '');
  await page.getByRole('button', { name: 'Customise & draw', exact: true }).waitFor();
  assert.equal(await page.locator('button[name=add]').isVisible(), false);
  assert.equal((await page.locator('body').innerText()).includes('auto-placement='), false);
});

test('rendered manual block remains available for required publications despite snippet wrapper comments', async (t) => {
  const html = await renderTheme(t, 'required', true);
  const page = await browserFixture(t);
  await page.evaluate(
    (markup) =>
      document.body.insertAdjacentHTML(
        'beforeend',
        `<section id="manual-section"><product-form-component data-product-id="111"><form action="/cart/add"><input name="id" value="101"><button type="submit" name="add">Buy</button></form></product-form-component>${markup}</section>`,
      ),
    html,
  );
  assert.equal(await page.locator('insignia-buyer:not([data-insignia-auto])').count(), 1);
  await page.getByRole('button', { name: 'Customise & draw', exact: true }).waitFor();
  assert.equal(await page.locator('insignia-buyer[data-insignia-auto]').count(), 0);
  assert.equal(await page.locator('button[name=add]').isVisible(), false);
});

test('rendered draft-only and retained optional products keep ordinary purchase controls', async (t) => {
  for (const mode of [null, 'optional'] as const) {
    const html = await renderTheme(t, mode, true);
    const page = await browserFixture(t);
    await page.route('**/apps/insignia/v1/eligibility?*', (route) =>
      route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } }),
    );
    const checked = page.waitForResponse((response) => response.url().includes('/eligibility?'));
    await page.evaluate(
      (markup) =>
        document.body.insertAdjacentHTML(
          'beforeend',
          `<section><product-form-component data-product-id="111"><form action="/cart/add"><input name="id" value="101"><button name="add" type="submit">Buy normally</button></form></product-form-component>${markup}</section>`,
        ),
      html,
    );
    await checked;
    assert.equal(await page.locator('insignia-theme-integration').getAttribute('known-required'), null);
    assert.equal(await page.locator('insignia-buyer').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Buy normally', exact: true }).isVisible(), true);
  }
});

function memberCarrier(quantity: number, unitMinor: number) {
  const bytes = Buffer.alloc(22);
  bytes.writeUInt16BE(0, 0);
  bytes.writeBigUInt64BE(101n, 2);
  bytes.writeUInt32BE(quantity, 10);
  bytes.writeBigUInt64BE(BigInt(unitMinor), 14);
  return bytes.toString('base64url');
}

test('cart repair prompts with localized theme-styled review only after a native cart edit voids customization', async (t) => {
  const html = await renderTheme(t, null);
  const page = await browserFixture(t);
  let line = {
    product_id: 111,
    quantity: 1,
    original_price: 1745,
    properties: { _insignia_member_v2: memberCarrier(1, 1745) },
  };
  await page.route('**/cart.js', (route) => route.fulfill({ json: { items: [line] } }));
  await page.route('**/cart/change.js', (route) => route.fulfill({ json: {} }));
  await page.evaluate((markup) => document.body.insertAdjacentHTML('beforeend', markup), html);
  const repair = page.locator('insignia-cart-repair');
  const trigger = repair.getByRole('button', { name: 'Review customized items', exact: true });
  await trigger.waitFor();
  // Light DOM lets the theme's own button styles apply to the trigger.
  assert.equal(await trigger.evaluate((button) => button.classList.contains('button')), true);
  const message = repair.getByText('Customized items changed & need review.');
  assert.equal(await message.isVisible(), false);

  // A native theme quantity change: Shopify reverts the line to its base price.
  line = { ...line, quantity: 2, original_price: 995 };
  await page.evaluate(() => fetch('/cart/change.js', { method: 'POST', body: '{}' }));
  await message.waitFor();
  const notice = repair.getByRole('status');
  assert.equal(await notice.evaluate((element) => getComputedStyle(element).position), 'fixed');

  // A repaired, re-signed line clears the prompt.
  line = { ...line, original_price: 1745, properties: { _insignia_member_v2: memberCarrier(2, 1745) } };
  await page.evaluate(() => window.dispatchEvent(new Event('insignia-cart-updated')));
  await message.waitFor({ state: 'hidden' });
  assert.equal(await notice.evaluate((element) => getComputedStyle(element).position), 'static');
});

test('a leftover cart quote without designed lines is cleared unless this tab has an unresolved Insignia write', async (t) => {
  const html = await renderTheme(t, null);
  for (const unresolved of [false, true]) {
    const page = await browserFixture(t);
    const updates: unknown[] = [];
    let attributes: Record<string, string> = { _insignia_quote_v2: 'stale', gift: 'keep' };
    await page.route('**/cart.js', (route) =>
      route.fulfill({ json: { items: [{ product_id: 9, quantity: 1, properties: {} }], attributes } }),
    );
    await page.route('**/cart/update.js', (route) => {
      const body = route.request().postDataJSON() as { attributes: Record<string, string> };
      updates.push(body);
      attributes = { ...attributes, ...body.attributes };
      return route.fulfill({ json: { items: [], attributes } });
    });
    if (unresolved) await page.evaluate(() => sessionStorage.setItem('insignia-cart-unresolved-v2', '1'));
    const loaded = page.waitForResponse((response) => response.url().endsWith('/cart.js'));
    const cleared = unresolved
      ? undefined
      : page.waitForRequest((request) => request.url().endsWith('/cart/update.js'));
    await page.evaluate((markup) => document.body.insertAdjacentHTML('beforeend', markup), html);
    await loaded;
    if (cleared) {
      await cleared;
      await expectEventually(() => updates.length === 1);
      assert.deepEqual(updates, [{ attributes: { _insignia_quote_v2: '' } }], 'only the stale quote is cleared');
    } else {
      await page.waitForTimeout(300);
      assert.deepEqual(updates, [], 'an unresolved Insignia operation keeps the cart for its own recovery');
    }
    assert.equal(await page.locator('insignia-cart-repair insignia-buyer').count(), 0);
  }
});

function quoteEnvelope(context: { currency?: string; country?: string; marketId?: bigint; validThroughDay: number }) {
  const bytes = Buffer.alloc(156);
  bytes.write('ISG2', 0, 'ascii');
  bytes[4] = 2;
  bytes.write(context.currency ?? 'USD', 62, 'ascii');
  bytes[65] = 2;
  bytes.write(context.country ?? 'US', 66, 'ascii');
  bytes.writeBigUInt64BE(context.marketId ?? 42n, 68);
  bytes.writeUInt32BE(context.validThroughDay, 76);
  return bytes.toString('base64url');
}
const utcDay = () => Math.floor(Date.now() / 86400000);

test('cart repair names a currency or Market change and repairs in the current storefront context', async (t) => {
  const html = await renderTheme(t, null);
  const page = await browserFixture(t);
  let cart = {
    currency: 'EUR',
    items: [
      {
        product_id: 111,
        quantity: 1,
        original_price: 920,
        properties: {
          _insignia_quote_v2: quoteEnvelope({ validThroughDay: utcDay() + 2 }),
          _insignia_member_v2: memberCarrier(1, 1745),
        },
      },
    ],
  };
  await page.route('**/cart.js', (route) => route.fulfill({ json: cart }));
  await page.evaluate((markup) => document.body.insertAdjacentHTML('beforeend', markup), html);
  const repair = page.locator('insignia-cart-repair');
  await repair.getByText('Country or currency changed.').waitFor();
  assert.equal(await repair.getByRole('button', { name: 'Renew prices' }).count(), 0);
  // Designer repair quotes again with the storefront's current country and Market.
  const buyer = repair.locator('insignia-buyer[repair]');
  assert.equal(await buyer.getAttribute('country'), 'US');
  assert.equal(await buyer.getAttribute('market-id'), '42');

  // Same currency, but the signed Market is not the storefront's current Market.
  const [line] = cart.items;
  assert.ok(line);
  cart = {
    currency: 'USD',
    items: [
      {
        ...line,
        original_price: 995,
        properties: {
          ...line.properties,
          _insignia_quote_v2: quoteEnvelope({ marketId: 7n, validThroughDay: utcDay() - 3 }),
        },
      },
    ],
  };
  await page.evaluate(() => window.dispatchEvent(new Event('insignia-cart-updated')));
  await page.waitForResponse((response) => response.url().endsWith('/cart.js'));
  await repair.getByText('Country or currency changed.').waitFor();
});

test('an expired unchanged offer renews in one click from the owning tab and otherwise falls back to Designer repair', async (t) => {
  const html = await renderTheme(t, null);
  for (const outcome of ['renewed', 'review'] as const) {
    const page = await browserFixture(t);
    let items: Record<string, unknown>[] = [
      { key: 'ordinary', product_id: 9, variant_id: 9, quantity: 1, properties: {} },
      {
        key: 'custom',
        product_id: 111,
        variant_id: 101,
        quantity: 1,
        original_price: 995,
        properties: {
          _insignia_quote_v2: quoteEnvelope({ validThroughDay: utcDay() - 3 }),
          _insignia_member_v2: memberCarrier(1, 1745),
        },
      },
    ];
    const attributes: Record<string, string> = {};
    const renewals: unknown[] = [];
    await page.route('**/cart.js', (route) => route.fulfill({ json: { currency: 'USD', items, attributes } }));
    await page.route('**/cart/update.js', (route) => {
      const body = route.request().postDataJSON() as {
        updates?: Record<string, number>;
        attributes?: Record<string, string>;
      };
      items = items.filter((item) => body.updates?.[String(item.key)] !== 0);
      Object.assign(attributes, body.attributes);
      return route.fulfill({ json: { currency: 'USD', items, attributes } });
    });
    await page.route('**/cart/add.js', (route) => {
      const body = route.request().postDataJSON() as {
        items: { id: string; quantity: number; properties: Record<string, string> }[];
      };
      for (const item of body.items)
        items.push({ key: 'renewed', product_id: 111, variant_id: Number(item.id), ...item });
      return route.fulfill({ json: { items: body.items } });
    });
    const quoteId = '11111111-1111-4111-8111-111111111111';
    const group = {
      productId: '111',
      configRevisionId: 'revision',
      revisionContentHash: 'a'.repeat(64),
      design: {
        placements: [
          { placementId: 'front', methodId: 'print', stepId: 'small', artwork: { kind: 'deferred', intentId: 'i' } },
        ],
        options: [],
      },
      variants: [{ variantId: '101', quantity: 1 }],
    };
    await page.route('**/apps/insignia/v1/cart-state', (route) =>
      route.fulfill({
        json: {
          groups: [group],
          quoteId,
          repairRequired: true,
          renewable: outcome === 'renewed',
        },
      }),
    );
    await page.route(`**/apps/insignia/v1/quotes/${quoteId}/renew`, (route) => {
      renewals.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          quoteId,
          setId: '33333333-3333-4333-8333-333333333333',
          validThroughDay: utcDay() + 2,
          applicationId: '22222222-2222-4222-8222-222222222222',
          buckets: [
            {
              variantId: '101',
              quantity: 1,
              properties: {
                _insignia_quote_v2: quoteEnvelope({ validThroughDay: utcDay() + 2 }),
                _insignia_member_v2: memberCarrier(1, 1745),
              },
            },
          ],
          desired: [group],
        },
      });
    });
    await page.route('**/apps/insignia/v1/cart-applications/*/confirm', (route) =>
      route.fulfill({ json: { id: '22222222-2222-4222-8222-222222222222', status: 'APPLIED' } }),
    );
    await page.route('**/cart', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Native cart</p>' }));
    await page.evaluate((markup) => document.body.insertAdjacentHTML('beforeend', markup), html);
    const repair = page.locator('insignia-cart-repair');
    const renew = repair.getByRole('button', { name: 'Renew prices', exact: true });
    // A returning buyer without the owning tab session cannot renew; the generic Designer repair remains.
    await repair.getByText('Customized items changed & need review.').waitFor();
    assert.equal(await renew.isVisible(), false);

    await page.evaluate(() =>
      sessionStorage.setItem(
        'insignia-buyer-session:/apps/insignia',
        JSON.stringify({
          capability: 'abc.def',
          sessionId: 's',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        }),
      ),
    );
    await page.evaluate(() => window.dispatchEvent(new Event('insignia-cart-updated')));
    await repair.getByText('Customization prices expired.').waitFor();
    assert.equal(await repair.getByRole('button', { name: 'Review customized items', exact: true }).isVisible(), true);
    assert.deepEqual(renewals, [], 'nothing is renewed before the buyer clicks');
    if (outcome === 'renewed') {
      await Promise.all([page.waitForURL('**/cart'), renew.click()]);
      assert.equal(renewals.length, 1);
      assert.deepEqual(
        items.map((item) => item.key),
        ['ordinary', 'renewed'],
      );
    } else {
      await renew.click();
      await repair.getByText('Prices could not be renewed.').waitFor();
      assert.equal(await renew.isVisible(), false);
      assert.deepEqual(renewals, []);
      assert.equal(
        await repair
          .getByRole('button', { name: 'Review customized items', exact: true })
          .evaluate((button) => document.activeElement === button),
        true,
      );
    }
  }
});

async function expectEventually(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(check());
}
