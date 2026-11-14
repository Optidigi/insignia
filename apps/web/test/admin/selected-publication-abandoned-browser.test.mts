import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import type { Page } from 'playwright';
import type { PublicationState } from '../../src/shared/admin-view.ts';
import { required } from './support/fixtures.mts';
import { editName, fixture, storedIntent } from './support/selected-browser.mts';

const restoring =
  'Publishing didn’t finish. Insignia is putting your product back as it was; this page updates when it’s done.';
const restored = 'Publishing didn’t finish, so your product is back as it was. Publish again when you’re ready.';
const support =
  'Publishing didn’t finish and this product may be unavailable in your store. Insignia support has to check it before it can be restored. Contact support and mention this product.';
const serverReason = 'Synthetic English server reason.';

/** #466: the server projects the publication state; the editor shows it through publicationNotice. */
async function serverState(t: TestContext, initial: PublicationState) {
  const f = await fixture(t);
  let state = initial;
  let requestKey: string | null = null;
  let publishKey: string | null = null;
  let publishes = 0;
  await f.page.route('**/api/admin/products/111/config', async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && JSON.parse(request.postData() ?? '{}').action === 'publish') {
      publishes++;
      publishKey = request.headers()['idempotency-key'] ?? null;
      return route.abort('timedout');
    }
    if (request.method() !== 'GET') return route.fallback();
    const view = f.view();
    const config = required(view.config);
    if (state !== 'DRAFT')
      config.publication = {
        ...config.publication,
        state,
        revisionId: 'revision-abandoned-111',
        sourceDraftVersion: config.draftVersion,
        requestKey,
        reason: serverReason,
      };
    return route.fulfill({ json: view });
  });
  return {
    ...f,
    set: (next: PublicationState, key: string | null = requestKey) => {
      state = next;
      requestKey = key;
    },
    publishKey: () => publishKey,
    publishes: () => publishes,
  };
}
const publishButton = (page: Page) => page.locator('s-button[slot="primary-action"]').filter({ hasText: /^Publish$/ });
const publishDisabled = (page: Page) =>
  publishButton(page).evaluate((button: HTMLElementTagNameMap['s-button']) => button.disabled === true);

test('#466: a reopened editor follows restoring to restored, keeps local edits and allows Publish again', {
  timeout: 60000,
}, async (t) => {
  const f = await serverState(t, 'ABANDONMENT_RESTORING');
  await f.open();
  const banner = f.page.locator('s-banner').filter({ hasText: restoring });
  await banner.waitFor();
  assert.equal(await banner.getAttribute('tone'), 'info');
  assert.equal(await publishDisabled(f.page), true, 'Publish is blocked while the product is restored');
  assert.equal(await f.page.getByText(serverReason).count(), 0, 'no English server reason');
  assert.equal(await banner.locator('s-button').count(), 0, 'no action while restoring');
  await editName(f.page, 'Edited while restoring');
  f.set('ABANDONED_RESTORED');
  // The editor polls a continuing publication and adopts only its publication metadata.
  const done = f.page.locator('s-banner').filter({ hasText: restored });
  await done.waitFor({ timeout: 20000 });
  assert.equal(await done.getAttribute('tone'), 'warning');
  assert.equal(await f.page.getByText(restoring).count(), 0);
  // Keyboard: the notice update neither steals focus nor drops what the merchant is typing.
  await f.page.keyboard.type(' more');
  assert.equal(
    await f.page.getByRole('textbox', { name: /^Placement name/ }).inputValue(),
    'Edited while restoring more',
  );
  assert.equal(await f.page.getByText(serverReason).count(), 0);
  assert.equal(await publishDisabled(f.page), false, 'Publish is enabled again');
  assert.equal(await done.locator('s-button').count(), 0, 'the notice holds no focus target');
  await publishButton(f.page).evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  await f.page.locator('s-modal').filter({ hasText: 'Publish setup' }).waitFor();
});

test('#466: an unanswered publish that was abandoned settles its journal and allows Publish again', {
  timeout: 60000,
}, async (t) => {
  const f = await serverState(t, 'DRAFT');
  await f.open();
  await publishButton(f.page).evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  const modal = f.page.locator('s-modal').filter({ hasText: 'Publish setup' });
  const unanswered = f.page.waitForEvent(
    'requestfailed',
    (request) => request.method() === 'POST' && JSON.parse(request.postData() ?? '{}').action === 'publish',
  );
  await modal.getByRole('button', { name: 'Publish', exact: true }).click();
  await unanswered;
  assert.ok(await storedIntent(f.page), 'the unanswered publish keeps its custody');
  // The worker restored the product and finalized the request; the read names it by its key.
  f.set('ABANDONED_RESTORED', f.publishKey());
  await f.page.waitForFunction(
    () =>
      !sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
    undefined,
    { timeout: 20000 },
  );
  await modal.waitFor({ state: 'hidden' });
  await f.page.locator('s-banner').filter({ hasText: restored }).waitFor();
  assert.equal(f.publishes(), 1, 'the abandoned request is never redispatched');
  assert.equal(await publishDisabled(f.page), false);
});

test('#466: a hold that needs support shows the support copy, blocks Publish and offers no reload', {
  timeout: 60000,
}, async (t) => {
  const f = await serverState(t, 'HOLD_NEEDS_SUPPORT');
  await f.open();
  const banner = f.page.locator('s-banner').filter({ hasText: support });
  await banner.waitFor();
  assert.equal(await banner.getAttribute('tone'), 'critical');
  assert.equal(await publishDisabled(f.page), true);
  assert.equal(await banner.locator('s-button').count(), 0);
  assert.equal(await f.page.getByText(serverReason).count(), 0);
  assert.equal(await f.page.getByText('Publication requires review.').count(), 0);
});
