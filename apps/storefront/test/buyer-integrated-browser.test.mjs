import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { handleBuyerRequest } from '../../web/src/server/buyer/http.ts';
import { fixture } from '../../web/test/support/buyer-fixture.mjs';

// Actual browser -> HTTP -> real HMAC/quote/signing/PG -> HTTP Ajax adapter.
// Shopify signed routing, catalog, entitlement/readiness and cart provider are synthetic boundaries.
test('buyer purchases the EUR91 quote through actual HTTP, real signing and PostgreSQL while ordinary cart stays exact', {
  skip: !process.env.DATABASE_URL,
}, async (t) => {
  const f = await fixture(t, { demo91: true });
  let browser;
  let items = [{ key: 'ordinary', variant_id: 999, product_id: 888, quantity: 2, properties: { gift: true } }];
  const attributes = {};
  let adds = 0;
  let confirmed = false;
  const boundary = (req, res, next) => {
    void (async () => {
      const url = new URL(req.url, 'http://local.test');
      const prefix = '/apps/insignia/v1/';
      if (url.pathname.startsWith(prefix)) {
        // This local adapter substitutes the Shopify-signed routing boundary, not buyer-supplied tenant authority.
        url.searchParams.set('shop', f.shopDomain);
        const request = new Request(url, {
          method: req.method,
          headers: req.headers,
          ...(req.method === 'GET' ? {} : { body: Readable.toWeb(req), duplex: 'half' }),
        });
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
        const body = await new Response(Readable.toWeb(req)).json();
        if (body.updates) items = items.filter((item) => body.updates[item.key] !== 0);
        Object.assign(attributes, body.attributes ?? {});
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ items, attributes, currency: 'EUR' }));
        return;
      }
      if (url.pathname === '/cart/add.js') {
        adds++;
        const body = await new Response(Readable.toWeb(req)).json();
        items = [
          ...items,
          ...body.items.map((item, index) => ({
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
      t.diagnostic(error.message);
    });
  };
  const server = await createServer({
    plugins: [
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
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.evaluate((productId) => {
      const host = document.createElement('insignia-buyer');
      host.setAttribute('product-id', productId);
      host.setAttribute('country', 'NL');
      host.setAttribute('market-id', '42');
      document.body.append(host);
    }, f.productId);
    const host = page.locator('insignia-buyer');
    await host.getByRole('button', { name: 'Customize this product' }).click();
    await host.getByRole('button', { name: 'Provide logo later' }).click();
    await host.getByRole('button', { name: 'Continue to Placement' }).click();
    await host.getByRole('checkbox', { name: 'Front', exact: true }).check();
    await host.getByRole('button', { name: 'Continue to Preview' }).click();
    await host.getByRole('button', { name: 'Continue to Review' }).click();
    await host.getByRole('spinbutton').fill('3');
    await host.getByRole('button', { name: 'Review complete customized cart' }).click();
    await host.getByRole('button', { name: 'Add to Cart — EUR 91.00' }).waitFor();
    if (process.env.M7_DEMO_SCREENSHOT) {
      await host.getByRole('button', { name: 'Add to Cart — EUR 91.00' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: process.env.M7_DEMO_SCREENSHOT, fullPage: true });
    }
    await host.getByRole('button', { name: 'Add to Cart — EUR 91.00' }).click();
    await host.getByText('Customized cart updated.').waitFor();
    assert.equal(adds, 1);
    assert.equal(confirmed, true);
    assert.deepEqual(items[0], {
      key: 'ordinary',
      variant_id: 999,
      product_id: 888,
      quantity: 2,
      properties: { gift: true },
    });
    assert.equal(items[1].variant_id, '222');
    assert.equal(
      items.slice(1).reduce((sum, item) => sum + item.quantity, 0),
      3,
    );
    assert.ok(items.slice(1).every((item) => item.variant_id === '222'));
    assert.ok(items[1].properties._insignia_quote_v2.length > 100);
    assert.ok(items[1].properties._insignia_member_v2.length > 10);
    assert.equal(f.signings(), 1);
    const accepted = (await f.pool.query('SELECT quote_value FROM accepted_quotes WHERE shop_id=$1', [f.shopId])).rows;
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].quote_value.economics.totalMinor, '9100');
    assert.equal(accepted[0].quote_value.economics.customizedQuantity, 3);
    assert.equal(accepted[0].quote_value.economics.groups[0].setupMinor, '100');
    assert.equal(accepted[0].quote_value.economics.groups[0].customizationUnitMinor, '1000');
    assert.equal(accepted[0].quote_value.economics.groups[0].baseTotalMinor, '6000');
  } finally {
    await browser?.close();
    await server.close();
  }
});
