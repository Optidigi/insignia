import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './support/selected-browser.mts';

declare global {
  interface Window {
    qa009OriginalDismiss: () => void;
    qa009Pending: (() => void)[];
    qa009Hosts: Map<string, { onDismiss(): void; buttons: { label: string; onAction(): void }[] }>;
  }
}

// Only the host promise/callback timing is synthetic: the selected editor and
// s-modal implementation are the actual built entry and pinned Polaris bytes.
for (const mode of ['Cancel', 'host-dismiss'] as const) {
  test(`QA009 opening ${mode} retires a late host show without writes`, { timeout: 20000 }, async (t) => {
    const f = await fixture(t, { shopifyModal: true });
    await f.page.addInitScript(() => {
      window.qa009Pending = [];
      window.qa009Hosts = new Map();
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
          window.qa009Hosts.set(id, { onDismiss: options.onDismiss, buttons });
          return new Promise<void>((resolve) => window.qa009Pending.push(resolve));
        },
        async hide(id) {
          const host = window.qa009Hosts.get(id);
          if (!host) return;
          window.qa009Hosts.delete(id);
          scrims.get(id)?.remove();
          host.onDismiss();
        },
      };
    });
    await f.open();
    const trigger = f.page.locator('[data-outline-add-view]');
    await trigger.click();
    await f.page.waitForFunction(() => window.qa009Pending.length === 1);
    const picker = f.page.locator('s-modal[data-method-dialog]');
    const originalId = await picker.getAttribute('id');
    await f.page.evaluate((mode) => {
      const entry = [...window.qa009Hosts.entries()].at(-1);
      if (!entry) throw new Error('Expected pending modal');
      const [id, host] = entry;
      window.qa009OriginalDismiss = host.onDismiss;
      if (mode === 'Cancel') {
        const cancel = host.buttons.find((button) => button.label === 'Cancel');
        if (!cancel) throw new Error('Expected exported Cancel action');
        cancel.onAction();
      } else {
        window.qa009Hosts.delete(id);
        document.querySelector('[data-shopify-host-modal-scrim]')?.remove();
        host.onDismiss();
      }
      window.qa009Pending.shift()?.();
    }, mode);
    await picker.waitFor({ state: 'detached' });
    await f.page.locator('[data-shopify-host-modal-scrim]').waitFor({ state: 'detached' });
    assert.equal(await f.page.evaluate(() => window.qa009Hosts.size), 0);
    await f.page.waitForFunction(() => document.activeElement === document.querySelector('[data-outline-add-view]'));
    assert.equal(f.mutations.length, 0);

    // A stale host callback must not close a new picker session.
    await trigger.click();
    await f.page.waitForFunction(() => window.qa009Pending.length === 1);
    await f.page.evaluate(() => window.qa009Pending.shift()?.());
    await picker.waitFor({ state: 'visible' });
    assert.notEqual(await picker.getAttribute('id'), originalId);
    await f.page.evaluate(async () => {
      window.qa009OriginalDismiss();
      await Promise.allSettled(document.getAnimations().map((animation) => animation.finished));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await picker.isVisible(), true);
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
    await picker.waitFor({ state: 'detached' });
    await f.page.locator('[data-shopify-host-modal-scrim]').waitFor({ state: 'detached' });
    assert.equal(f.mutations.length, 0);
  });
}
