import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { serverPort } from './support.mts';

for (const engine of [chromium, firefox]) {
  test(`${engine.name()}: isolated selected Designer preserves edits, renders real review before consent and retries one cart identity`, async (t) => {
    const host = await build({
      entryPoints: [new URL('../src/designer/frame-host.ts', import.meta.url).pathname],
      bundle: true,
      write: false,
      loader: { '.css': 'text' },
      format: 'esm',
      platform: 'browser',
    });
    const sourceFrame =
      process.env.INSIGNIA_SOURCE_FRAME === '1'
        ? await build({
            entryPoints: [new URL('../src/designer/frame.tsx', import.meta.url).pathname],
            bundle: true,
            write: false,
            format: 'esm',
            platform: 'browser',
            define: { 'import.meta.env.DEV': 'false' },
            jsx: 'automatic',
            jsxImportSource: 'preact',
            loader: { '.css': 'text' },
          })
        : undefined;
    const source = host.outputFiles[0];
    assert(source);
    const config = {
      id: 'live-product',
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
      methods: [{ id: 'print', label: 'Print', surcharge: 500 }],
      productionOptions: [
        {
          id: 'packing',
          label: 'Packaging',
          values: [
            { id: 'plain', label: 'Plain' },
            { id: 'gift', label: 'Gift wrap' },
          ],
        },
      ],
    };
    const html = `<!doctype html><html><head><style>body{font-family:serif}#outside{color:rgb(200,0,0)}</style></head><body><p id="outside">Shopify-owned page</p><script type="module">
 import {createDesignerFrame} from '/host.js';
 const config=${JSON.stringify(config)};
 window.preparations=[];window.writes=[];window.releaseQuote=null;window.designerClosed=0;window.appliedCloses=0;
 const frame=createDesignerFrame({config,locale:'en',initialPrints:[{id:'chest',method:'print',size:0,artworkId:'asset'}],initialArtworks:[{id:'asset',name:'Logo.png',url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect width="100" height="100" fill="navy"/%3E%3C/svg%3E',width:100,height:100}],ports:{artwork:{upload:async(file,request)=>{request.onProgress?.('uploading');window.uploadSignal=request.signal;return new Promise((resolve,reject)=>{window.failUpload=()=>reject(new Error('temporary failure'));window.completeUpload=()=>resolve({id:'replacement',name:file.name,url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/%3E',width:100,height:100});request.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});})}},review:{prepare:async(request)=>{window.preparations.push({key:request.idempotencyKey,requestId:request.requestId,design:request.design});frame.review({currency:'USD',exponent:2,customizedQuantity:2,groups:[]},request);await new Promise((resolve,reject)=>window.releaseQuote=(fail)=>fail?reject(Error("quote unavailable")):resolve());frame.review({currency:'USD',exponent:2,totalMinor:'3500',customizedQuantity:request.design.variants[0].quantity,groups:[{id:'other',label:'Reviewed customized cart',quantity:request.design.variants[0].quantity,totalMinor:'3500'}]},request);}},cart:{commit:async(request)=>{window.writes.push({key:request.idempotencyKey,requestId:request.requestId,operation:request.operation,design:request.design});if(window.writes.length===1)throw Error('lost response');return{kind:'applied',requestId:request.requestId,designId:request.design.id,operation:request.operation,authority:'shopify'};}}},onClose(){window.designerClosed++},onAppliedClose(){window.appliedCloses++}});
 window.liveFrame=frame;
 </script></body></html>`;
    const server = createServer((request, response) => {
      void (async () => {
        const path = new URL(request.url ?? '/', 'http://fixture.test').pathname;
        if (path === '/') {
          response.setHeader('Content-Type', 'text/html');
          response.end(html);
          return;
        }
        if (path === '/insignia-designer-frame.js' && sourceFrame) {
          response.setHeader('Content-Type', 'text/javascript');
          response.end(sourceFrame.outputFiles[0]!.text);
          return;
        }
        if (path === '/host.js') {
          response.setHeader('Content-Type', 'text/javascript');
          response.end(source.text);
          return;
        }
        if (!/^\/insignia-[A-Za-z0-9_.-]+\.(?:js|css)$/.test(path)) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : 'text/javascript');
        response.end(await readFile(new URL(`../dist${path}`, import.meta.url)));
      })().catch(() => {
        response.statusCode = 500;
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await engine.launch({ headless: true });
    t.after(async () => {
      await browser.close();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    });
    const page = await browser.newPage({ viewport: { width: engine === firefox ? 390 : 1280, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
    await page.goto(`http://127.0.0.1:${serverPort(server)}/`);
    const frame = page.frameLocator('iframe');
    try {
      await frame.locator('.app').waitFor({ timeout: 10000 });
    } catch {
      throw new Error(
        JSON.stringify({
          errors,
          frames: page.frames().map((frame) => frame.url()),
          body: await page.locator('body').innerText(),
        }),
      );
    }
    assert.match(await frame.locator('.app').evaluate((element) => getComputedStyle(element).fontFamily), /Inter/);
    assert.equal(
      await page.locator('#outside').evaluate((element) => getComputedStyle(element).color),
      'rgb(200, 0, 0)',
    );
    // Real srcdoc host Escape uses the same reducer decision as the visible X.
    await frame.getByRole('button', { name: 'Close customizer', exact: true }).click();
    await frame.getByRole('heading', { name: 'Close customization?', exact: true }).waitFor();
    await frame.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await frame.locator('#artwork-chest').click();
    await frame
      .locator('input[type=file]')
      .setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from('fixture') });
    await frame.getByText('Uploading artwork…', { exact: true }).waitFor();
    // The outer modal cancel event used to bypass the selected workflow.
    await page.locator('dialog').dispatchEvent('cancel');
    await frame.getByRole('heading', { name: 'Cancel this upload?', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => Reflect.get(window, 'uploadSignal')?.aborted), false);
    await frame.getByRole('button', { name: 'Keep uploading', exact: true }).click();
    await frame.getByText('Uploading artwork…', { exact: true }).waitFor();
    await frame.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await frame.getByRole('heading', { name: 'Cancel this upload?', exact: true }).waitFor();
    await frame.getByRole('button', { name: 'Cancel upload', exact: true }).click();
    await frame.locator('#artwork-chest').waitFor();
    await page.waitForFunction(() => Reflect.get(window, 'uploadSignal')?.aborted === true);
    assert.match(await frame.locator('.app').innerText(), /Logo.png/);
    await page.locator('dialog').dispatchEvent('cancel');
    await frame.getByRole('heading', { name: 'Close customization?', exact: true }).waitFor();
    await frame.getByRole('button', { name: 'Close customization', exact: true }).click();
    await page.waitForFunction(() => Reflect.get(window, 'designerClosed') === 1);
    await page.evaluate(() => {
      Reflect.set(window, 'designerClosed', 0);
      Reflect.get(window, 'liveFrame').open();
    });
    await frame.locator('#artwork-chest').click();
    await frame
      .locator('input[type=file]')
      .setInputFiles({ name: 'cancel-on-close.png', mimeType: 'image/png', buffer: Buffer.from('fixture') });
    await frame.getByText('Uploading artwork…', { exact: true }).waitFor();
    // A host close request follows the Escape rule: the open upload dialog's decision comes first,
    // and cancelling the upload closes only that dialog.
    await page.locator('dialog').dispatchEvent('cancel');
    await frame.getByRole('heading', { name: 'Cancel this upload?', exact: true }).waitFor();
    await frame.getByRole('button', { name: 'Cancel upload', exact: true }).click();
    await page.waitForFunction(() => Reflect.get(window, 'uploadSignal')?.aborted === true);
    await frame.locator('.artwork-dialog').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => Reflect.get(window, 'designerClosed')), 0);
    await frame.locator('#artwork-chest').click();
    await frame
      .locator('input[type=file]')
      .setInputFiles({ name: 'retry.png', mimeType: 'image/png', buffer: Buffer.from('fixture') });
    await frame.getByText('Uploading artwork…', { exact: true }).waitFor();
    await page.evaluate(() => Reflect.get(window, 'failUpload')());
    await frame.getByRole('button', { name: 'Try again', exact: true }).waitFor();
    await frame.getByRole('button', { name: 'Try again', exact: true }).click();
    await frame.getByText('Uploading artwork…', { exact: true }).waitFor();
    await page.evaluate(() => Reflect.get(window, 'completeUpload')());
    await frame.locator('#artwork-chest').waitFor();
    await page.waitForFunction(() =>
      document
        .querySelector('iframe')
        ?.contentDocument?.querySelector('#artwork-chest')
        ?.textContent?.includes('retry.png'),
    );
    assert.match(await frame.locator('#artwork-chest').innerText(), /retry.png/);

    await frame.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    assert.equal(await frame.getByLabel('Packaging', { exact: true }).inputValue(), 'plain');
    await frame.getByLabel('Packaging', { exact: true }).selectOption('gift');
    const quantity = frame.locator('input[type=number]:enabled').first();
    await quantity.fill('0');
    await frame.getByRole('button', { name: 'Review', exact: true }).last().click();
    await frame.locator('.validation-return').waitFor();
    const footerLayout = await frame.locator('.panel-footer').evaluate((element) => {
      const link = element.querySelector('.validation-return')!.getBoundingClientRect();
      const price = element.querySelector('.footer-price')!.getBoundingClientRect();
      const buttons = element.querySelector('.footer-buttons')!.getBoundingClientRect();
      const footer = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        linkTop: link.top,
        linkBottom: link.bottom,
        priceTop: price.top,
        priceBottom: price.bottom,
        buttonWidth: buttons.width,
        contentWidth: footer.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      };
    });
    assert.ok(
      Math.max(footerLayout.linkTop, footerLayout.priceTop) <
        Math.min(footerLayout.linkBottom, footerLayout.priceBottom),
      'validation and price retain one grid row',
    );
    assert.ok(
      Math.abs(footerLayout.buttonWidth - footerLayout.contentWidth) < 2,
      'footer actions retain their full-grid span',
    );
    await quantity.fill('2');
    await page.evaluate(() =>
      Reflect.get(window, 'liveFrame').repair({
        cause: 'review-required',
        canStart: true,
        canRemoveGroup: false,
        canRemoveAll: true,
      }),
    );
    await frame.getByRole('heading', { name: 'Your customization needs review' }).waitFor();
    assert.equal(await quantity.inputValue(), '2');
    assert.equal(await frame.getByLabel('Packaging', { exact: true }).inputValue(), 'gift');
    assert.equal(await page.evaluate(() => Reflect.get(window, 'writes').length), 0);
    await page.evaluate(() => Reflect.get(window, 'liveFrame').repair());

    await frame.getByRole('button', { name: 'Review', exact: true }).last().click();
    await page.waitForFunction(() => Reflect.get(window, 'releaseQuote') !== null);
    assert.equal(await frame.locator('.footer-price strong').innerText(), 'Calculating quote…');
    assert.equal(await frame.getByRole('button', { name: 'Preparing quote…', exact: true }).isDisabled(), true);
    await page.evaluate(() => Reflect.get(window, 'releaseQuote')(true));
    await frame.locator('.cart-submit-error').waitFor();
    assert.equal(await frame.locator('.footer-price strong').innerText(), 'Unavailable');
    await frame.locator('.review-pricing summary').click();
    assert.equal(
      await frame.getByText('Calculating quote…', { exact: true }).count(),
      0,
      'failed preparation must retire every loading price placeholder',
    );
    await frame.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.waitForFunction(() => Reflect.get(window, 'preparations').length === 2);
    await frame.getByRole('button', { name: 'Edit quantities', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await quantity.inputValue(), '2');
    await frame.getByRole('button', { name: 'Review', exact: true }).last().click();
    await frame.getByRole('button', { name: 'Previous step', exact: true }).click();
    assert.equal(await quantity.inputValue(), '2');
    await frame.getByRole('button', { name: 'Review', exact: true }).last().click();
    await frame.getByRole('button', { name: 'Close customizer', exact: true }).click();
    await frame.getByRole('button', { name: 'Close customization', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('iframe')?.hidden === true);
    await page.evaluate(() => Reflect.get(window, 'liveFrame').open());
    await page.waitForFunction(() => Reflect.get(window, 'preparations').length === 3);
    await page.evaluate(() => {
      const frame = Reflect.get(window, 'liveFrame').frame as HTMLIFrameElement;
      const requestId = Reflect.get(window, 'preparations')[0].requestId;
      for (const data of [
        {
          type: 'insignia:designer:quote',
          quote: { currency: 'USD', exponent: 2, totalMinor: '9999', customizedQuantity: 99, groups: [] },
        },
        { type: 'insignia:designer:repair', repair: { cause: 'unavailable', canRemoveAll: true } },
      ])
        frame.contentWindow?.postMessage({ ...data, requestId, channel: frame.name }, location.origin);
    });
    assert.equal(await frame.locator('.footer-price strong').innerText(), 'Calculating quote…');
    await page.evaluate(() => Reflect.get(window, 'releaseQuote')());
    await frame.getByRole('button', { name: 'Add to cart', exact: true }).waitFor();
    await page.waitForFunction(() => Reflect.get(window, 'preparations').length === 3);
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'preparations')[0].design.options), [
      { optionId: 'packing', valueId: 'gift' },
    ]);
    await frame.getByText('Gift wrap', { exact: true }).waitFor();
    assert.equal(await frame.locator('.footer-price strong').innerText(), '$35.00');
    assert.equal(await page.evaluate(() => Reflect.get(window, 'writes').length), 0);
    await frame.locator('.review-pricing summary').click();
    assert.equal(await frame.getByRole('region', { name: 'Design totals', exact: true }).count(), 0);
    assert.equal(await frame.getByText('Reviewed customized cart', { exact: true }).count(), 0);
    assert.equal(await frame.locator('.review-pricing summary bdi').innerText(), '$15.00');
    assert.deepEqual(await frame.locator('.review-costs dd').allTextContents(), ['$10.00', '$5.00']);
    assert.equal(await frame.locator('.footer-price strong').innerText(), '$35.00');
    await frame.getByRole('button', { name: 'Add to cart', exact: true }).click();
    await frame.locator('.cart-submit-error').waitFor();
    assert.equal(
      await page.evaluate(() => Reflect.get(window, 'appliedCloses')),
      0,
      'Unknown application cannot hand off to a native cart',
    );
    await frame.getByRole('button', { name: 'Previous step', exact: true }).click();
    assert.equal(await quantity.inputValue(), '2');
    await frame.getByRole('button', { name: 'Review', exact: true }).last().click();
    assert.equal(
      await page.evaluate(() => Reflect.get(window, 'preparations').length),
      3,
      'unchanged intent reuses its reviewed proposal after an ambiguous cart response',
    );
    await frame.getByRole('button', { name: 'Add to cart', exact: true }).click();
    await page.waitForFunction(() => Reflect.get(window, 'appliedCloses') === 1);
    await page.evaluate(() => {
      const element = document.querySelector('iframe')!;
      const attempt = Reflect.get(window, 'writes')[1];
      const receipt = {
        kind: 'applied',
        requestId: attempt.requestId,
        designId: attempt.design.id,
        operation: attempt.operation,
        authority: 'shopify',
      };
      for (let i = 0; i < 2; i++)
        window.dispatchEvent(
          new MessageEvent('message', {
            source: element.contentWindow,
            origin: location.origin,
            data: { type: 'insignia:designer:completed', channel: element.name, receipt },
          }),
        );
    });
    assert.equal(
      await page.evaluate(() => Reflect.get(window, 'appliedCloses')),
      1,
      'duplicate completion cannot repeat automatic navigation',
    );
    const attempts = (await page.evaluate(() => Reflect.get(window, 'writes'))) as {
      key: string;
      design: { id: string };
    }[];
    assert.equal(attempts[0]?.key, attempts[1]?.key);
    assert.equal(attempts[0]?.design.id, attempts[1]?.design.id);
    assert.equal(await page.locator('iframe').isHidden(), false);
    assert.equal(
      await frame.locator('dialog.host-preview-switch').count(),
      0,
      'completion stays inline in the original editor',
    );
    assert.equal(await frame.locator('.app').isVisible(), true);
    const fallback = frame.getByRole('button', { name: 'View cart', exact: true });
    assert.equal(await fallback.isEnabled(), true);
    for (let tab = 0; tab < 20 && !(await fallback.evaluate((button) => button === document.activeElement)); tab++)
      await page.keyboard.press('Tab');
    assert.equal(
      await fallback.evaluate((button) => button === document.activeElement && !button.closest('[inert]')),
      true,
    );
    await page.evaluate(() => {
      const frame = document.querySelector('iframe');
      const completion = frame?.contentDocument?.querySelector('.panel-footer [role=status]');
      if (!completion || !frame) throw new Error('Inline completion missing');
    });
    assert.equal(await frame.getByRole('button', { name: 'Add to cart', exact: true }).count(), 0);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => Reflect.get(window, 'appliedCloses') === 2);
    assert.equal(await page.evaluate(() => Reflect.get(window, 'writes').length), 2);
    assert.equal(await page.evaluate(() => Reflect.get(window, 'appliedCloses')), 2);
    const closesBeforeCompletion = await page.evaluate(() => Reflect.get(window, 'designerClosed'));
    await frame.locator('.header-actions button').last().click();
    await page.waitForFunction((previous) => Reflect.get(window, 'designerClosed') > previous, closesBeforeCompletion);
    await page.waitForFunction(() => document.querySelector('iframe')?.hidden === true);
    await page.evaluate(() => Reflect.get(window, 'liveFrame').open());
    const done = frame.getByRole('button', { name: 'Done', exact: true });
    await done.waitFor();
    assert.equal(await done.isEnabled(), true, 'clean completion can close without preparing or purchasing again');
    await done.click();
    assert.equal(await page.evaluate(() => Reflect.get(window, 'writes').length), 2);
    await page.evaluate(() => Reflect.get(window, 'liveFrame').close());
    assert.equal(
      await page.evaluate(() => Reflect.get(window, 'appliedCloses')),
      2,
      'An applied close is consumed once',
    );
  });
}

test('frame handoff consumes only the completion matching its verified Shopify request', async (t) => {
  const bundle = await build({
    entryPoints: [new URL('../src/designer/frame-host.ts', import.meta.url).pathname],
    bundle: true,
    write: false,
    loader: { '.css': 'text' },
    format: 'esm',
    platform: 'browser',
  });
  const source = bundle.outputFiles[0];
  assert.ok(source);
  const html = `<!doctype html><body><script type="module">
import {createDesignerFrame} from '/host.js';
window.protocolClosed=0;window.protocolApplied=0;
const frame=createDesignerFrame({ports:{artwork:{upload:async()=>{throw Error('unused')}},cart:{commit:async(request)=>{if(window.protocolRepairMode){const owner=new AbortController();frame.repair({cause:'unavailable',canRemoveAll:true},{...request,signal:owner.signal});if(window.protocolRepairMode==='retired')owner.abort();}return{kind:'applied',requestId:request.requestId,designId:request.design.id,operation:request.operation,authority:'shopify'};}}},onClose(){window.protocolClosed++},onAppliedClose(){window.protocolApplied++}});
frame.frame.id='protocol-frame';frame.frame.srcdoc='<!doctype html><body>Protocol fixture</body>';
</script></body>`;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/host.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/host.js' ? source.text : html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${serverPort(server)}/`);
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLIFrameElement>('#protocol-frame')?.contentDocument?.body?.textContent ===
      'Protocol fixture',
  );
  const channel = await page.locator('#protocol-frame').getAttribute('name');
  const child = page.frames().find((frame) => frame.name() === channel);
  assert.ok(child);
  const commit = async (id: string, mode: 'foreign' | 'valid' | 'manual', closed: number) => {
    await child.evaluate(
      async ({ id, mode }) =>
        new Promise<void>((resolve) => {
          const received = (event: MessageEvent) => {
            if (event.source !== parent || event.data?.type !== 'insignia:designer:result' || event.data.id !== id)
              return;
            window.removeEventListener('message', received);
            const receipt =
              mode === 'foreign'
                ? { ...event.data.value, requestId: 'foreign' }
                : mode === 'valid'
                  ? event.data.value
                  : undefined;
            Reflect.set(window, 'lastReceipt', event.data.value);
            parent.postMessage(
              { type: 'insignia:designer:closed', channel: window.name, receipt },
              new URL(document.referrer).origin,
            );
            resolve();
          };
          window.addEventListener('message', received);
          parent.postMessage(
            {
              type: 'insignia:designer:request',
              channel: window.name,
              id,
              action: 'commit',
              request: {
                requestId: id,
                operation: 'added',
                design: { id: 'design', variants: [{ variantId: '1', quantity: 1 }] },
              },
            },
            new URL(document.referrer).origin,
          );
        }),
      { id, mode },
    );
    await page.waitForFunction((count) => Reflect.get(window, 'protocolClosed') === count, closed);
  };
  await commit('one', 'foreign', 1);
  assert.equal(await page.evaluate(() => Reflect.get(window, 'protocolApplied')), 0);
  await commit('two', 'valid', 1);
  await page.waitForFunction(() => Reflect.get(window, 'protocolApplied') === 1);
  assert.equal(await page.evaluate(() => Reflect.get(window, 'protocolApplied')), 1);
  await child.evaluate(() =>
    parent.postMessage(
      { type: 'insignia:designer:closed', channel: window.name, receipt: Reflect.get(window, 'lastReceipt') },
      new URL(document.referrer).origin,
    ),
  );
  await page.waitForFunction(() => Reflect.get(window, 'protocolClosed') === 1);
  assert.equal(
    await page.evaluate(() => Reflect.get(window, 'protocolApplied')),
    1,
    'Duplicate completion is consumed once',
  );
  await commit('three', 'manual', 2);
  assert.equal(
    await page.evaluate(() => Reflect.get(window, 'protocolApplied')),
    1,
    'Manual close cannot use a known cart response as completion',
  );
  await child.evaluate(() => {
    Reflect.set(window, 'receivedRepairs', []);
    window.addEventListener('message', (event) => {
      if (event.source === parent && event.data?.type === 'insignia:designer:repair')
        Reflect.get(window, 'receivedRepairs').push(event.data);
    });
  });
  await page.evaluate(() => Reflect.set(window, 'protocolRepairMode', 'active'));
  await commit('repair-active', 'valid', 2);
  await child.waitForFunction(() => Reflect.get(window, 'receivedRepairs').length === 1);
  assert.equal(
    await child.evaluate(() => Reflect.get(window, 'receivedRepairs')[0].requestId),
    'repair-active',
    'deferred repair retains the operation identity used by the frame fence',
  );
  await page.evaluate(() => Reflect.set(window, 'protocolRepairMode', 'retired'));
  await commit('repair-retired', 'valid', 2);
  // Same-source message ordering provides a barrier after the deferred send.
  await child.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const barrier = (event: MessageEvent) => {
          if (event.source !== window || event.data !== 'repair-barrier') return;
          window.removeEventListener('message', barrier);
          resolve();
        };
        window.addEventListener('message', barrier);
        window.postMessage('repair-barrier', parent.location.origin);
      }),
  );
  assert.equal(
    await child.evaluate(() => Reflect.get(window, 'receivedRepairs').length),
    1,
    'retired repair ownership cannot deliver a deferred repair to the current view',
  );
});
