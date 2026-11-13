import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BrowserContext, FrameLocator, Page } from 'playwright';
import { chromium } from 'playwright';
import type { BuyerConfig } from '../src/buyer.ts';
import {
  createStorefrontTestServer as createServer,
  lineCarriers,
  record,
  required,
  selectedFrameAssets,
  serverPort,
} from './support.mts';

/**
 * #347: an unfinished design survives a reload, another page and another tab. Opening the Designer offers to
 * continue it; closing and reopening on the same page load keeps restoring it without asking.
 */
const SESSION_KEY = 'insignia-buyer-session:/apps/insignia';
const LATEST_KEY = 'insignia:selected-design-latest:v1:/apps/insignia:111';
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
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
  'base64',
);

/** Drafts belong to the session capability that saved them, as on the server. */
async function withStorefront(
  run: (fixture: {
    context: BrowserContext;
    origin: string;
    openPage(): Promise<Page>;
    drafts: Map<string, { capability: string; value: unknown; compatibility?: string }>;
    restores: string[];
    previews: string[];
    /** Design groups this session owns in the cart; each adds one signed line. */
    cartGroups: unknown[];
  }) => Promise<void>,
) {
  const server = await createServer({
    plugins: [
      selectedFrameAssets(),
      {
        name: 'native-cart-page',
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            if (new URL(request.url ?? '/', 'http://fixture').pathname !== '/cart') return next();
            response.setHeader('Content-Type', 'text/html');
            response.end('<main><h1>Native cart</h1></main>');
          });
        },
      },
    ],
    server: { host: '127.0.0.1', port: 0, strictPort: true, watch: null },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const origin = `http://127.0.0.1:${serverPort(server.httpServer)}`;
    let minted = 0;
    const drafts = new Map<string, { capability: string; value: unknown; compatibility?: string }>();
    const restores: string[] = [];
    const previews: string[] = [];
    const cartGroups: unknown[] = [];
    const carrier = required(lineCarriers([{ variantId: '222', unitMinor: '3000' }], { set: 9 }).carriers[0]);
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'),
    );
    await context.route('**/cart.js', (route) =>
      route.fulfill({
        json: {
          items: [
            { key: 'ordinary', variant_id: 999, quantity: 1, properties: {}, product_id: 999 },
            ...cartGroups.map((_group, index) => ({
              key: `custom-${index}`,
              variant_id: 222,
              quantity: 3,
              properties: { _insignia_line_v3: carrier },
              product_id: 111,
            })),
          ],
          attributes: {},
          currency: 'EUR',
        },
      }),
    );
    await context.route('**/apps/insignia/guest/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      const id = path.split('/').at(-2) ?? '';
      previews.push(id);
      return route.fulfill({
        json: {
          url: `https://preview.example/${id}.png`,
          width: 100,
          height: 100,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      });
    });
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
      if (path.endsWith('/cart-state')) return route.fulfill({ json: { groups: cartGroups, repairRequired: false } });
      if (path.endsWith('/quote-proposals')) {
        const groups = (body.groups as unknown[]) ?? [];
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
      const restore = /\/designs\/([a-f0-9-]+)\/restore$/.exec(path);
      if (restore) {
        const id = restore[1] ?? '';
        restores.push(id);
        const saved = drafts.get(id);
        return saved && saved.capability === body.capability
          ? route.fulfill({
              json: {
                id,
                version: 1,
                value: saved.value,
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
                compatibility: saved.compatibility ?? 'current',
                retained: null,
              },
            })
          : route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: 'Not found', requestId: 'r' } });
      }
      const design = /\/designs\/([a-f0-9-]+)$/.exec(path);
      if (design) {
        drafts.set(design[1] ?? '', { capability: String(body.capability), value: body.group });
        return route.fulfill({ json: { id: design[1], version: 1, value: body.group } });
      }
      return route.fulfill({ status: 500, json: { code: 'UNAVAILABLE', message: 'unexpected', requestId: 'r' } });
    });
    await context.route('https://preview.example/**', (route) =>
      route.fulfill({ contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: png }),
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
      drafts,
      restores,
      previews,
      cartGroups,
    });
  } finally {
    await browser?.close();
    await server.close();
  }
}

/** Mounts the product page's Designer element (again, after a navigation) and opens it. */
async function openDesigner(page: Page): Promise<FrameLocator> {
  await page.evaluate(() => {
    let host = document.querySelector('insignia-buyer');
    if (!host) {
      host = document.createElement('insignia-buyer');
      host.setAttribute('product-id', '111');
      host.setAttribute('country', 'NL');
      host.setAttribute('market-id', '42');
      document.body.append(host);
    }
  });
  await page.locator('insignia-buyer').getByRole('button').first().click();
  const ui = page.frameLocator('iframe:not([hidden])');
  // Each new page loads the Designer frame again; a loaded runner needs longer than the action default.
  await ui.locator('.app').waitFor({ timeout: 30_000 });
  return ui;
}

/** Artwork later on the front, three items, Review: the eager quote saves the draft. */
async function buildToReview(ui: FrameLocator) {
  await ui.getByRole('button', { name: 'Add artwork', exact: true }).first().click();
  const card = ui.locator('article.print-card').first();
  const heading = card.locator('.print-card-heading');
  if ((await heading.getAttribute('aria-expanded')) === 'false') await heading.click();
  await card.locator('.artwork-choice').click();
  await ui.getByRole('button', { name: 'Provide artwork later', exact: true }).click();
  await ui.getByRole('button', { name: 'Choose quantities', exact: true }).click();
  await ui.locator('input[inputmode=numeric]:enabled').first().fill('3');
  await ui.getByRole('button', { name: 'Review', exact: true }).last().click();
  await ui.getByText('€90.00', { exact: true }).filter({ visible: true }).first().waitFor();
}

async function expectEventually(check: () => boolean | Promise<boolean>, message: string) {
  const deadline = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > deadline) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const latestDraft = (page: Page) => page.evaluate((key) => localStorage.getItem(key), LATEST_KEY);
const prompt = (ui: FrameLocator) => ui.getByRole('heading', { name: 'Continue your design?', exact: true });
/** The opened Designer offers no draft: it is at its first step with no placement. */
async function expectCleanStart(ui: FrameLocator, message: string) {
  await ui.getByRole('button', { name: 'Add artwork', exact: true }).first().waitFor();
  assert.equal(await prompt(ui).count(), 0, message);
  assert.equal(await ui.locator('article.print-card').count(), 0, message);
}
/** The resumed draft: the front placement with artwork later and three items. */
async function expectResumedDraft(ui: FrameLocator) {
  await prompt(ui).waitFor({ state: 'detached' });
  await ui.locator('article.print-card').first().waitFor();
  await ui.getByRole('button', { name: 'Choose quantities', exact: true }).click();
  assert.equal(await ui.locator('input[inputmode=numeric]:enabled').first().inputValue(), '3');
}

for (const route of ['reload', 'navigation away and back', 'new tab'] as const)
  test(`after a ${route} the Designer offers to continue the unfinished design, and Start new discards it`, async () => {
    await withStorefront(async ({ context, openPage, drafts }) => {
      const page = await openPage();
      await buildToReview(await openDesigner(page));
      await expectEventually(() => drafts.size > 0, 'the eager review saves the draft');
      const leave = async (from: Page) => {
        if (route === 'reload') {
          await from.reload();
          return from;
        }
        if (route === 'navigation away and back') {
          await from.goto(new URL('/cart', from.url()).href);
          await from.getByRole('heading', { name: 'Native cart' }).waitFor();
          await from.goBack();
          return from;
        }
        return openPage();
      };
      // Continue restores artwork placement and quantities.
      let current = await leave(page);
      let ui = await openDesigner(current);
      await prompt(ui).waitFor();
      const continueButton = ui.getByRole('button', { name: 'Continue', exact: true });
      await expectEventually(
        () => continueButton.evaluate((button) => button === document.activeElement),
        'focus starts on Continue, as on the other Designer decisions',
      );
      const resumedFrom = await latestDraft(current);
      await continueButton.click();
      await expectResumedDraft(ui);
      // Continuing keeps editing the same draft: it is not saved again, and the pointer stays on it (#366).
      assert.equal(await latestDraft(current), resumedFrom, 'the continued design is the same draft');

      // The draft stays unfinished: leaving again offers it again. Start new opens clean and discards it.
      current = await leave(route === 'new tab' ? context.pages()[0]! : current);
      ui = await openDesigner(current);
      await prompt(ui).waitFor();
      await ui.getByRole('button', { name: 'Start a new design', exact: true }).click();
      await expectCleanStart(ui, 'Start new opens a clean Designer');
      await expectEventually(async () => (await latestDraft(current)) === null, 'Start new discards the draft pointer');
      const later = await leave(current);
      await expectCleanStart(await openDesigner(later), 'a discarded draft is not offered again');
    });
  });

test('Escape closes the prompt and keeps the draft, which is offered again after the next reload', async () => {
  await withStorefront(async ({ openPage, drafts }) => {
    const page = await openPage();
    await buildToReview(await openDesigner(page));
    await expectEventually(() => drafts.size > 0, 'the eager review saves the draft');
    await page.reload();
    let ui = await openDesigner(page);
    await prompt(ui).waitFor();
    await ui.getByRole('button', { name: 'Continue', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await expectResumedDraft(ui);
    await page.reload();
    ui = await openDesigner(page);
    await prompt(ui).waitFor();
  });
});

test('Continue restores uploaded artwork through the session that owns it', async () => {
  await withStorefront(async ({ openPage, drafts, previews }) => {
    const page = await openPage();
    await openDesigner(page);
    const session = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), SESSION_KEY);
    assert.ok(session?.capability, 'the open Designer holds a session');
    // A draft saved by this session earlier, with an uploaded artwork revision on the front.
    const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    drafts.set(id, {
      capability: session.capability,
      value: {
        productId: '111',
        configRevisionId: 'r1',
        revisionContentHash: 'a'.repeat(64),
        design: {
          placements: [
            {
              placementId: 'front',
              methodId: 'print',
              stepId: 'small',
              artwork: { kind: 'revision', revisionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
            },
          ],
          options: [],
        },
        variants: [{ variantId: '222', quantity: 2 }],
      },
    });
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [
      LATEST_KEY,
      JSON.stringify({ session: session.sessionId, id }),
    ] as const);
    await page.reload();
    const ui = await openDesigner(page);
    await prompt(ui).waitFor();
    await ui.getByRole('button', { name: 'Continue', exact: true }).click();
    await prompt(ui).waitFor({ state: 'detached' });
    assert.deepEqual(previews, ['dddddddd-dddd-4ddd-8ddd-dddddddddddd']);
    await ui.locator('article.print-card img').first().waitFor();
    await ui.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    assert.equal(await ui.locator('input[inputmode=numeric]:enabled').first().inputValue(), '2');
  });
});

test('a Designer opened without designing anything offers nothing after a reload', async () => {
  await withStorefront(async ({ openPage, drafts, restores }) => {
    const page = await openPage();
    await openDesigner(page);
    await page.reload();
    await expectCleanStart(await openDesigner(page), 'no draft, no prompt');
    assert.equal(drafts.size, 0);
    assert.deepEqual(restores, []);
  });
});

test('closing and reopening on the same page load restores the design without asking', async () => {
  await withStorefront(async ({ openPage }) => {
    const page = await openPage();
    const ui = await openDesigner(page);
    await buildToReview(ui);
    await ui.getByRole('button', { name: 'Close customizer', exact: true }).click();
    await ui.getByRole('heading', { name: 'Close customization?', exact: true }).waitFor();
    await ui.getByText('Your design will stay here while this page is open.', { exact: false }).waitFor();
    await ui.getByRole('button', { name: 'Close customization', exact: true }).click();
    await page.locator('iframe:not([hidden])').waitFor({ state: 'detached' });
    const reopened = await openDesigner(page);
    await reopened.getByText('€90.00', { exact: true }).filter({ visible: true }).first().waitFor();
    assert.equal(await prompt(reopened).count(), 0);
  });
});

for (const stored of ['expired', 'foreign'] as const)
  test(`a draft whose session is ${stored === 'expired' ? 'expired' : 'another'} falls back silently to a clean start`, async () => {
    await withStorefront(async ({ openPage, drafts, restores }) => {
      const page = await openPage();
      await buildToReview(await openDesigner(page));
      await expectEventually(() => drafts.size > 0, 'the eager review saves the draft');
      await page.evaluate(
        ([key, stored]) => {
          const session = JSON.parse(localStorage.getItem(key) ?? 'null');
          localStorage.setItem(
            key,
            JSON.stringify(
              stored === 'expired'
                ? { ...session, expiresAt: new Date(Date.now() - 1000).toISOString() }
                : {
                    capability: 'other.def',
                    sessionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                    expiresAt: new Date(Date.now() + 3600000).toISOString(),
                  },
            ),
          );
        },
        [SESSION_KEY, stored] as const,
      );
      await page.reload();
      await expectCleanStart(await openDesigner(page), `${stored} session`);
      assert.deepEqual(restores, [], 'another session never reads the draft');
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), LATEST_KEY), null);
    });
  });

test('a draft the server no longer has falls back silently to a clean start', async () => {
  await withStorefront(async ({ openPage, drafts, restores }) => {
    const page = await openPage();
    await buildToReview(await openDesigner(page));
    await expectEventually(() => drafts.size > 0, 'the eager review saves the draft');
    drafts.clear();
    await page.reload();
    await expectCleanStart(await openDesigner(page), 'expired draft');
    assert.equal(restores.length, 1);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), LATEST_KEY), null);
  });
});

test('a design whose Add to cart reached Shopify, but not its answer, is not offered again', async () => {
  await withStorefront(async ({ context, openPage, drafts, cartGroups }) => {
    const page = await openPage();
    await buildToReview(await openDesigner(page));
    await expectEventually(() => drafts.size > 0, 'the eager review saves the draft');
    // Shopify applied it, but the lost response left the pointer behind.
    cartGroups.push(required([...drafts.values()].at(-1)).value);
    assert.notEqual(await page.evaluate((key) => localStorage.getItem(key), LATEST_KEY), null);
    const other = await context.newPage();
    await other.goto(page.url());
    await expectCleanStart(await openDesigner(other), 'the design is already in the cart');
    assert.equal(await other.evaluate((key) => localStorage.getItem(key), LATEST_KEY), null, 'its pointer is dropped');
  });
});

test('a design one tab added is not offered again after another tab continued and reviewed it', async () => {
  await withStorefront(async ({ openPage, drafts, cartGroups }) => {
    const first = await openPage();
    await buildToReview(await openDesigner(first));
    await expectEventually(() => drafts.size > 0, 'the eager review saves the draft');
    await first.reload();
    const second = await openPage();
    for (const page of [first, second]) {
      const ui = await openDesigner(page);
      await prompt(ui).waitFor();
      await ui.getByRole('button', { name: 'Continue', exact: true }).click();
      await prompt(ui).waitFor({ state: 'detached' });
    }
    // Both tabs continue the same draft; continuing alone saves nothing (#366).
    assert.equal(drafts.size, 1);
    // The first tab adds it.
    cartGroups.push(required([...drafts.values()].at(-1)).value);
    // The second tab's Review saves it again and its pointer stays.
    const ui = second.frameLocator('iframe:not([hidden])');
    await ui.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    await ui.getByRole('button', { name: 'Review', exact: true }).last().click();
    await ui.getByText('€90.00', { exact: true }).filter({ visible: true }).first().waitFor();
    assert.notEqual(await second.evaluate((key) => localStorage.getItem(key), LATEST_KEY), null);
    const third = await openPage();
    await expectCleanStart(await openDesigner(third), 'the design is already in the cart');
    assert.equal(await third.evaluate((key) => localStorage.getItem(key), LATEST_KEY), null);
  });
});

test('a draft whose choices are no longer offered is discarded with a notice, and the Designer starts clean', async () => {
  await withStorefront(async ({ openPage, drafts }) => {
    const page = await openPage();
    await buildToReview(await openDesigner(page));
    await expectEventually(() => drafts.size > 0, 'the eager review saves the draft');
    const saved = required([...drafts.values()].at(-1));
    saved.compatibility = 'choice-unavailable';
    await page.reload();
    const ui = await openDesigner(page);
    const notice = ui
      .getByRole('status')
      .filter({ hasText: "Your earlier design can't be restored because this product's options changed." });
    await notice.waitFor();
    await expectCleanStart(ui, 'no prompt for a draft that cannot be restored');
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), LATEST_KEY), null, 'the draft is discarded');
    // It stays until dismissed.
    await page.waitForTimeout(6500);
    assert.equal(await notice.count(), 1);
    await notice.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
    await notice.waitFor({ state: 'detached' });
    await page.reload();
    const again = await openDesigner(page);
    await expectCleanStart(again, 'nothing is offered afterwards');
    assert.equal(await again.getByRole('status').count(), 0, 'and the notice is not repeated');
  });
});

/** The real upload path: allocation, transfer, inspection and preview, as the guest artwork API answers it. */
async function routeUpload(context: BrowserContext, assetId: string) {
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  await context.route('https://upload.example.test/**', (route) =>
    route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' } }),
  );
  await context.route('**/apps/insignia/guest**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/guest'))
      return route.fulfill({
        json: { assetId, expiresAt, upload: { url: 'https://upload.example.test/original', headers: {} } },
      });
    if (path.endsWith('/complete')) return route.fulfill({ json: { state: 'QUEUED', expiresAt } });
    if (path.endsWith('/status')) return route.fulfill({ json: { state: 'USABLE', expiresAt } });
    if (path.endsWith('/preview'))
      return route.fulfill({
        json: { url: `https://preview.example/${assetId}.png`, width: 100, height: 100, expiresAt },
      });
    return route.fallback();
  });
}
type SavedGroup = {
  design: { placements: { placementId: string; artwork: { kind: string; revisionId?: string } }[] };
  variants: { variantId: string; quantity: number }[];
};

test('artwork uploaded and placed before choosing quantities is offered again after a reload (#366)', async () => {
  await withStorefront(async ({ context, openPage, drafts }) => {
    const assetId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    await routeUpload(context, assetId);
    const page = await openPage();
    const ui = await openDesigner(page);
    await ui.getByRole('button', { name: 'Add artwork', exact: true }).first().click();
    const card = ui.locator('article.print-card').first();
    const heading = card.locator('.print-card-heading');
    if ((await heading.getAttribute('aria-expanded')) === 'false') await heading.click();
    await card.locator('.artwork-choice').click();
    await ui.locator('input[type=file]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
    await ui.getByRole('button', { name: 'logo.png Change', exact: true }).waitFor({ timeout: 10000 });
    // No sizes or colours chosen: the draft is still saved, shortly after the last change.
    await expectEventually(() => drafts.size === 1, 'the placed artwork is saved without quantities');
    const saved = required([...drafts.values()][0]).value as SavedGroup;
    assert.deepEqual(saved.variants, []);
    assert.deepEqual(
      saved.design.placements.map((placement) => [placement.placementId, placement.artwork]),
      [['front', { kind: 'revision', revisionId: assetId }]],
    );
    await page.reload();
    const resumed = await openDesigner(page);
    await prompt(resumed).waitFor();
    await resumed.getByRole('button', { name: 'Continue', exact: true }).click();
    await prompt(resumed).waitFor({ state: 'detached' });
    // The artwork and its placement are back, through the session that owns them.
    await resumed.locator('article.print-card img').first().waitFor();
    assert.equal(await resumed.locator('article.print-card').count(), 1);
    await resumed.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    assert.equal(
      await resumed.locator('input[inputmode=numeric]:enabled').first().inputValue(),
      '0',
      'no quantities yet',
    );
  });
});

test('an edit made after Review is restored after a reload (#366)', async () => {
  await withStorefront(async ({ openPage, drafts }) => {
    const page = await openPage();
    const ui = await openDesigner(page);
    await buildToReview(ui);
    await expectEventually(() => drafts.size === 1, 'Review saves the draft');
    await ui.getByRole('button', { name: 'Previous step', exact: true }).last().click();
    await ui.locator('input[inputmode=numeric]:enabled').first().fill('5');
    await expectEventually(
      () =>
        drafts.size === 1 &&
        (required([...drafts.values()][0]).value as SavedGroup).variants.some((variant) => variant.quantity === 5),
      'the edit is saved to the same draft without another Review',
    );
    await page.reload();
    const resumed = await openDesigner(page);
    await prompt(resumed).waitFor();
    await resumed.getByRole('button', { name: 'Continue', exact: true }).click();
    await prompt(resumed).waitFor({ state: 'detached' });
    await resumed.getByRole('button', { name: 'Choose quantities', exact: true }).click();
    assert.equal(await resumed.locator('input[inputmode=numeric]:enabled').first().inputValue(), '5');
  });
});

test('artwork removed after its autosave is not offered after a reload (#366)', async () => {
  await withStorefront(async ({ openPage, drafts }) => {
    const page = await openPage();
    const ui = await openDesigner(page);
    await ui.getByRole('button', { name: 'Add artwork', exact: true }).first().click();
    const card = ui.locator('article.print-card').first();
    const heading = card.locator('.print-card-heading');
    if ((await heading.getAttribute('aria-expanded')) === 'false') await heading.click();
    await card.locator('.artwork-choice').click();
    await ui.getByRole('button', { name: 'Provide artwork later', exact: true }).click();
    await expectEventually(
      async () => drafts.size === 1 && (await latestDraft(page)) !== null,
      'the placement is saved',
    );
    await ui.getByRole('button', { name: 'Remove artwork', exact: true }).click();
    await expectEventually(async () => (await latestDraft(page)) === null, 'the removed design is no longer offered');
    await page.reload();
    await expectCleanStart(await openDesigner(page), 'nothing the buyer removed comes back');
  });
});
