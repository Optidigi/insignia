import { BuyerAcceptanceSchema, BuyerDesiredGroupSchema, BuyerProposalRequestSchema } from '@insignia/contracts';
import type { FrameLocator, Locator, Page } from 'playwright';
import type { BuyerConfig, DesiredGroup } from '../src/buyer.ts';

type ProposalRequest = ReturnType<typeof BuyerProposalRequestSchema.parse>;
type AcceptanceRequest = ReturnType<typeof BuyerAcceptanceSchema.parse>;

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import {
  type AjaxItem,
  ajaxBody,
  createStorefrontTestServer as createServer,
  record,
  required,
  selectedFrameAssets,
  serverPort,
} from './support.mts';

const config: BuyerConfig = {
  version: 'm7-config-v1',
  productId: '111',
  title: 'Synthetic shirt',
  shopCurrency: 'EUR',
  decorationPrices: [{ placementId: 'front', methodId: 'print', stepId: 'small', minor: '1000' }],
  revisionId: 'r1',
  contentHash: 'a'.repeat(64),
  methods: [{ id: 'print', label: 'Print' }],
  placements: [
    { id: 'front', label: 'Front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true },
  ],
  steps: [{ id: 'small', label: 'Small' }],
  options: [],
  variants: [
    {
      id: '222',
      label: 'Blue / M',
      available: true,
      selectedOptions: [
        { name: 'Color', value: 'Blue' },
        { name: 'Size', value: 'M' },
      ],
      baseUnitMinor: '2000',
    },
  ],
  geometry: {
    version: 'm5-geometry-v1',
    views: [
      {
        id: 'front',
        image: { revisionId: 'photo', width: 1000, height: 1000 },
        variantImages: [],
        placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 } }],
      },
    ],
    steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5, physicalMm: { width: 50, height: 50 } }],
  },
  imageUrls: { photo: 'https://preview.example/fixture.png' },
  ready: true,
};
async function prepareSelectedPage(page: Page, origin: string) {
  page.setDefaultTimeout(7000);
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'),
  );
  await page.route('https://preview.example/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
        'base64',
      ),
    }),
  );
}
async function installDesignBoundary(page: Page) {
  const drafts = new Map<string, { id: string; version: number; value: DesiredGroup }>();
  await page.route('**/apps/insignia/v1/designs/**', (route) => {
    const url = new URL(route.request().url());
    const match = /\/designs\/([a-f0-9-]+)(\/restore)?$/.exec(url.pathname);
    assert.ok(match);
    const id = required(match[1]);
    const body = record(route.request().postDataJSON());
    assert.equal(body.capability, 'abc.def');
    const previous = drafts.get(id);
    if (match[2])
      return previous
        ? route.fulfill({
            json: {
              ...previous,
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
              compatibility: 'current',
              retained: null,
            },
          })
        : route.fulfill({ status: 404, json: { error: 'Owned draft not found' } });
    if (body.expectedVersion !== (previous?.version ?? 0))
      return route.fulfill({ status: 409, json: { error: 'Draft changed' } });
    const value = BuyerDesiredGroupSchema.parse(body.group);
    const draft = { id, version: (previous?.version ?? 0) + 1, value };
    drafts.set(id, draft);
    return route.fulfill({ json: draft });
  });
}
function positionCard(ui: FrameLocator, label: string) {
  return ui.locator('article.print-card').filter({ has: ui.locator('.print-card-heading').filter({ hasText: label }) });
}
async function addDeferred(ui: FrameLocator, label?: string, remaining = 1) {
  await ui.getByRole('button', { name: 'Add artwork', exact: true }).first().click();
  if (remaining > 1) {
    assert.ok(label);
    await ui
      .getByRole('dialog', { name: 'Choose position', exact: true })
      .getByRole('button', { name: new RegExp(`^${label}`) })
      .click();
  }
  const card = label ? positionCard(ui, label) : ui.locator('article.print-card').first();
  const heading = card.locator('.print-card-heading');
  if ((await heading.getAttribute('aria-expanded')) === 'false') await heading.click();
  await card.locator('.artwork-choice').click();
  await ui.getByRole('button', { name: 'Provide artwork later', exact: true }).click();
}
test('buyer reviews full retained cart, accepts exact price and keeps ordinary lines; dialog returns focus', async () => {
  const server = await createServer({
    plugins: [selectedFrameAssets()],
    server: { host: '127.0.0.1', port: 0, strictPort: true },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await prepareSelectedPage(page, `http://127.0.0.1:${serverPort(server.httpServer)}`);
    await page.goto(`http://127.0.0.1:${serverPort(server.httpServer)}`);
    let items: AjaxItem[] = [{ key: 'ordinary', variant_id: 999, quantity: 2, properties: { gift: true } }];
    let proposalBody: ProposalRequest | undefined;
    let acceptedBody: AcceptanceRequest | undefined;
    let sessionCalls = 0;
    let artworkCalls = 0;
    await page.route('**/apps/insignia/guest**', (route) => {
      artworkCalls++;
      return route.fulfill({ status: 400, json: { error: 'must not allocate during commerce' } });
    });
    let releaseCartAdd: () => void = () => {
      throw new Error('Missing add gate');
    };
    const cartAddGate = new Promise<void>((resolve) => {
      releaseCartAdd = resolve;
    });
    let cartAddStarted: () => void = () => {
      throw new Error('Missing start gate');
    };
    const adding = new Promise<void>((resolve) => {
      cartAddStarted = resolve;
    });
    const attributes = {};
    await page.route('**/cart*.js', (route) => route.fulfill({ json: { items, attributes, currency: 'EUR' } }));
    await page.route('**/cart/update.js', (route) => {
      const body = ajaxBody(route.request().postDataJSON());
      if (body.updates) items = items.filter((item) => body.updates?.[item.key] !== 0);
      Object.assign(attributes, body.attributes ?? {});
      return route.fulfill({ json: { items, attributes, currency: 'EUR' } });
    });
    await page.route('**/cart/add.js', async (route) => {
      const body = ajaxBody(route.request().postDataJSON());
      items = [
        ...items,
        ...required(body.items).map((i, index) => ({
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
      const body = record(route.request().postData() ? route.request().postDataJSON() : {});
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
        proposalBody = BuyerProposalRequestSchema.parse(body);
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
        acceptedBody = BuyerAcceptanceSchema.parse(body);
        return route.fulfill({
          json: {
            quoteId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            setId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            validThroughDay: 22000,
            applicationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            buckets: [
              { variantId: '222', quantity: 3, properties: { _insignia_quote_v2: 'q', _insignia_member_v2: 'm' } },
            ],
            desired: required(proposalBody).groups,
          },
        });
      }
      return route.fulfill({ json: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', status: 'APPLIED' } });
    });
    await installDesignBoundary(page);
    await page.evaluate(() => {
      const host = document.createElement('insignia-buyer');
      host.setAttribute('product-id', '111');
      host.setAttribute('country', 'NL');
      host.setAttribute('market-id', '1');
      host.setAttribute('market-id', '1');
      document.body.append(host);
    });
    const trigger = page.locator('insignia-buyer');
    await trigger.getByRole('button', { name: 'Customize this product' }).click();
    const ui = page.frameLocator('iframe');
    await ui.locator('.app').waitFor();
    await addDeferred(ui);
    await ui.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    await ui.locator('input[type=number]:enabled').first().fill('3');
    await ui.getByRole('button', { name: 'Review', exact: true }).last().click();
    await ui.getByText('€91.00', { exact: true }).filter({ visible: true }).first().waitFor();
    assert.equal(await ui.getByRole('columnheader', { name: 'Setup once' }).count(), 0);
    assert.equal(required(required(required(proposalBody).groups[0]).variants[0]).quantity, 3);
    assert.equal(required(proposalBody).capacity.ordinaryLineCount, 1);
    await ui.getByRole('button', { name: 'Add to cart', exact: true }).click();
    await adding;
    assert.equal(await ui.locator('.cart-button').isDisabled(), true);
    assert.equal(await ui.locator('.cart-button').getAttribute('aria-busy'), 'true');
    assert.equal(await ui.locator('.panel-content').evaluate((element: HTMLElement) => element.inert), true);
    await ui.locator('.app').evaluate((el) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }));
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
    });
    assert.equal(artworkCalls, 0, 'No artwork allocation can start during the exact cart commit');
    releaseCartAdd();
    await page.waitForFunction(() => document.querySelector('iframe')?.hidden === true);
    assert.equal(required(items[0]).key, 'ordinary');
    assert.deepEqual(required(items[0]).properties, { gift: true });
    assert.equal(required(items[1]).quantity, 3);
    assert.ok(required(acceptedBody).idempotencyKey);
    assert.equal(sessionCalls, 1);
    assert.equal(
      await trigger.getByRole('button', { name: 'Customize this product' }).evaluate((el) => {
        const root = el.getRootNode();
        return (root instanceof ShadowRoot || root instanceof Document) && el === root.activeElement;
      }),
      true,
    );
  } finally {
    await browser?.close();
    await server.close();
  }
});

test('selected mobile positions keep independent logo-later choices and exact physical size bindings', async () => {
  const server = await createServer({
    plugins: [selectedFrameAssets()],
    server: { host: '127.0.0.1', port: 0, strictPort: true },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await prepareSelectedPage(page, `http://127.0.0.1:${serverPort(server.httpServer)}`);
    await page.goto(`http://127.0.0.1:${serverPort(server.httpServer)}`);
    const cfg = structuredClone(config);
    cfg.steps = [
      { id: 'small', label: 'Small' },
      { id: 'medium', label: 'Medium' },
      { id: 'large', label: 'Large' },
    ];
    required(cfg.placements[0]).allowedStepIds = ['small', 'medium', 'large'];
    cfg.placements.push({
      id: 'back',
      label: 'Back',
      allowedMethodIds: ['print'],
      allowedStepIds: ['small', 'medium'],
      logoLaterAllowed: true,
    });
    cfg.geometry.steps = [
      { id: 'small', widthFraction: 0.3, heightFraction: 0.3, physicalMm: { width: 30, height: 30 } },
      { id: 'medium', widthFraction: 0.6, heightFraction: 0.6, physicalMm: { width: 60, height: 60 } },
      { id: 'large', widthFraction: 1, heightFraction: 1, physicalMm: { width: 100, height: 100 } },
    ];
    cfg.geometry.views.push({
      id: 'back',
      image: { revisionId: 'back-photo', width: 1000, height: 1000 },
      variantImages: [],
      placements: [{ id: 'back', rect: { centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 } }],
    });
    cfg.imageUrls['back-photo'] = 'https://preview.example/fixture.png';
    required(cfg.variants[0]).baseUnitMinor = '1000';
    // These are intentionally explicit free cells, matching the fixture's authoritative zero-customization quote.
    cfg.decorationPrices = [
      ...['small', 'medium', 'large'].map((stepId) => ({
        placementId: 'front',
        methodId: 'print',
        stepId,
        minor: '0',
      })),
      ...['small', 'medium'].map((stepId) => ({ placementId: 'back', methodId: 'print', stepId, minor: '0' })),
    ];
    let proposed: ProposalRequest | undefined;
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
      proposed = BuyerProposalRequestSchema.parse(route.request().postDataJSON());
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
    await installDesignBoundary(page);
    await page.evaluate(() => {
      const host = document.createElement('insignia-buyer');
      host.setAttribute('product-id', '111');
      host.setAttribute('trigger-label', 'Add your logo');
      host.setAttribute('country', 'NL');
      host.setAttribute('market-id', '42');
      document.body.append(host);
    });
    const trigger = page.locator('insignia-buyer');
    await trigger.getByRole('button', { name: 'Add your logo' }).tap();
    const host = page.frameLocator('iframe');
    await host.locator('.app').waitFor();
    await addDeferred(host, 'Front', 2);
    await positionCard(host, 'Front')
      .getByRole('button', { name: /^Medium/ })
      .click();
    await addDeferred(host, 'Back');
    await positionCard(host, 'Back')
      .getByRole('button', { name: /^Medium/ })
      .click();
    await positionCard(host, 'Back').locator('.artwork-choice').click();
    await host.getByRole('button', { name: 'Provide artwork later', exact: true }).click();
    await host.getByRole('button', { name: 'Choose quantities', exact: true }).tap();
    await host.locator('input[type=number]:enabled').first().fill('1');
    const proposalResponse = page.waitForResponse((response) => response.url().endsWith('/quote-proposals'));
    await host.getByRole('button', { name: 'Review', exact: true }).last().tap();
    await proposalResponse;
    await host.getByText('€10.00', { exact: true }).filter({ visible: true }).first().waitFor();
    const placements = required(required(proposed).groups[0]).design.placements;
    assert.equal(placements.length, 2);
    assert.deepEqual(
      placements.map((p) => p.stepId),
      ['medium', 'medium'],
    );
    const firstArtwork = required(placements[0]).artwork;
    const secondArtwork = required(placements[1]).artwork;
    assert.equal(firstArtwork.kind, 'deferred');
    assert.equal(secondArtwork.kind, 'deferred');
    if (firstArtwork.kind !== 'deferred' || secondArtwork.kind !== 'deferred')
      throw new Error('Expected deferred artwork');
    assert.notEqual(firstArtwork.intentId, secondArtwork.intentId);
    assert.equal(await host.getByRole('group', { name: 'Product views' }).count(), 0);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test('selected photo views retain size choices when another view has no placement geometry', async () => {
  const server = await createServer({
    plugins: [selectedFrameAssets()],
    server: { host: '127.0.0.1', port: 0, strictPort: true },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await prepareSelectedPage(page, `http://127.0.0.1:${serverPort(server.httpServer)}`);
    await page.goto(`http://127.0.0.1:${serverPort(server.httpServer)}`);
    const cfg = structuredClone(config);
    required(cfg.geometry.views[0]).image = { revisionId: 'front-image', width: 100, height: 100 };
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
    required(cfg.placements[0]).allowedStepIds.push('large');
    cfg.geometry.steps.push({
      id: 'large',
      widthFraction: 1,
      heightFraction: 1,
      physicalMm: { width: 100, height: 100 },
    });
    required(cfg.decorationPrices).push({ placementId: 'front', methodId: 'print', stepId: 'large', minor: '2000' });
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
    await installDesignBoundary(page);
    await page.evaluate(() => {
      const host = document.createElement('insignia-buyer');
      host.setAttribute('product-id', '111');
      document.body.append(host);
    });
    const trigger = page.locator('insignia-buyer');
    await trigger.getByRole('button', { name: 'Customize this product' }).click();
    const host = page.frameLocator('iframe');
    await host.locator('.app').waitFor();
    await addDeferred(host);
    await host.getByRole('button', { name: 'Edit Front artwork', exact: true }).waitFor();
    await host.getByRole('button', { name: 'back', exact: true }).click();
    assert.equal(await host.getByRole('button', { name: 'Edit Front artwork', exact: true }).count(), 0);
    await positionCard(host, 'Front')
      .getByRole('button', { name: /^Large/ })
      .click();
    assert.equal(
      await positionCard(host, 'Front')
        .getByRole('button', { name: /^Large/ })
        .getAttribute('aria-pressed'),
      'true',
    );
    await host.getByRole('button', { name: 'front', exact: true }).click();
    await host.getByRole('button', { name: 'Edit Front artwork', exact: true }).waitFor();
    await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    assert.equal(await host.locator('input[type=number]:enabled').first().isVisible(), true);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test('one selected photo view displays both independent logo-later placements and preserves them across steps', async () => {
  const server = await createServer({
    plugins: [selectedFrameAssets()],
    server: { host: '127.0.0.1', port: 0, strictPort: true, watch: null },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await prepareSelectedPage(page, `http://127.0.0.1:${serverPort(server.httpServer)}`);
    await page.goto(`http://127.0.0.1:${serverPort(server.httpServer)}`);
    const cfg = structuredClone(config);
    required(cfg.geometry.views[0]).image = { revisionId: 'garment', width: 100, height: 100 };
    required(cfg.geometry.views[0]).placements = [
      { id: 'front', rect: { centerX: 0.25, centerY: 0.5, width: 0.3, height: 0.3 } },
      { id: 'right', rect: { centerX: 0.75, centerY: 0.5, width: 0.3, height: 0.3 } },
    ];
    cfg.placements.push({ ...required(cfg.placements[0]), id: 'right', label: 'Right' });
    cfg.imageUrls = { garment: 'https://preview.example/garment.png' };
    required(cfg.decorationPrices).push({ placementId: 'right', methodId: 'print', stepId: 'small', minor: '1000' });
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
    await installDesignBoundary(page);
    await page.evaluate(() => {
      const host = document.createElement('insignia-buyer');
      host.setAttribute('product-id', '111');
      document.body.append(host);
    });
    const trigger = page.locator('insignia-buyer');
    await trigger.getByRole('button', { name: 'Customize this product' }).click();
    const host = page.frameLocator('iframe');
    await host.locator('.app').waitFor();
    await addDeferred(host, 'Front', 2);
    await addDeferred(host, 'Right');
    const overlays = host.locator('.print-overlay');
    assert.equal(await overlays.count(), 2);
    const centers = await overlays.evaluateAll((nodes) =>
      nodes
        .map((node) => {
          const box = node.getBoundingClientRect();
          const parent = node.parentElement;
          if (!parent) throw new Error('Preview surface missing');
          const bounds = parent.getBoundingClientRect();
          return (box.x + box.width / 2 - bounds.x) / bounds.width;
        })
        .sort((a, b) => a - b),
    );
    assert.ok(Math.abs(required(centers[0]) - 0.25) < 0.02);
    assert.ok(Math.abs(required(centers[1]) - 0.75) < 0.02);
    await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    await host.getByRole('button', { name: 'Previous step', exact: true }).click();
    assert.equal(await host.getByRole('button', { name: 'Edit Front artwork', exact: true }).isVisible(), true);
    assert.equal(await host.getByRole('button', { name: 'Edit Right artwork', exact: true }).isVisible(), true);
  } finally {
    await browser?.close();
    await server.close();
  }
});

type RetainedScenario = {
  page: Page;
  host: FrameLocator;
  trigger: Locator;
  proposals: ProposalRequest[];
  accepts: AcceptanceRequest[];
  proposalIds: string[];
  group: DesiredGroup;
  editCart(): void;
  mutations(): number;
  failAcceptance(value: boolean): void;
  configure(value: BuyerConfig): void;
};
async function withRetainedBuyer(
  run: (context: RetainedScenario) => Promise<void>,
  { multipleProducts = false, clock = false } = {},
) {
  const server = await createServer({
    plugins: [selectedFrameAssets()],
    server: { host: '127.0.0.1', port: 0, strictPort: true, watch: null },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    if (clock) await page.clock.install();
    await prepareSelectedPage(page, `http://127.0.0.1:${serverPort(server.httpServer)}`);
    await page.goto(`http://127.0.0.1:${serverPort(server.httpServer)}`);
    const group: DesiredGroup = {
      productId: '111',
      configRevisionId: 'historical',
      revisionContentHash: 'c'.repeat(64),
      design: {
        placements: [
          {
            placementId: 'front',
            methodId: 'print',
            stepId: 'small',
            artwork: { kind: 'deferred', intentId: 'original-intent' },
          },
        ],
        options: [],
      },
      variants: [{ variantId: '222', quantity: 3 }],
    };
    let groups = [structuredClone(group)];
    let items: AjaxItem[] = [
      {
        key: 'custom',
        variant_id: 222,
        product_id: 111,
        quantity: 3,
        properties: { _insignia_quote_v2: 'q', _insignia_member_v2: 'm' },
      },
      { key: 'ordinary-gift', variant_id: 999, quantity: 2, properties: { gift: true, note: 'Keep gift wrapping' } },
    ];
    const configurations = new Map<string, BuyerConfig>([['111', structuredClone(config)]]);
    if (multipleProducts) {
      groups.push({ ...structuredClone(group), productId: '333', variants: [{ variantId: '444', quantity: 2 }] });
      items.push({
        key: 'other-custom',
        variant_id: 444,
        product_id: 333,
        quantity: 2,
        properties: { _insignia_quote_v2: 'q', _insignia_member_v2: 'other-m' },
      });
      configurations.set('333', {
        ...structuredClone(config),
        productId: '333',
        title: 'Other synthetic shirt',
        revisionId: 'r-other',
        contentHash: 'd'.repeat(64),
        variants: [
          {
            id: '444',
            label: 'Other / M',
            available: true,
            selectedOptions: [
              { name: 'Color', value: 'Other' },
              { name: 'Size', value: 'M' },
            ],
            baseUnitMinor: '2000',
          },
        ],
      });
    }
    const proposals: ProposalRequest[] = [],
      accepts: AcceptanceRequest[] = [],
      proposalIds: string[] = [];
    const quotes = new Map<string, { hash: string; desired: DesiredGroup[] }>();
    const accepted = new Map<
      string,
      {
        hash: string;
        value: {
          quoteId: string;
          setId: string;
          validThroughDay: number;
          applicationId: string;
          buckets: { variantId: string; quantity: number; properties: Record<string, string> }[];
          desired: DesiredGroup[];
        };
      }
    >();
    let mutations = 0,
      failure = false;
    const attributes: Record<string, string> = {};
    await page.route('**/cart*.js', (route) => route.fulfill({ json: { items, attributes, currency: 'EUR' } }));
    await page.route('**/cart/update.js', (route) => {
      mutations++;
      const body = ajaxBody(route.request().postDataJSON());
      if (body.updates) items = items.filter((item) => body.updates?.[item.key] !== 0);
      Object.assign(attributes, body.attributes ?? {});
      return route.fulfill({ json: { items, attributes, currency: 'EUR' } });
    });
    await page.route('**/cart/add.js', (route) => {
      mutations++;
      items = [
        ...items,
        ...required(ajaxBody(route.request().postDataJSON()).items).map((item, index) => ({
          key: `applied-${mutations}-${index}`,
          variant_id: item.id,
          quantity: item.quantity,
          properties: item.properties,
        })),
      ];
      return route.fulfill({ json: { items } });
    });
    await page.route('**/apps/insignia/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/config'))
        return route.fulfill({
          json: configurations.get(required(new URL(route.request().url()).searchParams.get('productId'))),
        });
      if (path.endsWith('/sessions'))
        return route.fulfill({
          json: {
            capability: 'abc.def',
            sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
        });
      const body = record(route.request().postDataJSON());
      assert.equal(body.capability, 'abc.def');
      if (path.endsWith('/cart-state')) {
        const expected = groups.flatMap((group) => group.variants);
        if (
          items.some(
            (item) =>
              item.properties._insignia_quote_v2 &&
              expected
                .filter((value) => value.variantId === String(item.variant_id))
                .reduce((sum, value) => sum + value.quantity, 0) !== item.quantity,
          )
        )
          return route.fulfill({ status: 409, json: { error: 'Cart quantity changed' } });
        return route.fulfill({
          json: { groups, quoteId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', repairRequired: false },
        });
      }
      if (path.endsWith('/quote-proposals')) {
        const request = BuyerProposalRequestSchema.parse(body);
        proposals.push(request);
        const number = proposals.length;
        const proposalId = `bbbbbbbb-bbbb-4bbb-8bbb-${String(number).padStart(12, '0')}`;
        const hash = String(number).padStart(64, '0');
        proposalIds.push(proposalId);
        quotes.set(proposalId, { hash, desired: request.groups });
        const rows = request.groups.map((selection, index) => {
          const cfg = required(configurations.get(selection.productId));
          let base = 0n;
          let quantity = 0;
          for (const variant of selection.variants) {
            const retained = required(cfg.variants.find((value) => value.id === variant.variantId));
            base += BigInt(required(retained.baseUnitMinor)) * BigInt(variant.quantity);
            quantity += variant.quantity;
          }
          let unit = 0n;
          for (const choice of selection.design.placements) {
            const cell = required(
              cfg.decorationPrices?.find(
                (value) =>
                  value.placementId === choice.placementId &&
                  value.methodId === choice.methodId &&
                  value.stepId === choice.stepId,
              ),
            );
            unit += BigInt(cell.minor);
          }
          return {
            productId: selection.productId,
            canonicalIdentitySha256: String(index + 1).padStart(64, '0'),
            selection,
            quantity,
            setupMinor: '0',
            customizationUnitMinor: unit.toString(),
            baseTotalMinor: base.toString(),
            totalMinor: (base + unit * BigInt(quantity)).toString(),
          };
        });
        return route.fulfill({
          json: {
            proposalId,
            hash,
            expiresAt: new Date(await page.evaluate(() => Date.now() + 60000)).toISOString(),
            currency: 'EUR',
            exponent: 2,
            customizedQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
            totalMinor: rows.reduce((sum, row) => sum + BigInt(row.totalMinor), 0n).toString(),
            groups: rows,
            changedGroups: [],
          },
        });
      }
      if (path.endsWith('/accept')) {
        const request = BuyerAcceptanceSchema.parse(body);
        accepts.push(request);
        let receipt = accepted.get(request.idempotencyKey);
        const quote = required(quotes.get(required(path.split('/').at(-2))));
        if (receipt && receipt.hash !== request.hash)
          return route.fulfill({ status: 409, json: { error: 'Acceptance identity changed' } });
        assert.equal(request.hash, quote.hash);
        if (!receipt) {
          const index = accepted.size + 1;
          receipt = {
            hash: request.hash,
            value: {
              quoteId: `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, '0')}`,
              setId: `dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, '0')}`,
              validThroughDay: 22000,
              applicationId: `eeeeeeee-eeee-4eee-8eee-${String(index).padStart(12, '0')}`,
              buckets: quote.desired.flatMap((group) =>
                group.variants.map((variant) => ({
                  variantId: variant.variantId,
                  quantity: variant.quantity,
                  properties: {
                    _insignia_quote_v2: `q-${index}`,
                    _insignia_member_v2: `m-${index}-${variant.variantId}`,
                  },
                })),
              ),
              desired: quote.desired,
            },
          };
          accepted.set(request.idempotencyKey, receipt);
        }
        return failure
          ? route.fulfill({ status: 503, json: { error: 'Lost acknowledgement' } })
          : route.fulfill({ json: receipt.value });
      }
      if (path.endsWith('/confirm')) {
        const receipt = required(
          [...accepted.values()].find((value) => value.value.applicationId === path.split('/').at(-2)),
        );
        groups = structuredClone(receipt.value.desired);
        return route.fulfill({ json: { id: receipt.value.applicationId, status: 'APPLIED' } });
      }
      throw new Error(`Unexpected synthetic buyer path: ${path}`);
    });
    await installDesignBoundary(page);
    await page.evaluate(() => {
      const buyer = document.createElement('insignia-buyer');
      buyer.setAttribute('product-id', '111');
      buyer.setAttribute('country', 'NL');
      buyer.setAttribute('market-id', '1');
      buyer.setAttribute('repair', '');
      document.body.append(buyer);
    });
    const trigger = page.locator('insignia-buyer');
    await trigger.getByRole('button', { name: 'Review customized cart', exact: true }).click();
    const host = page.frameLocator('iframe:not([hidden])');
    await host.locator('.app').waitFor();
    await run({
      page,
      host,
      trigger,
      group,
      proposals,
      accepts,
      proposalIds,
      editCart: () => {
        required(items[0]).quantity = 5;
      },
      mutations: () => mutations,
      failAcceptance: (value) => {
        failure = value;
      },
      configure: (value) => configurations.set(value.productId, value),
    });
  } finally {
    await browser?.close();
    await server.close();
  }
}
async function reviewRetained(host: FrameLocator) {
  await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
  await host.getByRole('button', { name: 'Review', exact: true }).last().click();
}
const applyButton = (host: FrameLocator) => host.getByRole('button', { name: /^(?:Add to cart|Update cart)$/ });

test('selected full-cart review rejects external signed quantity drift without issuing or mutating the cart', async () => {
  await withRetainedBuyer(async ({ host, editCart, proposals, accepts, mutations }) => {
    editCart();
    await reviewRetained(host);
    await host.getByRole('heading', { name: 'Your customization needs review', exact: true }).waitFor();
    assert.equal(proposals.length, 0);
    assert.equal(accepts.length, 0);
    assert.equal(mutations(), 0);
  });
});
test('selected acknowledgements rotate acceptance keys while uncertain API retries preserve the exact proposal and key', async () => {
  await withRetainedBuyer(async ({ page, host, trigger, accepts, proposals, failAcceptance }) => {
    await reviewRetained(host);
    await applyButton(host).waitFor();
    failAcceptance(true);
    await applyButton(host).click();
    await host.locator('.cart-submit-error').waitFor();
    assert.equal(accepts.length, 1);
    failAcceptance(false);
    await applyButton(host).click();
    await page.waitForFunction(() => document.querySelector('iframe')?.hidden === true);
    assert.equal(accepts.length, 2);
    assert.deepEqual(accepts[1], accepts[0]);
    assert.equal(proposals.length, 1, 'Unknown acceptance never prepares a new proposal');
    await trigger.getByRole('button', { name: 'Review customized cart', exact: true }).click();
    await host.getByRole('button', { name: 'Previous step', exact: true }).click();
    await host.locator('input[type=number]:enabled').first().fill('4');
    await host.getByRole('button', { name: 'Review', exact: true }).last().click();
    await applyButton(host).waitFor();
    await applyButton(host).click();
    await page.waitForFunction(() => document.querySelector('iframe')?.hidden === true);
    assert.equal(accepts.length, 3);
    assert.notEqual(required(accepts[2]).idempotencyKey, required(accepts[1]).idempotencyKey);
  });
});
test('explicit selected full-cart review rebases compatible historical designs to each current product revision without rewriting saved choices', async () => {
  await withRetainedBuyer(
    async ({ host, proposals, group }) => {
      await reviewRetained(host);
      await host.getByText('€150.00', { exact: true }).filter({ visible: true }).first().waitFor();
      assert.deepEqual(
        required(proposals[0]).groups.map((value) => [
          value.productId,
          value.configRevisionId,
          value.revisionContentHash,
        ]),
        [
          ['111', 'r1', 'a'.repeat(64)],
          ['333', 'r-other', 'd'.repeat(64)],
        ],
      );
      assert.deepEqual(required(required(proposals[0]).groups[0]).design, group.design);
      assert.equal(group.configRevisionId, 'historical');
    },
    { multipleProducts: true },
  );
});
test('an incompatible republish requires explicit selected design repair and never silently drops retained logo-later choices', async () => {
  await withRetainedBuyer(async ({ host, proposals, configure, group }) => {
    const cfg = structuredClone(config);
    required(cfg.placements[0]).logoLaterAllowed = false;
    cfg.revisionId = 'changed';
    cfg.contentHash = 'e'.repeat(64);
    configure(cfg);
    await reviewRetained(host);
    await host.getByRole('heading', { name: 'Your customization needs review', exact: true }).waitFor();
    assert.equal(proposals.length, 0);
    assert.equal(required(group.design.placements[0]).artwork.kind, 'deferred');
  });
});
test('known quote expiry prepares a fresh authoritative proposal and requires another acceptance gesture', async () => {
  await withRetainedBuyer(
    async ({ page, host, proposals, accepts, proposalIds }) => {
      await reviewRetained(host);
      await applyButton(host).waitFor();
      assert.equal(proposals.length, 1);
      await page.clock.fastForward(61000);
      await applyButton(host).click();
      await host.locator('.cart-submit-error').waitFor();
      assert.equal(proposals.length, 2);
      assert.notEqual(proposalIds[1], proposalIds[0]);
      assert.equal(accepts.length, 0, 'The expired proposal is never accepted');
      await applyButton(host).click();
      await page.waitForFunction(() => document.querySelector('iframe')?.hidden === true);
      assert.equal(accepts.length, 1);
      assert.equal(required(accepts[0]).hash, String(2).padStart(64, '0'));
      const cart = record(await page.evaluate(async () => (await fetch('/cart.js')).json()));
      assert(Array.isArray(cart.items));
      const ordinary = cart.items.map(record).find((item) => item.key === 'ordinary-gift');
      assert.deepEqual(ordinary, {
        key: 'ordinary-gift',
        variant_id: 999,
        quantity: 2,
        properties: { gift: true, note: 'Keep gift wrapping' },
      });
    },
    { clock: true },
  );
});

test('expired-offer recovery rejects a subsequent external cart change before acceptance or mutation', async () => {
  await withRetainedBuyer(
    async ({ page, host, proposals, accepts, editCart, mutations }) => {
      await reviewRetained(host);
      await applyButton(host).waitFor();
      await page.clock.fastForward(61000);
      await applyButton(host).click();
      await host.locator('.cart-submit-error').waitFor();
      assert.equal(proposals.length, 2);
      editCart();
      const rejected = page.waitForResponse(
        (response) => response.url().endsWith('/cart-state') && response.status() === 409,
      );
      await applyButton(host).click();
      await rejected;
      await host.getByRole('heading', { name: 'Your customization needs review', exact: true }).waitFor();
      assert.equal(proposals.length, 2);
      assert.equal(accepts.length, 0);
      assert.equal(mutations(), 0);
    },
    { clock: true },
  );
});

async function withProductDesigner(
  cfg: BuyerConfig,
  run: (context: { page: Page; ui: FrameLocator; trigger: Locator; privateRequests: () => number }) => Promise<void>,
  mobile = false,
) {
  const server = await createServer({
    plugins: [selectedFrameAssets()],
    server: { host: '127.0.0.1', port: 0, strictPort: true, watch: null },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      hasTouch: mobile,
      reducedMotion: 'reduce',
    });
    const origin = `http://127.0.0.1:${serverPort(server.httpServer)}`;
    await prepareSelectedPage(page, origin);
    let privateRequests = 0;
    await page.route('**/cart.js', (route) => route.fulfill({ json: { items: [], currency: 'EUR' } }));
    await page.route('**/apps/insignia/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/config')) return route.fulfill({ json: cfg });
      privateRequests++;
      if (path.endsWith('/sessions'))
        return route.fulfill({
          json: {
            capability: 'abc.def',
            sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
        });
      throw new Error(`Unexpected product-designer API request: ${path}`);
    });
    await installDesignBoundary(page);
    await page.goto(origin);
    await page.evaluate(() => {
      const buyer = document.createElement('insignia-buyer');
      buyer.setAttribute('product-id', '111');
      buyer.setAttribute('country', 'NL');
      buyer.setAttribute('market-id', '42');
      document.body.append(buyer);
    });
    const trigger = page.locator('insignia-buyer').getByRole('button', { name: 'Customize this product' });
    await trigger.click();
    const ui = page.frameLocator('iframe:not([hidden])');
    await ui.locator('.app').waitFor();
    await run({ page, ui, trigger, privateRequests: () => privateRequests });
  } finally {
    await browser?.close();
    await server.close();
  }
}

test('selected desktop and mobile layouts retain the design and quantities when closing and reopening', async () => {
  await withProductDesigner(config, async ({ page, ui, trigger }) => {
    const iframe = required(await page.locator('iframe').boundingBox());
    assert.deepEqual([iframe.x, iframe.y, iframe.width, iframe.height], [0, 0, 1440, 900]);
    const preview = required(await ui.locator('.preview-panel').boundingBox());
    const controls = required(await ui.locator('.control-panel').boundingBox());
    assert.equal(Math.round(controls.width), 460);
    assert.equal(Math.round(preview.x + preview.width), Math.round(controls.x));
    await addDeferred(ui, 'Front');
    await ui.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    const quantity = ui.locator('input[type=number]:enabled').first();
    await quantity.fill('3');
    await ui.getByRole('button', { name: 'Close customizer', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('iframe')?.hidden === true);
    assert.equal(
      await trigger.evaluate((element) => {
        const root = element.getRootNode();
        return (root instanceof Document || root instanceof ShadowRoot) && root.activeElement === element;
      }),
      true,
    );
    await trigger.click();
    await ui.locator('.app').waitFor();
    assert.equal(await quantity.inputValue(), '3');
    await ui.getByRole('button', { name: 'Previous step', exact: true }).click();
    await positionCard(ui, 'Front').getByText('Artwork to follow', { exact: true }).first().waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await ui.locator('.app').evaluate(async (app) => {
      // Media-query listeners update preview focus on the next render; take all bounds in one settled frame.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const preview = app.querySelector('.preview-panel')?.getBoundingClientRect();
      const controls = app.querySelector('.control-panel')?.getBoundingClientRect();
      const footer = app.querySelector('.panel-footer')?.getBoundingClientRect();
      if (!preview || !controls || !footer) throw new Error('Missing selected mobile layout');
      return {
        previewWidth: preview.width,
        controlsWidth: controls.width,
        previewBottom: preview.bottom,
        controlsTop: controls.top,
        footerBottom: footer.bottom,
      };
    });
    assert.equal(Math.round(mobile.previewWidth), 390);
    assert.equal(Math.round(mobile.controlsWidth), 390);
    assert.equal(Math.round(mobile.previewBottom), Math.round(mobile.controlsTop));
    assert.equal(Math.round(mobile.footerBottom), 844);
    assert.equal(await ui.locator('.app').evaluate((element) => element.scrollWidth <= element.clientWidth), true);
    await ui.locator('.app').click({ position: { x: 2, y: 2 } });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('iframe')?.hidden === true);
    await trigger.click();
    await ui.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    assert.equal(await quantity.inputValue(), '3');
  });
});

test('selected mobile artwork dialog rejects unsupported files locally and real photo tabs retain the current design', async () => {
  const cfg = structuredClone(config);
  cfg.geometry.views.push({ ...structuredClone(required(cfg.geometry.views[0])), id: 'back', placements: [] });
  await withProductDesigner(
    cfg,
    async ({ page, ui, privateRequests }) => {
      await ui.getByRole('button', { name: 'Add artwork', exact: true }).click();
      await ui.locator('.artwork-choice').click();
      await ui.locator('.upload-zone').evaluate((element) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['unsupported'], 'notes.txt', { type: 'text/plain' }));
        element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
      });
      await ui.locator('.upload-error').waitFor();
      assert.match(required(await ui.locator('.upload-error').textContent()), /PNG.*JPG.*SVG/);
      assert.equal(privateRequests(), 0);
      const dialog = ui.locator('dialog[open]');
      await dialog.getByRole('button', { name: 'Close dialog', exact: true }).focus();
      await page.keyboard.press('Shift+Tab');
      assert.equal(
        await dialog
          .getByRole('button', { name: 'Provide artwork later', exact: true })
          .evaluate((element) => document.activeElement === element),
        true,
        await dialog.evaluate(() => document.activeElement?.tagName),
      );
      await page.keyboard.press('Tab');
      assert.equal(
        await dialog
          .getByRole('button', { name: 'Close dialog', exact: true })
          .evaluate((element) => document.activeElement === element),
        true,
      );
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      await positionCard(ui, 'Front').locator('.artwork-choice').click();
      await ui.getByRole('button', { name: 'Provide artwork later', exact: true }).click();
      const viewTabs = ui.getByRole('group', { name: 'Product view', exact: true });
      await viewTabs.getByRole('button', { name: 'back', exact: true }).click();
      assert.equal(
        await viewTabs.getByRole('button', { name: 'back', exact: true }).getAttribute('aria-pressed'),
        'true',
      );
      await viewTabs.getByRole('button', { name: 'front', exact: true }).click();
      await positionCard(ui, 'Front').getByText('Artwork to follow', { exact: true }).first().waitFor();
      await ui.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      assert.equal(await ui.locator('input[type=number]:enabled').first().isVisible(), true);
      assert.deepEqual(await ui.locator('.steps .step-label').allTextContents(), ['Artwork', 'Quantities', 'Review']);
      assert.equal(
        await ui.locator('.steps button').first().locator('svg').count(),
        1,
        'completed artwork uses the selected checkmark',
      );
    },
    true,
  );
});

test('republishing during a new empty-cart customization never offers removal of nonexistent cart items', async () => {
  await withProductDesigner(config, async ({ page, ui }) => {
    let writes = 0;
    await page.route('**/apps/insignia/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/config'))
        return route.fulfill({ json: { ...config, revisionId: 'new-publication', contentHash: 'f'.repeat(64) } });
      if (path.endsWith('/sessions'))
        return route.fulfill({
          json: {
            capability: 'abc.def',
            sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          },
        });
      writes++;
      return route.fulfill({ status: 500, json: { error: 'unexpected' } });
    });
    await addDeferred(ui, 'Front');
    await ui.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    await ui.locator('input[type=number]:enabled').first().fill('1');
    await ui.getByRole('button', { name: 'Review', exact: true }).last().click();
    await ui.getByRole('heading', { name: 'Unavailable', exact: true }).waitFor();
    assert.equal(
      await ui.getByRole('button', { name: 'Review removing all customized items', exact: true }).count(),
      0,
    );
    assert.equal(writes, 0, 'revision drift does not issue a proposal or alter the cart');
  });
});

test('missing critical physical production facts require repair without issuing editable defaults', async () => {
  const cfg = structuredClone(config);
  delete required(cfg.geometry.views[0]).image;
  delete required(cfg.geometry.steps[0]).physicalMm;
  await withProductDesigner(cfg, async ({ ui, privateRequests }) => {
    await ui.getByRole('heading', { name: 'Unavailable', exact: true }).waitFor();
    assert.equal(await ui.getByRole('button', { name: 'Add artwork', exact: true }).count(), 0);
    assert.equal(privateRequests(), 0);
  });
});

test('lost optional captured product preview keeps valid production choices and explicit authoritative quote review available', async () => {
  const cfg = structuredClone(config);
  cfg.imageUrls = {};
  await withProductDesigner(cfg, async ({ page, ui }) => {
    await ui.getByText('A selected preview could not load. Choose another option.', { exact: true }).waitFor();
    assert.equal(await ui.locator('.garment-photo').count(), 0, 'no invented garment replaces the missing photograph');
    let quoted: ProposalRequest | undefined,
      accepts = 0,
      writes = 0;
    await page.route('**/apps/insignia/v1/cart-state', (route) =>
      route.fulfill({ json: { groups: [], repairRequired: false } }),
    );
    await page.route('**/apps/insignia/v1/quote-proposals', (route) => {
      quoted = BuyerProposalRequestSchema.parse(route.request().postDataJSON());
      return route.fulfill({
        json: {
          proposalId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          hash: 'b'.repeat(64),
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          currency: 'EUR',
          exponent: 2,
          customizedQuantity: 2,
          totalMinor: '6000',
          groups: [
            {
              productId: '111',
              quantity: 2,
              setupMinor: '0',
              customizationUnitMinor: '1000',
              baseTotalMinor: '4000',
              totalMinor: '6000',
            },
          ],
          changedGroups: [],
        },
      });
    });
    await page.route('**/apps/insignia/v1/quote-proposals/*/accept', (route) => {
      accepts++;
      return route.fulfill({ status: 500, json: { error: 'unexpected' } });
    });
    await page.route('**/cart/add.js', (route) => {
      writes++;
      return route.fulfill({ status: 500, json: { error: 'unexpected' } });
    });
    await addDeferred(ui);
    await ui.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    await ui.locator('input[type=number]:enabled').first().fill('2');
    const response = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/quote-proposals'));
    await ui.getByRole('button', { name: 'Review', exact: true }).last().click();
    assert.equal((await response).status(), 200);
    await ui.getByText('€60.00', { exact: true }).filter({ visible: true }).first().waitFor();
    assert.equal(quoted?.groups[0]?.design.placements[0]?.stepId, 'small');
    assert.equal(quoted?.groups[0]?.variants[0]?.quantity, 2);
    assert.equal(accepts, 0);
    assert.equal(writes, 0);
  });
});
