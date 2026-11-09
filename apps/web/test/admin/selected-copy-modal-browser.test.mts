import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './support/selected-browser.mts';

// Synthetic Shopify host protocol around the actual built Copy actions; not native pointer qualification.
test('Copy Cancel releases its host scrim and host dismissal allows a fresh session', { timeout: 30000 }, async (t) => {
  const f = await fixture(t, { shopifyModal: true, deferShopifyModalDismiss: true });
  await f.open();
  const open = () =>
    f.page
      .locator('s-menu#placement-page-actions s-button')
      .filter({ hasText: 'Copy setup to products' })
      .evaluate((button: HTMLElement) => button.click());
  const dialog = f.page.locator('s-modal').filter({ has: f.page.locator('.placement-setup-copy') });
  const scrims = f.page.locator('[data-shopify-host-modal-scrim]');
  await open();
  await dialog.waitFor({ state: 'attached' });
  await f.page.waitForFunction(() => document.querySelectorAll('[data-shopify-host-modal-scrim]').length === 1);
  const firstId = await dialog.getAttribute('id');
  assert.ok(firstId);
  await dialog.locator('.placement-setup-copy__loading').waitFor({ state: 'detached' });
  assert.equal(await dialog.getAttribute('id'), firstId, 'Loading completion must retain the session identity');
  await dialog.locator('s-button[slot="secondary-actions"]').evaluate((button: HTMLElement) => button.click());
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await scrims.count(), 0, 'Cancel must release the Shopify host scrim');
  await open();
  await dialog.waitFor({ state: 'attached' });
  assert.notEqual(await dialog.getAttribute('id'), firstId, 'Reopening creates a fresh session identity');
  await f.page.evaluate(() => window.finishShopifyModalDismiss());
  assert.equal(await dialog.count(), 1, 'A retired session callback must not close its replacement');
  await f.page.evaluate(() => window.dismissShopifyModal());
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await scrims.count(), 0);
  await open();
  await dialog.locator('.placement-setup-copy__loading').waitFor({ state: 'detached' });
  assert.equal(await scrims.count(), 1);
  assert.equal(f.mutations.length, 0);
});

test('Copy can cancel pending discovery and ignore its late response after reopening', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t, { shopifyModal: true });
  await f.open();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  t.after(() => release.resolve());
  let reads = 0;
  await f.page.route('**/api/admin/products?*', async (route) => {
    if (++reads === 1) {
      started.resolve();
      await release.promise;
    }
    await route.fallback().catch(() => {});
  });
  const open = () =>
    f.page
      .locator('s-menu#placement-page-actions s-button')
      .filter({ hasText: 'Copy setup to products' })
      .evaluate((button: HTMLElement) => button.click());
  const dialog = f.page.locator('s-modal').filter({ has: f.page.locator('.placement-setup-copy') });
  await open();
  await started.promise;
  const aborted = f.page.waitForEvent('requestfailed', {
    predicate: (request) => new URL(request.url()).pathname === '/api/admin/products',
  });
  await dialog.locator('s-button[slot="secondary-actions"]').evaluate((button: HTMLElement) => button.click());
  await dialog.waitFor({ state: 'detached' });
  assert.match((await aborted).failure()?.errorText ?? '', /abort|cancel/i);
  assert.equal(await f.page.locator('[data-shopify-host-modal-scrim]').count(), 0);
  await open();
  await dialog.locator('.placement-setup-copy__loading').waitFor({ state: 'detached' });
  release.resolve();
  await f.page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  assert.equal(await dialog.count(), 1);
  assert.equal(await f.page.locator('[data-shopify-host-modal-scrim]').count(), 1);
  assert.equal(f.mutations.length, 0);
});

declare global {
  interface Window {
    copyPendingOriginalDismiss: () => void;
    copyPendingPending: (() => void)[];
    copyPendingHosts: Map<string, { onDismiss(): void; buttons: { label: string; onAction(): void }[] }>;
  }
}

// Only the host promise/callback timing is synthetic: the selected editor and
// s-modal implementation are the actual built entry and pinned Polaris bytes.
for (const mode of ['Cancel', 'host-dismiss'] as const) {
  test(`Copy opening ${mode} retires a late host show without writes`, { timeout: 20000 }, async (t) => {
    const f = await fixture(t, { shopifyModal: true });
    await f.page.addInitScript(() => {
      window.copyPendingPending = [];
      window.copyPendingHosts = new Map();
      const scrims = new Map<string, HTMLElement>();
      if (!window.shopify?._internal) throw new Error('Expected synthetic Shopify host');
      window.shopify._internal.modal = {
        show(id, options) {
          if (!id || !options) throw new Error('Expected routed host modal');
          const scrim = document.createElement('div');
          scrim.dataset.shopifyHostModalScrim = '';
          document.body.append(scrim);
          scrims.set(id, scrim);
          if (!options.onDismiss) throw new Error('Expected host dismissal callback');
          const buttons = (options.buttons ?? []).filter(
            (button): button is { label: string; onAction(): void } =>
              !!button &&
              typeof button === 'object' &&
              'label' in button &&
              typeof button.label === 'string' &&
              'onAction' in button &&
              typeof button.onAction === 'function',
          );
          window.copyPendingHosts.set(id, { onDismiss: options.onDismiss, buttons });
          return new Promise<void>((resolve) => window.copyPendingPending.push(resolve));
        },
        async hide(id) {
          const host = window.copyPendingHosts.get(id);
          if (!host) return;
          window.copyPendingHosts.delete(id);
          scrims.get(id)?.remove();
          host.onDismiss();
        },
      };
    });
    await f.open();
    const trigger = f.page
      .locator('s-menu#placement-page-actions s-button')
      .filter({ hasText: 'Copy setup to products' });
    await trigger.evaluate((button: HTMLElement) => button.click());
    await f.page.waitForFunction(() => window.copyPendingPending.length === 1);
    const picker = f.page.locator('s-modal').filter({ has: f.page.locator('.placement-setup-copy') });
    const originalId = await picker.getAttribute('id');
    await f.page.evaluate((mode) => {
      const entry = [...window.copyPendingHosts.entries()].at(-1);
      if (!entry) throw new Error('Expected pending modal');
      const [id, host] = entry;
      window.copyPendingOriginalDismiss = host.onDismiss;
      if (mode === 'Cancel') {
        const cancel = host.buttons.find((button) => button.label === 'Cancel');
        if (!cancel) throw new Error('Expected exported Cancel action');
        cancel.onAction();
      } else {
        window.copyPendingHosts.delete(id);
        document.querySelector('[data-shopify-host-modal-scrim]')?.remove();
        host.onDismiss();
      }
      window.copyPendingPending.shift()?.();
    }, mode);
    await picker.waitFor({ state: 'detached' });
    await f.page.locator('[data-shopify-host-modal-scrim]').waitFor({ state: 'detached' });
    assert.equal(await f.page.evaluate(() => window.copyPendingHosts.size), 0);

    assert.equal(f.mutations.length, 0);

    // A stale host callback must not close a new picker session.
    await trigger.evaluate((button: HTMLElement) => button.click());
    await f.page.waitForFunction(() => window.copyPendingPending.length === 1);
    await f.page.evaluate(() => window.copyPendingPending.shift()?.());
    await picker.waitFor({ state: 'visible' });
    assert.notEqual(await picker.getAttribute('id'), originalId);
    await f.page.evaluate(async () => {
      window.copyPendingOriginalDismiss();
      await Promise.allSettled(document.getAnimations().map((animation) => animation.finished));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await picker.isVisible(), true);
    await picker.locator('s-button[slot="secondary-actions"]').evaluate((button: HTMLElement) => button.click());
    await picker.waitFor({ state: 'detached' });
    await f.page.locator('[data-shopify-host-modal-scrim]').waitFor({ state: 'detached' });
    assert.equal(f.mutations.length, 0);
  });
}
