import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { serverPort } from './support.mts';

/**
 * #371: a failed repair action crosses the real frame bridge as one validated failure and gets its own copy. Retry
 * is offered only where repeating the action can help: a held cart lock, not a cart over its limit.
 */
test('repair-view failures name the cart limit and a held cart lock, offering Retry only for the lock', async (t) => {
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
  // `failures` lists, per action, the errors its next calls throw; an exhausted list succeeds.
  const html = (locale: string) => `<!doctype html><html><body><script type="module">
 import {createDesignerFrame} from '/host.js';
 window.calls=[];window.failures={};
 createDesignerFrame({title:'Shirt',locale:${JSON.stringify(locale)},repair:{cause:'review-required',canStart:false,canRemoveGroup:true,canRemoveAll:true},onClose(){},
  async onRepair(action){window.calls.push(action);const next=window.failures[action]?.shift();if(next)throw Object.assign(new Error('Raw server message'),next);
   if(action==='confirm')return;return{currency:'USD',exponent:2,totalMinor:action==='remove-all'?'0':'1500',customizedQuantity:1,groups:[]};}});
 </script></body></html>`;
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://fixture.test');
      if (url.pathname === '/products/shirt') {
        response.setHeader('Content-Type', 'text/html');
        response.end(html(url.searchParams.get('locale') ?? 'en'));
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
  const frame = page.frameLocator('iframe');
  const alert = frame.getByRole('alert');
  const calls = () => page.evaluate(() => Reflect.get(window, 'calls') as string[]);
  const open = async (failures: Record<string, object[]>, locale = 'en') => {
    await page.goto(`http://127.0.0.1:${serverPort(server)}/products/shirt?locale=${locale}`);
    await page.evaluate((value) => Reflect.set(window, 'failures', value), failures);
    await frame.locator('section .dialog-actions').waitFor();
  };
  const button = (name: string) => frame.getByRole('button', { name, exact: true });

  // Native cart edits pushed the cart over its signed-set limit: the cart-limit copy, and no Retry.
  await open({ 'remove-group': [{ status: 422, code: 'CAPACITY_EXCEEDED' }] });
  await button('Review removing this customization').click();
  await alert.waitFor();
  assert.equal(
    await alert.innerText(),
    'Your cart has reached the customization limit of 32 customized cart lines and 10,000 customized items. Remove items from your cart or lower quantities to continue.',
  );
  assert.equal(await button('Retry').count(), 1, 'only the review’s own Retry (reopen the Designer) is offered');
  // Remove all still works.
  await button('Review removing all customized items').click();
  await button('Confirm cart update').click();
  await page.waitForFunction(() => (Reflect.get(window, 'calls') as string[]).includes('confirm'));

  // Over 200 cart lines in total.
  await open({ 'remove-group': [{ status: 422, code: 'CAPACITY_EXCEEDED', reason: 'CART_LINES' }] });
  await button('Review removing this customization').click();
  await alert.waitFor();
  assert.equal(
    await alert.innerText(),
    'Your cart has too many items to customize this design. Remove items from your cart to continue.',
  );

  // Another tab holds the cart lock: the busy copy, and Retry confirms the same reviewed removal again.
  await open({ confirm: [{ code: 'CART_BUSY' }] });
  await button('Review removing this customization').click();
  await button('Confirm cart update').click();
  await alert.waitFor();
  assert.equal(
    await alert.innerText(),
    'Your cart is being updated in another tab or window. Wait until it finishes, then try again.',
  );
  assert.equal(await button('Confirm cart update').count(), 0, 'Retry takes the confirmation’s place');
  await button('Retry').click();
  await page.waitForFunction(
    () => (Reflect.get(window, 'calls') as string[]).filter((c) => c === 'confirm').length === 2,
  );
  assert.deepEqual(await calls(), ['remove-group', 'confirm', 'confirm'], 'Retry repeats only the confirmation');
  await alert.waitFor({ state: 'detached' });

  // Any other failure keeps the generic copy; the server's message never reaches the buyer.
  await open({ 'remove-group': [{ status: 400, code: 'SOMETHING_ELSE' }] });
  await button('Review removing this customization').click();
  await alert.waitFor();
  assert.equal(await alert.innerText(), 'Your cart could not be updated. Your design is still here. Try again.');

  // Formal German copy.
  await open({ confirm: [{ code: 'CART_BUSY' }] }, 'de');
  await button('Entfernung dieser Personalisierung prüfen').click();
  await button('Warenkorbänderung bestätigen').click();
  await alert.waitFor();
  assert.match(await alert.innerText(), /^Ihr Warenkorb wird gerade in einem anderen Tab oder Fenster aktualisiert\./);
  assert.equal(await button('Erneut versuchen').count(), 1);
});
