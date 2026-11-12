import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { serverPort } from './support.mts';

const config = {
  id: 'error-codes-product',
  name: 'Shirt',
  description: 'Shirt',
  storeName: 'Store',
  productName: 'Shirt',
  productDescription: 'Shirt',
  basePrice: 1000,
  currency: 'USD',
  locale: 'en',
  preview: 'photo',
  maxQuantity: 100,
  artworkLater: false,
  sizes: [{ id: 'small', label: 'Small' }],
  colors: [
    {
      id: 'white',
      name: 'White',
      availableSizeIds: ['small'],
      images: {
        front:
          'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"%3E%3Crect width="1000" height="1000" fill="white"/%3E%3C/svg%3E',
      },
    },
  ],
  variantMatrix: [{ rowId: 'white', columnId: 'small', variantId: '101', available: true }],
  views: [{ id: 'front', label: 'Front', illustration: 'front' }],
  positions: [
    {
      id: 'chest',
      name: 'Chest',
      view: 'front',
      x: 50,
      y: 50,
      width: 20,
      dimensions: [10],
      sizePrices: [0],
      price: 0,
      methodIds: ['print'],
    },
  ],
  methods: [{ id: 'print', label: 'Print', surcharge: 0 }],
};

/** The raw English server message; the Designer must never show it (#337). */
const SERVER_MESSAGE = 'Raw server message that must stay hidden';

/**
 * #337: buyer-actionable server codes (spec §8.3) cross the real iframe bridge as one validated code and
 * get their own localized copy. Retry stays only where repeating can succeed; otherwise the primary action
 * is the one that helps (replace the artwork, edit the design, close), and it never re-sends the request.
 */
test('every buyer error code crosses the frame bridge with its own copy and only a helpful action', async (t) => {
  const [host, frameSource] = await Promise.all([
    build({
      entryPoints: [new URL('../src/designer/frame-host.ts', import.meta.url).pathname],
      bundle: true,
      write: false,
      loader: { '.css': 'text' },
      format: 'esm',
      platform: 'browser',
    }),
    build({
      entryPoints: [new URL('../src/designer/frame.tsx', import.meta.url).pathname],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      define: { 'import.meta.env.DEV': 'false' },
      jsx: 'automatic',
      jsxImportSource: 'preact',
      loader: { '.css': 'text' },
      logLevel: 'error',
    }),
  ]);
  // `path=prepare`: the review (price) request fails. `path=commit`: the review succeeds and Add to cart fails.
  // `path=upload`: the artwork upload fails.
  const html = (query: URLSearchParams) => {
    const failure = JSON.stringify({
      status: Number(query.get('status') ?? 0) || undefined,
      code: query.get('code') ?? undefined,
      retryAfter: Number(query.get('retryAfter') ?? 0),
    });
    const prepare = query.get('path') === 'prepare';
    return `<!doctype html><html><body><p>Shopify product page</p><script type="module">
 import {createDesignerFrame} from '/host.js';
 window.preparations=0;window.commits=0;window.closes=0;
 const fail=()=>Object.assign(new Error(${JSON.stringify(SERVER_MESSAGE)}),${failure});
 createDesignerFrame({config:${JSON.stringify(config)},locale:${JSON.stringify(query.get('locale') ?? 'en')},initialPrints:[{id:'chest',method:'print',size:0,artworkId:'asset'}],initialArtworks:[{id:'asset',name:'Logo.png',url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/%3E',width:100,height:100}],ports:{artwork:{upload:${query.get('path') === 'upload' ? "async(file,request)=>{request.onProgress?.('uploading');throw fail()}" : '()=>new Promise(()=>{})'}},review:{prepare:async()=>{window.preparations++;${prepare ? 'throw fail()' : 'return {expiresAt:new Date(Date.now()+600000).toISOString()}'}}},cart:{commit:async()=>{window.commits++;throw fail()}}},onClose(){window.closes++}});
 </script></body></html>`;
  };
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://fixture.test');
      if (url.pathname === '/products/shirt') {
        response.setHeader('Content-Type', 'text/html');
        response.end(html(url.searchParams));
      } else if (url.pathname === '/host.js' || url.pathname === '/insignia-designer-frame.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end((url.pathname === '/host.js' ? host : frameSource).outputFiles[0]?.text);
      } else if (url.pathname === '/insignia-designer.css') {
        response.setHeader('Content-Type', 'text/css');
        response.end(await readFile(new URL(`../dist${url.pathname}`, import.meta.url)));
      } else {
        response.statusCode = 404;
        response.end();
      }
    })().catch(() => {
      response.statusCode = 500;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const frame = page.frameLocator('dialog > iframe');
  const primary = frame.locator('.panel-footer .primary-button');
  const counters = () =>
    page.evaluate(() => ({
      preparations: Reflect.get(window, 'preparations') as number,
      commits: Reflect.get(window, 'commits') as number,
    }));
  const fail = async (path: 'prepare' | 'commit', failure: Record<string, string | number>, locale = 'en') => {
    const query = new URLSearchParams({
      path,
      locale,
      ...Object.fromEntries(Object.entries(failure).map(([k, v]) => [k, String(v)])),
    });
    await page.goto(`http://127.0.0.1:${serverPort(server)}/products/shirt?${query}`);
    await frame.locator('.app').waitFor({ timeout: 10000 });
    await frame.locator('.steps button').nth(1).click();
    await frame.locator('#quantity-white-small').fill('2');
    await frame.locator('.steps button').nth(2).click();
    if (path === 'commit') await primary.click();
    const alert = frame.locator('.cart-submit-error');
    await alert.waitFor();
    const message = await alert.innerText();
    assert.doesNotMatch(message, /Raw server message/, 'the English server message never reaches the buyer');
    return { message, action: await primary.innerText() };
  };
  /** The primary action repeats the request: exactly one more call reaches the port. */
  const assertRetries = async (path: 'prepare' | 'commit') => {
    const before = await counters();
    await primary.click();
    const key = path === 'prepare' ? 'preparations' : 'commits';
    await page.waitForFunction(([name, count]) => Reflect.get(window, name) === count, [key, before[key] + 1] as const);
  };
  /** The primary action helps instead of re-sending; nothing more reaches the port. */
  const assertNoResend = async (after: () => Promise<void>) => {
    const before = await counters();
    await primary.click();
    await after();
    assert.deepEqual(await counters(), before, 'a non-retryable failure is never re-sent');
  };
  const backToDesign = () => frame.locator('.app[data-step="0"]').waitFor();
  // The only uploaded artwork is the expired one: Replace artwork opens its placement's artwork dialog.
  const replaceChestArtwork = async () => {
    await frame.locator('.app[data-step="0"]').waitFor();
    await frame.getByText('Artwork for Chest', { exact: true }).waitFor();
  };
  const closeRequested = () => frame.getByRole('button', { name: 'Close customization', exact: true }).waitFor();

  // Transient: Retry (review) or Add to cart (commit) repeats the request.
  assert.deepEqual(await fail('prepare', { status: 409, code: 'BUSY', retryAfter: 2 }), {
    message: 'The store is busy right now. Your design is still here. Try again in a few seconds.',
    action: 'Retry',
  });
  // Retry waits for Retry-After before it can repeat the request.
  assert.equal(await primary.isDisabled(), true, 'Retry is held until the stated wait passes');
  await assertRetries('prepare');
  assert.deepEqual(await fail('prepare', { status: 503, code: 'UNAVAILABLE' }), {
    message: 'Customization is temporarily unavailable. Your design is still here. Try again later.',
    action: 'Retry',
  });
  await assertRetries('prepare');
  assert.deepEqual(await fail('prepare', { status: 429, code: 'RATE_LIMITED', retryAfter: 90 }), {
    message: 'Too many requests from your network. Try again in 2 minutes.',
    action: 'Retry',
  });
  assert.equal(await primary.isDisabled(), true, 'Retry is held for the 90-second wait');
  const held = await counters();
  await primary.click({ force: true });
  assert.deepEqual(await counters(), held, 'a held Retry sends nothing');
  // The buyer config throttle sends no Retry-After.
  assert.deepEqual(await fail('prepare', { status: 429, code: 'RATE_LIMITED' }), {
    message: 'Too many requests right now. Wait a moment, then try again.',
    action: 'Retry',
  });
  assert.deepEqual(await fail('prepare', { status: 409, code: 'REVIEW_REQUIRED' }), {
    message:
      'This product changed since you opened it, for example its price or stock. Check your choices and try again.',
    action: 'Retry',
  });
  await assertRetries('prepare');
  // At Add to cart a 409 REVIEW_REQUIRED is a definite no-commit: Retry reviews again, never resends the add.
  assert.deepEqual(await fail('commit', { status: 409, code: 'REVIEW_REQUIRED' }), {
    message:
      'This product changed since you opened it, for example its price or stock. Check your choices and try again.',
    action: 'Retry',
  });
  {
    const before = await counters();
    await primary.click();
    await page.waitForFunction((count) => Reflect.get(window, 'preparations') === count, before.preparations + 1);
    assert.equal((await counters()).commits, before.commits, 'the rejected Add to cart is not resent');
  }
  assert.deepEqual(await fail('commit', { status: 409, code: 'BUSY', retryAfter: 2 }), {
    message: 'The store is busy right now. Your design is still here. Try again in a few seconds.',
    action: 'Add to cart',
  });
  assert.equal(await primary.isDisabled(), true, 'Add to cart is held until the stated wait passes');
  await assertRetries('commit');
  // Another tab or the repair view holds this browser's cart lock.
  assert.deepEqual(await fail('commit', { code: 'CART_BUSY' }), {
    message: 'Your cart is being updated in another tab or window. Wait until it finishes, then try again.',
    action: 'Add to cart',
  });
  await assertRetries('commit');

  // Fixable in the design: the primary action goes back to the Design step.
  for (const path of ['prepare', 'commit'] as const) {
    assert.deepEqual(
      await fail(path, { status: 409, code: 'ARTWORK_EXPIRED' }),
      {
        message: 'Your artwork has expired. Replace it to continue.',
        action: 'Replace artwork',
      },
      path,
    );
    await assertNoResend(replaceChestArtwork);
  }
  assert.deepEqual(await fail('prepare', { status: 422, code: 'POSITION_INVALID' }), {
    message: 'Your artwork position is no longer allowed. Edit your design to continue.',
    action: 'Edit design',
  });
  await assertNoResend(backToDesign);

  // Nothing the buyer does here helps: Close (the usual close flow, which keeps the design).
  const closing: [Record<string, string | number>, string][] = [
    [{ status: 410, code: 'PRODUCT_UNAVAILABLE' }, 'This product can no longer be customized. Your cart is unchanged.'],
    [
      { status: 422, code: 'UNSUPPORTED_MARKET' },
      "Customization isn't available for your country or currency. Your cart is unchanged.",
    ],
    [
      { status: 400, code: 'COUNTRY_REQUIRED' },
      'Choose your country or region in the store, then open customization again.',
    ],
    [
      { status: 403, code: 'ENTITLEMENT_DENIED' },
      "This store can't accept customizations right now. Your cart is unchanged.",
    ],
    // #362 follow-up: the session limit at review, before any upload ("Provide artwork later").
    [
      { status: 429, code: 'SESSION_RATE_LIMITED', retryAfter: 1500 },
      'Too many new customization sessions from your network. Try again in 25 minutes.',
    ],
  ];
  for (const [failure, message] of closing) {
    assert.deepEqual(await fail('prepare', failure), { message, action: 'Close' }, String(failure.code));
    await assertNoResend(closeRequested);
  }
  // #362 follow-up: the session limit at Add to cart names the limit and its wait, not the generic failure.
  assert.deepEqual(await fail('commit', { status: 429, code: 'SESSION_RATE_LIMITED', retryAfter: 30 }), {
    message: 'Too many new customization sessions from your network. Try again in 1 minute.',
    action: 'Close',
  });
  await assertNoResend(closeRequested);

  // Only whitelisted codes cross the frame, and a wait is bounded to the one-hour window.
  assert.deepEqual(await fail('commit', { status: 409, code: 'SOMETHING_ELSE' }), {
    message: 'Your cart could not be updated. Your design is still here. Try again.',
    action: 'Add to cart',
  });
  assert.deepEqual(await fail('prepare', { status: 429, code: 'SESSION_RATE_LIMITED', retryAfter: 1e9 }), {
    message: 'Too many new customization sessions from your network. Try again in 60 minutes.',
    action: 'Close',
  });

  // The owner's upload quota names its wait; neither a retry nor another file helps until then.
  const failUpload = async (failure: Record<string, string | number>) => {
    const query = new URLSearchParams({
      path: 'upload',
      locale: 'en',
      ...Object.fromEntries(Object.entries(failure).map(([k, v]) => [k, String(v)])),
    });
    await page.goto(`http://127.0.0.1:${serverPort(server)}/products/shirt?${query}`);
    await frame.locator('.app').waitFor({ timeout: 10000 });
    await frame.locator('#artwork-chest').click();
    await frame
      .locator('input[type=file]')
      .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('fixture') });
    const alert = frame.locator('#artwork-upload-error');
    await alert.waitFor();
    return {
      message: await alert.innerText(),
      actions: await frame.locator('.upload-failure-actions button').allInnerTexts(),
    };
  };
  assert.deepEqual(await failUpload({ status: 429, code: 'RATE_LIMITED', retryAfter: 150 }), {
    message: "You've reached the upload limit. Try again in 3 minutes.",
    actions: ['Close'],
  });
  assert.deepEqual(await failUpload({ status: 429, code: 'RATE_LIMITED' }), {
    message: "You've reached the upload limit. Try again later.",
    actions: ['Close'],
  });

  // German uses the formal "Sie".
  assert.deepEqual(await fail('prepare', { status: 410, code: 'PRODUCT_UNAVAILABLE' }, 'de'), {
    message: 'Dieses Produkt kann nicht mehr personalisiert werden. Ihr Warenkorb ist unverändert.',
    action: 'Schließen',
  });
  assert.deepEqual(await fail('commit', { code: 'CART_BUSY' }, 'de'), {
    message:
      'Ihr Warenkorb wird gerade in einem anderen Tab oder Fenster aktualisiert. Warten Sie, bis der Vorgang abgeschlossen ist, und versuchen Sie es dann erneut.',
    action: 'In den Warenkorb legen',
  });
});
