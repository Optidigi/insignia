import {
  BuyerAcceptanceSchema,
  BuyerDesiredGroupSchema,
  BuyerDraftGroupSchema,
  BuyerProposalRequestSchema,
} from '@insignia/contracts';
import type { FrameLocator, Locator, Page, Request as PlaywrightRequest } from 'playwright';

type ObservedCartRequest = {
  idempotencyKey: string;
  design: { options?: { optionId: string; valueId: string }[] };
  [key: string]: unknown;
};

import type { BuyerConfig, DesiredGroup } from '../src/buyer.ts';

type ProposalRequest = ReturnType<typeof BuyerProposalRequestSchema.parse>;
type AcceptanceRequest = ReturnType<typeof BuyerAcceptanceSchema.parse>;

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { chromium, firefox } from 'playwright';
import {
  type AjaxItem,
  ajaxBody,
  createStorefrontTestServer as createServer,
  lineCarriers,
  record,
  required,
  selectedFrameAssets,
  serverPort,
} from './support.mts';

/** One-line v3 carrier for a variant; the storefront decodes but never verifies it. */
const v3Carrier = (variantId: string) => required(lineCarriers([{ variantId, unitMinor: '1000' }]).carriers[0]);

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
// The first page load and first Designer opening compile the storefront and Designer frame on
// demand; on a loaded runner that readiness takes longer than the 7 s action default.
const firstLoad = { timeout: 30_000 };
async function prepareSelectedPage(page: Page, origin: string) {
  page.setDefaultTimeout(7000);
  page.setDefaultNavigationTimeout(firstLoad.timeout);
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
    const value = BuyerDraftGroupSchema.parse(body.group);
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
test('buyer reviews the full retained cart and opens the locale native cart only after verified application', async () => {
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
            buckets: [{ variantId: '222', quantity: 3, properties: { _insignia_line_v3: v3Carrier('222') } }],
            desired: required(proposalBody).groups,
          },
        });
      }
      return route.fulfill({ json: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', status: 'APPLIED' } });
    });
    await installDesignBoundary(page);
    await page.route('**/nl/cart', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<main><h1>Native cart</h1></main>' }),
    );
    await page.evaluate(() => {
      const host = document.createElement('insignia-buyer');
      host.setAttribute('product-id', '111');
      host.setAttribute('cart-root', '/nl/');
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
    await ui.locator('input[inputmode=numeric]:enabled').first().fill('3');
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
    assert.equal(new URL(page.url()).pathname, '/', 'Pending application never leaves the selected review');
    releaseCartAdd();
    await page.waitForURL('**/nl/cart', { timeout: 7000 });
    await page.getByRole('heading', { name: 'Native cart', exact: true }).waitFor();
    assert.equal(required(items[0]).key, 'ordinary');
    assert.deepEqual(required(items[0]).properties, { gift: true });
    assert.equal(required(items[1]).quantity, 3);
    assert.ok(required(acceptedBody).idempotencyKey);
    assert.equal(sessionCalls, 1);
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
    await host.locator('input[inputmode=numeric]:enabled').first().fill('1');
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
    await host.getByRole('button', { name: 'Add artwork for Front', exact: true }).waitFor();
    await host.getByRole('button', { name: 'back', exact: true }).click();
    assert.equal(await host.getByRole('button', { name: 'Add artwork for Front', exact: true }).count(), 0);
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
    await host.getByRole('button', { name: 'Add artwork for Front', exact: true }).waitFor();
    await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    assert.equal(await host.locator('input[inputmode=numeric]:enabled').first().isVisible(), true);
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
    assert.equal(await host.getByRole('button', { name: 'Add artwork for Front', exact: true }).isVisible(), true);
    assert.equal(await host.getByRole('button', { name: 'Add artwork for Right', exact: true }).isVisible(), true);
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
  /** A native theme quantity change of the customized line. */
  editCart(quantity?: number): void;
  mutations(): number;
  cartNavigations(): number;
  failAcceptance(value: boolean): void;
  configure(value: BuyerConfig): void;
};
async function withRetainedBuyer(
  run: (context: RetainedScenario) => Promise<void>,
  {
    multipleProducts = false,
    clock = false,
    unknownOwned = false,
    productionOptions = false,
    // 'product' starts from the product page with no customized line, as a first Add to cart does.
    opening = 'editable' as 'editable' | 'repair' | 'product',
    // Like the v3 server: native quantity edits need no review and groups carry the cart's observed quantities.
    // Narrower than the server's cartState: repairRequired is always false (no expiry), renewable is absent,
    // and quantities are summed per variant across all carrier lines, not per signed line of each group,
    // so it only models carts whose groups use distinct variants.
    observedQuantities = false,
  } = {},
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
    if (productionOptions) group.design.options = [{ optionId: 'packing', valueId: 'plain' }];
    let groups = opening === 'product' ? [] : [structuredClone(group)];
    let items: AjaxItem[] = [
      ...(opening === 'product'
        ? []
        : [
            {
              key: 'custom',
              variant_id: 222,
              product_id: 111,
              quantity: 3,
              properties: { _insignia_line_v3: v3Carrier('222') },
            },
          ]),
      { key: 'ordinary-gift', variant_id: 999, quantity: 2, properties: { gift: true, note: 'Keep gift wrapping' } },
    ];
    const initialConfig = structuredClone(config);
    if (productionOptions)
      initialConfig.options = [
        {
          id: 'packing',
          label: 'Packing',
          values: [
            { id: 'plain', label: 'Plain' },
            { id: 'gift', label: 'Gift' },
          ],
        },
      ];
    const configurations = new Map<string, BuyerConfig>([['111', initialConfig]]);
    if (multipleProducts) {
      groups.push({ ...structuredClone(group), productId: '333', variants: [{ variantId: '444', quantity: 2 }] });
      items.push({
        key: 'other-custom',
        variant_id: 444,
        product_id: 333,
        quantity: 2,
        properties: { _insignia_line_v3: v3Carrier('444') },
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
        if (unknownOwned) return route.fulfill({ status: 503, json: { error: 'Owned session unavailable' } });
        if (observedQuantities) {
          const observed = groups.map((group) => ({
            ...group,
            variants: group.variants.flatMap((variant) => {
              const quantity = items
                .filter((item) => item.properties._insignia_line_v3 && String(item.variant_id) === variant.variantId)
                .reduce((sum, item) => sum + item.quantity, 0);
              return quantity ? [{ variantId: variant.variantId, quantity }] : [];
            }),
          }));
          return route.fulfill({
            json: {
              groups: observed,
              labels: { '111': 'Synthetic shirt', '333': 'Other synthetic shirt' },
              quoteId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              repairRequired: false,
            },
          });
        }
        const expected = groups.flatMap((group) => group.variants);
        if (
          items.some(
            (item) =>
              item.properties._insignia_line_v3 &&
              expected
                .filter((value) => value.variantId === String(item.variant_id))
                .reduce((sum, value) => sum + value.quantity, 0) !== item.quantity,
          )
        )
          return route.fulfill({ status: 409, json: { error: 'Cart quantity changed' } });
        return route.fulfill({
          json: {
            groups,
            labels: { '111': 'Synthetic shirt', '333': 'Other synthetic shirt' },
            quoteId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            repairRequired: false,
          },
        });
      }
      if (path.endsWith('/quote-proposals')) {
        const request = BuyerProposalRequestSchema.parse(body);
        proposals.push(request);
        const number = proposals.length;
        const proposalId = `bbbbbbbb-bbbb-4bbb-8bbb-${String(number).padStart(12, '0')}`;
        proposalIds.push(proposalId);
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
        // Like the server's material hash: identical economics and selections give the identical hash.
        const hash = createHash('sha256')
          .update(JSON.stringify([request.groups, rows]))
          .digest('hex');
        quotes.set(proposalId, { hash, desired: request.groups });
        // The quote expires on the page's clock (fake in clock tests). An eager proposal can still be
        // here when the test reloads or closes the page; nobody then awaits its response.
        let pageNow: number;
        try {
          pageNow = await page.evaluate(() => Date.now());
        } catch {
          return route.abort().catch(() => {});
        }
        return route.fulfill({
          json: {
            proposalId,
            hash,
            expiresAt: new Date(pageNow + 60000).toISOString(),
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
              buckets: (() => {
                const variants = quote.desired.flatMap((group) => group.variants);
                const set = lineCarriers(
                  variants.map((variant) => ({ variantId: variant.variantId, unitMinor: '1000' })),
                  { set: index + 1 },
                );
                return variants.map((variant, line) => ({
                  variantId: variant.variantId,
                  quantity: variant.quantity,
                  properties: { _insignia_line_v3: required(set.carriers[line]) },
                }));
              })(),
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
    await page.evaluate((product) => {
      const buyer = document.createElement('insignia-buyer');
      buyer.setAttribute('product-id', '111');
      buyer.setAttribute('country', 'NL');
      buyer.setAttribute('market-id', '1');
      if (!product) buyer.setAttribute('repair', '');
      document.body.append(buyer);
    }, opening === 'product');
    // These cases isolate retained-state/retry behavior. The native-cart
    // navigation boundary returns no document so that the same session can be reopened.
    // The product purchase and real HTTP/PG cases separately verify actual navigation.
    let cartNavigations = 0;
    await page.route('**/cart', (route) => {
      cartNavigations++;
      return route.fulfill({ status: 204 });
    });
    const trigger = page.locator('insignia-buyer');
    await trigger
      .getByRole('button', {
        name: opening === 'product' ? 'Customize this product' : 'Review customized cart',
        exact: true,
      })
      .click();
    const host = page.frameLocator('iframe:not([hidden])');
    if (opening === 'repair') {
      await host.getByRole('heading', { name: 'Your customization needs review', exact: true }).waitFor(firstLoad);
      await host.getByRole('button', { name: 'Review removing all customized items', exact: true }).waitFor();
      assert.equal(await host.locator('input,select,textarea').count(), 0);
    } else await host.locator('.app').waitFor(firstLoad);
    assert.equal(await page.locator('dialog[open]').isVisible(), true);
    assert.equal(await page.locator('dialog[open] > iframe').isVisible(), true);
    assert.equal(
      await page.locator('dialog[open] > div').evaluate((element) => element instanceof HTMLElement && element.hidden),
      true,
    );
    await run({
      page,
      host,
      trigger,
      group,
      proposals,
      accepts,
      proposalIds,
      editCart: (quantity = 5) => {
        required(items.find((item) => item.properties._insignia_line_v3)).quantity = quantity;
      },
      mutations: () => mutations,
      cartNavigations: () => cartNavigations,
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
/**
 * Pauses page timers (needs `clock: true`) so the Designer's eager review, 350 ms after quantities
 * settle, cannot run between a test's own edit, native cart change and Review click.
 */
async function freezeTimers(page: Page) {
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
}
async function reviewRetained(host: FrameLocator) {
  await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
  await host.getByRole('button', { name: 'Review', exact: true }).last().click();
}
const applyButton = (host: FrameLocator) => host.getByRole('button', { name: /^(?:Add to cart|Update cart)$/ });

test('direct Artwork to Review starts one current preparation without passive cleanup aborting it', async () => {
  await withRetainedBuyer(async ({ page, host, accepts, mutations }) => {
    await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    await host.locator('body').evaluate((body) => {
      const input = body.querySelector<HTMLInputElement>('input[inputmode=numeric]:enabled');
      if (!input) throw new Error('Quantity field was not rendered');
      input.value = '4';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      [...body.querySelectorAll<HTMLButtonElement>('.steps button')]
        .find((b) => b.textContent?.includes('Artwork'))
        ?.click();
    });
    await host.getByRole('button', { name: 'Choose quantities', exact: true }).waitFor();
    await host.locator('body').evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
        }),
    );
    await page.evaluate(() => {
      Reflect.set(window, 'directReviewRequests', 0);
      addEventListener('message', (event) => {
        if (event.data?.type === 'insignia:designer:request' && event.data.action === 'prepare')
          Reflect.set(window, 'directReviewRequests', Reflect.get(window, 'directReviewRequests') + 1);
      });
    });
    await host.locator('.steps button').filter({ hasText: 'Review' }).click();
    await applyButton(host).waitFor();
    await page.waitForFunction(() => {
      const doc = document.querySelector<HTMLIFrameElement>('dialog:modal > iframe[srcdoc]')?.contentDocument;
      const button = doc?.querySelector<HTMLButtonElement>('.footer-buttons .primary-button');
      return button && !button.disabled && !doc?.querySelector('.cart-submit-error');
    });
    assert.equal(await page.evaluate(() => Reflect.get(window, 'directReviewRequests')), 1);
    assert.equal(accepts.length, 0);
    assert.equal(mutations(), 0);
  });
});

test('quantity editing speculates once instead of spending a proposal slot on every pause', async () => {
  await withRetainedBuyer(
    async ({ page, host, proposals, accepts, mutations }) => {
      const first = page.waitForResponse('**/quote-proposals');
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      await host.locator('input[inputmode=numeric]:enabled').first().fill('4');
      await page.clock.runFor(700);
      await first;
      await page.clock.runFor(100);
      for (const value of ['5', '6']) {
        await host.locator('input[inputmode=numeric]:enabled').first().fill(value);
        await page.clock.runFor(700);
      }
      assert.equal(proposals.length, 1, 'typing pauses must not exhaust the bounded session draft/proposal budget');
      const final = page.waitForResponse('**/quote-proposals');
      await host.getByRole('button', { name: 'Review', exact: true }).last().click();
      await final;
      assert.equal(proposals.length, 2);
      assert.equal(proposals[1]?.groups[0]?.variants[0]?.quantity, 6);
      assert.equal(accepts.length, 0);
      assert.equal(mutations(), 0);
    },
    { clock: true },
  );
});

test('verified cart handoff does not wait for best-effort application confirmation', async () => {
  await withRetainedBuyer(async ({ page, host, cartNavigations }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/cart-applications/*/confirm', async (route) => {
      await held;
      await route.fallback().catch(() => {});
    });
    try {
      await reviewRetained(host);
      await applyButton(host).click();
      await host.getByRole('button', { name: 'View cart', exact: true }).waitFor();
      assert.equal(await page.locator('dialog:modal').isVisible(), true);
      assert.equal(await page.locator('iframe:not([hidden])').isVisible(), true);
      assert.equal(cartNavigations(), 1, 'only the verified cart receipt gates native handoff');
    } finally {
      release();
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
});

test('Quantities footer enters Review while its speculative quote is still preparing', async () => {
  await withRetainedBuyer(async ({ page, host, accepts, mutations }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = page.waitForRequest('**/quote-proposals');
    let requests = 0;
    await page.route('**/quote-proposals', async (route) => {
      requests++;
      await held;
      await route.fallback().catch(() => {});
    });
    try {
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      await host.locator('input[inputmode=numeric]:enabled').first().fill('4');
      await started;
      const next = host.locator('.footer-buttons .primary-button');
      assert.equal(await next.textContent(), 'Review', 'background preparation cannot replace the navigation action');
      assert.equal(await next.isEnabled(), true, 'Review navigation cannot wait for quote IO');
      await next.click();
      assert.equal(await host.locator('.footer-price strong').textContent(), 'Calculating quote…');
      assert.equal(await next.isEnabled(), false, 'purchase stays disabled until authoritative preparation finishes');
      assert.equal(await next.textContent(), 'Preparing quote…');
      assert.equal(await host.getByRole('button', { name: 'Edit quantities', exact: true }).isEnabled(), true);
      release();
      await applyButton(host).waitFor();
      assert.equal(requests, 1, 'entering Review reuses the in-flight preparation');
      assert.equal(accepts.length, 0);
      assert.equal(mutations(), 0);
    } finally {
      release();
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
});

test('applying an already prepared quote never flashes "Preparing quote…"', async () => {
  await withRetainedBuyer(async ({ host, cartNavigations, accepts }) => {
    await reviewRetained(host);
    const apply = applyButton(host);
    await apply.and(host.locator(':enabled')).waitFor();
    await host.locator('.footer-buttons').evaluate((footer) => {
      const seen: string[] = [];
      Reflect.set(window, '__footerTexts', seen);
      new MutationObserver(() => seen.push(footer.textContent ?? '')).observe(footer, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });
    await apply.click();
    await host.locator('body').evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    for (let i = 0; i < 100 && cartNavigations() === 0; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(cartNavigations(), 1);
    assert.equal(accepts.length, 1);
    const texts: string[] = await host.locator('body').evaluate(() => Reflect.get(window, '__footerTexts'));
    assert.ok(
      texts.some((text) => text.includes('Updating cart…')),
      texts.join(' | '),
    );
    assert.equal(
      texts.some((text) => text.includes('Preparing quote…')),
      false,
      texts.join(' | '),
    );
  });
});

test('Review never shows the local design count before the whole retained cart count', async () => {
  await withRetainedBuyer(
    async ({ page, host }) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/apps/insignia/v1/cart-state', async (route) => {
        await held;
        await route.fallback().catch(() => {});
      });
      try {
        // A one-off isVisible() sample can miss a count shown for a single frame. Record the
        // computed visibility synchronously after every footer mutation instead.
        await host.locator('.footer-price').evaluate((price) => {
          const shown: string[] = [];
          Reflect.set(window, '__pendingCountShown', shown);
          new MutationObserver(() => {
            const count = price.querySelector(':scope > span');
            if (
              price.querySelector('strong')?.textContent === 'Calculating quote…' &&
              count &&
              getComputedStyle(count).visibility !== 'hidden'
            )
              shown.push(count.textContent ?? '');
          }).observe(price, { subtree: true, childList: true, characterData: true, attributes: true });
        });
        await reviewRetained(host);
        const count = host.locator('.footer-price > span');
        assert.equal(await host.locator('.footer-price strong').textContent(), 'Calculating quote…');
        assert.equal(await count.textContent(), '3 items', 'the local count of this design alone');
        assert.equal(await count.isVisible(), false, 'is not shown while the cart may hold other designs');
        assert.deepEqual(
          await host.locator('body').evaluate(() => Reflect.get(window, '__pendingCountShown')),
          [],
          'is not shown even for a frame while the cart may hold other designs',
        );
        release();
        await count.filter({ hasText: '5 items' }).waitFor({ state: 'visible' });
      } finally {
        release();
        await page.unrouteAll({ behavior: 'ignoreErrors' });
      }
    },
    { multipleProducts: true },
  );
});

test('pending quote preparation keeps review editing responsive and cancels obsolete quantities', async () => {
  await withRetainedBuyer(async ({ page, host, accepts, mutations }) => {
    const started = page.waitForRequest('**/quote-proposals');
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/quote-proposals', async (route) => {
      await held;
      await route.fallback().catch(() => {}); // The edited-away request may already be aborted.
    });
    try {
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      await host.locator('input[inputmode=numeric]:enabled').first().fill('4');
      await started;
      await host.getByRole('button', { name: 'Review', exact: true }).last().click();
      assert.equal(await host.locator('.footer-buttons .primary-button').isEnabled(), false);
      await host.getByRole('button', { name: 'Edit quantities', exact: true }).click();
      await host.locator('input[inputmode=numeric]:enabled').first().fill('5');
      release();
      await host.getByRole('button', { name: 'Review', exact: true }).last().click();
      await applyButton(host).waitFor();
      await page.waitForFunction(() => {
        const doc = document.querySelector<HTMLIFrameElement>('iframe:not([hidden])')?.contentDocument;
        return [...(doc?.querySelectorAll<HTMLButtonElement>('button') ?? [])].some(
          (b) => b.textContent?.trim() === 'Update cart' && !b.disabled,
        );
      });
      assert.equal(accepts.length, 0);
      assert.equal(mutations(), 0);
      await host.getByRole('button', { name: 'Edit quantities', exact: true }).click();
      assert.equal(await host.locator('input[inputmode=numeric]:enabled').first().inputValue(), '5');
    } finally {
      release();
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
});

test('selected full-cart review rejects external signed quantity drift without issuing or mutating the cart', async () => {
  await withRetainedBuyer(
    async ({ page, host, editCart, proposals, accepts, mutations }) => {
      await freezeTimers(page);
      editCart();
      await reviewRetained(host);
      await host.getByRole('heading', { name: 'Your customization needs review', exact: true }).waitFor();
      assert.equal(proposals.length, 0);
      assert.equal(accepts.length, 0);
      assert.equal(mutations(), 0);
    },
    { clock: true },
  );
});
/** The verified apply hands off to the native cart (204 here); reloading during it races that navigation. */
const nativeCartHandoff = (page: Page) =>
  page.waitForResponse((response) => new URL(response.url()).pathname === '/cart');
async function reopenOwned(page: Page, trigger: Locator, host: FrameLocator) {
  await page.reload();
  await page.evaluate(() => {
    const buyer = document.createElement('insignia-buyer');
    buyer.setAttribute('product-id', '111');
    buyer.setAttribute('country', 'NL');
    buyer.setAttribute('market-id', '1');
    buyer.setAttribute('repair', '');
    document.body.append(buyer);
  });
  await trigger.getByRole('button', { name: 'Review customized cart', exact: true }).click();
  // After a full reload the Designer frame loads again, like a first opening.
  await host.locator('.app').waitFor(firstLoad);
}
test('a native cart quantity change reopens the design at the cart quantity, never the saved draft quantity (#341)', async () => {
  await withRetainedBuyer(
    async ({ page, host, trigger, editCart, proposals, accepts, mutations }) => {
      // An unsent Designer edit (3 -> 4) is still resumed: the cart keeps its accepted quantity.
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      await host.locator('input[inputmode=numeric]:enabled').first().fill('4');
      await host.getByRole('button', { name: 'Review', exact: true }).last().click();
      await applyButton(host).waitFor();
      await reopenOwned(page, trigger, host);
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      assert.equal(await host.locator('input[inputmode=numeric]:enabled').first().inputValue(), '4');
      // The buyer then changes the cart line to 5 with the theme's controls: that is the latest choice.
      editCart();
      await reopenOwned(page, trigger, host);
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      assert.equal(
        await host.locator('input[inputmode=numeric]:enabled').first().inputValue(),
        '5',
        'the cart quantity seeds the editor',
      );
      await host.getByRole('button', { name: 'Review', exact: true }).last().click();
      await applyButton(host).waitFor();
      assert.deepEqual(
        proposals.at(-1)?.groups.map((group) => group.variants),
        [[{ variantId: '222', quantity: 5 }]],
        'Update cart keeps the cart quantity instead of reverting it',
      );
      assert.equal(accepts.length, 0);
      assert.equal(mutations(), 0);
    },
    { observedQuantities: true },
  );
});
/** The theme's own Ajax quantity control: the cart changes and the page is not reloaded. */
async function ajaxQuantity(page: Page, editCart: RetainedScenario['editCart'], quantity: number) {
  await page.route('**/cart/change.js', (route) => {
    editCart(quantity);
    return route.fulfill({ json: {} });
  });
  await page.evaluate(
    (value) =>
      fetch('/cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'custom', quantity: value }),
      }),
    quantity,
  );
}
async function reopenSamePage(page: Page, trigger: Locator, host: FrameLocator) {
  await trigger.getByRole('button', { name: 'Review customized cart', exact: true }).click();
  await page.locator('dialog:modal').waitFor();
}
test('a cart line edited and then changed back to the cart reopens from the cart after a reload (#366)', async () => {
  await withRetainedBuyer(async ({ page, host, trigger }) => {
    const saved = (quantity: number) =>
      page.waitForRequest(
        (request) =>
          request.method() === 'PUT' &&
          /\/designs\/[a-f0-9-]+$/.test(new URL(request.url()).pathname) &&
          JSON.stringify(
            record(request.postDataJSON()).group && record(record(request.postDataJSON()).group).variants,
          ) === JSON.stringify([{ variantId: '222', quantity }]),
        // An autosave waits at least 10 s after the previous one.
        { timeout: 20_000 },
      );
    await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    const edited = saved(4);
    await host.locator('input[inputmode=numeric]:enabled').first().fill('4');
    await edited;
    // Undo by hand: the line is as the cart holds it again. Its draft must say so too.
    const undone = saved(3);
    await host.locator('input[inputmode=numeric]:enabled').first().fill('3');
    await undone;
    await reopenOwned(page, trigger, host);
    await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    assert.equal(await host.locator('input[inputmode=numeric]:enabled').first().inputValue(), '3');
  });
});
test('reopening on the same cart page follows a native Ajax quantity change (#397)', async () => {
  await withRetainedBuyer(
    async ({ page, host, trigger, editCart, proposals, accepts, mutations }) => {
      await host.getByRole('button', { name: 'Close customizer', exact: true }).click();
      await page.locator('dialog:modal').waitFor({ state: 'detached' });
      await ajaxQuantity(page, editCart, 5);
      await reopenSamePage(page, trigger, host);
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      assert.equal(
        await host.locator('input[inputmode=numeric]:enabled').first().inputValue(),
        '5',
        'the cart quantity seeds the editor, as after a reload',
      );
      await host.getByRole('button', { name: 'Review', exact: true }).last().click();
      await applyButton(host).waitFor();
      assert.deepEqual(
        proposals.at(-1)?.groups.map((group) => group.variants),
        [[{ variantId: '222', quantity: 5 }]],
        'Update cart replaces the cart line as it is now',
      );
      assert.equal(accepts.length, 0);
      assert.equal(mutations(), 0);
    },
    { observedQuantities: true },
  );
});
test('reopening on the same cart page keeps a Designer quantity edit over a native Ajax change (#397)', async () => {
  await withRetainedBuyer(
    async ({ page, host, trigger, editCart, proposals, accepts, mutations }) => {
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      await host.locator('input[inputmode=numeric]:enabled').first().fill('4');
      await host.getByRole('button', { name: 'Close customizer', exact: true }).click();
      await host.getByRole('button', { name: 'Close customization', exact: true }).click();
      await page.locator('dialog:modal').waitFor({ state: 'detached' });
      await ajaxQuantity(page, editCart, 5);
      await reopenSamePage(page, trigger, host);
      // The Designer reopens where it was closed: on Quantities.
      assert.equal(await host.locator('input[inputmode=numeric]:enabled').first().inputValue(), '4');
      await host.getByRole('button', { name: 'Review', exact: true }).last().click();
      await applyButton(host).waitFor();
      assert.deepEqual(
        proposals.at(-1)?.groups.map((group) => group.variants),
        [[{ variantId: '222', quantity: 4 }]],
        'the buyer edited this quantity in the Designer',
      );
      assert.equal(accepts.length, 0);
      assert.equal(mutations(), 0);
    },
    { observedQuantities: true },
  );
});
test('a Designer quantity edit that cancels the eager draft save still reopens at the edit (#371)', async () => {
  await withRetainedBuyer(
    async ({ page, host, trigger }) => {
      // The eager review saves the cart line's quantity; its answer is held until the buyer's edit cancels it.
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let sent!: (request: PlaywrightRequest) => void;
      const eagerSave = new Promise<PlaywrightRequest>((resolve) => {
        sent = resolve;
      });
      let first = true;
      await page.route('**/apps/insignia/v1/designs/*', async (route) => {
        if (route.request().method() === 'PUT' && first) {
          first = false;
          sent(route.request());
          await held;
        }
        // The draft server still applies the cancelled save, as a server that received it does.
        await route.fallback();
      });
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      const request = await eagerSave;
      assert.deepEqual(BuyerDesiredGroupSchema.parse(record(request.postDataJSON()).group).variants, [
        { variantId: '222', quantity: 3 },
      ]);
      const cancelled = page.waitForEvent('requestfailed', (failed) => failed === request);
      await host.locator('input[inputmode=numeric]:enabled').first().fill('4');
      await cancelled;
      release();
      await host.getByRole('button', { name: 'Review', exact: true }).last().click();
      await applyButton(host).waitFor();
      await reopenOwned(page, trigger, host);
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      assert.equal(
        await host.locator('input[inputmode=numeric]:enabled').first().inputValue(),
        '4',
        'the reviewed Designer edit is resumed, not the cancelled eager save',
      );
    },
    { observedQuantities: true },
  );
});
test('a design added from the product page reopens at a later native cart quantity (#341)', async () => {
  await withRetainedBuyer(
    async ({ page, host, trigger, editCart, accepts }) => {
      await addDeferred(host);
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      await host.locator('input[inputmode=numeric]:enabled').first().fill('3');
      await host.getByRole('button', { name: 'Review', exact: true }).last().click();
      const latest = () =>
        page.evaluate(() =>
          Object.keys(localStorage).filter((key) => key.startsWith('insignia:selected-design-latest:')),
        );
      await applyButton(host).and(host.locator(':enabled')).waitFor();
      assert.equal((await latest()).length, 1, 'the unfinished design can be continued after a reload (#347)');
      const handoff = nativeCartHandoff(page);
      await host.getByRole('button', { name: 'Add to cart', exact: true }).click();
      await host.getByRole('button', { name: 'View cart', exact: true }).waitFor();
      await handoff;
      assert.equal(accepts.length, 1);
      assert.deepEqual(await latest(), [], 'a design in the cart is no longer offered to continue (#347)');
      // The draft had no cart line when it was saved; Add to cart makes the accepted line its base.
      editCart(5);
      await reopenOwned(page, trigger, host);
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      assert.equal(await host.locator('input[inputmode=numeric]:enabled').first().inputValue(), '5');
    },
    { observedQuantities: true, opening: 'product' },
  );
});
test('after Update cart, a native return to the earlier quantity is still the cart choice (#341)', async () => {
  await withRetainedBuyer(
    async ({ page, host, trigger, editCart, accepts }) => {
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      await host.locator('input[inputmode=numeric]:enabled').first().fill('4');
      await host.getByRole('button', { name: 'Review', exact: true }).last().click();
      const handoff = nativeCartHandoff(page);
      await applyButton(host).click();
      await host.getByRole('button', { name: 'View cart', exact: true }).waitFor();
      await handoff;
      assert.equal(accepts.length, 1);
      // The draft was saved against the cart line at 3; Update cart to 4 makes 4 its base.
      editCart(3);
      await reopenOwned(page, trigger, host);
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      assert.equal(await host.locator('input[inputmode=numeric]:enabled').first().inputValue(), '3');
    },
    { observedQuantities: true },
  );
});
test('after a cart quantity change during editing, Retry follows the cart when the buyer kept its quantity (#341)', async () => {
  await withRetainedBuyer(
    async ({ page, host, editCart, proposals, accepts, mutations }) => {
      await freezeTimers(page);
      editCart();
      await reviewRetained(host);
      await host.getByRole('heading', { name: 'Your customization needs review', exact: true }).waitFor();
      assert.equal(proposals.length, 0);
      // Retry resumes the suspended review, which prepares again against the current cart.
      await host.getByRole('button', { name: 'Retry', exact: true }).click();
      await applyButton(host).waitFor();
      assert.deepEqual(
        proposals.map((proposal) => proposal.groups.map((group) => group.variants)),
        [[[{ variantId: '222', quantity: 5 }]]],
        'an unedited Designer quantity never reverts the cart line',
      );
      await host.getByRole('button', { name: 'Edit quantities', exact: true }).click();
      assert.equal(await host.locator('input[inputmode=numeric]:enabled').first().inputValue(), '5');
      // The cart line is the new unchanged state: closing asks nothing.
      await host.getByRole('button', { name: 'Close customizer', exact: true }).click();
      await page.locator('dialog:modal').waitFor({ state: 'detached' });
      assert.equal(accepts.length, 0);
      assert.equal(mutations(), 0);
    },
    { observedQuantities: true, clock: true },
  );
});
test('after a cart quantity change during editing, Retry keeps a quantity the buyer edited in the Designer (#341)', async () => {
  await withRetainedBuyer(
    async ({ page, host, editCart, proposals, accepts, mutations }) => {
      await freezeTimers(page);
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      await host.locator('input[inputmode=numeric]:enabled').first().fill('4');
      editCart();
      await host.getByRole('button', { name: 'Review', exact: true }).last().click();
      await host.getByRole('heading', { name: 'Your customization needs review', exact: true }).waitFor();
      await host.getByRole('button', { name: 'Retry', exact: true }).click();
      await applyButton(host).waitFor();
      assert.deepEqual(
        proposals.map((proposal) => proposal.groups.map((group) => group.variants)),
        [[[{ variantId: '222', quantity: 4 }]]],
        'the buyer edited this quantity in the Designer',
      );
      assert.equal(accepts.length, 0);
      assert.equal(mutations(), 0);
    },
    { observedQuantities: true, clock: true },
  );
});
test('after a cart quantity change during editing, the start action reopens the cart design at the cart quantity (#341)', async () => {
  await withRetainedBuyer(
    async ({ page, host, editCart, proposals, accepts, mutations }) => {
      await freezeTimers(page);
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      await host.locator('input[inputmode=numeric]:enabled').first().fill('7');
      editCart();
      await host.getByRole('button', { name: 'Review', exact: true }).last().click();
      await host.getByRole('heading', { name: 'Your customization needs review', exact: true }).waitFor();
      // The action says what it does: the Designer's unsaved changes go and the cart's design reopens.
      assert.equal(await host.getByRole('button', { name: 'Start a new customization', exact: true }).count(), 0);
      await host.getByRole('button', { name: 'Discard changes and reopen from cart', exact: true }).click();
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      assert.equal(
        await host.locator('input[inputmode=numeric]:enabled').first().inputValue(),
        '5',
        'it reopens the cart design, not a blank one',
      );
      await host.getByRole('button', { name: 'Review', exact: true }).last().click();
      await applyButton(host).waitFor();
      assert.deepEqual(
        proposals.map((proposal) => proposal.groups.map((group) => [group.design.placements.length, group.variants])),
        [[[1, [{ variantId: '222', quantity: 5 }]]]],
      );
      assert.equal(accepts.length, 0);
      assert.equal(mutations(), 0);
    },
    { observedQuantities: true, clock: true },
  );
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
    await host.getByRole('button', { name: 'View cart', exact: true }).waitFor();
    assert.equal(accepts.length, 2);
    assert.deepEqual(accepts[1], accepts[0]);
    assert.equal(proposals.length, 1, 'Unknown acceptance never prepares a new proposal');
    const placement = await trigger.evaluate((element) => element.outerHTML);
    await page.reload();
    await page.locator('body').evaluate((body, markup) => body.insertAdjacentHTML('beforeend', markup), placement);
    await trigger.getByRole('button', { name: 'Review customized cart', exact: true }).click();
    await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    await host.locator('input[inputmode=numeric]:enabled').first().fill('4');
    await host.getByRole('button', { name: 'Review', exact: true }).last().click();
    await applyButton(host).waitFor();
    await applyButton(host).click();
    await host.getByRole('button', { name: 'View cart', exact: true }).waitFor();
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
for (const restoreUnavailable of [false, true])
  test(`explicit repair Start-new abandons restored custody across reloads (restore unavailable=${restoreUnavailable})`, async () => {
    await withRetainedBuyer(async ({ page, host, trigger, configure, accepts, mutations }) => {
      const reloadOwned = async (inRepair = false) => {
        await page.reload();
        await page.evaluate(() => {
          const buyer = document.createElement('insignia-buyer');
          buyer.setAttribute('product-id', '111');
          buyer.setAttribute('country', 'NL');
          buyer.setAttribute('market-id', '1');
          buyer.setAttribute('repair', '');
          document.body.append(buyer);
        });
        await trigger.getByRole('button', { name: 'Review customized cart', exact: true }).click();
        if (inRepair)
          await host.getByRole('heading', { name: 'Your customization needs review', exact: true }).waitFor();
        else await host.locator('.app').waitFor();
      };
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      await host.locator('input[inputmode=numeric]:enabled').first().fill('4');
      await host.getByRole('button', { name: 'Review', exact: true }).last().click();
      await applyButton(host).waitFor();
      page.on('dialog', (dialog) => dialog.accept());
      const restoreRoute = '**/apps/insignia/v1/designs/*/restore';
      if (restoreUnavailable)
        await page.route(restoreRoute, (route) =>
          route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }),
        );
      await reloadOwned(restoreUnavailable);
      if (!restoreUnavailable) {
        await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
        assert.equal(await host.locator('input[inputmode=numeric]:enabled').first().inputValue(), '4');
        const published = structuredClone(config);
        published.revisionId = 'new-publication';
        published.contentHash = 'e'.repeat(64);
        configure(published);
        await host.getByRole('button', { name: 'Review', exact: true }).last().click();
        await host.getByRole('heading', { name: 'Your customization needs review', exact: true }).waitFor();
      }
      await host.getByRole('button', { name: 'Start a new customization', exact: true }).click();
      await host.getByRole('button', { name: 'Add artwork', exact: true }).waitFor();
      if (restoreUnavailable) await page.unroute(restoreRoute);
      await reloadOwned();
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      assert.equal(await host.locator('input[inputmode=numeric]:enabled').first().inputValue(), '3');
      assert.equal(accepts.length, 0);
      assert.equal(mutations(), 0);
    });
  });

test('an incompatible republish requires explicit selected design repair and never silently drops retained logo-later choices', async () => {
  await withRetainedBuyer(
    async ({ page, host, accepts, mutations, configure, group }) => {
      // Preparation sends its proposal without waiting for the fresh config read; the server re-checks
      // the revision. Whether that proposal leaves before the changed publication is seen is a race,
      // so hold proposals and assert the contract instead: a changed publication aborts it.
      await page.route('**/apps/insignia/v1/quote-proposals', () => new Promise<void>(() => {}));
      const dispatched: PlaywrightRequest[] = [];
      const aborted = new Set<PlaywrightRequest>();
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.endsWith('/quote-proposals')) dispatched.push(request);
      });
      page.on('requestfailed', (request) => aborted.add(request));
      const cfg = structuredClone(config);
      required(cfg.placements[0]).logoLaterAllowed = false;
      cfg.revisionId = 'changed';
      cfg.contentHash = 'e'.repeat(64);
      configure(cfg);
      await freezeTimers(page);
      await reviewRetained(host);
      await host.getByRole('heading', { name: 'Your customization needs review', exact: true }).waitFor();
      for (const request of dispatched)
        if (!aborted.has(request)) await page.waitForEvent('requestfailed', (failed) => failed === request);
      assert.equal(accepts.length, 0);
      assert.equal(mutations(), 0);
      assert.equal(required(group.design.placements[0]).artwork.kind, 'deferred');
    },
    { clock: true },
  );
});

for (const [action, unknownOwned] of [
  ['Review removing this customization', false],
  ['Review removing all customized items', false],
  ['Review removing all customized items', true],
] as const) {
  test(`confirmed ${action} (unknown session=${unknownOwned}) opens the native cart and preserves ordinary lines`, async () => {
    await withRetainedBuyer(
      async ({ page, host, configure, cartNavigations }) => {
        if (!unknownOwned) {
          const next = structuredClone(config);
          required(next.placements[0]).logoLaterAllowed = false;
          next.revisionId = 'changed';
          next.contentHash = 'e'.repeat(64);
          configure(next);
          await freezeTimers(page);
          await reviewRetained(host);
        }
        await host.getByRole('button', { name: action, exact: true }).click();
        assert.equal(cartNavigations(), 0);
        const navigated = page.waitForResponse(
          (response) => new URL(response.url()).pathname === '/cart' && response.request().isNavigationRequest(),
        );
        await host.getByRole('button', { name: 'Confirm cart update', exact: true }).click();
        await navigated;
        await page.waitForFunction(() => !document.querySelector('iframe:not([hidden])'));
        assert.equal(cartNavigations(), 1);
        const cart = record(await page.evaluate(async () => (await fetch('/cart.js')).json()));
        assert.deepEqual(cart.items, [
          {
            key: 'ordinary-gift',
            variant_id: 999,
            quantity: 2,
            properties: { gift: true, note: 'Keep gift wrapping' },
          },
        ]);
      },
      { unknownOwned, opening: unknownOwned ? 'repair' : 'editable', clock: true },
    );
  });
}

test('failed fallback removal preserves review and never opens the native cart', async () => {
  await withRetainedBuyer(
    async ({ page, host, cartNavigations, mutations }) => {
      const before = await page.evaluate(async () => (await fetch('/cart.js')).json());
      let attempts = 0;
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/cart/update.js') attempts++;
      });
      await host.getByRole('button', { name: 'Review removing all customized items', exact: true }).click();
      assert.equal(attempts, 0, 'Opening removal review cannot mutate the cart');
      await page.route('**/cart/update.js', (route) =>
        route.fulfill({ status: 503, json: { error: 'Unknown cart update' } }),
      );
      await host.getByRole('button', { name: 'Confirm cart update', exact: true }).click();
      await host.locator('.cart-submit-error').waitFor();
      assert.equal(cartNavigations(), 0);
      assert.equal(attempts, 1, 'One confirmed update was attempted and failed');
      assert.equal(mutations(), 0, 'The original route recorded no successful mutation');
      assert.deepEqual(await page.evaluate(async () => (await fetch('/cart.js')).json()), before);
      assert.equal(
        await host.getByRole('heading', { name: 'Remaining customized items', exact: true }).isVisible(),
        true,
      );
      assert.equal(await host.getByRole('button', { name: 'Confirm cart update', exact: true }).isVisible(), true);
      assert.equal(await host.getByRole('button', { name: 'Cancel', exact: true }).isVisible(), true);
      assert.equal(await page.locator('iframe:not([hidden])').count(), 1);
    },
    { unknownOwned: true, opening: 'repair' },
  );
});
test('expired quote with changed terms keeps Add, shows the fresh price and requires another acceptance gesture', async () => {
  await withRetainedBuyer(
    async ({ page, host, proposals, accepts, proposalIds, configure }) => {
      await reviewRetained(host);
      await applyButton(host).waitFor();
      assert.equal(proposals.length, 1);
      const originalTotal = await host.locator('.footer-price strong').innerText();
      await host.locator('.review-pricing summary').click();
      assert.equal(originalTotal, '€90.00', 'the footer owns the full three-item design total');
      assert.equal(await host.locator('.review-pricing summary bdi').innerText(), '€30.00');
      assert.deepEqual(await host.locator('.review-costs dd').allTextContents(), ['€20.00', '€10.00']);
      assert.equal(await host.getByRole('region', { name: 'Design totals', exact: true }).count(), 0);
      assert.equal(await host.locator('.review-pricing').getByText(originalTotal, { exact: true }).count(), 0);
      const repriced = structuredClone(config);
      repriced.variants = repriced.variants.map((variant) => ({ ...variant, baseUnitMinor: '9000' }));
      configure(repriced);
      await page.clock.fastForward(61000);
      await applyButton(host).waitFor();
      assert.equal(proposals.length, 1, 'expiry dispatches no periodic proposal');
      assert.equal(await host.getByRole('button', { name: 'Retry', exact: true }).count(), 0);
      assert.equal(await applyButton(host).isEnabled(), true, 'Add stays available after proposal expiry');
      assert.equal(
        await host.locator('.footer-price strong').innerText(),
        originalTotal,
        'the last price stays visible',
      );
      assert.deepEqual(await host.locator('.review-costs dd').allTextContents(), ['€20.00', '€10.00']);
      await applyButton(host).click();
      await host.locator('.footer-price strong').filter({ hasText: '300.00' }).waitFor({ timeout: 3000 });
      await applyButton(host).waitFor();
      assert.equal(await host.locator('.cart-submit-error').count(), 0, 'refresh is not a cart failure');
      assert.equal(proposals.length, 2);
      assert.notEqual(proposalIds[1], proposalIds[0]);
      assert.equal(accepts.length, 0, 'changed terms are never accepted without another gesture');
      await applyButton(host).click();
      await host.getByRole('button', { name: 'View cart', exact: true }).waitFor();
      assert.equal(accepts.length, 1);
      assert.equal(proposals.length, 2);
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

test('expired quote with unchanged terms is re-proposed and added in the same click', async () => {
  await withRetainedBuyer(
    async ({ page, host, proposals, accepts, proposalIds }) => {
      await reviewRetained(host);
      await applyButton(host).waitFor();
      const originalTotal = await host.locator('.footer-price strong').innerText();
      await page.clock.fastForward(61000);
      await applyButton(host).waitFor();
      assert.equal(await host.locator('.footer-price strong').innerText(), originalTotal);
      await applyButton(host).click();
      await host.getByRole('button', { name: 'View cart', exact: true }).waitFor();
      assert.equal(proposals.length, 2, 'one fresh proposal replaced the expired one');
      assert.equal(accepts.length, 1, 'a single click accepted');
      assert.equal(new URL(page.url()).pathname, '/');
      assert.equal(required(accepts[0]).hash.length, 64);
      assert.notEqual(proposalIds[1], proposalIds[0]);
    },
    { clock: true },
  );
});

test('returning to the tab silently re-proposes an expired quote once', async () => {
  await withRetainedBuyer(
    async ({ page, host, proposals, accepts }) => {
      await reviewRetained(host);
      await applyButton(host).waitFor();
      const originalTotal = await host.locator('.footer-price strong').innerText();
      await page.clock.fastForward(61000);
      await applyButton(host).waitFor();
      assert.equal(proposals.length, 1);
      const busy: string[] = [];
      await page.exposeFunction('recordBusy', (label: string) => busy.push(label));
      await host.locator('body').evaluate((body) => {
        new MutationObserver(() => {
          const button = body.querySelector('.cart-button');
          if (button?.getAttribute('aria-busy') === 'true') void Reflect.get(window, 'recordBusy')(button.textContent);
        }).observe(body, { subtree: true, attributes: true, childList: true, characterData: true });
        document.dispatchEvent(new Event('visibilitychange'));
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await host.locator('.footer-price strong').filter({ hasText: originalTotal }).waitFor();
      for (let attempt = 0; attempt < 50 && proposals.length < 2; attempt++) await page.waitForTimeout(20);
      assert.equal(proposals.length, 2, 'repeated visibility events start one proposal');
      await applyButton(host).waitFor();
      assert.deepEqual(busy, [], 'an unchanged refresh never shows a busy footer');
      assert.equal(await host.locator('.footer-price strong').innerText(), originalTotal);
      assert.equal(accepts.length, 0, 'a refresh never accepts');
      await applyButton(host).click();
      await host.getByRole('button', { name: 'View cart', exact: true }).waitFor();
      assert.equal(proposals.length, 2, 'the refreshed proposal is accepted without another proposal');
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
      await applyButton(host).waitFor();
      assert.equal(proposals.length, 1, 'expiry dispatches no periodic proposal');
      editCart();
      const rejected = page.waitForResponse(
        (response) => response.url().endsWith('/cart-state') && response.status() === 409,
      );
      await applyButton(host).click();
      await rejected;
      await host.getByRole('heading', { name: 'Your customization needs review', exact: true }).waitFor();
      assert.equal(proposals.length, 1);
      assert.equal(accepts.length, 0);
      assert.equal(mutations(), 0);
    },
    { clock: true },
  );
});

async function withProductDesigner(
  cfg: BuyerConfig,
  run: (context: {
    page: Page;
    ui: FrameLocator;
    trigger: Locator;
    privateRequests: () => number;
    sessions: () => number;
  }) => Promise<void>,
  mobile = false,
  engine: typeof chromium = chromium,
  opening: 'editable' | 'unavailable' = 'editable',
) {
  const server = await createServer({
    plugins: [selectedFrameAssets()],
    server: { host: '127.0.0.1', port: 0, strictPort: true, watch: null },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await engine.launch({ headless: true });
    const page = await browser.newPage({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      hasTouch: mobile,
      reducedMotion: 'reduce',
    });
    const origin = `http://127.0.0.1:${serverPort(server.httpServer)}`;
    await prepareSelectedPage(page, origin);
    let privateRequests = 0;
    let sessions = 0;
    await page.route('**/cart.js', (route) => route.fulfill({ json: { items: [], currency: 'EUR' } }));
    await page.route('**/apps/insignia/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/config')) return route.fulfill({ json: cfg });
      // Opening an editable Designer warms the tab's session; it is not a private data request.
      if (path.endsWith('/sessions')) {
        sessions++;
        return route.fulfill({
          json: {
            capability: 'abc.def',
            sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
        });
      }
      // Settled quantities start the Designer's eager review 350 ms later. These cases stop before
      // Review, so its proposal stays unanswered (editing or closing cancels it) rather than racing.
      if (path.endsWith('/quote-proposals')) return new Promise<void>(() => {});
      privateRequests++;
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
    if (opening === 'unavailable') {
      await ui.getByRole('heading', { name: 'Unavailable', exact: true }).waitFor(firstLoad);
      assert.equal(await ui.locator('input,select,textarea').count(), 0);
      assert.equal(await ui.locator('.app').count(), 0);
      assert.equal(await ui.getByRole('button', { name: /Review removing/ }).count(), 0);
    } else await ui.locator('.app').waitFor(firstLoad);
    assert.equal(await page.locator('dialog[open]').isVisible(), true);
    assert.equal(await page.locator('dialog[open] > iframe').isVisible(), true);
    assert.equal(
      await page.locator('dialog[open] > div').evaluate((element) => element instanceof HTMLElement && element.hidden),
      true,
    );
    await run({ page, ui, trigger, privateRequests: () => privateRequests, sessions: () => sessions });
  } finally {
    await browser?.close();
    await server.close();
  }
}

test('Firefox opens the selected Designer when srcdoc has no document referrer', async () => {
  await withProductDesigner(
    config,
    async ({ page, ui }) => {
      assert.equal(await ui.locator('body').evaluate(() => document.referrer), '');
      await ui.getByRole('button', { name: 'Add artwork', exact: true }).waitFor();
      assert.equal(await page.locator('dialog:modal').count(), 1);
      assert.equal(
        await page.locator('dialog iframe').evaluate((frame) => getComputedStyle(frame).visibility),
        'visible',
      );
      await addDeferred(ui, 'Front');
      await ui.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      await ui.locator('input[inputmode=numeric]:enabled').first().fill('2');
      assert.equal(await ui.locator('input[inputmode=numeric]:enabled').first().inputValue(), '2');
    },
    false,
    firefox,
  );
});

for (const engine of [chromium, firefox])
  for (const result of ['USABLE', 'REJECTED'] as const)
    test(`${engine.name()}: selected artwork exposes real transfer/inspection and ${result.toLowerCase()} outcome`, async () => {
      await withProductDesigner(
        config,
        async ({ page, ui }) => {
          const assetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
          const expiresAt = new Date(Date.now() + 3600000).toISOString();
          let releaseUpload: () => void = () => {};
          const transferring = new Promise<void>((resolve) => {
            releaseUpload = resolve;
          });
          let inspected = false;
          await page.route('https://upload.example.test/original', async (route) => {
            await transferring;
            await route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' } });
          });
          await page.route('**/apps/insignia/guest**', (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path.endsWith('/guest'))
              return route.fulfill({
                json: { assetId, expiresAt, upload: { url: 'https://upload.example.test/original', headers: {} } },
              });
            if (path.endsWith('/complete')) return route.fulfill({ json: { state: 'QUEUED', expiresAt } });
            if (path.endsWith('/status'))
              return route.fulfill({ json: { state: inspected ? result : 'INSPECTING', expiresAt } });
            if (path.endsWith('/preview'))
              return route.fulfill({
                json: { url: 'https://preview.example/uploaded.png', width: 100, height: 100, expiresAt },
              });
            throw Error('Unexpected artwork operation');
          });
          await ui.getByRole('button', { name: 'Add artwork', exact: true }).click();
          await ui.getByRole('button', { name: 'Choose artwork Choose', exact: true }).click();
          await ui.locator('input[type=file]').setInputFiles({
            name: 'progress.png',
            mimeType: 'image/png',
            buffer: Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
              'base64',
            ),
          });
          await ui.getByRole('status').getByText('Uploading artwork…', { exact: true }).waitFor();
          assert.equal(await ui.getByRole('button', { name: 'browse files', exact: true }).count(), 0);
          assert.equal(await ui.getByRole('button', { name: 'Cancel upload', exact: true }).isEnabled(), true);
          assert.equal(await ui.locator('.upload-filename .file-name').getAttribute('title'), 'progress.png');
          assert.equal(await ui.locator('.upload-zone').getAttribute('aria-busy'), null);
          releaseUpload();
          await ui.getByRole('status').getByText('Checking artwork…', { exact: true }).waitFor();
          inspected = true;
          if (result === 'USABLE') {
            await ui.getByRole('button', { name: 'progress.png Change', exact: true }).waitFor();
            assert.equal(await ui.getByRole('dialog', { name: 'Artwork for Front', exact: true }).count(), 0);
          } else {
            await ui
              .getByRole('alert')
              .getByText('This image was rejected. Choose a supported static image.', { exact: true })
              .waitFor();
            assert.equal(await ui.getByRole('button', { name: 'progress.png Change', exact: true }).count(), 0);
            assert.equal(await ui.getByRole('button', { name: 'Choose another file', exact: true }).isEnabled(), true);
            assert.equal(await ui.getByRole('button', { name: 'Try again', exact: true }).count(), 0);
          }
        },
        false,
        engine,
      );
    });

test('#349: three rejected uploads, then a valid PNG is checked and applied through the live ports', async () => {
  await withProductDesigner(config, async ({ page, ui }) => {
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    const assets = new Map<string, string>();
    const begun: string[] = [];
    await page.route('https://upload.example.test/**', (route) =>
      route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' } }),
    );
    await page.route('**/apps/insignia/guest**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/guest')) {
        const assetId = `bbbbbbbb-bbbb-4bbb-8bbb-${String(begun.length + 1).padStart(12, '0')}`;
        begun.push(assetId);
        // The first server-checked file is the corrupt PNG; later ones are valid.
        assets.set(assetId, begun.length === 1 ? 'REJECTED' : 'USABLE');
        return route.fulfill({
          json: { assetId, expiresAt, upload: { url: `https://upload.example.test/${assetId}`, headers: {} } },
        });
      }
      const assetId = path.split('/').at(-2) ?? '';
      if (path.endsWith('/complete')) return route.fulfill({ json: { state: 'QUEUED', expiresAt } });
      if (path.endsWith('/status')) return route.fulfill({ json: { state: assets.get(assetId), expiresAt } });
      if (path.endsWith('/preview'))
        return route.fulfill({
          json: { url: 'https://preview.example/uploaded.png', width: 100, height: 100, expiresAt },
        });
      throw Error('Unexpected artwork operation');
    });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
      'base64',
    );
    await ui.getByRole('button', { name: 'Add artwork', exact: true }).click();
    await ui.getByRole('button', { name: 'Choose artwork Choose', exact: true }).click();
    const input = ui.locator('input[type=file]');
    for (const [file, message] of [
      [
        { name: 'corrupt.png', mimeType: 'image/png', buffer: Buffer.from('not a png') },
        'This image was rejected. Choose a supported static image.',
      ],
      [
        { name: 'huge-noise.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) },
        'This file is larger than 5 MiB. Try a smaller image.',
      ],
      [
        { name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') },
        'Choose a PNG, JPG or SVG image.',
      ],
    ] as const) {
      await input.setInputFiles(file);
      await ui.getByRole('alert').getByText(message, { exact: true }).waitFor();
    }
    await input.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
    await ui.getByRole('button', { name: 'logo.png Change', exact: true }).waitFor({ timeout: 10000 });
    assert.equal(await ui.getByRole('dialog', { name: 'Artwork for Front', exact: true }).count(), 0);
    assert.equal(begun.length, 2, 'client-rejected files never reach the server');
  });
});

test('#349: an artwork check that never finishes ends with a retryable message', async () => {
  await withProductDesigner(config, async ({ page, ui }) => {
    await page.clock.install();
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    let statusReads = 0;
    let finish = false;
    await page.route('https://upload.example.test/**', (route) =>
      route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' } }),
    );
    await page.route('**/apps/insignia/guest**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/guest'))
        return route.fulfill({
          json: {
            assetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            expiresAt,
            upload: { url: 'https://upload.example.test/original', headers: {} },
          },
        });
      if (path.endsWith('/complete')) return route.fulfill({ json: { state: 'QUEUED', expiresAt } });
      if (path.endsWith('/status')) {
        statusReads++;
        return route.fulfill({ json: { state: finish ? 'USABLE' : 'INSPECTING', expiresAt } });
      }
      if (path.endsWith('/preview'))
        return route.fulfill({
          json: { url: 'https://preview.example/uploaded.png', width: 100, height: 100, expiresAt },
        });
      throw Error('Unexpected artwork operation');
    });
    await ui.getByRole('button', { name: 'Add artwork', exact: true }).click();
    await ui.getByRole('button', { name: 'Choose artwork Choose', exact: true }).click();
    await ui.locator('input[type=file]').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
        'base64',
      ),
    });
    await ui.getByRole('status').getByText('Checking artwork…', { exact: true }).waitFor();
    const timedOut = ui
      .getByRole('alert')
      .getByText('Checking artwork is taking longer than expected. Try again.', { exact: true });
    // `false` only when the page closes first; never an unhandled rejection.
    const shown = timedOut.waitFor({ timeout: 0 }).then(
      () => true,
      () => false,
    );
    // Advance one status poll at a time, as a real slow check does. One 31 s jump also expires the
    // host page's 10 s per-request timeout while a real status read is in flight, which ends the
    // check as "could not be checked" instead of reaching the Designer's 30 s check limit.
    for (let advanced = 0; ; ) {
      const read = page.waitForRequest((request) => request.url().endsWith('/status'));
      await page.clock.runFor(2000);
      advanced += 2000;
      if (await Promise.race([shown, read.then(() => false)])) break;
      assert.ok(advanced <= 32000, 'the artwork check outlived its 30 s limit');
    }
    assert.ok(statusReads >= 1);
    finish = true;
    // Retrying the same file starts a fresh check, which now finishes.
    await ui.getByRole('button', { name: 'Try again', exact: true }).click();
    await ui.getByRole('button', { name: 'logo.png Change', exact: true }).waitFor();
  });
});

test('reopening resumes the selected Designer without a developer host page', async () => {
  await withProductDesigner(config, async ({ page, ui, trigger }) => {
    // Start from the eager review's held proposal every time instead of racing the close against it.
    const eager = page.waitForRequest('**/apps/insignia/v1/quote-proposals');
    await addDeferred(ui, 'Front');
    await ui.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    await ui.locator('input[inputmode=numeric]:enabled').first().fill('3');
    const proposal = await eager;
    const cancelled = page.waitForEvent('requestfailed', (request) => request === proposal);
    await ui.getByRole('button', { name: 'Close customizer', exact: true }).click();
    await ui.getByRole('heading', { name: 'Close customization?', exact: true }).waitFor();
    await ui.getByRole('button', { name: 'Keep editing', exact: true }).click();
    assert.equal(await ui.locator('input[inputmode=numeric]:enabled').first().inputValue(), '3');
    await ui.getByRole('button', { name: 'Close customizer', exact: true }).click();
    await ui.getByRole('button', { name: 'Close customization', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('dialog:modal') === null);
    await cancelled; // closing retires the speculative proposal
    await trigger.click();
    await ui.locator('.app').waitFor();
    assert.equal(await ui.locator('input[inputmode=numeric]:enabled').first().inputValue(), '3');
    assert.equal(await ui.getByRole('button', { name: 'Personalise', exact: true }).count(), 0);
    assert.equal(await ui.getByRole('button', { name: 'Start a new design', exact: true }).count(), 0);
  });
});

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
    const quantity = ui.locator('input[inputmode=numeric]:enabled').first();
    await quantity.fill('3');
    await ui.getByRole('button', { name: 'Close customizer', exact: true }).click();
    await ui.getByRole('button', { name: 'Close customization', exact: true }).click();
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
      // The page resize reaches the frame asynchronously on a loaded runner, and Chromium can keep the
      // old 100dvh on existing elements for a few frames after the frame itself reports 844.
      const resized = () =>
        innerWidth === 390 && innerHeight === 844 && Math.round(app.getBoundingClientRect().height) === 844;
      for (const deadline = Date.now() + 10000; !resized(); ) {
        if (Date.now() > deadline)
          throw new Error(`Layout stayed ${innerWidth}x${innerHeight}, app ${app.getBoundingClientRect().height}`);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
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
    await ui.getByRole('heading', { name: 'Close customization?', exact: true }).waitFor();
    await ui.getByRole('button', { name: 'Close customization', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('iframe')?.hidden === true);
    await trigger.click();
    await ui.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    assert.equal(await quantity.inputValue(), '3');
  });
});

for (const engine of [chromium, firefox]) {
  for (const ordering of ['before', 'after'] as const) {
    test(`${engine.name()} failure recovery autofocus ${ordering} a newer keyboard focus choice`, async () => {
      await withProductDesigner(
        config,
        async ({ page, ui, trigger, privateRequests }) => {
          await ui.getByRole('button', { name: 'Add artwork', exact: true }).click();
          const opener = positionCard(ui, 'Front').locator('.artwork-choice');
          await opener.click();
          const zone = ui.locator('.upload-zone');
          await zone.evaluate((element) => {
            const native = window.requestAnimationFrame.bind(window);
            const pending: FrameRequestCallback[] = [];
            // Gate only recovery autofocus; Preact's effect scheduler must keep running.
            window.requestAnimationFrame = (callback) =>
              native((time) => {
                if (callback.toString().includes('.upload-failure-actions')) {
                  pending.push(() => callback(time));
                  element.setAttribute('data-failure-frame-pending', 'true');
                } else callback(time);
              });
            element.addEventListener(
              'release-failure-frame',
              () => {
                window.requestAnimationFrame = native;
                for (const callback of pending.splice(0)) callback(0);
              },
              { once: true },
            );
            const transfer = new DataTransfer();
            transfer.items.add(new File(['unsupported'], 'notes.txt', { type: 'text/plain' }));
            element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
          });
          await ui.locator('.upload-zone[data-failure-frame-pending]').waitFor();
          const dialog = ui.locator('dialog[open]');
          const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
          const later = dialog.getByRole('button', { name: 'Provide artwork later', exact: true });
          const release = () => zone.dispatchEvent('release-failure-frame');
          const focused = () =>
            dialog.evaluate(() => {
              const element = document.activeElement;
              return element?.getAttribute('aria-label') || element?.textContent?.trim() || element?.tagName;
            });
          if (ordering === 'before') {
            await release();
            assert.equal(await focused(), 'Choose another file');
          }
          await later.focus();
          await close.focus();
          if (ordering === 'after') await release();
          assert.equal(
            await focused(),
            'Close dialog',
            `${engine.name()} ${ordering}: recovery must yield to newer focus`,
          );
          await page.keyboard.press('Shift+Tab');
          assert.equal(await focused(), 'Provide artwork later');
          await page.keyboard.press('Tab');
          assert.equal(await focused(), 'Close dialog');
          await page.keyboard.press('Escape');
          await dialog.waitFor({ state: 'detached' });
          await positionCard(ui, 'Front').locator('.artwork-choice:focus').waitFor();
          assert.equal(await opener.evaluate((element) => document.activeElement === element), true);
          assert.equal(privateRequests(), 0);
          await opener.click();
          await ui.getByRole('button', { name: 'Provide artwork later', exact: true }).click();
          await ui.getByRole('button', { name: 'Choose quantities', exact: true }).click();
          const quantity = ui.locator('input[inputmode=numeric]:enabled').first();
          await quantity.fill('3');
          await ui.getByRole('button', { name: 'Close customizer', exact: true }).click();
          await ui.getByRole('button', { name: 'Close customization', exact: true }).click();
          await page.waitForFunction(() => document.querySelector('iframe')?.hidden === true);
          await trigger.click();
          await ui.locator('.app').waitFor();
          assert.equal(await quantity.inputValue(), '3');
        },
        true,
        engine,
      );
    });
  }
}

test('selected mobile artwork dialog rejects unsupported files locally and real photo views retain the current design', async () => {
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
      // Upload failure schedules focus after rendering, before the keyboard-wrap check takes focus.
      await dialog.locator('.upload-failure-actions button:focus').waitFor();
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
      const viewSelect = ui.getByRole('combobox', { name: 'Product view', exact: true });
      await viewSelect.selectOption({ label: 'back' });
      assert.equal(await viewSelect.locator('option:checked').innerText(), 'back');
      await viewSelect.selectOption({ label: 'front' });
      await positionCard(ui, 'Front').getByText('Artwork to follow', { exact: true }).first().waitFor();
      await ui.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      assert.equal(await ui.locator('input[inputmode=numeric]:enabled').first().isVisible(), true);
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
    const proposals: string[] = [];
    let cartWrites = 0;
    await page.route('**/cart/{add,update,change,clear}.js', (route) => {
      cartWrites++;
      return route.fulfill({ status: 500, json: { error: 'unexpected' } });
    });
    await page.route('**/apps/insignia/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/config'))
        return route.fulfill({ json: { ...config, revisionId: 'new-publication', contentHash: 'f'.repeat(64) } });
      // The proposal and draft save no longer wait for the config read; the server rejects the
      // stale revision and the fresh config takes precedence in the Designer.
      if (path.endsWith('/quote-proposals') || /\/designs\/[a-f0-9-]+$/.test(path)) {
        proposals.push(path);
        return route.fulfill({ status: 409, json: { code: 'REVIEW_REQUIRED', error: 'changed' } });
      }
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
    await ui.locator('input[inputmode=numeric]:enabled').first().fill('1');
    await ui.getByRole('button', { name: 'Review', exact: true }).last().click();
    await ui.getByRole('heading', { name: 'Unavailable', exact: true }).waitFor();
    assert.equal(
      await ui.getByRole('button', { name: 'Review removing all customized items', exact: true }).count(),
      0,
    );
    assert.equal(writes, 0, 'revision drift accepts nothing');
    assert.equal(cartWrites, 0, 'revision drift does not alter the cart');
  });
});

test('missing critical physical production facts require repair without issuing editable defaults', async () => {
  const cfg = structuredClone(config);
  delete required(cfg.geometry.views[0]).image;
  delete required(cfg.geometry.steps[0]).physicalMm;
  await withProductDesigner(
    cfg,
    async ({ ui, privateRequests, sessions }) => {
      await ui.getByRole('heading', { name: 'Unavailable', exact: true }).waitFor();
      assert.equal(await ui.getByRole('button', { name: 'Add artwork', exact: true }).count(), 0);
      assert.equal(privateRequests(), 0);
      assert.equal(sessions(), 0, 'an unavailable Designer warms no session');
    },
    false,
    chromium,
    'unavailable',
  );
});

test('unavailable-state removal succeeds in a tab whose earlier unknown write was retired (N2)', async () => {
  const server = await createServer({
    plugins: [selectedFrameAssets()],
    server: { host: '127.0.0.1', port: 0, strictPort: true, watch: null },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const origin = `http://127.0.0.1:${serverPort(server.httpServer)}`;
    await prepareSelectedPage(page, origin);
    let items: AjaxItem[] = [
      { key: 'custom', variant_id: 222, quantity: 1, properties: { _insignia_line_v3: v3Carrier('222') } },
    ];
    let updates = 0;
    await page.route('**/cart.js', (route) => route.fulfill({ json: { items, attributes: {}, currency: 'EUR' } }));
    await page.route('**/cart/update.js', (route) => {
      updates++;
      const body = ajaxBody(route.request().postDataJSON());
      items = items.filter((item) => body.updates?.[item.key] !== 0);
      return route.fulfill({ json: { items, attributes: {}, currency: 'EUR' } });
    });
    // No configuration at all: only the unavailable Designer's observed removal is offered.
    await page.route('**/apps/insignia/v1/config**', (route) => route.fulfill({ status: 503, json: {} }));
    await installDesignBoundary(page);
    await page.goto(origin);
    await page.evaluate(() => {
      // An unrelated abandoned set's tombstone stays for the session (late_effects_possible on every success).
      const tombstone = 'c'.repeat(64);
      sessionStorage.setItem(
        'insignia-cart-intent-v1',
        JSON.stringify({
          version: 1,
          phase: 'abandoned',
          before: tombstone,
          goal: tombstone,
          quote: tombstone,
          abandoned: [tombstone],
        }),
      );
      sessionStorage.setItem('insignia-cart-unresolved-v2', '1');
      const buyer = document.createElement('insignia-buyer');
      buyer.setAttribute('product-id', '111');
      buyer.setAttribute('country', 'NL');
      buyer.setAttribute('market-id', '42');
      document.body.append(buyer);
    });
    await page.locator('insignia-buyer').getByRole('button', { name: 'Customize this product' }).click();
    const ui = page.frameLocator('iframe:not([hidden])');
    await ui.getByRole('button', { name: 'Review removing all customized items', exact: true }).click();
    await ui.getByRole('button', { name: 'Confirm cart update', exact: true }).click();
    await page
      .locator('dialog[open]')
      .waitFor({ state: 'detached', timeout: 5000 })
      .catch(() => {});
    assert.equal(updates, 1);
    assert.deepEqual(items, []);
    assert.equal(await ui.getByRole('alert').count(), 0, 'the confirmed removal is not reported as a failure');
    assert.equal(await page.locator('dialog[open]').count(), 0, 'the Designer closes after the removal');
  } finally {
    await browser?.close();
    await server.close();
  }
});

test('lost optional captured product preview keeps valid production choices and explicit authoritative quote review available', async () => {
  const cfg = structuredClone(config);
  cfg.imageUrls = {};
  await withProductDesigner(cfg, async ({ page, ui }) => {
    await ui.locator('svg.garment-photo').waitFor();
    assert.equal(
      await ui.locator('img.garment-photo').count(),
      0,
      'the baseline illustration fallback does not invent a photograph',
    );
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
    await ui.locator('input[inputmode=numeric]:enabled').first().fill('2');
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

test('an expired product preview renews only media from the same publication without losing the design', async () => {
  await withProductDesigner(config, async ({ page, ui }) => {
    await addDeferred(ui, 'Front');
    let reads = 0;
    await page.route('**/apps/insignia/v1/config*', (route) => {
      reads++;
      return route.fulfill({
        json: {
          ...config,
          imageUrls: { photo: 'https://preview.example/renewed.png' },
          variants: config.variants.map((variant) => ({ ...variant, baseUnitMinor: '9999' })),
        },
      });
    });
    await page.route('https://preview.example/fixture.png*', (route) => route.fulfill({ status: 410 }));
    await ui.locator('img.garment-photo').evaluate((image) => {
      image.setAttribute('src', `${image.getAttribute('src')}?expired=1`);
    });
    await ui.locator('img.garment-photo[src="https://preview.example/renewed.png"]').waitFor();
    await positionCard(ui, 'Front').getByText('Artwork to follow', { exact: true }).first().waitFor();
    assert.equal(reads, 1);
    await ui.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    await ui.locator('input[inputmode=numeric]:enabled').first().fill('2');
    assert.equal(await ui.getByText('€99.99', { exact: true }).count(), 0);
  });
});

test('opening immediately shows a cancellable modal and reconnecting during configuration can open again', async () => {
  await withProductDesigner(config, async ({ page, ui, trigger }) => {
    await ui.getByRole('button', { name: 'Close customizer', exact: true }).click();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/apps/insignia/v1/config*', async (route) => {
      await held;
      await route.fulfill({ json: config }).catch(() => {});
    });
    await page.evaluate(() => {
      const buyer = document.querySelector('insignia-buyer');
      buyer?.remove();
      if (buyer) document.body.append(buyer);
    });
    await trigger.click();
    await page.getByRole('status').waitFor();
    assert.equal(await page.locator('dialog:modal').count(), 1);
    assert.equal(await page.locator('iframe').count(), 0);
    await page.evaluate(() => {
      const buyer = document.querySelector('insignia-buyer');
      buyer?.remove();
      if (buyer) document.body.append(buyer);
    });
    assert.equal(await page.locator('dialog:modal').count(), 0);
    release();
    await trigger.click();
    await ui.locator('.app').waitFor();
    await ui.getByRole('button', { name: 'Close customizer', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('iframe')?.hidden === true);
    assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '');
  });
});

test('a failed frame asset shows a bounded retry state and Retry opens the selected Designer', async () => {
  await withProductDesigner(config, async ({ page, ui, trigger }) => {
    await ui.getByRole('button', { name: 'Close customizer', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('iframe')?.hidden === true);
    await page.clock.install();
    await page.route('**/insignia-designer-frame.js', (route) => route.abort('failed'));
    await page.evaluate(() => {
      const buyer = document.querySelector('insignia-buyer');
      buyer?.remove();
      if (buyer) document.body.append(buyer);
    });
    await trigger.click();
    await page.locator('dialog:modal > iframe[srcdoc]').waitFor({ state: 'attached' });
    await page.clock.fastForward(11000);
    await page.getByRole('alert').waitFor();
    await page.unroute('**/insignia-designer-frame.js');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await ui.locator('.app').waitFor();
    assert.equal(await page.locator('dialog:modal').count(), 1);
    assert.equal(await page.locator('iframe').count(), 1);
  });
});

test('a failed selected stylesheet stays behind startup recovery until a styled retry succeeds', async () => {
  await withProductDesigner(config, async ({ page, ui, trigger }) => {
    await ui.getByRole('button', { name: 'Close customizer', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('iframe')?.hidden === true);
    await page.clock.install();
    await page.route('**/insignia-designer.css', (route) => route.abort('failed'));
    await page.evaluate(() => {
      const buyer = document.querySelector('insignia-buyer');
      buyer?.remove();
      if (buyer) document.body.append(buyer);
    });
    await trigger.click();
    await page.locator('dialog:modal > iframe[srcdoc]').waitFor({ state: 'attached' });
    await page.clock.fastForward(11000);
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('iframe').evaluate((frame) => getComputedStyle(frame).visibility), 'hidden');
    await page.unroute('**/insignia-designer.css');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await ui.locator('.app').waitFor();
    assert.equal(await ui.locator('.app').evaluate((app) => getComputedStyle(app).display), 'flex');
  });
});

test('switching a dirty cart design offers the baseline cancel/discard decision and never mutates the cart', async () => {
  await withRetainedBuyer(
    async ({ page, trigger, host, mutations, accepts }) => {
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      await host.locator('input[inputmode=numeric]:enabled').first().fill('4');
      await host.getByRole('button', { name: 'Review', exact: true }).last().click();
      await host.getByRole('region', { name: 'Design totals', exact: true }).waitFor();
      await host
        .getByRole('region', { name: 'Design totals', exact: true })
        .getByRole('button', { name: /^Other synthetic shirt\b/ })
        .click();
      await host.getByRole('dialog', { name: 'Discard changes?', exact: true }).waitFor();
      assert.equal(await host.locator('.app').count(), 1, 'the selected view remains behind its confirmation');
      assert.equal(await host.locator('.app').isVisible(), true);
      assert.equal(await host.locator('.app').getAttribute('inert'), '');
      await page.keyboard.press('Escape');
      await host.getByRole('button', { name: 'Edit quantities', exact: true }).click();
      assert.equal(await host.locator('input[inputmode=numeric]:enabled').first().inputValue(), '4');
      await host.getByRole('button', { name: 'Review', exact: true }).last().click();
      await host.getByRole('region', { name: 'Design totals', exact: true }).waitFor();
      await host
        .getByRole('region', { name: 'Design totals', exact: true })
        .getByRole('button', { name: /^Other synthetic shirt\b/ })
        .click();
      await host.getByRole('button', { name: 'Discard and edit', exact: true }).click();
      await host.getByRole('heading', { name: 'Other synthetic shirt', exact: true }).waitFor();
      await reviewRetained(host);
      await host.getByRole('region', { name: 'Design totals', exact: true }).waitFor();
      await host
        .getByRole('region', { name: 'Design totals', exact: true })
        .getByRole('button', { name: /^Synthetic shirt\b/ })
        .click();
      await host.getByRole('button', { name: 'Choose quantities', exact: true }).click();
      assert.equal(
        await host.locator('input[inputmode=numeric]:enabled').first().inputValue(),
        '3',
        'discard restores the accepted cart quantity, never the staged dirty draft',
      );
      assert.equal(mutations(), 0);
      assert.equal(accepts.length, 0);
    },
    { multipleProducts: true },
  );
});

test('an owned selection made during pending review remains editable after the final quote arrives', async () => {
  await withRetainedBuyer(
    async ({ host, accepts, mutations }) => {
      await host.locator('body').evaluate(() => {
        addEventListener('message', (event) => {
          if (
            event.source !== parent ||
            event.origin !== parent.location.origin ||
            event.data?.channel !== window.name ||
            event.data.type !== 'insignia:designer:quote'
          )
            return;
          if (event.data.quote.totalMinor === undefined)
            window.pendingOtherSelection = event.data.quote.groups.find(
              (group: { label: string; id: string }) => group.label === 'Other synthetic shirt',
            )?.id;
        });
      });
      await reviewRetained(host);
      await applyButton(host).waitFor();
      const id = await host.locator('body').evaluate(() => window.pendingOtherSelection);
      assert(id);
      await host.locator('body').evaluate((_body, selected) => {
        parent.postMessage(
          { type: 'insignia:designer:select-group', channel: window.name, id: selected },
          parent.location.origin,
        );
      }, id);
      await host.getByRole('heading', { name: 'Other synthetic shirt', exact: true }).waitFor();
      assert.equal(accepts.length, 0);
      assert.equal(mutations(), 0);
    },
    { multipleProducts: true },
  );
});

test('switching an unchanged cart design skips discard confirmation and disconnect aborts its loading modal', async () => {
  await withRetainedBuyer(
    async ({ page, host, trigger, proposals, mutations }) => {
      await reviewRetained(host);
      await host.getByRole('region', { name: 'Design totals', exact: true }).waitFor();
      await page.route('**/apps/insignia/v1/config*', (route) =>
        new URL(route.request().url()).searchParams.get('productId') === '333'
          ? new Promise<void>(() => {})
          : route.fallback(),
      );
      const requesting = page.waitForRequest(
        (request) => new URL(request.url()).searchParams.get('productId') === '333',
      );
      await host
        .getByRole('region', { name: 'Design totals', exact: true })
        .getByRole('button', { name: /^Other synthetic shirt\b/ })
        .click();
      await requesting;
      assert.equal(await host.getByRole('dialog', { name: 'Discard changes?', exact: true }).count(), 0);
      await page.getByRole('status').waitFor();
      const aborted = page.waitForEvent(
        'requestfailed',
        (request) => new URL(request.url()).searchParams.get('productId') === '333',
      );
      await page.locator('insignia-buyer').evaluate((buyer) => buyer.remove());
      await aborted;
      assert.equal(await page.locator('dialog:modal').count(), 0);
      assert.equal(await page.locator('iframe').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '');
      assert.equal(mutations(), 0);
    },
    { multipleProducts: true },
  );
});

test('an option-only change after lost acceptance requires distinct reviewed terms and cannot reuse old authorization', async () => {
  await withRetainedBuyer(
    async ({ page, host, accepts, proposals, failAcceptance, mutations }) => {
      await page.evaluate(() => {
        window.observedCartRequests = [];
        window.addEventListener('message', (event) => {
          if (
            event.origin === location.origin &&
            event.data?.type === 'insignia:designer:request' &&
            event.data.action === 'commit'
          )
            window.observedCartRequests.push(event.data.request);
        });
      });
      await reviewRetained(host);
      failAcceptance(true);
      await applyButton(host).click();
      await host.locator('.cart-submit-error').waitFor();
      assert.equal(accepts.length, 1);
      assert.equal(mutations(), 0);
      failAcceptance(false);
      await host.getByRole('button', { name: 'Edit quantities', exact: true }).click();
      await host.getByLabel('Packing', { exact: true }).selectOption({ label: 'Gift' });
      await host.getByRole('button', { name: 'Review', exact: true }).last().click();
      await applyButton(host).click();
      await host.getByRole('button', { name: 'View cart', exact: true }).waitFor();
      assert.equal(accepts.length, 2);
      assert.notEqual(accepts[0]?.idempotencyKey, accepts[1]?.idempotencyKey);
      assert.deepEqual(proposals[0]?.groups[0]?.design.options, [{ optionId: 'packing', valueId: 'plain' }]);
      assert.deepEqual(proposals[1]?.groups[0]?.design.options, [{ optionId: 'packing', valueId: 'gift' }]);
      const frame = page.frameLocator('iframe');
      const seen = await page.evaluate(() => window.observedCartRequests);
      const last = seen.at(-1);
      assert(last);
      const denied = await frame.locator('body').evaluate(
        async (_body, request) => {
          const origin = new URL(document.referrer).origin;
          return new Promise<boolean>((resolve, reject) => {
            const timeout = setTimeout(() => reject(Error('Missing guarded receipt')), 5000);
            const listener = (event: MessageEvent) => {
              if (
                event.source !== parent ||
                event.origin !== origin ||
                event.data?.channel !== window.name ||
                event.data.id !== 'changed-cached-attempt'
              )
                return;
              clearTimeout(timeout);
              removeEventListener('message', listener);
              resolve(event.data.ok);
            };
            addEventListener('message', listener);
            parent.postMessage(
              {
                type: 'insignia:designer:request',
                channel: window.name,
                id: 'changed-cached-attempt',
                action: 'commit',
                request,
              },
              origin,
            );
          });
        },
        { ...last, requestId: 'changed-cached-ui', design: { ...last.design, options: seen[0]?.design.options } },
      );
      assert.equal(denied, false);
    },
    { productionOptions: true },
  );
});

declare global {
  interface Window {
    observedCartRequests: ObservedCartRequest[];
    pendingOtherSelection?: string;
  }
}
