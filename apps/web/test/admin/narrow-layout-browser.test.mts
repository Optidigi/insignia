import assert from 'node:assert/strict';
import { test } from 'node:test';
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
const fade = (page: Page) =>
  page
    .locator('#admin-route-content .resource-table-scroll')
    .evaluate((scroller) => Number.parseFloat(getComputedStyle(scroller).getPropertyValue('--resource-table-fade')));
const overflowsPage = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme}: the Products table stays reachable on a phone and signals the hidden columns`, {
    timeout: 60000,
  }, async (t) => {
    const f = await fixture(t);
    await f.page.emulateMedia({ colorScheme: scheme });
    await openProducts(f, 390, 844);
    assert.equal(await overflowsPage(f.page), false, 'the page itself never scrolls sideways');
    const scroller = f.page.locator('#admin-route-content .resource-table-scroll');
    const wider = await scroller.evaluate((el) => el.scrollWidth > el.clientWidth);
    assert.equal(wider, true, 'a phone cannot show every column, so the table scrolls inside its own region');
    assert.ok((await fade(f.page)) > 0, 'unseen columns to the right are signalled at the start');
    // Hover keeps the pinned identity opaque and the layout still.
    await f.page.getByRole('link', { name: 'Insignia M5 acceptance — 27c397e10c26' }).hover();
    assert.equal(await overflowsPage(f.page), false);
    await scroller.focus();
    await f.page.keyboard.press('ArrowRight');
    await f.page.waitForFunction(
      () => (document.querySelector('#admin-route-content .resource-table-scroll')?.scrollLeft ?? 0) > 0,
    );
    await scroller.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await f.page.waitForFunction(() => {
      const el = document.querySelector('#admin-route-content .resource-table-scroll');
      return !!el && Math.abs(el.scrollLeft + el.clientWidth - el.scrollWidth) < 1;
    });
    await f.page.waitForFunction(
      () =>
        Number.parseFloat(
          getComputedStyle(
            document.querySelector('#admin-route-content .resource-table-scroll') as Element,
          ).getPropertyValue('--resource-table-fade'),
        ) === 0,
    );
    const reachable = await f.page.evaluate(() => {
      const box = (
        document.querySelector('#admin-route-content .resource-table-scroll') as Element
      ).getBoundingClientRect();
      const headers = [...document.querySelectorAll('#admin-route-content .admin-resource-table th')];
      const methods = headers.find((th) => th.textContent?.trim() === 'Methods');
      const pinned = headers[0]?.getBoundingClientRect();
      if (!methods || !pinned) throw new Error('Methods header missing');
      methods.scrollIntoView({ inline: 'start', block: 'nearest' });
      const rect = methods.getBoundingClientRect();
      return { fits: rect.right <= box.right + 1, clear: rect.left >= pinned.right - 1 };
    });
    assert.deepEqual(reachable, { fits: true, clear: true }, 'the Methods column can be scrolled fully into view');
  });

  test(`${scheme}: the Products table shows every column without a scroll hint on a wide screen`, {
    timeout: 60000,
  }, async (t) => {
    const f = await fixture(t);
    await f.page.emulateMedia({ colorScheme: scheme });
    await openProducts(f, 1440, 900);
    assert.equal(await overflowsPage(f.page), false);
    assert.equal(
      await f.page
        .locator('#admin-route-content .resource-table-scroll')
        .evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
    );
    assert.equal(await fade(f.page), 0, 'nothing is hidden, so nothing fades');
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
  });
}

test('the editor header group has a merchant-facing label instead of the bridge default', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  // App Bridge exports an s-button-group as `label` attribute || "Button Group" (see issue #444).
  const label = await f.page
    .locator('s-page > s-button-group[slot="secondary-actions"]')
    .evaluate((group) => group.getAttribute('label'));
  assert.equal(label, 'View and history');
});
