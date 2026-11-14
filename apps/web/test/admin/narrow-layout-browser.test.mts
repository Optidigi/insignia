import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PurchaseListViewSchema } from '@insignia/contracts';
import type { Page } from 'playwright';
import { fixture, product } from './support/selected-browser.mts';

// Scope: the built merchant UI with synthetic provider HTTP in an isolated Chromium (#444).
// These are not native Shopify mobile-app observations: the host's own header, bottom action bar
// and floating buttons are outside the iframe and cannot be seen here.
const products = [
  'Adidas All Day All Fear Polo — Customisation',
  'Insignia M5 acceptance — 27c397e10c26',
  'insignia-m5-009-439c9699-af2f-4e8a-b2c1-aaaaaaaaaaaa',
  'Plain tee',
].map((title, index) => ({
  ...product,
  id: `gid://shopify/Product/${200 + index}`,
  title,
  configurationSummary:
    index % 2
      ? { state: 'published', methods: ['Print', 'Embroidery'], locations: ['Chest', 'Back'] }
      : { state: 'not_configured', methods: [], locations: [] },
}));

async function openProducts(f: Awaited<ReturnType<typeof fixture>>, width: number, height: number) {
  await f.page.setViewportSize({ width, height });
  await f.page.route('**/api/admin/products?*', (route) => route.fulfill({ json: { products, nextCursor: null } }));
  await f.page.goto(`${f.base}/admin/products?locale=en`);
  await f.page.waitForFunction(() => document.documentElement.dataset.adminReady === 'true');
  await f.page.getByRole('link', { name: 'Plain tee' }).waitFor();
}
const scrollerSelector = '#admin-route-content .resource-table-scroll';
// The fade is a mask on the scroll region: a gradient with a `calc(100% - Npx)` stop while columns
// are hidden to the right, a plain opaque gradient once the last column is in view, and none while
// keyboard focus draws the region's own ring.
const mask = (page: Page) =>
  page.locator(scrollerSelector).evaluate((el) => {
    const { maskImage, outlineStyle } = getComputedStyle(el);
    const hit = /calc\(100% - ([\d.]+)px\)/.exec(maskImage);
    return { maskImage, fadePx: hit ? Number(hit[1]) : 0, outlineStyle };
  });
const overflowsPage = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

type Fixture = Awaited<ReturnType<typeof fixture>>;
const orderItem = (n: number) => ({
  version: 'm8-purchase-v1',
  isTest: true,
  purchaseId: `d841ee12-2075-4101-b3bc-429ad31a40${50 + n}`,
  orderId: `gid://shopify/Order/${n}`,
  orderName: `#100${n}`,
  orderCreatedAt: '2026-11-13T12:00:00Z',
  currency: 'USD',
  exponent: 2,
  originalTotalMinor: '4500',
  firstPaidAt: null,
  financialStatus: 'PENDING',
  cancelledAt: null,
  exceptions: [],
  canUploadArtwork: true,
  canShareCustomerArtwork: false,
  artworkVersion: 0,
  artworkState: 'PENDING_ARTWORK',
  refunds: [],
  lines: [
    {
      orderLineId: 'line1',
      title: 'Purchased shirt',
      variantTitle: 'Blue / M',
      productId: '111',
      variantId: '11',
      quantity: 2,
      unitPriceMinor: '4500',
    },
  ],
  groups: [],
  artworkEvents: [],
});
async function openOrders(f: Fixture, width: number, height: number) {
  await f.page.setViewportSize({ width, height });
  const items = [orderItem(1), orderItem(2)];
  await f.page.route('**/api/purchases/v1?*', (route) =>
    route.fulfill({
      json: PurchaseListViewSchema.parse({ version: 'm8-purchase-list-v1', items, nextCursor: null, timeZone: 'UTC' }),
    }),
  );
  await f.page.goto(`${f.base}/admin/orders?locale=en`);
  await f.page.waitForFunction(() => document.documentElement.dataset.adminReady === 'true');
  await f.page.getByText('#1002', { exact: true }).first().waitFor();
}

/** Shared phone-width contract of the app's resource table (Products and Orders). */
async function assertPhoneTable(f: Fixture, lastColumn: string) {
  const { page } = f;
  assert.equal(await overflowsPage(page), false, 'the page itself never scrolls sideways');
  const scroller = page.locator(scrollerSelector);
  assert.equal(
    await scroller.evaluate((el) => el.scrollWidth > el.clientWidth),
    true,
    'a phone cannot show every column, so the table scrolls inside its own region',
  );
  const start = await mask(page);
  assert.match(start.maskImage, /^linear-gradient/, 'hidden columns to the right are signalled by a fade');
  assert.equal(start.fadePx, 32);
  await page.locator(`${scrollerSelector} tbody tr`).first().hover();
  assert.equal(await overflowsPage(page), false);
  // Keyboard focus draws the region's own ring, which a mask would fade at the trailing edge.
  await scroller.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((selector) => (document.querySelector(selector)?.scrollLeft ?? 0) > 0, scrollerSelector);
  const focused = await mask(page);
  assert.equal(focused.maskImage, 'none');
  assert.equal(focused.outlineStyle, 'solid', 'the focus ring is fully visible');
  await scroller.evaluate((el) => {
    (el as HTMLElement).blur();
    el.scrollTo({ left: el.scrollWidth });
  });
  await page.waitForFunction((selector) => {
    const el = document.querySelector(selector);
    return !!el && Math.abs(el.scrollLeft + el.clientWidth - el.scrollWidth) < 1;
  }, scrollerSelector);
  await page.waitForFunction((selector) => {
    const m = getComputedStyle(document.querySelector(selector) as Element).maskImage;
    return m.startsWith('linear-gradient') && !/calc\(100% - /.test(m);
  }, scrollerSelector);
  const reachable = await page.evaluate(
    ({ selector, column }) => {
      const box = (document.querySelector(selector) as Element).getBoundingClientRect();
      const headers = [...document.querySelectorAll('#admin-route-content .admin-resource-table th')];
      const target = headers.find((th) => th.textContent?.trim() === column);
      const pinned = headers[0]?.getBoundingClientRect();
      if (!target || !pinned) throw new Error(`${column} header missing`);
      target.scrollIntoView({ inline: 'start', block: 'nearest' });
      const rect = target.getBoundingClientRect();
      return { fits: rect.right <= box.right + 1, clear: rect.left >= pinned.right - 1 };
    },
    { selector: scrollerSelector, column: lastColumn },
  );
  assert.deepEqual(reachable, { fits: true, clear: true }, `the ${lastColumn} column can be scrolled fully into view`);
}
async function assertWideTable(f: Fixture) {
  assert.equal(await overflowsPage(f.page), false);
  assert.equal(await f.page.locator(scrollerSelector).evaluate((el) => el.scrollWidth > el.clientWidth), false);
  const wide = await mask(f.page);
  assert.equal(wide.fadePx, 0, 'nothing is hidden, so nothing fades');
}

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme}: the Products table stays reachable on a phone and signals the hidden columns`, {
    timeout: 60000,
  }, async (t) => {
    const f = await fixture(t);
    await f.page.emulateMedia({ colorScheme: scheme });
    await openProducts(f, 390, 844);
    await assertPhoneTable(f, 'Methods');
  });

  test(`${scheme}: the Products table shows every column without a scroll hint on a wide screen`, {
    timeout: 60000,
  }, async (t) => {
    const f = await fixture(t);
    await f.page.emulateMedia({ colorScheme: scheme });
    await openProducts(f, 1440, 900);
    await assertWideTable(f);
  });

  test(`${scheme}: the Orders table shares the phone fade and the wide-screen absence`, {
    timeout: 60000,
  }, async (t) => {
    const f = await fixture(t);
    await f.page.emulateMedia({ colorScheme: scheme });
    await openOrders(f, 390, 844);
    await assertPhoneTable(f, 'Customized items');
    await f.page.setViewportSize({ width: 1440, height: 900 });
    await assertWideTable(f);
  });

  test(`${scheme}: the editor keeps the canvas in view beside the settings and clear of a bottom bar on a phone`, {
    timeout: 60000,
  }, async (t) => {
    const f = await fixture(t);
    await f.page.emulateMedia({ colorScheme: scheme });
    await f.open();
    await f.page.setViewportSize({ width: 390, height: 700 });
    await f.page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await f.page.getByRole('textbox', { name: /^Placement name/ }).waitFor({ state: 'visible' });
    assert.equal(await overflowsPage(f.page), false);
    const workspace = f.page.locator('.placement-workspace');
    const canvas = await workspace.evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(canvas >= 200 && canvas <= 0.4 * 700, `canvas leaves room for settings (${canvas}px of 700)`);
    // Scroll deep into the settings: the canvas stays pinned and the settings sit below it.
    const together = await f.page.evaluate(() => {
      const heading = [...document.querySelectorAll('.placement-properties .placement-property-section')].find((el) =>
        el.textContent?.trim().startsWith('Decoration methods'),
      );
      if (!heading) throw new Error('heading missing');
      heading.scrollIntoView({ block: 'start' });
      const w = document.querySelector('.placement-workspace')?.getBoundingClientRect();
      if (!w) throw new Error('workspace missing');
      return {
        scrolled: scrollY > 100,
        canvasTop: w.top,
        headingBelow: heading.getBoundingClientRect().top >= w.bottom - 1,
        canvasVisible: w.top >= 0 && w.bottom <= innerHeight,
      };
    });
    assert.equal(together.scrolled, true);
    assert.equal(together.canvasTop, 0, 'the canvas stays pinned while the settings scroll');
    assert.equal(together.canvasVisible, true);
    assert.equal(together.headingBelow, true, 'settings scroll beneath the canvas, not behind it');
    // A field that sits partly under the pinned canvas is brought clear of it when focused.
    const name = f.page.getByRole('textbox', { name: /^Placement name/ });
    await f.page.evaluate(() => scrollTo(0, 0));
    const resting = (await name.boundingBox())?.y ?? 0;
    await f.page.evaluate((y) => scrollTo(0, y - 100), resting);
    await name.focus();
    const focused = await f.page.evaluate(() => {
      const w = document.querySelector('.placement-workspace')?.getBoundingClientRect();
      if (!w) throw new Error('workspace missing');
      return w.bottom;
    });
    assert.ok(((await name.boundingBox())?.y ?? 0) >= focused - 1, 'a focused field is not hidden beneath the canvas');
    // The last control scrolls clear of a bottom action bar.
    await f.page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const clearance = await f.page.evaluate(() => {
      const last = [...document.querySelectorAll('.placement-properties button, .placement-properties s-button')]
        .filter((el) => el.getClientRects().length)
        .at(-1);
      if (!last) throw new Error('last control missing');
      return innerHeight - last.getBoundingClientRect().bottom;
    });
    assert.ok(clearance >= 56, `the last control stays above a bottom action bar (${clearance}px clear)`);
    // The pin shows a separation from the settings that scroll beneath it.
    await f.page.evaluate(() => scrollTo(0, 0));
    assert.notEqual(await workspace.evaluate((el) => getComputedStyle(el).boxShadow), 'none');
    // The expanded canvas is not pinned and adds no scroll padding.
    await f.page.getByRole('button', { name: 'Expand canvas', exact: true }).click();
    await f.page.locator('.placement-workspace.is-expanded').waitFor();
    const expanded = await f.page.evaluate(() => ({
      position: getComputedStyle(document.querySelector('.placement-workspace') as Element).position,
      padding: getComputedStyle(document.documentElement).scrollPaddingTop,
    }));
    assert.deepEqual(expanded, { position: 'static', padding: 'auto' });
  });
}

test('the editor header exports no unlabelled button group to the host', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  // App Bridge exports an s-button-group as `label` attribute || "Button Group" (see issue #444). The panel and
  // history controls now live in the editor, so the page header has no group to label (#441).
  const unlabelled = await f.page
    .locator('s-page > s-button-group[slot="secondary-actions"]')
    .evaluateAll((groups) => groups.filter((group) => !group.getAttribute('label')).length);
  assert.equal(unlabelled, 0);
});
