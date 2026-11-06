import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import type { Connect } from 'vite';
import { handleBuyerRequest } from '../../web/src/server/buyer/http.ts';
import { fixture } from '../../web/test/support/buyer-fixture.mts';
import {
  type AjaxItem,
  ajaxBody,
  createStorefrontTestServer as createServer,
  record,
  required,
  selectedFrameAssets,
  serverPort,
  text,
} from './support.mts';

// Actual browser -> HTTP -> real HMAC/quote/signing/PG -> HTTP Ajax adapter.
// Shopify signed routing, catalog, entitlement/readiness and cart provider are synthetic boundaries.
test('buyer purchases the EUR90 Lean quote through actual HTTP, real signing and PostgreSQL while ordinary cart stays exact', {
  skip: !process.env.DATABASE_URL,
}, async (t) => {
  const f = await fixture(t, { representativePricing: true, selectedBrowser: true });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let items: AjaxItem[] = [
    { key: 'ordinary', variant_id: 999, product_id: 888, quantity: 2, properties: { gift: true } },
  ];
  const attributes: Record<string, string> = {};
  let adds = 0;
  let confirmed = false;
  const boundary: Connect.NextHandleFunction = (req, res, next) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://local.test');
      const prefix = '/apps/insignia/v1/';
      if (url.pathname.startsWith(prefix)) {
        // This local adapter substitutes the Shopify-signed routing boundary, not buyer-supplied tenant authority.
        url.searchParams.set('shop', f.shopDomain);
        const init: RequestInit & { duplex?: 'half' } = {
          method: req.method,
          headers: nodeHeaders(req.headers),
          ...(req.method === 'GET' ? {} : { body: webBody(req), duplex: 'half' }),
        };
        const request = new Request(url, init);
        const response = await handleBuyerRequest(request, f.services, url.pathname.slice(prefix.length));
        if (url.pathname.endsWith('/confirm') && response.status === 200) confirmed = true;
        res.statusCode = response.status;
        for (const [key, value] of response.headers) res.setHeader(key, value);
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (url.pathname === '/cart.js') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ items, attributes, currency: 'EUR' }));
        return;
      }
      if (url.pathname === '/cart/update.js') {
        const body = ajaxBody(await new Response(webBody(req)).json());
        if (body.updates) items = items.filter((item) => body.updates?.[item.key] !== 0);
        Object.assign(attributes, body.attributes ?? {});
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ items, attributes, currency: 'EUR' }));
        return;
      }
      if (url.pathname === '/cart/add.js') {
        adds++;
        const body = ajaxBody(await new Response(webBody(req)).json());
        items = [
          ...items,
          ...required(body.items).map((item, index) => ({
            key: `custom-${index}`,
            variant_id: item.id,
            product_id: f.productId,
            quantity: item.quantity,
            properties: item.properties,
          })),
        ];
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ items }));
        return;
      }
      next();
    })().catch((error) => {
      res.statusCode = 500;
      res.end('Synthetic HTTP boundary failed');
      t.diagnostic(error instanceof Error ? error.message : 'Unknown fixture boundary failure');
    });
  };
  const server = await createServer({
    plugins: [
      selectedFrameAssets(),
      {
        name: 'synthetic-buyer-http',
        configureServer(server) {
          server.middlewares.use(boundary);
        },
      },
    ],
    server: { host: '127.0.0.1', port: 0, strictPort: true, watch: null },
  });
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.clock.install({ time: new Date('2026-10-12T12:00:00Z') });
    await page.route('https://synthetic.invalid/product.png', (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lL0AAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    );
    await page.goto(`http://127.0.0.1:${serverPort(server.httpServer)}`);
    await page.evaluate((productId) => {
      const host = document.createElement('insignia-buyer');
      host.setAttribute('product-id', productId);
      host.setAttribute('country', 'NL');
      host.setAttribute('market-id', '42');
      document.body.append(host);
    }, f.productId);
    const host = page.locator('insignia-buyer');
    await host.getByRole('button', { name: 'Customize this product' }).click();
    const frame = page.frameLocator('iframe');
    await frame.getByRole('button', { name: 'Add artwork', exact: true }).first().click();
    await frame.locator('.artwork-choice').first().click();
    await frame.getByRole('button', { name: 'Provide artwork later', exact: true }).click();
    await frame.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    await frame.locator('input[type=number]:enabled').first().fill('3');
    const proposed = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/quote-proposals'));
    await frame.getByRole('button', { name: 'Review', exact: true }).last().click();
    const proposalResponse = await proposed;
    assert.equal(proposalResponse.status(), 200, await proposalResponse.text());
    await frame.getByText('€90.00', { exact: true }).filter({ visible: true }).first().waitFor();
    if (process.env.M7_DEMO_SCREENSHOT) await page.screenshot({ path: process.env.M7_DEMO_SCREENSHOT, fullPage: true });
    await frame.getByRole('button', { name: 'Add to cart', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('iframe')?.hidden === true);
    assert.equal(adds, 1);
    assert.equal(confirmed, true);
    assert.deepEqual(items[0], {
      key: 'ordinary',
      variant_id: 999,
      product_id: 888,
      quantity: 2,
      properties: { gift: true },
    });
    assert.equal(required(items[1]).variant_id, '222');
    assert.equal(
      items.slice(1).reduce((sum, item) => sum + item.quantity, 0),
      3,
    );
    assert.ok(items.slice(1).every((item) => item.variant_id === '222'));
    assert.ok(text(required(items[1]).properties._insignia_quote_v2).length > 100);
    assert.ok(text(required(items[1]).properties._insignia_member_v2).length > 10);
    assert.equal(f.signings(), 1);
    const accepted = (await f.pool.query('SELECT quote_value FROM accepted_quotes WHERE shop_id=$1', [f.shopId])).rows;
    assert.equal(accepted.length, 1);
    const economics = record(record(required(accepted[0]).quote_value).economics);
    assert.equal(economics.totalMinor, '9000');
    assert.equal(economics.customizedQuantity, 3);
    assert(Array.isArray(economics.groups));
    const firstGroup = record(required(economics.groups[0]));
    assert.equal(firstGroup.setupMinor, '0');
    assert.equal(firstGroup.customizationUnitMinor, '1000');
    assert.equal(firstGroup.baseTotalMinor, '6000');
  } finally {
    await browser?.close();
    await server.close();
  }
});

function nodeHeaders(values: import('node:http').IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else if (value !== undefined) headers.set(key, value);
  }
  return headers;
}
function webBody(request: import('node:http').IncomingMessage): ReadableStream<Uint8Array<ArrayBuffer>> {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of request) {
          assert(Buffer.isBuffer(chunk));
          controller.enqueue(Uint8Array.from(chunk));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
