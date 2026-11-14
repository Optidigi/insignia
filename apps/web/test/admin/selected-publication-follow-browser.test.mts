import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { MerchantDraftSchema } from '@insignia/contracts';
import type { Page } from 'playwright';
import { required } from './support/fixtures.mts';
import { fixture, storedIntent } from './support/selected-browser.mts';

const progress = 'Publishing. This can take up to a minute; this page updates when it finishes.';

/**
 * #436: the publish request gets no answer (client deadline or lost response) while the server
 * goes on and activates the publication. The built editor follows the original request through
 * ordinary config reads and settles it by its exact idempotency key, also when the server's stored
 * setup is not byte-identical to the journaled one.
 */
async function noAnswerPublication(
  t: TestContext,
  outcome: 'ACTIVE' | 'OPERATOR_HOLD' = 'ACTIVE',
  options: { clock?: boolean } = {},
) {
  const f = await fixture(t);
  if (options.clock) await f.page.clock.install();
  let publishKey: string | null = null;
  let settled = false;
  let reads = 0;
  await f.page.route('**/api/admin/products/111/config', async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && JSON.parse(request.postData() ?? '{}').action === 'publish') {
      publishKey = request.headers()['idempotency-key'] ?? null;
      return route.abort('timedout');
    }
    if (request.method() !== 'GET') return route.fallback();
    reads++;
    const view = f.view();
    if (!settled) return route.fulfill({ json: view });
    const config = required(view.config);
    const stored = MerchantDraftSchema.parse(config.draft);
    // The server's canonical form of the saved setup differs from the client's journaled bytes.
    const canonical = structuredClone(required(stored.selectedSetup));
    const size = required(canonical.product.views[0]?.placements[0]?.sizes[0]);
    size.widthPercent = `${size.widthPercent}.0`;
    config.draft = { ...stored, selectedSetup: canonical };
    config.publication = {
      ...config.publication,
      state: outcome,
      revisionId: 'revision-selected-111',
      activeRevisionId: outcome === 'ACTIVE' ? 'revision-selected-111' : null,
      sourceDraftVersion: config.draftVersion,
      requestKey: publishKey,
      reason: outcome === 'ACTIVE' ? null : 'Publication requires operator review.',
    };
    config.publishedSetup = outcome === 'ACTIVE' ? canonical : null;
    return route.fulfill({ json: view });
  });
  await f.open();
  await f.page
    .locator('s-button[slot="primary-action"]')
    .filter({ hasText: /^Publish$/ })
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  const modal = f.page.locator('s-modal').filter({ hasText: 'Publish setup' });
  const unanswered = f.page.waitForEvent(
    'requestfailed',
    (request) => request.method() === 'POST' && JSON.parse(request.postData() ?? '{}').action === 'publish',
  );
  await modal.getByRole('button', { name: 'Publish', exact: true }).click();
  await unanswered;
  assert.ok(publishKey, 'the publish request was dispatched');
  // The dialog keeps following the request instead of reporting a failure.
  await modal.getByText(progress, { exact: true }).waitFor();
  assert.equal(await modal.getByText(/could not be published/).count(), 0);
  assert.ok(await storedIntent(f.page), 'the unanswered publish keeps its custody');
  return {
    ...f,
    modal,
    activate: () => {
      settled = true;
    },
    reads: () => reads,
  };
}
const custodyCleared = (page: Page, timeout: number) =>
  page.waitForFunction(
    () =>
      !sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
    undefined,
    { timeout },
  );
async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('#436: an unanswered publish shows progress and settles to Published without a reload', {
  timeout: 40000,
}, async (t) => {
  const f = await noAnswerPublication(t);
  f.activate();
  await custodyCleared(f.page, 12000);
  await f.modal.waitFor({ state: 'hidden' });
  await f.page.getByText('Published', { exact: true }).first().waitFor();
  assert.equal(
    f.mutations.filter((entry) => JSON.parse(entry.body).action === 'publish').length,
    0,
    'the follow-up never redispatches the publish command',
  );
  assert.equal(
    await f.page.locator('ui-save-bar button[variant="primary"][loading]').count(),
    0,
    'no save spinner remains',
  );
});

test('#436: a hidden tab catches up as soon as it becomes visible again', { timeout: 40000 }, async (t) => {
  const f = await noAnswerPublication(t);
  await setVisibility(f.page, 'hidden');
  f.activate();
  const before = f.reads();
  // Longer than one poll interval: a hidden tab does not poll.
  await f.page.waitForTimeout(6000);
  assert.equal(f.reads(), before, 'a hidden tab skips the poll');
  assert.ok(await storedIntent(f.page));
  const shown = Date.now();
  await setVisibility(f.page, 'visible');
  await custodyCleared(f.page, 2000);
  await f.page.getByText('Published', { exact: true }).first().waitFor();
  assert.ok(Date.now() - shown < 2500, 'visible again, the editor reads at once instead of at the next poll');
});

test('#436: an unanswered publish that stops for review shows that, not a spinner', { timeout: 40000 }, async (t) => {
  const f = await noAnswerPublication(t, 'OPERATOR_HOLD');
  f.activate();
  await f.modal.waitFor({ state: 'hidden', timeout: 12000 });
  await f.page.getByText('Publication requires review.').first().waitFor();
  assert.equal(await f.page.getByText(progress, { exact: true }).count(), 0);
  assert.equal(await f.page.locator('ui-save-bar button[variant="primary"][loading]').count(), 0);
});

test('#436: a followed publish that never settles offers to continue the original request', {
  timeout: 40000,
}, async (t) => {
  const f = await noAnswerPublication(t, 'ACTIVE', { clock: true });
  assert.equal(await f.page.getByRole('button', { name: 'Retry', exact: true }).count(), 0);
  // The server stops at the session's expiry; after the follow window the original request can be continued.
  await f.page.clock.fastForward(46_000);
  await f.modal
    .getByText('Publication is still processing. Continue the original request to check its status.', { exact: true })
    .waitFor();
  await f.page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  assert.equal(await f.page.getByText(progress, { exact: true }).count(), 0);
  assert.ok(await storedIntent(f.page), 'the original request keeps its custody');
});

test('#436: a publish that was never sent is a failure, not followed progress', { timeout: 40000 }, async (t) => {
  const f = await fixture(t);
  let publishes = 0;
  await f.page.route('**/api/admin/products/111/config', async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && JSON.parse(request.postData() ?? '{}').action === 'publish') publishes++;
    if (request.method() === 'PUT') {
      // The session cannot be renewed for the publish request that follows the confirmed save.
      await f.page.evaluate(() => {
        window.shopify.idToken = async () => {
          throw new Error('Open this page from Shopify Admin to verify your session.');
        };
      });
    }
    return route.fallback();
  });
  await f.open();
  await f.page
    .locator('s-button[slot="primary-action"]')
    .filter({ hasText: /^Publish$/ })
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  const modal = f.page.locator('s-modal').filter({ hasText: 'Publish setup' });
  await modal.getByRole('button', { name: 'Publish', exact: true }).click();
  await modal.getByText(/could not be published/).waitFor();
  assert.equal(publishes, 0, 'no publish request was sent');
  assert.equal(await f.page.getByText(progress, { exact: true }).count(), 0);
});
