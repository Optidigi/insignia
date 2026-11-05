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
