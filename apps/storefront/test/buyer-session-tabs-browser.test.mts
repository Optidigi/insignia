import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BrowserContext, FrameLocator, Page } from 'playwright';
import { chromium } from 'playwright';
import type { BuyerConfig, DesiredGroup } from '../src/buyer.ts';
import {
  type AjaxItem,
  createStorefrontTestServer as createServer,
  lineCarriers,
  record,
  required,
  selectedFrameAssets,
  serverPort,
} from './support.mts';

/**
 * #340: the buyer capability is shared by every tab of one browser, as the Shopify cart is. A cart line
 * accepted under a session this browser no longer holds is reported as an earlier session's, and the
 * buyer can keep it.
 */
const SESSION_KEY = 'insignia-buyer-session:/apps/insignia';
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
/** Design A, already in the cart. */
const cartGroup: DesiredGroup = {
  productId: '111',
  configRevisionId: 'r1',
  revisionContentHash: 'a'.repeat(64),
  design: {
    placements: [
      { placementId: 'front', methodId: 'print', stepId: 'small', artwork: { kind: 'deferred', intentId: 'a' } },
    ],
    options: [],
  },
  variants: [{ variantId: '222', quantity: 3 }],
};
const carrierA = required(lineCarriers([{ variantId: '222', unitMinor: '3000' }], { set: 9 }).carriers[0]);

/** A shared fake buyer API: sets are owned by the capability that accepted them, like `cartState`. */
async function withStorefront(
  run: (fixture: {
    context: BrowserContext;
    origin: string;
    openPage(): Promise<Page>;
    sessions(): number;
    cartStateCapabilities: string[];
    proposals: number[];
    items: AjaxItem[];
    owners: Map<string, string>;
    /** Carriers whose signed validity has certainly ended (the server reads it from the header). */
    expired: Set<string>;
  }) => Promise<void>,
) {
  const server = await createServer({
    plugins: [selectedFrameAssets()],
    server: { host: '127.0.0.1', port: 0, strictPort: true, watch: null },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const origin = `http://127.0.0.1:${serverPort(server.httpServer)}`;
    let minted = 0;
    const cartStateCapabilities: string[] = [];
    const proposals: number[] = [];
    const owners = new Map<string, string>();
    const expired = new Set<string>();
    const items: AjaxItem[] = [
      { key: 'ordinary', variant_id: 999, quantity: 1, properties: {} },
      { key: 'custom-a', variant_id: 222, quantity: 3, properties: { _insignia_line_v3: carrierA } },
    ];
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'),
    );
    await context.route('**/cart.js', (route) =>
      route.fulfill({
        json: { items: items.map((item) => ({ ...item, product_id: 111 })), attributes: {}, currency: 'EUR' },
      }),
    );
    await context.route('**/cart', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<main><h1>Native cart</h1></main>' }),
    );
    await context.route('**/apps/insignia/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      const body = record(route.request().postData() ? route.request().postDataJSON() : {});
      if (path.endsWith('/config')) return route.fulfill({ json: config });
      if (path.endsWith('/sessions')) {
        minted++;
        return route.fulfill({
          json: {
            capability: `cap${minted}.def`,
            sessionId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(minted).padStart(12, '0')}`,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
        });
      }
      if (path.endsWith('/cart-state')) {
        cartStateCapabilities.push(String(body.capability));
        const lines = (body.lines as { properties: Record<string, string> }[]) ?? [];
        const owned = lines.every((line) => owners.get(line.properties._insignia_line_v3 ?? '') === body.capability);
        return owned
          ? route.fulfill({ json: { groups: [cartGroup], repairRequired: false } })
          : route.fulfill({
              status: 409,
              json: {
                code: 'REVIEW_REQUIRED',
                message: 'Prices or selections changed. Review the complete customization again.',
                requestId: 'r',
                details: {
                  reason: lines.some((line) => expired.has(line.properties._insignia_line_v3 ?? ''))
                    ? 'NOT_OWNED_EXPIRED'
                    : 'NOT_OWNED',
                },
              },
            });
      }
      if (path.endsWith('/quote-proposals')) {
        const groups = (body.groups as unknown[]) ?? [];
        proposals.push(groups.length);
        return route.fulfill({
          json: {
            proposalId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            hash: 'b'.repeat(64),
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            currency: 'EUR',
            exponent: 2,
            customizedQuantity: 3 * groups.length,
            totalMinor: String(9000 * groups.length),
            groups: groups.map(() => ({
              productId: '111',
              quantity: 3,
              setupMinor: '0',
              customizationUnitMinor: '1000',
              baseTotalMinor: '6000',
              totalMinor: '9000',
            })),
            changedGroups: [],
          },
        });
      }
      if (/\/designs\/[a-f0-9-]+\/restore$/.test(path))
        return route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: 'Not found', requestId: 'r' } });
      if (/\/designs\/[a-f0-9-]+$/.test(path))
        return route.fulfill({ json: { id: path.split('/').at(-1), version: 1, value: body.group } });
      return route.fulfill({ status: 500, json: { code: 'UNAVAILABLE', message: 'unexpected', requestId: 'r' } });
    });
    await context.route('https://preview.example/**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
          'base64',
        ),
      }),
    );
    await run({
      context,
      origin,
      async openPage() {
        const page = await context.newPage();
        page.setDefaultTimeout(7000);
        // The first load compiles the storefront and Designer on demand; a loaded runner needs longer.
        page.setDefaultNavigationTimeout(30_000);
        await page.goto(origin);
        return page;
      },
      sessions: () => minted,
      cartStateCapabilities,
      proposals,
      items,
      owners,
      expired,
    });
  } finally {
    await browser?.close();
    await server.close();
  }
}

async function openDesigner(page: Page, attributes: Record<string, string> = {}): Promise<FrameLocator> {
  await page.evaluate((attributes) => {
    const host = document.createElement('insignia-buyer');
    host.setAttribute('product-id', '111');
    host.setAttribute('country', 'NL');
    host.setAttribute('market-id', '42');
    for (const [name, value] of Object.entries(attributes)) host.setAttribute(name, value);
    document.body.append(host);
  }, attributes);
  await page.locator('insignia-buyer').getByRole('button').first().click();
  return page.frameLocator('iframe:not([hidden])');
}

async function buildToReview(ui: FrameLocator) {
  await ui.locator('.app').waitFor();
  await ui.getByRole('button', { name: 'Add artwork', exact: true }).first().click();
  const card = ui.locator('article.print-card').first();
  const heading = card.locator('.print-card-heading');
  if ((await heading.getAttribute('aria-expanded')) === 'false') await heading.click();
  await card.locator('.artwork-choice').click();
  await ui.getByRole('button', { name: 'Provide artwork later', exact: true }).click();
  await ui.getByRole('button', { name: 'Choose quantities', exact: true }).click();
  await ui.locator('input[inputmode=numeric]:enabled').first().fill('3');
  await ui.getByRole('button', { name: 'Review', exact: true }).last().click();
}

async function expectEventually(check: () => boolean | Promise<boolean>, message: string) {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    if (Date.now() > deadline) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test('a second and a later new tab reuse the first tab session and review its customized cart lines', async () => {
  await withStorefront(async ({ openPage, sessions, cartStateCapabilities, proposals, owners }) => {
    const first = await openPage();
    await (await openDesigner(first)).locator('.app').waitFor();
    await expectEventually(() => sessions() === 1, 'the open Designer creates one session');
    // Tab X added design A under its session.
    owners.set(carrierA, 'cap1.def');

    const second = await openPage();
    const ui = await openDesigner(second);
    await buildToReview(ui);
    await ui.getByText('€180.00', { exact: true }).filter({ visible: true }).first().waitFor();
    assert.equal(await ui.getByRole('heading', { name: 'Your customization needs review' }).count(), 0);
    assert.deepEqual(proposals.at(-1), 2, 'the review covers the cart design and the new one');
    assert.equal(sessions(), 1, 'the second tab mints no session of its own');

    await first.close();
    await second.close();
    const later = await openPage();
    const reopened = await openDesigner(later);
    await buildToReview(reopened);
    await reopened.getByText('€180.00', { exact: true }).filter({ visible: true }).first().waitFor();
    assert.equal(sessions(), 1, 'a new tab after the others closed still holds the same session');
    assert.ok(cartStateCapabilities.length >= 2);
    assert.ok(cartStateCapabilities.every((capability) => capability === 'cap1.def'));
  });
});

test('an expired stored session is replaced, and its cart lines offer an earlier-session path that keeps them', async () => {
  await withStorefront(async ({ openPage, sessions, items, owners }) => {
    owners.set(carrierA, 'cap0.def');
    const page = await openPage();
    await page.evaluate(
      (key) =>
        localStorage.setItem(
          key,
          JSON.stringify({
            capability: 'cap0.def',
            sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000000',
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          }),
        ),
      SESSION_KEY,
    );
    const ui = await openDesigner(page);
    await buildToReview(ui);
    await ui.getByRole('heading', { name: 'Customized in an earlier session', exact: true }).waitFor();
    assert.equal(sessions(), 1);
    const stored = await page.evaluate((key) => localStorage.getItem(key), SESSION_KEY);
    assert.equal(record(JSON.parse(required(stored))).capability, 'cap1.def', 'the expired capability is replaced');
    assert.equal(
      await ui.getByText('Calculating quote…').filter({ visible: true }).count(),
      0,
      'no pending quote is left on screen',
    );
    assert.equal(await ui.getByRole('button', { name: 'Retry', exact: true }).count(), 0, 'retrying cannot help');
    assert.equal(
      await ui.getByRole('button', { name: 'Review removing all customized items', exact: true }).count(),
      1,
    );
    await Promise.all([page.waitForURL('**/cart'), ui.getByRole('button', { name: 'View cart', exact: true }).click()]);
    assert.deepEqual(
      items.map((item) => item.key),
      ['ordinary', 'custom-a'],
      'the earlier session lines stay in the cart',
    );
  });
});

test('the cart-page review of an earlier session cart offers the same path that keeps the lines', async () => {
  await withStorefront(async ({ openPage, items }) => {
    const page = await openPage();
    const ui = await openDesigner(page, { repair: '' });
    await ui.getByRole('heading', { name: 'Customized in an earlier session', exact: true }).waitFor();
    assert.equal(await ui.getByRole('button', { name: 'Retry', exact: true }).count(), 0);
    await Promise.all([page.waitForURL('**/cart'), ui.getByRole('button', { name: 'View cart', exact: true }).click()]);
    assert.deepEqual(
      items.map((item) => item.key),
      ['ordinary', 'custom-a'],
    );
  });
});

test('a capability the server rejects is cleared from shared storage, not kept for other tabs', async () => {
  await withStorefront(async ({ context, openPage, sessions }) => {
    await context.route('**/apps/insignia/v1/cart-state', (route) =>
      record(route.request().postDataJSON()).capability === 'revoked.def'
        ? route.fulfill({ status: 401, json: { code: 'UNAUTHORIZED', message: 'Unauthorized', requestId: 'r' } })
        : route.fallback(),
    );
    const page = await openPage();
    await page.evaluate(
      (key) =>
        localStorage.setItem(
          key,
          JSON.stringify({
            capability: 'revoked.def',
            sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000000',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          }),
        ),
      SESSION_KEY,
    );
    const ui = await openDesigner(page);
    await buildToReview(ui);
    await ui.getByRole('heading', { name: 'Customized in an earlier session', exact: true }).waitFor();
    assert.equal(sessions(), 1);
    const other = await openPage();
    const stored = await other.evaluate((key) => localStorage.getItem(key), SESSION_KEY);
    assert.equal(record(JSON.parse(required(stored))).capability, 'cap1.def');
  });
});

test('an earlier session cart past its signed validity offers removal only, never checkout', async () => {
  await withStorefront(async ({ openPage, expired }) => {
    expired.add(carrierA);
    for (const entry of ['product', 'cart'] as const) {
      const page = await openPage();
      const ui = await openDesigner(page, entry === 'cart' ? { repair: '' } : {});
      if (entry === 'product') await buildToReview(ui);
      await ui.getByRole('heading', { name: 'Customized in an earlier session', exact: true }).waitFor();
      await ui.getByText('their prices have expired', { exact: false }).waitFor();
      assert.equal(await ui.getByRole('button', { name: 'View cart', exact: true }).count(), 0, entry);
      assert.equal(await ui.getByRole('button', { name: 'Retry', exact: true }).count(), 0, entry);
      assert.equal(
        await ui.getByRole('button', { name: 'Review removing all customized items', exact: true }).count(),
        1,
        entry,
      );
      await page.close();
    }
  });
});

test('a tab still holding its pre-#340 per-tab session moves it to the shared store and keeps its cart', async () => {
  await withStorefront(async ({ openPage, sessions, cartStateCapabilities, owners }) => {
    owners.set(carrierA, 'legacy.def');
    const page = await openPage();
    await page.evaluate(
      (key) =>
        sessionStorage.setItem(
          key,
          JSON.stringify({
            capability: 'legacy.def',
            sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000000',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          }),
        ),
      SESSION_KEY,
    );
    const ui = await openDesigner(page);
    await buildToReview(ui);
    await ui.getByText('€180.00', { exact: true }).filter({ visible: true }).first().waitFor();
    assert.equal(sessions(), 0, 'no new session is created');
    assert.ok(cartStateCapabilities.every((capability) => capability === 'legacy.def'));
    const stored = await page.evaluate(
      (key) => [localStorage.getItem(key), sessionStorage.getItem(key)] as const,
      SESSION_KEY,
    );
    assert.equal(record(JSON.parse(required(stored[0]))).capability, 'legacy.def');
    assert.equal(stored[1], null, 'the per-tab copy is removed');
  });
});

test('a new tab opening the cart-page review restores the design another tab added', async () => {
  await withStorefront(async ({ openPage, sessions, cartStateCapabilities, owners }) => {
    const first = await openPage();
    await (await openDesigner(first)).locator('.app').waitFor();
    await expectEventually(() => sessions() === 1, 'the open Designer creates one session');
    owners.set(carrierA, 'cap1.def');
    const cartPage = await openPage();
    const ui = await openDesigner(cartPage, { repair: '' });
    await ui.locator('.app').waitFor();
    await ui.getByRole('button', { name: 'Choose quantities', exact: true }).waitFor();
    assert.equal(await ui.getByRole('heading', { name: 'Your customization needs review' }).count(), 0);
    assert.equal(await ui.getByRole('heading', { name: 'Customized in an earlier session' }).count(), 0);
    assert.equal(sessions(), 1);
    assert.ok(cartStateCapabilities.length > 0);
    assert.ok(cartStateCapabilities.every((capability) => capability === 'cap1.def'));
  });
});
