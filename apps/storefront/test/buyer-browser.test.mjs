import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const config = {
  version: 'm7-config-v1',
  productId: '111',
  revisionId: 'r1',
  contentHash: 'a'.repeat(64),
  methods: [{ id: 'print', label: 'Print' }],
  placements: [
    { id: 'front', label: 'Front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true },
  ],
  steps: [{ id: 'small', label: 'Small' }],
  options: [],
  variants: [{ id: '222', label: 'Blue / M', available: true }],
  geometry: {
    version: 'm5-geometry-v1',
    views: [
      {
        id: 'front',
        variantImages: [],
        placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 } }],
      },
    ],
    steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5 }],
  },
  imageUrls: {},
  ready: true,
};
test('buyer reviews full retained cart, accepts exact price and keeps ordinary lines; dialog returns focus', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    let items = [{ key: 'ordinary', variant_id: 999, quantity: 2, properties: { gift: true } }];
    let proposalBody;
    let acceptedBody;
    let sessionCalls = 0;
    let artworkCalls = 0;
    await page.route('**/apps/insignia/guest**', (route) => {
      artworkCalls++;
      return route.fulfill({ status: 400, json: { error: 'must not allocate during commerce' } });
    });
    let releaseCartAdd;
    const cartAddGate = new Promise((resolve) => {
      releaseCartAdd = resolve;
    });
    let cartAddStarted;
    const adding = new Promise((resolve) => {
      cartAddStarted = resolve;
    });
    const attributes = {};
    await page.route('**/cart*.js', (route) => route.fulfill({ json: { items, attributes, currency: 'EUR' } }));
    await page.route('**/cart/update.js', (route) => {
      const body = route.request().postDataJSON();
      if (body.updates) items = items.filter((item) => body.updates[item.key] !== 0);
      Object.assign(attributes, body.attributes ?? {});
      return route.fulfill({ json: { items, attributes, currency: 'EUR' } });
    });
    await page.route('**/cart/add.js', async (route) => {
      const body = route.request().postDataJSON();
      items = [
        ...items,
        ...body.items.map((i, index) => ({
          key: `new${index}`,
          variant_id: i.id,
          quantity: i.quantity,
          properties: i.properties,
        })),
      ];
      cartAddStarted();
      await cartAddGate;
      return route.fulfill({ json: { items } });
    });
    await page.route('**/apps/insignia/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.includes('/uploads') || path.includes('/assets')) artworkCalls++;
      const body = route.request().postData() ? route.request().postDataJSON() : null;
      if (path.endsWith('/config')) return route.fulfill({ json: config });
      if (path.endsWith('/sessions')) {
        sessionCalls++;
        return route.fulfill({
          json: {
            capability: 'abc.def',
            sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
        });
      }
      assert.equal(body.capability, 'abc.def');
      if (path.endsWith('/quote-proposals')) {
        proposalBody = body;
        return route.fulfill({
          json: {
            proposalId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            hash: 'b'.repeat(64),
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            currency: 'EUR',
            exponent: 2,
            customizedQuantity: 3,
            totalMinor: '9100',
            groups: [
              {
                productId: '111',
                quantity: 3,
                setupMinor: '100',
                customizationUnitMinor: '1000',
                baseTotalMinor: '6000',
                totalMinor: '9100',
              },
            ],
            changedGroups: [],
          },
        });
      }
      if (path.endsWith('/accept')) {
        acceptedBody = body;
        return route.fulfill({
          json: {
            quoteId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            setId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            validThroughDay: 22000,
            applicationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            buckets: [
              { variantId: '222', quantity: 3, properties: { _insignia_quote_v2: 'q', _insignia_member_v2: 'm' } },
            ],
            desired: proposalBody.groups,
          },
        });
      }
      return route.fulfill({ json: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', status: 'APPLIED' } });
    });
    await page.evaluate(() => {
      const host = document.createElement('insignia-buyer');
      host.setAttribute('product-id', '111');
      host.setAttribute('country', 'NL');
      host.setAttribute('market-id', '1');
      document.body.append(host);
    });
    const host = page.locator('insignia-buyer');
    await host.getByRole('button', { name: 'Customize this product' }).click();
    await host.getByRole('button', { name: 'Provide logo later' }).click();
    await host.getByRole('button', { name: 'Continue to Placement' }).click();
    await host.getByRole('checkbox', { name: 'Front', exact: true }).check();
    await host.getByRole('button', { name: 'Continue to Preview', exact: true }).click();
    await host.getByText('This placement has one configured size. No size adjustment is needed.').waitFor();
    assert.deepEqual(await host.locator('.wizard li').allTextContents(), ['Upload', 'Placement', 'Preview', 'Review']);
    assert.equal(await host.locator('.wizard [aria-current=step]').textContent(), 'Preview');
    await host.getByRole('button', { name: 'Continue to Review' }).click();
    await host.getByRole('spinbutton').fill('3');
    await host.getByRole('button', { name: 'Review complete customized cart' }).click();
    await host.getByText('EUR 91.00', { exact: true }).first().waitFor();
    assert.equal(await host.getByRole('columnheader', { name: 'Setup once' }).count(), 0);
    assert.equal(proposalBody.groups[0].variants[0].quantity, 3);
    assert.equal(proposalBody.capacity.ordinaryLineCount, 1);
    await host.getByRole('button', { name: 'Add to Cart — EUR 91.00' }).click();
    await adding;
    await host.locator('.artwork-upload').evaluate((el) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'logo.svg', { type: 'image/svg+xml' }),
      );
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    });
    await page.waitForTimeout(50);
    assert.equal(artworkCalls, 0, 'disabled commerce fieldset must not start an artwork upload');
    assert.equal(await host.getByRole('button', { name: 'Add to Cart — EUR 91.00' }).isDisabled(), true);
    releaseCartAdd();
    await host.getByText('Customized cart updated.').waitFor();
    assert.equal(items[0].key, 'ordinary');
    assert.deepEqual(items[0].properties, { gift: true });
    assert.equal(items[1].quantity, 3);
    assert.ok(acceptedBody.idempotencyKey);
    assert.equal(sessionCalls, 1);
    await page.keyboard.press('Escape');
    await host.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(
      await host
        .getByRole('button', { name: 'Customize this product' })
        .evaluate((el) => el === el.getRootNode().activeElement),
      true,
    );
  } finally {
    await browser?.close();
    await server.close();
  }
});

test('mobile wizard offers per-placement slider/cards, independent logo override and graceful no-preview review', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    const cfg = structuredClone(config);
    cfg.steps = [
      { id: 'small', label: 'Small' },
      { id: 'medium', label: 'Medium' },
      { id: 'large', label: 'Large' },
    ];
    cfg.placements[0].allowedStepIds = ['small', 'medium', 'large'];
    cfg.placements.push({
      id: 'back',
      label: 'Back',
      allowedMethodIds: ['print'],
      allowedStepIds: ['small', 'medium'],
      logoLaterAllowed: true,
    });
    cfg.geometry.steps = [
      { id: 'small', widthFraction: 0.3, heightFraction: 0.3 },
      { id: 'medium', widthFraction: 0.6, heightFraction: 0.6 },
      { id: 'large', widthFraction: 1, heightFraction: 1 },
    ];
    cfg.geometry.views.push({
      id: 'back',
      variantImages: [],
      placements: [{ id: 'back', rect: { centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 } }],
    });
    let proposed;
    await page.route('**/cart.js', (route) => route.fulfill({ json: { items: [], currency: 'EUR' } }));
    await page.route('**/apps/insignia/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/config')) return route.fulfill({ json: cfg });
      if (path.endsWith('/sessions'))
        return route.fulfill({
          json: {
            capability: 'abc.def',
            sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          },
        });
      proposed = route.request().postDataJSON();
      return route.fulfill({
        json: {
          proposalId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          hash: 'b'.repeat(64),
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          currency: 'EUR',
          exponent: 2,
          customizedQuantity: 1,
          totalMinor: '1000',
          groups: [
            {
              productId: '111',
              quantity: 1,
              setupMinor: '0',
              customizationUnitMinor: '0',
              baseTotalMinor: '1000',
              totalMinor: '1000',
            },
          ],
          changedGroups: [],
        },
      });
    });
    await page.evaluate(() => {
      const host = document.createElement('insignia-buyer');
      host.setAttribute('product-id', '111');
      host.setAttribute('trigger-label', 'Add your logo');
      host.setAttribute('country', 'NL');
      host.setAttribute('market-id', '42');
      document.body.append(host);
    });
    const host = page.locator('insignia-buyer');
    await host.getByRole('button', { name: 'Add your logo' }).tap();
    await host.getByRole('button', { name: 'Provide logo later' }).tap();
    await host.getByRole('button', { name: 'Continue to Placement' }).tap();
    await host.getByRole('checkbox', { name: 'Front', exact: true }).check();
    await host.getByRole('checkbox', { name: 'Back', exact: true }).check();
    await host.getByRole('button', { name: 'Continue to Size' }).tap();
    const slider = host.getByRole('slider', { name: 'Decoration size' });
    await slider.focus();
    await slider.press('ArrowRight');
    assert.equal(await slider.getAttribute('aria-valuetext'), 'Medium');
    await host.getByRole('button', { name: 'Back — done', exact: true }).tap();
    assert.equal(await host.getByRole('slider').count(), 0);
    await host.getByRole('radio', { name: 'Medium', exact: true }).check();
    await host.getByRole('button', { name: 'Change logo for this placement' }).tap();
    await host.getByRole('button', { name: 'Logo later for this placement' }).tap();
    await host.getByRole('button', { name: 'Continue to Review' }).tap();
    await host.getByRole('spinbutton').fill('1');
    await host.getByRole('button', { name: 'Review complete customized cart' }).tap();
    await host.getByText('Complete customized cart review', { exact: true }).waitFor();
    const placements = proposed.groups[0].design.placements;
    assert.equal(placements.length, 2);
    assert.deepEqual(
      placements.map((p) => p.stepId),
      ['medium', 'medium'],
    );
    assert.notEqual(placements[0].artwork.intentId, placements[1].artwork.intentId);
    assert.equal(await host.getByRole('group', { name: 'Product views' }).count(), 0);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test('usable views expose the shared canvas and missing view geometry keeps size choices usable', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    const cfg = structuredClone(config);
    cfg.geometry.views[0].image = { revisionId: 'front-image', width: 100, height: 100 };
    cfg.geometry.views.push({
      id: 'back',
      image: { revisionId: 'back-image', width: 100, height: 100 },
      variantImages: [],
      placements: [],
    });
    cfg.imageUrls = {
      'front-image': 'https://preview.example/front.png',
      'back-image': 'https://preview.example/back.png',
    };
    cfg.steps.push({ id: 'large', label: 'Large' });
    cfg.placements[0].allowedStepIds.push('large');
    cfg.geometry.steps.push({ id: 'large', widthFraction: 1, heightFraction: 1 });
    await page.route('https://preview.example/**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    );
    await page.route('**/cart.js', (route) => route.fulfill({ json: { items: [], currency: 'EUR' } }));
    await page.route('**/apps/insignia/v1/config*', (route) => route.fulfill({ json: cfg }));
    await page.evaluate(() => {
      const host = document.createElement('insignia-buyer');
      host.setAttribute('product-id', '111');
      document.body.append(host);
    });
    const host = page.locator('insignia-buyer');
    await host.getByRole('button', { name: 'Customize this product' }).click();
    await host.getByRole('button', { name: 'Provide logo later' }).click();
    await host.getByRole('button', { name: 'Continue to Placement' }).click();
    await host.getByRole('checkbox', { name: 'Front', exact: true }).check();
    await host.getByRole('button', { name: 'Continue to Size' }).click();
    await host.locator('canvas').first().waitFor();
    await host.getByRole('button', { name: 'back', exact: true }).click();
    await host
      .getByText('Preview unavailable for this placement/view. Your size selections remain available.')
      .waitFor();
    assert.equal(await host.getByRole('radio', { name: 'Large', exact: true }).isEnabled(), true);
    await host.getByRole('radio', { name: 'Large', exact: true }).check();
    await host.getByRole('button', { name: 'front', exact: true }).click();
    await host.locator('canvas').first().waitFor();
    await host.getByRole('button', { name: 'Continue to Review' }).click();
    assert.equal(await host.getByRole('spinbutton').isVisible(), true);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test('one canvas view displays both selected logo-later placements simultaneously', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true, watch: null } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    const cfg = structuredClone(config);
    cfg.geometry.views[0].image = { revisionId: 'garment', width: 100, height: 100 };
    cfg.geometry.views[0].placements = [
      { id: 'front', rect: { centerX: 0.25, centerY: 0.5, width: 0.3, height: 0.3 } },
      { id: 'right', rect: { centerX: 0.75, centerY: 0.5, width: 0.3, height: 0.3 } },
    ];
    cfg.placements.push({ ...cfg.placements[0], id: 'right', label: 'Right' });
    cfg.imageUrls = { garment: 'https://preview.example/garment.png' };
    await page.route('https://preview.example/**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    );
    await page.route('**/cart.js', (route) => route.fulfill({ json: { items: [], currency: 'EUR' } }));
    await page.route('**/apps/insignia/v1/config*', (route) => route.fulfill({ json: cfg }));
    await page.evaluate(() => {
      const host = document.createElement('insignia-buyer');
      host.setAttribute('product-id', '111');
      document.body.append(host);
    });
    const host = page.locator('insignia-buyer');
    await host.getByRole('button', { name: 'Customize this product' }).click();
    await host.getByRole('button', { name: 'Provide logo later' }).click();
    await host.getByRole('button', { name: 'Continue to Placement' }).click();
    await host.getByRole('checkbox', { name: 'Front', exact: true }).check();
    await host.getByRole('checkbox', { name: 'Right', exact: true }).check();
    await host.getByRole('button', { name: 'Continue to Preview' }).click();
    await host.locator('canvas').first().waitFor();
    assert.deepEqual(await host.locator('.wizard li').allTextContents(), ['Upload', 'Placement', 'Preview', 'Review']);
    assert.equal(await host.locator('.wizard [aria-current=step]').textContent(), 'Preview');
    await host.locator('.method-setting-single').getByText('Print', { exact: true }).waitFor();
    assert.equal(await host.getByRole('button', { name: 'Change logo for this placement' }).isVisible(), true);
    await page.waitForFunction(
      () => {
        const host = document.querySelector('insignia-buyer');
        const canvases = [...host.shadowRoot.querySelectorAll('canvas')];
        return canvases.some((canvas) => {
          const ctx = canvas.getContext('2d');
          const w = canvas.width,
            h = canvas.height;
          if (!ctx || !w || !h) return false;
          let pixels;
          try {
            pixels = ctx.getImageData(0, 0, w, h).data;
          } catch {
            return false;
          }
          return [0.25, 0.75].every((position) => {
            const center = (w - h) / 2 + h * position;
            let count = 0;
            for (let y = Math.floor(h * 0.45); y < h * 0.55; y++)
              for (let x = Math.floor(center - h * 0.05); x < center + h * 0.05; x++) {
                const i = (y * w + x) * 4;
                if (pixels[i] === 212 && pixels[i + 1] === 215 && pixels[i + 2] === 220 && pixels[i + 3] === 255)
                  count++;
              }
            return count > 100;
          });
        });
      },
      undefined,
      { timeout: 5000 },
    );
    await host.getByRole('button', { name: 'Continue to Review', exact: true }).click();
    assert.equal(await host.locator('.wizard [aria-current=step]').textContent(), 'Review');
    await host.getByRole('button', { name: '← Back', exact: true }).click();
    assert.equal(await host.locator('.wizard [aria-current=step]').textContent(), 'Preview');
    assert.equal(await host.getByRole('button', { name: 'Change logo for this placement' }).isVisible(), true);
  } finally {
    await browser?.close();
    await server.close();
  }
});

async function withRenewalBuyer(run, { multipleProducts = false } = {}) {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    const group = {
      productId: '111',
      configRevisionId: 'historical',
      revisionContentHash: 'c'.repeat(64),
      design: {
        placements: [
          {
            placementId: 'front',
            methodId: 'print',
            stepId: 'small',
            artwork: { kind: 'deferred', intentId: 'intent' },
          },
        ],
        options: [],
      },
      variants: [{ variantId: '222', quantity: 3 }],
    };
    let items = [
      {
        key: 'custom',
        variant_id: 222,
        quantity: 3,
        properties: { _insignia_quote_v2: 'q', _insignia_member_v2: 'm' },
      },
    ];
    const renewals = [];
    const proposals = [];
    let mutations = 0;
    let renewalFailure = false;
    const configurations = new Map([['111', structuredClone(config)]]);
    const groups = [group];
    if (multipleProducts) {
      groups.push({ ...structuredClone(group), productId: '333', variants: [{ variantId: '444', quantity: 2 }] });
      configurations.set('333', {
        ...structuredClone(config),
        productId: '333',
        revisionId: 'r-other',
        contentHash: 'd'.repeat(64),
        variants: [{ id: '444', label: 'Other', available: true }],
      });
    }
    const attributes = {};
    await page.route('**/cart*.js', (route) => route.fulfill({ json: { items, attributes, currency: 'EUR' } }));
    await page.route('**/cart/update.js', (route) => {
      mutations++;
      const body = route.request().postDataJSON();
      if (body.updates) items = items.filter((i) => body.updates[i.key] !== 0);
      Object.assign(attributes, body.attributes ?? {});
      return route.fulfill({ json: { items, attributes, currency: 'EUR' } });
    });
    await page.route('**/cart/add.js', (route) => {
      mutations++;
      items = route
        .request()
        .postDataJSON()
        .items.map((i, index) => ({
          key: `renewed${mutations}-${index}`,
          variant_id: i.id,
          quantity: i.quantity,
          properties: i.properties,
        }));
      return route.fulfill({ json: { items } });
    });
    await page.route('**/apps/insignia/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/config'))
        return route.fulfill({
          json: configurations.get(new URL(route.request().url()).searchParams.get('productId')),
        });
      if (path.endsWith('/sessions'))
        return route.fulfill({
          json: {
            capability: 'abc.def',
            sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
        });
      const body = route.request().postDataJSON();
      if (path.endsWith('/cart-state'))
        return route.fulfill({
          json: { groups, quoteId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', repairRequired: false },
        });
      if (path.endsWith('/renew')) {
        renewals.push(body);
        if (renewalFailure) return route.fulfill({ status: 503 });
        return route.fulfill({
          json: {
            quoteId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            setId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            validThroughDay: 22000,
            applicationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            buckets: [
              {
                variantId: '222',
                quantity: 3,
                properties: { _insignia_quote_v2: 'q', _insignia_member_v2: `renewed-${renewals.length}` },
              },
            ],
            desired: body.groups,
          },
        });
      }
      if (path.endsWith('/quote-proposals')) {
        proposals.push(body);
        return route.fulfill({
          json: {
            proposalId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            hash: 'b'.repeat(64),
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            currency: 'EUR',
            exponent: 2,
            customizedQuantity: 3,
            totalMinor: '9100',
            groups: [
              {
                productId: '111',
                quantity: 3,
                setupMinor: '100',
                customizationUnitMinor: '1000',
                baseTotalMinor: '6000',
                totalMinor: '9100',
              },
            ],
            changedGroups: [],
          },
        });
      }
      return route.fulfill({ json: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', status: 'APPLIED' } });
    });
    await page.evaluate(() => {
      const host = document.createElement('insignia-buyer');
      host.setAttribute('product-id', '111');
      host.setAttribute('country', 'NL');
      document.body.append(host);
    });
    const host = page.locator('insignia-buyer');
    await host.getByRole('button', { name: 'Customize this product' }).click();
    await host.getByRole('button', { name: 'Renew accepted cart offer' }).waitFor();
    await run({
      page,
      host,
      renewals,
      proposals,
      group,
      editCart: () => {
        items[0].quantity = 5;
      },
      mutations: () => mutations,
      failRenewal: (value) => {
        renewalFailure = value;
      },
      configure: (value) => {
        configurations.set(value.productId, value);
      },
    });
  } finally {
    await browser?.close();
    await server.close();
  }
}

test('renewal rejects an external quantity edit while mounted without issuing or overwriting cart', async () => {
  await withRenewalBuyer(async ({ host, renewals, editCart, mutations }) => {
    editCart();
    await host.getByRole('button', { name: 'Renew accepted cart offer' }).click();
    await host
      .getByText('Cart changed. Reopen customization and review the complete current cart before renewing.')
      .first()
      .waitFor();
    assert.equal(renewals.length, 0);
    assert.equal(mutations(), 0);
  });
});

test('acknowledged renewals rotate command keys while uncertain API retry preserves its key', async () => {
  await withRenewalBuyer(async ({ host, renewals, failRenewal }) => {
    const renew = host.getByRole('button', { name: 'Renew accepted cart offer' });
    failRenewal(true);
    await renew.click();
    await host.getByText('Customization request unavailable').first().waitFor();
    failRenewal(false);
    await renew.click();
    await host.getByText('Customized cart updated.').waitFor();
    assert.equal(renewals[0].idempotencyKey, renewals[1].idempotencyKey);
    await renew.click();
    await host.getByText('Customized cart updated.').waitFor();
    assert.equal(renewals.length, 3);
    assert.notEqual(renewals[1].idempotencyKey, renewals[2].idempotencyKey);
  });
});

test('explicit full-cart review rebases compatible historical designs to each product current revision', async () => {
  await withRenewalBuyer(
    async ({ host, proposals, group }) => {
      await host.getByRole('combobox', { name: 'Edit retained design' }).selectOption('0');
      await host.getByRole('button', { name: 'Review complete customized cart' }).click();
      await host.getByText('EUR 91.00', { exact: true }).first().waitFor();
      assert.equal(await host.getByRole('columnheader', { name: 'Setup once' }).count(), 0);
      assert.deepEqual(
        proposals[0].groups.map((value) => [value.productId, value.configRevisionId, value.revisionContentHash]),
        [
          ['111', 'r1', 'a'.repeat(64)],
          ['333', 'r-other', 'd'.repeat(64)],
        ],
      );
      assert.deepEqual(proposals[0].groups[0].design, group.design);
      assert.equal(group.configRevisionId, 'historical');
    },
    { multipleProducts: true },
  );
});

test('incompatible republish needs explicit design repair and cannot silently drop logo-later', async () => {
  await withRenewalBuyer(async ({ host, proposals, configure, group }) => {
    const cfg = structuredClone(config);
    cfg.placements[0].logoLaterAllowed = false;
    configure(cfg);
    await host.getByRole('combobox', { name: 'Edit retained design' }).selectOption('0');
    await host.getByRole('button', { name: 'Review complete customized cart' }).click();
    await host
      .getByText('Product configuration changed. Repair incompatible design choices before reviewing current prices.')
      .first()
      .waitFor();
    assert.equal(proposals.length, 0);
    assert.equal(group.design.placements[0].artwork.kind, 'deferred');
  });
});

test('desktop and mobile customizer keeps the preview and navigation usable and confirms discarding a design', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/cart.js', (route) => route.fulfill({ json: { items: [], currency: 'USD' } }));
    await page.route('**/apps/insignia/v1/**', (route) => route.fulfill({ json: config }));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.evaluate(() => {
      const host = document.createElement('insignia-buyer');
      host.setAttribute('product-id', '111');
      document.body.append(host);
    });
    const host = page.locator('insignia-buyer');
    await host.getByRole('button', { name: 'Customize this product' }).click();
    await host.getByRole('button', { name: 'Provide logo later' }).waitFor();
    const dialog = await host.getByRole('dialog').boundingBox();
    assert.equal(dialog.width, 1440);
    assert.equal(dialog.height, 900);
    const preview = await host.getByRole('complementary', { name: 'Product preview' }).boundingBox();
    assert.equal(Math.round(preview.width), 864);
    await host.getByRole('button', { name: 'Provide logo later' }).click();
    await host.getByRole('button', { name: 'Close customization' }).click();
    await host.getByRole('alertdialog', { name: 'Discard customization?' }).waitFor();
    await page.keyboard.press('Shift+Tab');
    assert.equal(
      await host
        .getByRole('button', { name: 'Discard design' })
        .evaluate((el) => el === el.getRootNode().activeElement),
      true,
    );
    await page.keyboard.press('Tab');
    assert.equal(
      await host.getByRole('button', { name: 'Keep editing' }).evaluate((el) => el === el.getRootNode().activeElement),
      true,
    );
    await host.getByRole('button', { name: 'Keep editing' }).click();
    assert.equal(await host.getByRole('button', { name: 'Provide logo later' }).getAttribute('aria-pressed'), 'true');
    await host.getByRole('button', { name: 'Continue to Placement' }).click();
    await host.getByRole('checkbox', { name: 'Front', exact: true }).check();
    await host.getByRole('button', { name: 'Continue to Preview', exact: true }).click();
    await host.getByRole('button', { name: 'Continue to Review' }).click();
    await host.getByRole('button', { name: 'Increase Blue / M quantity' }).click();
    assert.equal(await host.getByRole('spinbutton').inputValue(), '1');
    await host.getByRole('button', { name: 'Decrease Blue / M quantity' }).click();
    assert.equal(await host.getByRole('spinbutton').inputValue(), '0');
    await page.setViewportSize({ width: 390, height: 844 });
    const footer = await host.getByRole('contentinfo', { name: 'Customization navigation' }).boundingBox();
    assert.equal(Math.round(footer.y + footer.height), 844);
    assert.equal(await host.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth), true);
    await page.keyboard.press('Escape');
    await host.getByRole('alertdialog').waitFor();
    await host.getByRole('button', { name: 'Discard design' }).click();
    await host.getByRole('dialog').waitFor({ state: 'detached' });
  } finally {
    await browser?.close();
    await server.close();
  }
});

test('four-step mobile flow previews the current design in a dismissible sheet and swipes real product views', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const cfg = structuredClone(config);
    cfg.geometry.views[0].image = { revisionId: 'image', width: 100, height: 100 };
    cfg.geometry.views.push({ ...structuredClone(cfg.geometry.views[0]), id: 'back' });
    cfg.imageUrls = { image: 'https://preview.example/fixture.png' };
    await page.route('https://preview.example/**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    );
    await page.route('**/cart.js', (route) => route.fulfill({ json: { items: [], currency: 'USD' } }));
    let privateRequests = 0;
    await page.route('**/apps/insignia/v1/**', (route) => {
      if (route.request().method() !== 'GET') privateRequests++;
      return route.fulfill({ json: cfg });
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.evaluate(() => {
      const host = document.createElement('insignia-buyer');
      host.setAttribute('product-id', '111');
      document.body.append(host);
    });
    const host = page.locator('insignia-buyer');
    await host.getByRole('button', { name: 'Customize this product' }).click();
    await host.locator('.artwork-upload').evaluate((el) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['unsupported'], 'notes.txt', { type: 'text/plain' }));
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    });
    await host.getByText('Choose an SVG, PNG or JPEG up to 5 MiB.', { exact: true }).waitFor();
    assert.equal(privateRequests, 0);
    await host.getByRole('button', { name: 'Provide logo later' }).click();
    await host.getByRole('button', { name: 'Continue to Placement' }).click();
    await host.getByRole('checkbox', { name: 'Front', exact: true }).check();
    await host.getByRole('button', { name: 'Continue to Preview', exact: true }).click();
    assert.deepEqual(await host.locator('.wizard li').allTextContents(), ['Upload', 'Placement', 'Preview', 'Review']);
    await host.getByRole('button', { name: 'Continue to Review' }).click();
    await host.getByRole('button', { name: 'Preview your design', exact: true }).click();
    const sheet = host.getByRole('dialog', { name: 'Product preview', exact: true });
    await sheet.waitFor();
    const preview = sheet.locator('.preview');
    await preview.evaluate((el) =>
      el.dispatchEvent(
        new TouchEvent('touchstart', {
          bubbles: true,
          touches: [new Touch({ identifier: 1, target: el, clientX: 300, clientY: 100 })],
        }),
      ),
    );
    await preview.evaluate((el) =>
      el.dispatchEvent(
        new TouchEvent('touchend', {
          bubbles: true,
          changedTouches: [new Touch({ identifier: 1, target: el, clientX: 120, clientY: 110 })],
        }),
      ),
    );
    assert.equal(await sheet.getByRole('button', { name: 'back', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'hidden' });
    assert.equal(await host.getByRole('spinbutton').isVisible(), true);
    await host.getByRole('button', { name: 'Preview your design', exact: true }).click();
    await sheet.getByRole('button', { name: 'Close preview', exact: true }).click();
    assert.equal(
      await host
        .getByRole('button', { name: 'Preview your design' })
        .evaluate((el) => el === el.getRootNode().activeElement),
      true,
    );
  } finally {
    await browser?.close();
    await server.close();
  }
});
