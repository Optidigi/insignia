import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { chromium, firefox } from 'playwright';
import { createStorefrontTestServer, serverPort } from './support.mts';

async function fixture(t: TestContext, engine: typeof chromium = chromium) {
  const server = await createStorefrontTestServer({ server: { host: '127.0.0.1', port: 0, strictPort: true } });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  t.after(async () => {
    await browser?.close();
    await server.close();
  });
  await server.listen();
  browser = await engine.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${serverPort(server.httpServer)}`);
  return page;
}

test('automatic Customise replaces only the published product purchase controls and inherits the native button style', async (t) => {
  const page = await fixture(t);
  const reads: string[] = [];
  await page.route('**/apps/insignia/v1/eligibility?*', (route) => {
    const id = new URL(route.request().url()).searchParams.get('productId');
    reads.push(id ?? 'missing');
    return id === '111'
      ? route.fulfill({ json: { productId: id, configured: true } })
      : route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } });
  });
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      `
      <style>.native-purchase { background: rgb(11, 22, 33); color: white; border-radius: 7px; font-family: monospace; }</style>
      <product-form-component data-product-id="111"><form id="configured" action="/cart/add">
        <input name="id" value="101"><div class="product-form-buttons">
        <button type="submit" name="add" class="button native-purchase" ref="addToCartButton" on:click="/handleClick">Add to cart</button>
        <div class="shopify-payment-button"><button>Buy now</button></div></div>
      </form></product-form-component>
      <form id="ordinary" action="/cart/add"><input name="product-id" value="222"><input name="id" value="202">
        <button type="submit" name="add">Add ordinary product</button></form>
      <form action="/cart"><button name="checkout">Checkout cart</button></form>
      <insignia-theme-integration product-id="111" variant-ids="101,102" known-required proxy-base="/apps/insignia" country="US" market-id="42" trigger-label="Customise"></insignia-theme-integration>
    `,
    );
  });
  const trigger = page.locator('#configured insignia-buyer').getByRole('button', { name: 'Customise', exact: true });
  await trigger.waitFor();
  assert.equal(await page.locator('#configured button[name=add]').isVisible(), false);
  assert.equal(await page.locator('#configured .shopify-payment-button').isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'Add ordinary product', exact: true }).isVisible(), true);
  assert.equal(await page.getByRole('button', { name: 'Checkout cart', exact: true }).isVisible(), true);
  assert.deepEqual(
    await trigger.evaluate((button) => {
      const style = getComputedStyle(button);
      return {
        background: style.backgroundColor,
        radius: style.borderRadius,
        ref: button.getAttribute('ref'),
        type: button.getAttribute('type'),
      };
    }),
    { background: 'rgb(11, 22, 33)', radius: '7px', ref: null, type: 'button' },
  );
  assert.equal(await page.locator('iframe').count(), 0, 'Designer stays lazy until the customer chooses Customise');
  await page.evaluate(() => document.querySelector('insignia-theme-integration')?.remove());
  assert.equal(await page.locator('#configured button[name=add]').isVisible(), true);
  assert.equal(await page.locator('#configured .shopify-payment-button').isVisible(), true);
  assert.equal(await page.locator('#configured insignia-buyer').count(), 0);
  assert.equal(reads.filter((id) => id === '111').length <= 1, true);
});

test('manual placement wins without duplication and section, variant, quick-add and theme-editor lifecycles preserve product isolation', async (t) => {
  const page = await fixture(t);
  await page.route('**/apps/insignia/v1/eligibility?*', (route) => {
    const id = new URL(route.request().url()).searchParams.get('productId');
    return id === '111'
      ? route.fulfill({ json: { productId: id, configured: true } })
      : route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } });
  });
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      `
      <section id="product-section"><product-info data-product-id="111">
        <form id="dawn" action="/nl/cart/add"><input name="id" value="101">
          <div class="product-form__buttons"><button type="submit" name="add" class="button button--secondary" style="display:inline-flex">Buy</button>
          <div class="shopify-payment-button">Express</div></div></form>
      </product-info></section>
      <quick-add-component data-product-id="111"><button name="add" class="button quick-add__button--choose">Choose</button></quick-add-component>
      <sticky-add-to-cart data-product-id="111"><button type="button" class="sticky-add-to-cart__button button" ref="addToCartButton" on:click="/handleAddToCartClick">Sticky Buy</button></sticky-add-to-cart>
      <dialog id="dialog-manual"><form action="/cart/add"><input name="product-id" value="111"><button type="submit" name="add">Modal Buy</button></form><insignia-buyer product-id="111" trigger-label="Hidden manual placement"></insignia-buyer></dialog>
      <insignia-theme-integration product-id="111" known-required variant-ids="101,102" proxy-base="/apps/insignia" trigger-label="Customise"
        button-background="#123456" button-radius="12px" button-border-width="2px" button-border-color="#abcdef" button-width="full" button-style="primary"></insignia-theme-integration>
    `,
    );
  });
  const dawn = page.locator('#dawn');
  const trigger = dawn.getByRole('button', { name: 'Customise', exact: true });
  assert.equal(
    await dawn.locator('insignia-buyer').count(),
    1,
    'Hidden manual placements cannot suppress the product trigger',
  );
  await trigger.waitFor();
  assert.deepEqual(
    await trigger.evaluate((e) => ({
      color: getComputedStyle(e).backgroundColor,
      radius: getComputedStyle(e).borderRadius,
      borderWidth: getComputedStyle(e).borderWidth,
      borderColor: getComputedStyle(e).borderColor,
      type: e.getAttribute('type'),
    })),
    { color: 'rgb(18, 52, 86)', radius: '12px', borderWidth: '2px', borderColor: 'rgb(171, 205, 239)', type: 'button' },
  );
  assert.equal(await page.locator('quick-add-component button[name=add]').isVisible(), false);
  await page.locator('quick-add-component').getByRole('button', { name: 'Customise', exact: true }).waitFor();
  await page.locator('sticky-add-to-cart').getByRole('button', { name: 'Customise', exact: true }).waitFor();
  assert.equal(await page.locator('sticky-add-to-cart button[ref=addToCartButton]').isVisible(), false);
  await page.evaluate(() => document.querySelector<HTMLDialogElement>('#dialog-manual')?.show());
  await page.locator('#dialog-manual insignia-buyer[data-insignia-auto]').waitFor({ state: 'detached' });
  assert.equal(await trigger.isVisible(), true, 'Opening a different surface cannot suppress the product trigger');
  await page.evaluate(() => document.querySelector<HTMLDialogElement>('#dialog-manual')?.close());
  await page.waitForFunction(() => !!document.querySelector('#dialog-manual insignia-buyer[data-insignia-auto]'));
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('#dawn [name=id]');
    if (!input) throw new Error('Missing variant fixture');
    input.value = '102';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await dawn.locator('insignia-buyer').count(), 1);
  await page.evaluate(() => {
    const manual = document.createElement('insignia-buyer');
    manual.id = 'manual';
    manual.setAttribute('product-id', '111');
    manual.setAttribute('trigger-label', 'Manual Customise');
    document.querySelector('#product-section')?.append(manual);
  });
  await page.getByRole('button', { name: 'Manual Customise', exact: true }).waitFor();
  await dawn.locator('insignia-buyer[data-insignia-auto]').waitFor({ state: 'detached' });
  assert.equal(
    await page.locator('quick-add-component').getByRole('button', { name: 'Customise', exact: true }).isVisible(),
    true,
  );
  assert.equal(
    await page.locator('sticky-add-to-cart').getByRole('button', { name: 'Customise', exact: true }).isVisible(),
    true,
  );
  assert.equal(await dawn.locator('button[name=add]').isVisible(), false);
  assert.deepEqual(
    await page.evaluate(() => {
      const manual = document.querySelector('#manual button[slot=trigger]');
      const form = document.querySelector('#dawn');
      if (!manual || !form) throw new Error('Missing manual fixture');
      let clicks = 0;
      manual.addEventListener(
        'click',
        (event) => {
          clicks++;
          event.stopImmediatePropagation();
        },
        { capture: true, once: true },
      );
      const allowed = form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return { clicks, allowed };
    }),
    { clicks: 1, allowed: false },
  );
  await page.evaluate(() => {
    const manual = document.querySelector<HTMLElement>('#manual');
    if (manual) manual.hidden = true;
  });
  await trigger.waitFor();
  await page.evaluate(() => {
    const manual = document.querySelector<HTMLElement>('#manual');
    if (manual) manual.hidden = false;
  });
  await dawn.locator('insignia-buyer[data-insignia-auto]').waitFor({ state: 'detached' });
  await page.evaluate(() => document.querySelector('#manual')?.remove());
  await trigger.waitFor();
  await page.evaluate(() => {
    const section = document.querySelector('#product-section');
    if (!section) throw new Error('Missing section fixture');
    section.innerHTML =
      '<product-form-component data-product-id="111"><form id="replacement" action="/cart/add"><input name="id" value="102"><button type="submit" name="add" style="display:inline-flex">Replacement Buy</button></form></product-form-component>';
    document.dispatchEvent(new CustomEvent('shopify:section:load'));
  });
  await page.locator('#replacement').getByRole('button', { name: 'Customise', exact: true }).waitFor();
  assert.equal(await page.locator('#replacement button[name=add]').isVisible(), false);
  await page.evaluate(() => document.querySelector('insignia-theme-integration')?.remove());
  assert.equal(await page.locator('#replacement button[name=add]').evaluate((e) => e.style.display), 'inline-flex');
  assert.equal(await page.locator('quick-add-component button[name=add]').isVisible(), true);
  assert.equal(await page.getByRole('button', { name: 'Sticky Buy', exact: true }).isVisible(), true);
  assert.equal(await page.locator('insignia-buyer[data-insignia-auto]').count(), 0);
});

test('a transient eligibility failure is retried on section reload without polling or downgrading a known required product', async (t) => {
  const page = await fixture(t);
  let reads = 0;
  await page.route('**/apps/insignia/v1/eligibility?*', (route) => {
    reads++;
    return reads === 1
      ? route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } })
      : route.fulfill({ json: { productId: '111', configured: true } });
  });
  const failed = page.waitForResponse(
    (response) => response.url().includes('/eligibility?') && response.status() === 503,
  );
  await page.evaluate(() =>
    document.body.insertAdjacentHTML(
      'beforeend',
      `
    <quick-add-component data-product-id="111"><button name="add">Choose options</button></quick-add-component>
    <insignia-theme-integration proxy-base="/apps/insignia" trigger-label="Customise"></insignia-theme-integration>
  `,
    ),
  );
  await failed;
  assert.equal(reads, 1);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('shopify:section:load')));
  await page.locator('quick-add-component').getByRole('button', { name: 'Customise', exact: true }).waitFor();
  assert.equal(reads, 2);
  assert.equal(await page.locator('button[name=add]').isVisible(), false);
  await page.route('**/apps/insignia/v1/eligibility?*', (route) => route.fulfill({ status: 503 }));
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('shopify:section:load')));
  assert.equal(await page.locator('button[name=add]').isVisible(), false);
});

test('card Customise retains native modifier, local variables and scoped presentation across resize without copying purchase behavior', async (t) => {
  const page = await fixture(t);
  await page.route('**/apps/insignia/v1/eligibility?*', (route) =>
    route.fulfill({ json: { productId: '111', configured: true } }),
  );
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<style>
      .button { background: white; color: black; border-radius: 2px; }
      quick-add-component > button.quick-add__button--choose { background:var(--native-card-color);color:rgb(240,241,242);border:2px solid rgb(31,32,33);border-radius:13px;padding:11px 19px;font:600 15px/20px monospace; }
      @media(max-width:600px){quick-add-component > button.quick-add__button--choose{padding:7px 12px;border-radius:9px}}
      .button:focus-visible { outline:3px solid rgb(60,70,80); }
    </style><quick-add-component data-product-id="111"><button name="add" type="submit" id="native-card" ref="addToCartButton" on:click="/handleClick" class="button quick-add__button--choose" style="--native-card-color:rgb(21,22,23)">Choose</button></quick-add-component>
    <insignia-theme-integration proxy-base="/apps/insignia"></insignia-theme-integration>`,
    );
  });
  const trigger = page.locator('quick-add-component insignia-buyer button');
  await trigger.waitFor();
  const appearance = () =>
    trigger.evaluate((button) => {
      const s = getComputedStyle(button);
      return {
        background: s.backgroundColor,
        color: s.color,
        radius: s.borderRadius,
        padding: s.padding,
        font: s.fontFamily,
        modifier: button.classList.contains('quick-add__button--choose'),
        id: button.id,
        ref: button.getAttribute('ref'),
        name: button.getAttribute('name'),
        handler: button.getAttribute('on:click'),
        type: button.getAttribute('type'),
      };
    });
  assert.deepEqual(await appearance(), {
    background: 'rgb(21, 22, 23)',
    color: 'rgb(240, 241, 242)',
    radius: '13px',
    padding: '11px 19px',
    font: 'monospace',
    modifier: true,
    id: '',
    ref: null,
    name: null,
    handler: null,
    type: 'button',
  });
  await page.setViewportSize({ width: 500, height: 700 });
  await page.waitForFunction(() => {
    const button = document.querySelector('quick-add-component insignia-buyer button');
    return !!button && getComputedStyle(button).borderRadius === '9px';
  });
  assert.equal((await appearance()).padding, '7px 12px');
});

test('icon card keeps the native collapsed and hover presentation with a safe decorative icon', async (t) => {
  const page = await fixture(t);
  await page.route('**/apps/insignia/v1/eligibility?*', (route) =>
    route.fulfill({ json: { productId: '111', configured: true } }),
  );
  await page.evaluate(() =>
    document.body.insertAdjacentHTML(
      'beforeend',
      `<style>
    button.quick-add__button{display:flex;align-items:center;width:36px;height:36px;border:2px solid rgb(20,30,40);border-radius:50px;padding:0;background:rgb(240,241,242);overflow:hidden;white-space:nowrap;gap:0}
    .quick-add__button .svg-wrapper{width:32px;min-width:32px;display:flex;align-items:center;justify-content:center}
    .quick-add__button svg{width:20px;height:20px}
    button.quick-add__button:hover{width:max-content;padding-right:12px;background:rgb(210,211,212)}
  </style><quick-add-component data-product-id="111"><button name="add" class="button quick-add__button quick-add__button--choose"><span class="svg-wrapper add-to-cart-icon" aria-hidden="true"><svg viewBox="0 0 20 20" id="native-svg" onload="window.shouldNeverCopy=true"><path d="M2 2L18 18" stroke="currentColor" ref="nativeRef"></path></svg></span>Choose</button></quick-add-component><insignia-theme-integration proxy-base="/apps/insignia"></insignia-theme-integration>`,
    ),
  );
  const trigger = page.locator('quick-add-component insignia-buyer button');
  await trigger.waitFor();
  assert.equal(await trigger.evaluate((b) => getComputedStyle(b).width), '36px');
  assert.equal(await trigger.locator('span.svg-wrapper svg').count(), 1);
  assert.equal(await trigger.locator('[id],[ref],[onload]').count(), 0);
  assert.equal(await trigger.getAttribute('name'), null);
  assert.equal(await trigger.getAttribute('type'), 'button');
  assert.equal(await trigger.getAttribute('aria-label'), null);
  assert.equal(await trigger.innerText(), 'Customise');
  await trigger.hover();
  await page.evaluate(() => document.body.append(document.createElement('div')));
  assert.equal(await trigger.evaluate((b) => getComputedStyle(b).backgroundColor), 'rgb(210, 211, 212)');
  assert.ok(await trigger.evaluate((b) => b.getBoundingClientRect().width > 36));
});

test('explicit Theme Editor controls override inherited native presentation', async (t) => {
  const page = await fixture(t);
  await page.route('**/apps/insignia/v1/eligibility?*', (route) =>
    route.fulfill({ json: { productId: '111', configured: true } }),
  );
  await page.evaluate(() =>
    document.body.insertAdjacentHTML(
      'beforeend',
      `<style>.native{background:linear-gradient(rgb(20,30,40),rgb(20,30,40));color:white;border-radius:20px}</style><form data-product-id="111" action="/cart/add"><button name="add" class="button native">Buy</button></form><insignia-theme-integration proxy-base="/apps/insignia" button-background="rgb(90,80,70)" button-color="rgb(60,50,40)" button-radius="3px" button-width="full"></insignia-theme-integration>`,
    ),
  );
  const button = page.locator('form insignia-buyer button');
  await button.waitFor();
  assert.equal(await button.evaluate((b) => getComputedStyle(b).backgroundImage), 'none');
  assert.deepEqual(
    await button.evaluate((b) => {
      const s = getComputedStyle(b);
      return { bg: s.backgroundColor, color: s.color, radius: s.borderRadius, width: b.style.width };
    }),
    { bg: 'rgb(90, 80, 70)', color: 'rgb(60, 50, 40)', radius: '3px', width: '100%' },
  );
});

test('explicit secondary preset retains its theme variant instead of inheriting the replaced primary colours', async (t) => {
  const page = await fixture(t);
  await page.route('**/apps/insignia/v1/eligibility?*', (route) =>
    route.fulfill({ json: { productId: '111', configured: true } }),
  );
  await page.evaluate(() =>
    document.body.insertAdjacentHTML(
      'beforeend',
      `<style>.button--primary{background:rgb(20,30,40);color:white}.button--secondary{background:rgb(230,231,232);color:rgb(10,11,12)}</style><form data-product-id="111" action="/cart/add"><button name="add" class="button button--primary">Buy</button></form><insignia-theme-integration proxy-base="/apps/insignia" button-style="secondary"></insignia-theme-integration>`,
    ),
  );
  const button = page.locator('form insignia-buyer button');
  await button.waitFor();
  assert.deepEqual(
    await button.evaluate((b) => {
      const s = getComputedStyle(b);
      return { bg: s.backgroundColor, color: s.color };
    }),
    { bg: 'rgb(230, 231, 232)', color: 'rgb(10, 11, 12)' },
  );
});

test('ancestor-scoped idle fallback preserves generic hover background and keyboard focus shadow', async (t) => {
  const page = await fixture(t);
  await page.route('**/apps/insignia/v1/eligibility?*', (route) =>
    route.fulfill({ json: { productId: '111', configured: true } }),
  );
  await page.evaluate(() =>
    document.body.insertAdjacentHTML(
      'beforeend',
      `<style>
    quick-add-component > button.button {background:rgb(21,22,23);box-shadow:rgb(0,0,0) 0 0 0 0;padding:12px}
    .button:hover {background:rgb(210,211,212)}
    .button:focus-visible {box-shadow:rgb(60,70,80) 0 0 0 3px}
    </style><quick-add-component data-product-id="111"><button name="add" class="button">Choose</button></quick-add-component>
    <insignia-theme-integration proxy-base="/apps/insignia"></insignia-theme-integration>`,
    ),
  );
  const trigger = page.locator('quick-add-component insignia-buyer button');
  await trigger.waitFor();
  const appearance = () =>
    trigger.evaluate((b) => {
      const s = getComputedStyle(b);
      return { background: s.backgroundColor, shadow: s.boxShadow, padding: s.padding };
    });
  const idle = { background: 'rgb(21, 22, 23)', shadow: 'rgb(0, 0, 0) 0px 0px 0px 0px', padding: '12px' };
  assert.deepEqual(await appearance(), idle);
  await trigger.hover();
  await page.waitForFunction(() => {
    const button = document.querySelector('quick-add-component insignia-buyer button');
    return button && getComputedStyle(button).backgroundColor === 'rgb(210, 211, 212)';
  });
  assert.deepEqual(await appearance(), { ...idle, background: 'rgb(210, 211, 212)' });
  await page.mouse.move(800, 600);
  await page.keyboard.press('Tab');
  assert.equal(await trigger.evaluate((b) => b.matches(':focus-visible')), true);
  await page.waitForFunction(() => {
    const button = document.querySelector('quick-add-component insignia-buyer button');
    return button && getComputedStyle(button).boxShadow === 'rgb(60, 70, 80) 0px 0px 0px 3px';
  });
  assert.deepEqual(await appearance(), { ...idle, shadow: 'rgb(60, 70, 80) 0px 0px 0px 3px' });
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => {
    const button = document.querySelector('quick-add-component insignia-buyer button');
    return button && getComputedStyle(button).boxShadow === 'rgb(0, 0, 0) 0px 0px 0px 0px';
  });
  assert.deepEqual(await appearance(), idle);
});

for (const engine of [chromium, firefox]) {
  for (const manual of [false, true]) {
    test(`${engine.name()}: transitioning fallback preserves hover and padding on ${manual ? 'manual' : 'automatic'} triggers`, async (t) => {
      const page = await fixture(t, engine);
      await page.route('**/apps/insignia/v1/eligibility?*', (route) =>
        route.fulfill({ json: { productId: '111', configured: true } }),
      );
      await page.route('**/apps/insignia/v1/config?*', (route) =>
        route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } }),
      );
      await page.evaluate(
        (manual) =>
          document.body.insertAdjacentHTML(
            'beforeend',
            `<style>
      form > button.button {background:rgb(21,22,23);padding:12px}
      .button {transition:background-color .2s,padding .2s}
      .button:hover {background:rgb(210,211,212)}
      </style><section><form action="/cart/add" data-product-id="111"><button name="add" class="button">Buy</button></form>
      ${manual ? '<insignia-buyer product-id="111"><button slot="trigger" class="button">Customise</button></insignia-buyer>' : ''}
      <insignia-theme-integration proxy-base="/apps/insignia"></insignia-theme-integration></section>`,
          ),
        manual,
      );
      const trigger = page.locator('insignia-buyer button[slot="trigger"]');
      await trigger.waitFor();
      await page.waitForFunction(() =>
        (() => {
          const button = document.querySelector('insignia-buyer button');
          return button && getComputedStyle(button).padding === '12px';
        })(),
      );
      // The browser reports each transition it starts. Sampling for an in-between colour instead
      // misses a 0.2 s transition that finishes before the first sample on a loaded runner.
      await trigger.evaluate((button) => {
        const started: string[] = [];
        Object.assign(window, { transitionsStarted: started });
        button.addEventListener('transitionrun', (event) => started.push(event.propertyName));
      });
      await trigger.hover();
      await page.waitForFunction(() =>
        (window as unknown as { transitionsStarted: string[] }).transitionsStarted.includes('background-color'),
      );
      await page.waitForFunction(() => {
        const button = document.querySelector('insignia-buyer button');
        if (!button) return false;
        const s = getComputedStyle(button);
        return s.backgroundColor === 'rgb(210, 211, 212)' && s.padding === '12px';
      });
      await page.mouse.move(800, 600);
      await page.waitForFunction(() => {
        const button = document.querySelector('insignia-buyer button');
        if (!button) return false;
        const s = getComputedStyle(button);
        return s.backgroundColor === 'rgb(21, 22, 23)' && s.padding === '12px';
      });
    });
  }
}
