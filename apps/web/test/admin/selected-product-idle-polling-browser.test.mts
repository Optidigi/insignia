import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MerchantDraftSchema } from '@insignia/contracts';
import type { Page } from 'playwright';
import { required } from './support/fixtures.mts';
import { fixture } from './support/selected-browser.mts';

// Scope: real built merchant UI in an isolated browser with synthetic provider HTTP and a controlled page clock.
// The editor reads product status on a timer: every 5 s while a write or publication is unresolved, every 30 s
// otherwise (to notice another session's changes or a lost session), and never in a hidden tab.

const FOLLOWING_MS = 5000;
const IDLE_MS = 30000;

/** Reads of the product configuration or merchant preferences: what the status read requests. */
function countStatusReads(page: Page) {
  let count = 0;
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && (path === '/api/admin/preferences' || path === '/api/admin/products/111/config'))
      count++;
  });
  return () => count;
}

/** Let in-flight reads reach the network after the page clock moved. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 700));

test('an idle editor with the Add views picker open reads only on the slow idle interval', {
  timeout: 60000,
}, async (t) => {
  const f = await fixture(t);
  await f.page.clock.install();
  await f.open();
  await f.page.locator('[data-outline-add-view]').click();
  await f.page
    .locator('s-modal')
    .filter({ has: f.page.locator('.placement-image-picker') })
    .waitFor({ state: 'visible' });
  const reads = countStatusReads(f.page);
  await f.page.clock.runFor(11500);
  await settle();
  assert.equal(reads(), 0, 'nothing is pending, so nothing is re-requested at the following rate');
  await f.page.clock.runFor(IDLE_MS - 11500 + 500);
  await settle();
  assert.ok(reads() >= 2, `the idle read happens by 30 s (reads: ${reads()})`);
  await f.page.clock.runFor(IDLE_MS);
  await settle();
  assert.ok(reads() >= 4, `and repeats on the idle interval (reads: ${reads()})`);
});

test('an idle editor still refreshes when the tab regains focus', { timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  await f.open();
  const reads = countStatusReads(f.page);
  await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await settle();
  assert.ok(reads() >= 1, 'regaining focus reads the current state');
});

test('a publication the server is still carrying out keeps being followed at 5 s', {
  timeout: 60000,
}, async (t) => {
  const f = await fixture(t, { publicationPending: true });
  await f.page.clock.install();
  await f.open();
  await f.page
    .locator('s-button[slot="primary-action"]')
    .filter({ hasText: /^Publish$/ })
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  const modal = f.page.locator('s-modal').filter({ hasText: 'Publish setup' });
  await modal.getByRole('button', { name: 'Publish', exact: true }).click();
  await settle();
  const reads = countStatusReads(f.page);
  await f.page.clock.runFor(FOLLOWING_MS * 2 + 500);
  await settle();
  assert.ok(reads() >= 2, `a pending publication is re-read every 5 s (reads: ${reads()})`);
});

test('a reloaded editor follows a publication the server is carrying out, then falls back to the idle rate', {
  timeout: 60000,
}, async (t) => {
  const f = await fixture(t);
  let carrying = true;
  await f.page.route('**/api/admin/products/111/config', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const view = f.view();
    const config = required(view.config);
    config.publication = {
      ...config.publication,
      state: carrying ? 'REMOTE_PENDING' : 'ACTIVE',
      revisionId: 'revision-selected-111',
      activeRevisionId: carrying ? null : 'revision-selected-111',
      sourceDraftVersion: config.draftVersion,
      requestKey: 'm5pub_cfg-selected-111_2_1',
    };
    config.publishedSetup = carrying ? null : (MerchantDraftSchema.parse(config.draft).selectedSetup ?? null);
    return route.fulfill({ json: view });
  });
  await f.page.clock.install();
  await f.open();
  const reads = countStatusReads(f.page);
  await f.page.clock.runFor(FOLLOWING_MS + 500);
  await settle();
  assert.ok(reads() >= 2, `no local custody, yet the pending server publication is read at 5 s (reads: ${reads()})`);
  carrying = false;
  await f.page.clock.runFor(FOLLOWING_MS);
  await settle();
  await f.page.getByText('Published', { exact: true }).first().waitFor();
  const settled = reads();
  await f.page.clock.runFor(IDLE_MS - 5000);
  await settle();
  assert.equal(reads(), settled, 'settled: no more reads at the 5 s rate');
  await f.page.clock.runFor(IDLE_MS);
  await settle();
  assert.ok(reads() > settled, 'only the idle interval remains');
});
