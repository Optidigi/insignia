import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateCustomerWordingOverlay } from '@insignia/ui-localization/customer';
import { createCustomerTranslationsWorkflow } from '../../src/islands/customer-translations-workflow.ts';

test('customer wording resolves the authenticated shop before loading without App Bridge shop metadata', async () => {
  const workflow = createCustomerTranslationsWorkflow({ shop: null, resolveShop: async () => 'verified.myshopify.com', validateOverlay: validateCustomerWordingOverlay, storage: {
    read: () => ({ version: 1, shop: 'verified.myshopify.com', overlays: { en: { locale: 'en', messages: {} } } }), write: () => {}, remove: () => {},
  } });
  assert.equal(await workflow.load(), true);
  assert.equal(workflow.getSnapshot().shop, 'verified.myshopify.com');
  workflow.dispose();
});
test('failed shop discovery uses existing load failure/retry and never reads another shop or replaces dirty edits', async () => {
  let fail = true, calls = 0, reads = 0;
  const workflow = createCustomerTranslationsWorkflow({ shop: null, resolveShop: async () => { calls++; if (fail) throw new Error('Unavailable'); return 'verified.myshopify.com'; }, validateOverlay: validateCustomerWordingOverlay, storage: {
    read: () => { reads++; return { version: 1, shop: 'verified.myshopify.com', overlays: { en: { locale: 'en', messages: {} } } }; }, write: () => {}, remove: () => {},
  } });
  assert.equal(await workflow.load(), false);
  assert.equal(workflow.getSnapshot().error, 'storage-read-failed');
  assert.equal(reads, 0);
  fail = false;
  assert.equal(await workflow.load(), true);
  workflow.editMessage('customer:steps.done', 'message', 'Finished');
  assert.equal(await workflow.load(), false);
  assert.equal(calls, 2, 'a background reload may not replace an active dirty editor');
  assert.equal(workflow.getSnapshot().currentOverlay.messages['customer:steps.done']?.message, 'Finished');
  workflow.dispose();
});

const busy = () => Object.assign(new Error('Shopify is busy. Try again in a few seconds.'), { status: 409, code: 'BUSY' });
const english = { version: 1, shop: 'verified.myshopify.com', overlays: { en: { locale: 'en', messages: {} } } } as const;
test('Shopify throttling while loading is reported as busy, not as an unreadable store, and a retry loads', async () => {
  for (const resolve of [true, false]) {
    let throttled = true;
    const workflow = createCustomerTranslationsWorkflow({
      shop: resolve ? null : 'verified.myshopify.com',
      resolveShop: resolve
        ? async () => {
            if (throttled) throw busy();
            return 'verified.myshopify.com';
          }
        : undefined,
      validateOverlay: validateCustomerWordingOverlay,
      storage: {
        read: () => {
          if (throttled && !resolve) throw busy();
          return english;
        },
        write: () => {},
        remove: () => {},
      },
    });
    assert.equal(await workflow.load(), false);
    assert.equal(workflow.getSnapshot().error, 'busy');
    throttled = false;
    assert.equal(await workflow.load(), true);
    workflow.dispose();
  }
});
test('Shopify throttling while saving keeps the edits and is reported as busy; other failures stay general', async () => {
  let failure: Error | null = busy();
  const workflow = createCustomerTranslationsWorkflow({
    shop: 'verified.myshopify.com',
    validateOverlay: validateCustomerWordingOverlay,
    storage: {
      read: () => english,
      write: () => {
        if (failure) throw failure;
      },
      remove: () => {},
    },
  });
  await workflow.load();
  workflow.editMessage('customer:steps.done', 'message', 'Finished');
  assert.equal(await workflow.save(), false);
  assert.equal(workflow.getSnapshot().saveError, 'busy');
  assert.equal(workflow.getSnapshot().currentOverlay.messages['customer:steps.done']?.message, 'Finished');
  failure = new Error('Admin service unavailable');
  assert.equal(await workflow.save(), false);
  assert.equal(workflow.getSnapshot().saveError, 'storage-write-failed');
  failure = null;
  assert.equal(await workflow.save(), true);
  assert.equal(workflow.getSnapshot().saveError, null);
  workflow.dispose();
});
