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
  await page.goto(base + '/admin/orders/' + id);
  await page.getByText('USD 90071992547409.93', { exact: true }).waitFor();
  await page.getByText('Historical preview unavailable.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Lock artwork', exact: true }).isEnabled(), false);
  await page.screenshot({ path: '/tmp/insignia-m8-local-order-demo.png', fullPage: true });
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
