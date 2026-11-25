import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { contentType, serverPort } from './support.mts';

test('selected repair keeps cart unchanged until actual remaining-cart review is explicitly confirmed', async (t) => {
  const built = await build({
    entryPoints: [new URL('../src/designer/frame-host.ts', import.meta.url).pathname],
    bundle: true,
    write: false,
    loader: { '.css': 'text' },
    format: 'esm',
    platform: 'browser',
  });
  const script = built.outputFiles[0];
  assert(script);
  const config = {
    id: 'repair',
    name: 'Shirt',
    description: 'Shirt',
    storeName: 'Store',
    productName: 'Shirt',
    productDescription: 'Shirt',
    basePrice: 0,
    currency: 'USD',
    locale: 'en',
    maxQuantity: 100,
    artworkLater: false,
    sizes: [{ id: 's', label: 'Small' }],
    colors: [
      {
        id: 'white',
        name: 'White',
        availableSizeIds: ['s'],
        images: { front: 'https://images.example.test/front.png' },
      },
    ],
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
  const html = `<!doctype html><script type="module">import{createDesignerFrame}from'/host.js';window.prepared=0;window.confirmed=0;window.starts=0;window.closedRepair=0;window.repairFrame=createDesignerFrame({config:${JSON.stringify(config)},locale:'en',ports:{artwork:{upload:async()=>{throw Error('unused')}},cart:{commit:async()=>{throw Error('must not commit designer')}}},repair:{cause:'review-required',canStart:true,canRemoveGroup:true,canRemoveAll:true},onClose(){window.closedRepair++},async onRepair(action){if(action==='start'){window.starts++;return;}if(action==='confirm'){window.confirmed++;return;}window.prepared++;return{currency:'USD',exponent:2,totalMinor:'4200',customizedQuantity:2,groups:[{id:'sibling',label:'Retained sibling customization',quantity:2,totalMinor:'4200'}]};}});</script>`;
  const server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://fixture').pathname;
      if (path === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
        return;
      }
      if (path === '/host.js') {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(script.text);
        return;
      }
      if (!/^\/insignia-[A-Za-z0-9_.-]+\.(js|css|woff2)$/.test(path)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader('Content-Type', contentType(path));
      res.end(await readFile(new URL(`../dist${path}`, import.meta.url)));
    })().catch(() => {
      res.statusCode = 500;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${serverPort(server)}/`);
  const frame = page.frameLocator('iframe');
  await frame.getByRole('heading', { name: 'Your customization needs review' }).waitFor();
  const repairBounds = await frame
    .getByRole('region', { name: 'Your customization needs review', exact: true })
    .boundingBox();
  assert.ok(
    repairBounds && repairBounds.width <= 600 && repairBounds.x > 100,
    'Recovery stays in a selected centered panel inside the modal',
  );
  assert.equal(await page.evaluate(() => Reflect.get(window, 'confirmed')), 0);
  await frame.getByRole('button', { name: 'Review removing this customization', exact: true }).click();
  await frame.getByText('Retained sibling customization', { exact: false }).waitFor();
  assert.equal(await frame.locator('strong').last().innerText(), '$42.00');
  assert.equal(await page.evaluate(() => Reflect.get(window, 'confirmed')), 0);
  await frame.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.evaluate(() => Reflect.get(window, 'confirmed')), 0);
  await frame.getByRole('button', { name: 'Review removing this customization', exact: true }).click();
  await frame.getByRole('button', { name: 'Confirm cart update', exact: true }).click();
  await page.waitForFunction(() => Reflect.get(window, 'confirmed') === 1);
  assert.equal(await page.evaluate(() => Reflect.get(window, 'confirmed')), 1);
  assert.equal(await page.evaluate(() => Reflect.get(window, 'prepared')), 2);
  await page.evaluate(async () => {
    Reflect.get(window, 'repairFrame').destroy();
    const { createDesignerFrame } = await import(/* @vite-ignore */ new URL('/host.js', location.href).href);
    Reflect.set(
      window,
      'repairFrame',
      createDesignerFrame({
        title: 'Retained order',
        locale: 'en',
        repair: { cause: 'unavailable', canRemoveAll: true },
        onClose() {},
        onRepair: async () => undefined,
      }),
    );
  });
  await frame.getByRole('heading', { name: 'Your customization needs review' }).waitFor();
  assert.equal(
    await frame.locator('.preview-panel').count(),
    0,
    'unrepresentable publications do not get a fabricated Designer product',
  );
  assert.equal(await frame.getByRole('button', { name: 'Start a new customization', exact: true }).count(), 0);
  assert.equal(await frame.getByRole('button', { name: 'Review removing this customization', exact: true }).count(), 0);
  assert.equal(
    await frame.getByRole('button', { name: 'Review removing all customized items', exact: true }).count(),
    1,
  );
  assert.doesNotMatch(await frame.locator('body').innerText(), /[$€]0[.,]00/, 'no dummy free quote is shown');
  // #340 beside #341: an earlier session's lines carry no reopen or start offer; this session can neither reopen
  // nor replace them.
  for (const earlierSession of ['valid', 'expired'] as const) {
    await page.evaluate(async (earlierSession) => {
      Reflect.get(window, 'repairFrame').destroy();
      const { createDesignerFrame } = await import(/* @vite-ignore */ new URL('/host.js', location.href).href);
      Reflect.set(
        window,
        'repairFrame',
        createDesignerFrame({
          title: 'Retained order',
          locale: 'en',
          repair: { cause: 'earlier-session', lines: earlierSession, canRemoveAll: true },
          onClose() {},
          onRepair: async () => undefined,
        }),
      );
    }, earlierSession);
    await frame.getByRole('heading', { name: 'Customized in an earlier session' }).waitFor();
    assert.equal(
      await frame.getByRole('button', { name: 'Discard changes and reopen from cart', exact: true }).count(),
      0,
    );
    assert.equal(await frame.getByRole('button', { name: 'Start a new customization', exact: true }).count(), 0);
    assert.equal(
      await frame.getByRole('button', { name: 'View cart', exact: true }).count(),
      earlierSession === 'valid' ? 1 : 0,
      earlierSession,
    );
  }
  // §8.1: Escape does exactly what Close does. Inside the frame the host dialog never sees the key, so the
  // repair view handles it: an open removal confirmation closes first, then the view, with focus returned to
  // the trigger; while an action is pending (Close disabled) Escape does nothing.
  await page.evaluate(async () => {
    Reflect.get(window, 'repairFrame').destroy();
    const trigger = document.createElement('button');
    trigger.id = 'trigger';
    trigger.textContent = 'Review cart';
    document.body.append(trigger);
    trigger.focus();
    Reflect.set(window, 'escapeClosed', 0);
    const { createDesignerFrame } = await import(/* @vite-ignore */ new URL('/host.js', location.href).href);
    Reflect.set(
      window,
      'repairFrame',
      createDesignerFrame({
        title: 'Retained order',
        locale: 'en',
        repair: { cause: 'unavailable', canRemoveAll: true },
        onClose() {
          Reflect.set(window, 'escapeClosed', Reflect.get(window, 'escapeClosed') + 1);
        },
        onRepair: (action: string) =>
          action === 'confirm'
            ? new Promise((resolve) => Reflect.set(window, 'releaseConfirm', () => resolve(undefined)))
            : Promise.resolve({ currency: 'USD', exponent: 2, totalMinor: '0', customizedQuantity: 0, groups: [] }),
      }),
    );
  });
  await frame.getByRole('heading', { name: 'Your customization needs review' }).waitFor();
  await frame.getByRole('button', { name: 'Review removing all customized items', exact: true }).click();
  const confirmRemoval = frame.getByRole('button', { name: 'Confirm cart update', exact: true });
  await confirmRemoval.waitFor();
  await confirmRemoval.focus();
  await page.keyboard.press('Escape');
  await frame.getByRole('button', { name: 'Review removing all customized items', exact: true }).waitFor();
  assert.equal(await confirmRemoval.count(), 0, 'Escape closes the open removal confirmation first');
  assert.equal(await page.evaluate(() => Reflect.get(window, 'escapeClosed')), 0, 'the view stays open');
  // Pending action: Close is disabled, so Escape does nothing.
  await frame.getByRole('button', { name: 'Review removing all customized items', exact: true }).click();
  await confirmRemoval.click();
  await page.waitForFunction(() => typeof Reflect.get(window, 'releaseConfirm') === 'function');
  assert.equal(await frame.getByRole('button', { name: 'Close', exact: true }).isDisabled(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => Reflect.get(window, 'escapeClosed')), 0, 'Escape is inert while busy');
  assert.equal(await confirmRemoval.count(), 1, 'the pending confirmation stays');
  await page.evaluate(() => Reflect.get(window, 'releaseConfirm')());
  await frame.getByRole('button', { name: 'Close', exact: true }).and(frame.locator(':enabled')).waitFor();
  await frame.getByRole('button', { name: 'Cancel', exact: true }).click();
  await frame.getByRole('button', { name: 'Review removing all customized items', exact: true }).focus();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => Reflect.get(window, 'escapeClosed') === 1);
  await page.waitForFunction(() => !document.querySelector('dialog')?.open);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'trigger', 'focus returns to the trigger');
});
