import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { fixture } from './support/selected-browser.mts';

// Scope: real built merchant UI in an isolated browser with synthetic provider HTTP (#454 loose end).
// The editor's status poll is a timer every 5 s; it must run only while a write or publication is unresolved.

const POLL_MS = 5000;

/** Reads of the product configuration or merchant preferences: what the status poll requests. */
function countStatusReads(page: Page) {
  let count = 0;
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && (path === '/api/admin/preferences' || path === '/api/admin/products/111/config'))
      count++;
  });
  return () => count;
}

test('an idle editor with the Add views picker open makes no periodic status requests', {
  timeout: 60000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  await f.page.locator('[data-outline-add-view]').click();
  await f.page
    .locator('s-modal')
    .filter({ has: f.page.locator('.placement-image-picker') })
    .waitFor({ state: 'visible' });
  const reads = countStatusReads(f.page);
  await f.page.waitForTimeout(POLL_MS * 2 + 1500);
  assert.equal(reads(), 0, 'nothing is pending, so nothing is re-requested');
  // Returning to the tab still refreshes once: an event, not a timer.
  await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await f.page.waitForTimeout(500);
  assert.ok(reads() >= 1, 'regaining focus reads the current state');
});

test('a publication the server is still carrying out keeps being followed', { timeout: 60000 }, async (t) => {
  const f = await fixture(t, { publicationPending: true });
  await f.open();
  await f.page
    .locator('s-button[slot="primary-action"]')
    .filter({ hasText: /^Publish$/ })
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  const modal = f.page.locator('s-modal').filter({ hasText: 'Publish setup' });
  await modal.getByRole('button', { name: 'Publish', exact: true }).click();
  const reads = countStatusReads(f.page);
  await f.page.waitForTimeout(POLL_MS * 2 + 1500);
  assert.ok(reads() >= 2, `a pending publication is re-read on the poll (reads: ${reads()})`);
});
