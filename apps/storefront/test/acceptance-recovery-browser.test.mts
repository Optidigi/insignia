import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import type { BuyerConfig, DesiredGroup } from '../src/buyer.ts';
import { serverPort } from './support.mts';

declare global {
  interface Window {
    reopenAcceptanceRecovery(): void;
  }
}
for (const mode of [
  'declined',
  'ordinary409',
  'network',
  'unavailable-observation',
  'delayed-decline',
  'delayed-observation',
  'declined-with-sibling',
] as const)
  test(`acceptance recovery through controller/live ports/frame: ${mode}`, async (t) => {
    const source: BuyerConfig = {
      version: 'm7-config-v1',
      productId: '111',
      revisionId: 'x-revision',
      contentHash: 'a'.repeat(64),
      title: 'Private product X',
      shopCurrency: 'USD',
      methods: [{ id: 'print', label: 'Print' }],
      placements: [
        { id: 'front', label: 'Front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true },
      ],
      steps: [{ id: 'small', label: 'Small' }],
      options: [],
      variants: [
        {
          id: '101',
          label: 'X',
          available: true,
          selectedOptions: [{ name: 'Title', value: 'Default Title' }],
          baseUnitMinor: '1000',
        },
      ],
      geometry: {
        version: 'm5-geometry-v1',
        views: [
          {
            id: 'front',
            image: { revisionId: 'x-photo', width: 1000, height: 1000 },
            variantImages: [],
            placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 } }],
          },
        ],
        steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5, physicalMm: { width: 100, height: 100 } }],
      },
      imageUrls: { 'x-photo': 'https://example.test/x.png' },
      decorationPrices: [{ placementId: 'front', methodId: 'print', stepId: 'small', minor: '500' }],
      ready: true,
    };
    const compiled = await build({
        entryPoints: [new URL('../src/designer/controller.ts', import.meta.url).pathname],
        bundle: true,
        write: false,
        loader: { '.css': 'text' },
        platform: 'browser',
        format: 'esm',
      }),
      script = compiled.outputFiles[0];
    assert(script);
    const html = `<!doctype html><script type="module">import{mountLiveDesigner}from'/controller.js';window.controller=await mountLiveDesigner({source:${JSON.stringify(source)},proxyBase:'/apps/insignia',cartRoot:'/',country:'US',marketId:'42',locale:'en',storeName:'Store',repair:false,storage:sessionStorage,onClose(){},onError(){},isCurrent:()=>true});window.reopenAcceptanceRecovery=()=>window.controller.open();</script>`;
    const server = createServer((request, response) => {
      void (async () => {
        const path = new URL(request.url ?? '/', 'http://fixture').pathname;
        if (path === '/') {
          response.setHeader('Content-Type', 'text/html');
          response.end(html);
          return;
        }
        if (path === '/controller.js') {
          response.setHeader('Content-Type', 'text/javascript');
          response.end(script.text);
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
    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    });

    const page = await browser.newPage();
    const proposals: string[] = [];
    const attempts: { id: string; key: string }[] = [];
    let writes = 0;
    let enterDelay: () => void = () => {},
      releaseDelay: () => void = () => {};
    const delayed = new Promise<void>((resolve) => {
      enterDelay = resolve;
    });
    const delayGate = new Promise<void>((resolve) => {
      releaseDelay = resolve;
    });
    let delayUsed = false;
    const sibling: DesiredGroup = {
      productId: '333',
      configRevisionId: 'sibling-revision',
      revisionContentHash: 'c'.repeat(64),
      design: {
        placements: [
          {
            placementId: 'front',
            methodId: 'print',
            stepId: 'small',
            artwork: { kind: 'deferred', intentId: 'sibling-intent' },
          },
        ],
        options: [],
      },
      variants: [{ variantId: '303', quantity: 2 }],
    };
    const items =
      mode === 'declined-with-sibling'
        ? [
            {
              key: 'sibling-line',
              variant_id: 303,
              product_id: 333,
              quantity: 2,
              properties: { _insignia_quote_v2: 'q', _insignia_member_v2: 'm' },
            },
            { key: 'gift', variant_id: 999, quantity: 1, properties: { note: 'Keep ordinary gift' } },
          ]
        : [];
    await page.route('**/cart.js', (route) => route.fulfill({ json: { currency: 'USD', attributes: {}, items } }));
    await page.route('**/cart/*.js', (route) => {
      writes++;
      return route.fulfill({ status: 500, json: {} });
    });
    await page.route('**/apps/insignia/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const body = route.request().method() === 'GET' ? null : route.request().postDataJSON();
      if (path.endsWith('/sessions'))
        return route.fulfill({
          json: {
            capability: 'abc.def',
            sessionId: '11111111-1111-4111-8111-111111111111',
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          },
        });
      if (path.endsWith('/config') && mode === 'delayed-observation' && attempts.length > 0 && !delayUsed) {
        delayUsed = true;
        enterDelay();
        await delayGate;
      }
      if (path.endsWith('/cart-state'))
        return route.fulfill({
          json: {
            groups: [sibling],
            labels: { '333': 'Retained sibling' },
            quoteId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            repairRequired: false,
          },
        });
      if (path.endsWith('/config'))
        return mode === 'unavailable-observation' && attempts.length > 0
          ? route.fulfill({ status: 503, json: {} })
          : route.fulfill({
              json:
                new URL(route.request().url()).searchParams.get('productId') === '333'
                  ? {
                      ...source,
                      productId: '333',
                      revisionId: sibling.configRevisionId,
                      contentHash: sibling.revisionContentHash,
                      variants: source.variants.map((v) => ({ ...v, id: '303' })),
                    }
                  : source,
            });
      if (/\/designs\/[^/]+$/.test(path))
        return route.fulfill({ json: { id: path.split('/').at(-1), version: 1, value: body.group } });
      if (path.endsWith('/quote-proposals')) {
        const id = `11111111-1111-4111-8111-${String(proposals.length + 1).padStart(12, '0')}`;
        proposals.push(id);
        if (mode === 'declined-with-sibling')
          assert.deepEqual(
            body.groups.find((group: DesiredGroup) => group.productId === '333'),
            sibling,
          );
        return route.fulfill({
          json: {
            proposalId: id,
            hash: 'b'.repeat(64),
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            currency: 'USD',
            exponent: 2,
            customizedQuantity: 1,
            totalMinor: proposals.length === 1 ? '1500' : '1700',
            groups: [
              {
                productId: '111',
                quantity: 1,
                setupMinor: '0',
                customizationUnitMinor: '500',
                baseTotalMinor: proposals.length === 1 ? '1000' : '1200',
                totalMinor: proposals.length === 1 ? '1500' : '1700',
              },
            ],
            changedGroups: [],
          },
        });
      }
      if (path.endsWith('/accept')) {
        attempts.push({ id: path.split('/').at(-2)!, key: body.idempotencyKey });
        if (mode === 'delayed-decline' && !delayUsed) {
          delayUsed = true;
          enterDelay();
          await delayGate;
        }
        return mode === 'network'
          ? route.abort()
          : route.fulfill({
              status: 409,
              json: { code: 'REVIEW_REQUIRED', ...(mode !== 'ordinary409' ? { acceptanceOutcome: 'declined' } : {}) },
            });
      }
      return route.fulfill({ status: 500, json: {} });
    });
    await page.goto(`http://127.0.0.1:${serverPort(server)}/`);
    const frame = page.frameLocator('iframe');
    await frame.locator('.app').waitFor();
    await frame.getByRole('button', { name: 'Add artwork', exact: true }).click();
    await frame.locator('.artwork-choice').click();
    await frame.locator('.later-button').click();
    await frame.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    await frame.locator('input[type=number]:enabled').first().fill('1');
    await frame.getByRole('button', { name: 'Review', exact: true }).last().click();
    await frame.getByRole('button', { name: 'Add to cart', exact: true }).click();

    if (mode === 'delayed-decline' || mode === 'delayed-observation') {
      await delayed;
      await frame.getByRole('button', { name: 'Close customizer', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      releaseDelay();
      await page.evaluate(() => window.reopenAcceptanceRecovery());
      await frame.locator('.app').waitFor();
      assert.equal(
        await frame.getByRole('region', { name: 'Your customization needs review', exact: true }).count(),
        0,
      );
      await frame.getByRole('button', { name: 'Add to cart', exact: true }).click();
      await frame.getByRole('region', { name: 'Your customization needs review', exact: true }).waitFor();
      assert.equal(proposals.length, 1, 'Aborted late outcomes cannot retire another current attempt');
      assert.deepEqual(attempts[0], attempts[1], 'Reopened unresolved attempt retains its original identity');
      assert.equal(writes, 0);
      assert.equal(new URL(page.url()).pathname, '/');
      return;
    }
    if (mode === 'ordinary409' || mode === 'network') {
      await frame.locator('.cart-submit-error').waitFor();
      await frame.getByRole('button', { name: 'Previous step', exact: true }).click();
      await frame.getByRole('button', { name: 'Review', exact: true }).last().click();
      await frame.getByRole('button', { name: 'Add to cart', exact: true }).click();
      await frame.locator('.cart-submit-error').waitFor();
      assert.equal(proposals.length, 1);
      assert.equal(attempts.length, 2);
      assert.deepEqual(attempts[0], attempts[1]);
      assert.equal(writes, 0);
      return;
    }
    await frame.getByRole('region', { name: 'Your customization needs review', exact: true }).waitFor();
    assert.equal(attempts.length, 1);
    assert.equal(writes, 0);
    if (mode === 'declined-with-sibling') {
      const observed = await page.evaluate(async () => (await fetch('/cart.js')).json());
      assert.deepEqual(observed.items, items, 'Terminal decline preserves sibling and ordinary cart lines exactly');
      assert.equal(proposals.length, 1);
      assert.equal(writes, 0);
      return;
    }
    if (mode === 'unavailable-observation') {
      assert.equal(await frame.getByRole('button', { name: 'Start a new customization', exact: true }).count(), 0);
      assert.equal(await frame.getByRole('button', { name: /Review removing/ }).count(), 0);
      assert.equal(proposals.length, 1);
      assert.equal(writes, 0);
      return;
    }
    await frame.getByRole('button', { name: 'Retry', exact: true }).click();

    await frame.getByRole('button', { name: 'Add to cart', exact: true }).waitFor();
    await frame.locator('.footer-price strong').filter({ hasText: '$17.00' }).waitFor();
    await frame.getByText('Artwork to follow', { exact: true }).waitFor();
    assert.equal(proposals.length, 2);
    assert.equal(attempts.length, 1);
    assert.equal(new URL(page.url()).pathname, '/');
    await frame.getByRole('button', { name: 'Add to cart', exact: true }).click();
    await frame.getByRole('region', { name: 'Your customization needs review', exact: true }).waitFor();
    assert.equal(attempts.length, 2);
    assert.notEqual(attempts[0]?.key, attempts[1]?.key);
    assert.notEqual(attempts[0]?.id, attempts[1]?.id);
    assert.equal(writes, 0);
  });
