import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium } from 'playwright';

const id = 'd841ee12-2075-4101-b3bc-429ad31a4059';
function view(state = 'PENDING_ARTWORK') {
  return {
    version: 'm8-purchase-v1',
    isTest: false,
    purchaseId: id,
    orderId: 'gid://shopify/Order/1',
    orderCreatedAt: '2026-10-12T12:00:00Z',
    currency: 'USD',
    exponent: 2,
    originalTotalMinor: '9007199254740993',
    firstPaidAt: null,
    financialStatus: 'PENDING',
    cancelledAt: null,
    exceptions: [],
    artworkVersion: 0,
    artworkState: state,
    refunds: [],
    lines: [{ orderLineId: 'line1', productId: '111', variantId: '11', quantity: 2, unitPriceMinor: '4500' }],
    groups:
      state === 'ERASED'
        ? []
        : [
            {
              index: 0,
              productId: '111',
              configRevisionId: 'historical1',
              variants: [{ variantId: '11', quantity: 2 }],
              placements: [
                {
                  id: 'front',
                  methodId: 'print',
                  stepId: 'small',
                  originalArtwork: { kind: 'deferred', intentId: 'intent1' },
                  currentAssetId: null,
                  currentExpiresAt: null,
                  expired: false,
                },
              ],
              geometry: null,
              presentation: null,
              imageUrls: {},
              payloadExpiresAt: '2026-10-19T12:00:00Z',
            },
          ],
    artworkEvents: [],
  };
}
async function fixture(t) {
  const child = spawn(
    process.execPath,
    [process.env.PURCHASE_BROWSER_ENTRY ?? new URL('../../dist/server/entry.mjs', import.meta.url).pathname],
    {
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '0',
        SHOPIFY_CLIENT_ID: '11111111111111111111111111111111',
        ARTWORK_R2_ENDPOINT: 'https://private.example',
      },
    },
  );
  let log = '';
  child.stdout.on('data', (x) => (log += x));
  child.stderr.on('data', (x) => (log += x));
  const exited = new Promise((r) => child.once('close', r));
  let base;
  for (let i = 0; i < 100; i++) {
    base = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (base) {
      try {
        if ((await fetch(base + '/live')).ok) break;
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(base, log);
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    child.kill('SIGTERM');
    await exited;
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => (window.shopify = { idToken: async () => 'synthetic-purchase-actor' }));
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  const polaris = await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url));
  await page.route('https://cdn.shopify.com/shopifycloud/polaris-1.1.js', (r) =>
    r.fulfill({ body: polaris, contentType: 'text/javascript' }),
  );
  await page.route('https://cdn.shopify.com/static/fonts/**', (r) => r.fulfill({ body: '' }));
  return { page, base };
}
test('merchant sees exact historical economics and erased detail never offers new artwork work', {
  timeout: 20000,
}, async (t) => {
  const { page, base } = await fixture(t);
  const shell = await fetch(base + '/admin/orders/' + id);
  assert.equal(shell.status, 200);
  assert.equal(shell.headers.get('cache-control'), 'private, no-store');
  assert.match(shell.headers.get('content-security-policy'), /connect-src 'self' https:\/\/private\.example;/);
  assert.equal((await shell.text()).includes('9007199254740993'), false, 'SSR does not load private order economics');
  let current = view();
  await page.route('**/api/purchases/v1/' + id, (r) => {
    assert.equal(r.request().headers().authorization, 'Bearer synthetic-purchase-actor');
    return r.fulfill({ json: current });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/admin/orders/' + id);
  await page.getByText('USD 90071992547409.93', { exact: true }).waitFor();
  const navigation = page.getByRole('navigation', { name: 'Insignia' });
  await navigation.getByRole('link', { name: 'Products', exact: true }).waitFor();
  await navigation.getByRole('link', { name: 'Orders and artwork', exact: true }).waitFor();
  assert.equal(
    await navigation.getByRole('link', { name: 'Billing', exact: true }).getAttribute('href'),
    '/admin/billing',
  );
  await page.getByRole('heading', { name: 'Order summary', exact: true }).waitFor();
  assert.equal(await page.locator('time[datetime="2026-10-19T12:00:00Z"]').innerText(), 'Oct 19, 2026, 12:00 PM UTC');
  await page.getByText('Historical preview unavailable.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Lock artwork', exact: true }).isEnabled(), false);
  await page.screenshot({ path: '/tmp/insignia-m8-local-order-demo.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'purchase fits a narrow merchant viewport',
  );
  await page.screenshot({ path: '/tmp/insignia-lean-local-order-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  current = view('ERASED');
  await page.getByRole('button', { name: 'Refresh purchase', exact: true }).click();
  await page.getByText('Production detail erased. Historical economics remain.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Upload artwork').count(), 0);
});
test('merchant attaches verified upload, locks exact version, and permission loss removes private work', {
  timeout: 20000,
}, async (t) => {
  const { page, base } = await fixture(t);
  let current = view();
  const asset = '0829a06c-e8c5-40aa-9167-4fb47e443231';
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  let denied = false;
  let attachment;
  await page.route('**/api/purchases/v1/' + id, (r) => r.fulfill({ json: current }));
  await page.route('**/api/artwork', (r) =>
    r.fulfill({ json: { assetId: asset, expiresAt, upload: { url: 'https://private.example/q', headers: {} } } }),
  );
  await page.route('https://private.example/**', (r) =>
    r.fulfill({ status: 200, body: '', headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
  await page.route('**/api/artwork/' + asset + '/**', (r) =>
    r.fulfill({
      json: r.request().url().endsWith('/status')
        ? { state: 'USABLE', expiresAt }
        : r.request().url().endsWith('/preview')
          ? { url: 'https://private.example/preview.png', width: 10, height: 10, expiresAt }
          : {},
    }),
  );
  await page.route('**/api/purchases/v1/' + id + '/artwork', (r) => {
    attachment = r.request().postDataJSON();
    current = {
      ...current,
      artworkVersion: 1,
      artworkState: 'READY',
      groups: current.groups.map((g) => ({
        ...g,
        placements: g.placements.map((p) => ({ ...p, currentAssetId: asset, currentExpiresAt: expiresAt })),
      })),
      artworkEvents: [
        {
          eventId: 'event1',
          version: 1,
          kind: 'ATTACH',
          groupIndex: 0,
          placementId: 'front',
          assetId: asset,
          expiresAt,
          erasedAt: null,
        },
      ],
    };
    return r.fulfill({ json: current });
  });
  await page.route('**/api/purchases/v1/' + id + '/lock', (r) => {
    assert.deepEqual(r.request().postDataJSON(), { expectedVersion: 1 });
    current = { ...current, artworkVersion: 2, artworkState: 'ARTWORK_LOCKED' };
    return r.fulfill({ json: current });
  });
  await page.route('**/api/purchases/v1/' + id + '/artwork/' + asset + '/download', (r) =>
    r.fulfill(
      denied
        ? { status: 403, json: { error: 'DENIED' } }
        : { json: { url: 'https://private.example/original.svg', expiresAt } },
    ),
  );
  await page.goto(base + '/admin/orders/' + id);
  await page
    .getByLabel('Upload artwork')
    .setInputFiles({ name: 'safe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await page.getByRole('img', { name: 'Verified artwork preview', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Attach artwork', exact: true }).click();
  await page.getByText('Artwork state: READY', { exact: true }).waitFor();
  assert.deepEqual(attachment, { expectedVersion: 0, groupIndex: 0, placementId: 'front', assetId: asset });
  await page.getByRole('button', { name: 'Lock artwork', exact: true }).click();
  await page.getByText('Artwork state: ARTWORK_LOCKED', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Upload artwork').count(), 0);
  await page.getByRole('button', { name: 'Prepare original download', exact: true }).click();
  await page.getByRole('link', { name: 'Download verified original', exact: true }).waitFor();
  denied = true;
  await page.getByRole('button', { name: 'Prepare original download', exact: true }).click();
  await page
    .getByText('Your Shopify identity or permission could not be verified. Reopen from Shopify Admin.', { exact: true })
    .waitFor();
  assert.equal(await page.getByRole('link', { name: 'Download verified original' }).count(), 0);
  assert.equal(await page.getByText('USD 90071992547409.93', { exact: true }).count(), 0);
});
test('stale lock stays READY and asks refresh without optimistic lock or fulfillment changes', {
  timeout: 15000,
}, async (t) => {
  const { page, base } = await fixture(t);
  const current = view('READY');
  current.groups[0].placements[0] = {
    ...current.groups[0].placements[0],
    currentAssetId: '0829a06c-e8c5-40aa-9167-4fb47e443231',
    currentExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  };
  let calls = 0;
  await page.route('**/api/purchases/v1/' + id, (r) => r.fulfill({ json: current }));
  await page.route('**/api/purchases/v1/' + id + '/lock', (r) => {
    calls++;
    assert.deepEqual(r.request().postDataJSON(), { expectedVersion: 0 });
    return r.fulfill({ status: 409, json: { error: 'CONFLICT' } });
  });
  await page.goto(base + '/admin/orders/' + id);
  await page.getByText('Artwork state: READY', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Lock artwork', exact: true }).click();
  await page.getByText('Artwork changed. Refresh the purchase before continuing.', { exact: true }).waitFor();
  assert.equal(calls, 1);
  assert.equal(await page.getByText('Artwork state: READY', { exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: /fulfill|refund|unlock/i }).count(), 0);
});
test('erased selected artwork permits explicit replacement only while bound design detail remains and is unlocked', {
  timeout: 15000,
}, async (t) => {
  const { page, base } = await fixture(t);
  let current = {
    ...view(),
    artworkState: 'ERASED',
    artworkVersion: 1,
    artworkEvents: [
      {
        eventId: 'erased1',
        version: 1,
        kind: 'ATTACH',
        groupIndex: 0,
        placementId: 'front',
        assetId: null,
        expiresAt: null,
        erasedAt: '2026-10-13T00:00:00Z',
      },
    ],
  };
  current.groups[0].placements[0] = {
    ...current.groups[0].placements[0],
    currentAssetId: null,
    currentExpiresAt: null,
    expired: true,
  };
  await page.route('**/api/purchases/v1/' + id, (r) => r.fulfill({ json: current }));
  await page.goto(base + '/admin/orders/' + id);
  await page
    .getByText('Selected artwork unavailable; explicitly replace within remaining detail retention.', { exact: true })
    .waitFor();
  assert.equal(await page.getByLabel('Upload artwork').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'View safe preview', exact: true }).count(), 0);
  current = {
    ...current,
    artworkEvents: [
      ...current.artworkEvents,
      {
        eventId: 'lock2',
        version: 2,
        kind: 'LOCK',
        groupIndex: null,
        placementId: null,
        assetId: null,
        expiresAt: null,
        erasedAt: null,
      },
    ],
    artworkVersion: 2,
  };
  await page.getByRole('button', { name: 'Refresh purchase', exact: true }).click();
  await page.getByText('Version 2: LOCK', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Upload artwork').count(), 0);
  current = { ...view(), groups: [], lines: [], exceptions: ['CONTEXT_UNVERIFIED'] };
  await page.getByRole('button', { name: 'Refresh purchase', exact: true }).click();
  await page
    .getByText('Customization binding requires reconciliation. No production authorization is established.', {
      exact: true,
    })
    .waitFor();
  assert.equal(await page.getByLabel('Upload artwork').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Lock artwork', exact: true }).count(), 0);
  assert.equal(await page.getByText('Artwork state: PENDING_ARTWORK', { exact: true }).count(), 0);
});
test('retention readback clears a displayed selected preview even when artwork version is unchanged', {
  timeout: 15000,
}, async (t) => {
  const { page, base } = await fixture(t);
  const asset = '0829a06c-e8c5-40aa-9167-4fb47e443231';
  const deadline = new Date(Date.now() + 86400000).toISOString();
  let current = view('READY');
  current.groups[0].placements[0] = {
    ...current.groups[0].placements[0],
    currentAssetId: asset,
    currentExpiresAt: deadline,
  };
  await page.route('**/api/purchases/v1/' + id, (r) => r.fulfill({ json: current }));
  await page.route('**/api/purchases/v1/' + id + '/artwork/' + asset + '/preview', (r) =>
    r.fulfill({ json: { url: 'https://private.example/old.png', expiresAt: deadline } }),
  );
  await page.route('**/api/purchases/v1/' + id + '/artwork/' + asset + '/download', (r) =>
    r.fulfill({ json: { url: 'https://private.example/old.svg', expiresAt: deadline } }),
  );
  await page.route('https://private.example/**', (r) => r.fulfill({ body: '' }));
  await page.goto(base + '/admin/orders/' + id);
  await page.getByRole('button', { name: 'Prepare original download', exact: true }).click();
  await page.getByRole('link', { name: 'Download verified original', exact: true }).waitFor();
  await page.getByRole('button', { name: 'View safe preview', exact: true }).click();
  await page.getByRole('img', { name: 'Verified PNG front', exact: true }).waitFor();
  await page.evaluate(() => {
    window.erasurePrivacyGap = false;
    new MutationObserver(() => {
      if (
        document.body.textContent.includes(
          'Selected artwork unavailable; explicitly replace within remaining detail retention.',
        ) &&
        (document.querySelector('img[alt="Verified PNG front"]') ||
          Array.from(document.querySelectorAll('a')).some((link) => link.textContent === 'Download verified original'))
      )
        window.erasurePrivacyGap = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  current = {
    ...current,
    artworkState: 'ERASED',
    groups: current.groups.map((g) => ({
      ...g,
      placements: g.placements.map((p) => ({ ...p, currentAssetId: null, currentExpiresAt: null, expired: true })),
    })),
  };
  await page.getByRole('button', { name: 'Refresh purchase', exact: true }).click();
  await page
    .getByText('Selected artwork unavailable; explicitly replace within remaining detail retention.', { exact: true })
    .waitFor();
  assert.equal(await page.getByRole('img', { name: 'Verified PNG front', exact: true }).count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Download verified original', exact: true }).count(), 0);
  assert.equal(
    await page.evaluate(() => window.erasurePrivacyGap),
    false,
    'no render may show erased current artwork, including before passive effects',
  );
});
test('Shopify refund records describe requested facts without claiming settled payment', {
  timeout: 15000,
}, async (t) => {
  const { page, base } = await fixture(t);
  let current = {
    ...view(),
    isTest: true,
    refunds: [
      {
        refundId: 'refund-pending',
        occurredAt: '2026-10-13T00:00:00Z',
        currency: 'USD',
        amountMinor: '4500',
        lines: [{ lineId: 'line1', quantity: 1, amountMinor: '4500' }],
      },
    ],
  };
  await page.route('**/api/purchases/v1/' + id, (r) => r.fulfill({ json: current }));
  await page.goto(base + '/admin/orders/' + id);
  await page.getByRole('heading', { name: 'Shopify refund records', exact: true }).waitFor();
  await page.getByText('Test order.', { exact: true }).waitFor();
  await page
    .getByText('Refund records do not prove that money has settled. Shopify remains the payment authority.', {
      exact: true,
    })
    .waitFor();
  await page.getByText('· line1: 1 recorded for refund, USD 45.00', { exact: true }).waitFor();
  assert.equal(await page.getByText(/1 refunded/).count(), 0);
  current = { ...current, isTest: null };
  await page.getByRole('button', { name: 'Refresh purchase', exact: true }).click();
  await page.getByText('Test status unavailable.', { exact: true }).waitFor();
});

test('merchant requests independent reconciliation without claiming current facts changed', {
  timeout: 20000,
}, async (t) => {
  const { page, base } = await fixture(t);
  const current = view();
  let requests = 0;
  await page.route('**/api/purchases/v1/' + id, (r) => r.fulfill({ json: current }));
  await page.route('**/api/purchases/v1/' + id + '/reconcile', (r) => {
    requests++;
    assert.deepEqual(r.request().postDataJSON(), {});
    return r.fulfill({ status: 202, json: current });
  });
  await page.goto(base + '/admin/orders/' + id);
  await page.getByText('USD 90071992547409.93', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Request reconciliation', exact: true }).click();
  await page
    .getByText('Reconciliation requested. Refresh later for independently read Shopify facts.', { exact: true })
    .waitFor();
  assert.equal(requests, 1);
  assert.equal(await page.getByText('USD 90071992547409.93', { exact: true }).count(), 1);
  assert.equal(await page.getByText('Shopify facts reconciled.', { exact: true }).count(), 0);
});

function historicalView() {
  const original = '0829a06c-e8c5-40aa-9167-4fb47e443231';
  const replacement = 'e3e03d15-0be4-44cd-a3cc-98f5474b44fa';
  const current = view('READY');
  const group = current.groups[0];
  group.geometry = {
    version: 'm5-geometry-v1',
    views: [
      {
        id: 'front',
        image: { revisionId: 'frozen', width: 100, height: 100 },
        variantImages: [],
        placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.5, height: 0.5 } }],
      },
    ],
    steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5 }],
  };
  group.geometry.views.push({
    id: 'back',
    image: { revisionId: 'frozen-back', width: 100, height: 100 },
    variantImages: [],
    placements: [{ id: 'back', rect: { centerX: 0.5, centerY: 0.5, width: 0.5, height: 0.5 } }],
  });
  group.variants.push({ variantId: '12', quantity: 1 });
  group.placements.push({
    ...group.placements[0],
    id: 'back',
    originalArtwork: { kind: 'deferred', intentId: 'back-later' },
  });
  group.imageUrls = {
    frozen: 'https://private.example/frozen.png',
    'frozen-back': 'https://private.example/frozen-back.png',
  };
  group.placements[0].originalArtwork = { kind: 'revision', revisionId: original };
  group.placements[0].currentAssetId = replacement;
  group.placements[0].currentExpiresAt = new Date(Date.now() + 60000).toISOString();
  return { original, replacement, current, group };
}

test('historical canvas composes the purchased original PNG at its frozen placement and does not substitute a replacement', {
  timeout: 20000,
}, async (t) => {
  const { page, base } = await fixture(t);
  const { original, current, group } = historicalView();
  const seen = [];
  await page.route('**/api/purchases/v1/' + id, (route) => route.fulfill({ json: current }));
  await page.route('**/api/purchases/v1/' + id + '/artwork/*/preview', (route) => {
    assert.equal(route.request().method(), 'GET');
    assert.equal(route.request().headers().authorization, 'Bearer synthetic-purchase-actor');
    seen.push(route.request().url().split('/').at(-2));
    return route.fulfill({
      json: {
        url: 'https://private.example/purchased-original.png',
        aspectRatio: 1,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    });
  });
  await page.route('https://private.example/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        route.request().url().endsWith('purchased-original.png')
          ? 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4IycHAALyARlzRAvLAAAAAElFTkSuQmCC'
          : 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
        'base64',
      ),
    }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/admin/orders/' + id);
  await page.getByText('Historical purchased artwork preview.', { exact: true }).waitFor();
  assert.deepEqual(seen, [original]);
  const canvas = page.getByRole('region', { name: 'Purchased design preview' }).locator('canvas').nth(1);
  const centerColor = async () => {
    const screenshot = await canvas.screenshot();
    return page.evaluate(async (png) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + png;
      await image.decode();
      const scratch = document.createElement('canvas');
      scratch.width = image.width;
      scratch.height = image.height;
      const context = scratch.getContext('2d');
      context.drawImage(image, 0, 0);
      return Array.from(
        context.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data,
      ).slice(0, 3);
    }, screenshot.toString('base64'));
  };
  assert.deepEqual(
    await centerColor(),
    [220, 30, 30],
    'actual canvas paints the verified original inside the purchased placement',
  );
  await page.screenshot({ path: '/tmp/insignia-lean-local-historical-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '/tmp/insignia-lean-local-historical-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  current.artworkVersion++;
  group.placements[0].currentAssetId = 'e365cfa1-bab9-42e6-b4c2-319baae86e69';
  const refreshedOriginal = page.waitForResponse((response) => response.url().endsWith('/' + original + '/preview'));
  await page.getByRole('button', { name: 'Refresh purchase', exact: true }).click();
  await (await refreshedOriginal).finished();
  await page.getByText('Historical purchased artwork preview.', { exact: true }).waitFor();
  assert.deepEqual(seen, [original, original]);
  assert.deepEqual(await centerColor(), [220, 30, 30]);
  const backImage = page.waitForResponse('https://private.example/frozen-back.png');
  await page.getByLabel('Preview view', { exact: true }).selectOption('back');
  await (await backImage).finished();
  await page.getByText('Historical purchased artwork preview.', { exact: true }).waitFor();
  assert.notDeepEqual(
    await centerColor(),
    [220, 30, 30],
    'another purchased view must not keep the previous placement artwork',
  );
  const frontOriginal = page.waitForResponse((response) => response.url().endsWith('/' + original + '/preview'));
  await page.getByLabel('Preview view', { exact: true }).selectOption('front');
  await (await frontOriginal).finished();
  await page.getByText('Historical purchased artwork preview.', { exact: true }).waitFor();
  const variantOriginal = page.waitForResponse((response) => response.url().endsWith('/' + original + '/preview'));
  await page.getByLabel('Purchased variant', { exact: true }).selectOption('12');
  await (await variantOriginal).finished();
  await page.getByText('Historical purchased artwork preview.', { exact: true }).waitFor();
  assert.deepEqual(await centerColor(), [220, 30, 30]);
});

test('historical preview never fetches or paints an original when its retained payload expires during access lookup', {
  timeout: 15000,
}, async (t) => {
  const { page, base } = await fixture(t);
  const { original, current, group } = historicalView();
  group.payloadExpiresAt = new Date(Date.now() + 1500).toISOString();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let requested;
  const started = new Promise((resolve) => {
    requested = resolve;
  });
  const imageRequests = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://private.example/')) imageRequests.push(request.url());
  });
  await page.route('**/api/purchases/v1/' + id, (route) => route.fulfill({ json: current }));
  await page.route('**/api/purchases/v1/' + id + '/artwork/' + original + '/preview', async (route) => {
    requested();
    await pending;
    await route.fulfill({
      json: {
        url: 'https://private.example/expired-original.png',
        aspectRatio: 1,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    });
  });
  await page.route('https://private.example/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
        'base64',
      ),
    }),
  );
  await page.goto(base + '/admin/orders/' + id);
  await started;
  await new Promise((resolve) => setTimeout(resolve, 1600));
  release();
  await page.getByText('Historical preview expired. Refresh to check current access.', { exact: true }).waitFor();
  assert.deepEqual(
    imageRequests,
    [],
    'expiry is checked again before renderer or PNG requests, not cleared only after a transient paint',
  );
  assert.equal(await page.getByRole('region', { name: 'Purchased design preview' }).locator('canvas').count(), 0);
});

test('missing historical originals remain explicit and permission loss clears all private purchase work', {
  timeout: 15000,
}, async (t) => {
  const { page, base } = await fixture(t);
  const { original, current } = historicalView();
  let denied = false;
  const seen = [];
  await page.route('**/api/purchases/v1/' + id, (route) => route.fulfill({ json: current }));
  await page.route('**/api/purchases/v1/' + id + '/artwork/*/preview', (route) => {
    seen.push(route.request().url().split('/').at(-2));
    return route.fulfill({ status: denied ? 403 : 404, json: { error: 'ARTWORK_UNAVAILABLE' } });
  });
  await page.route('https://private.example/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
        'base64',
      ),
    }),
  );
  await page.goto(base + '/admin/orders/' + id);
  await page.getByText('Historical preview: some original artwork is unavailable.', { exact: true }).waitFor();
  assert.deepEqual(seen, [original]);
  assert.equal(await page.getByText('Historical purchased artwork preview.', { exact: true }).count(), 0);
  denied = true;
  await page.getByRole('button', { name: 'Refresh historical preview', exact: true }).click();
  await page
    .getByText('Your Shopify identity or permission could not be verified. Reopen from Shopify Admin.', { exact: true })
    .waitFor();
  assert.equal(await page.locator('canvas').count(), 0);
  assert.equal(await page.getByText('USD 90071992547409.93', { exact: true }).count(), 0);
  assert.deepEqual(seen, [original, original]);
});

test('a late historical PNG lookup cannot restore a design after a same-version erasure readback', {
  timeout: 15000,
}, async (t) => {
  const { page, base } = await fixture(t);
  const { original, current, group } = historicalView();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let requested;
  const started = new Promise((resolve) => {
    requested = resolve;
  });
  const imageRequests = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://private.example/')) imageRequests.push(request.url());
  });
  await page.route('**/api/purchases/v1/' + id, (route) => route.fulfill({ json: current }));
  await page.route('**/api/purchases/v1/' + id + '/artwork/' + original + '/preview', async (route) => {
    requested();
    await pending;
    await route.fulfill({
      json: {
        url: 'https://private.example/late-original.png',
        aspectRatio: 1,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    });
  });
  await page.goto(base + '/admin/orders/' + id);
  await started;
  group.geometry = null;
  await page.getByRole('button', { name: 'Refresh purchase', exact: true }).click();
  await page.getByText('Historical preview unavailable.', { exact: true }).waitFor();
  const response = page.waitForResponse((request) => request.url().endsWith('/' + original + '/preview'));
  release();
  await (await response).finished();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('canvas').count(), 0);
  assert.deepEqual(imageRequests, []);
});

test('displayed historical artwork clears at its real preview expiry and refresh requires a new scoped read', {
  timeout: 15000,
}, async (t) => {
  const { page, base } = await fixture(t);
  const { original, current } = historicalView();
  let lookups = 0;
  await page.route('**/api/purchases/v1/' + id, (route) => route.fulfill({ json: current }));
  await page.route('**/api/purchases/v1/' + id + '/artwork/' + original + '/preview', (route) => {
    lookups++;
    return route.fulfill({
      json: {
        url: 'https://private.example/short-original.png',
        aspectRatio: 1,
        expiresAt: new Date(Date.now() + 1500).toISOString(),
      },
    });
  });
  await page.route('https://private.example/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
        'base64',
      ),
    }),
  );
  await page.goto(base + '/admin/orders/' + id);
  await page.getByText('Historical purchased artwork preview.', { exact: true }).waitFor();
  await page.getByText('Historical preview expired. Refresh to check current access.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: 'Purchased design preview' }).locator('canvas').count(), 0);
  assert.equal(lookups, 1);
  await page.getByRole('button', { name: 'Refresh historical preview', exact: true }).click();
  await page.getByText('Historical purchased artwork preview.', { exact: true }).waitFor();
  assert.equal(lookups, 2);
});
