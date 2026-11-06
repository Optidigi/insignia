import assert from 'node:assert/strict';
import { test } from 'node:test';
import { required } from './support/fixtures.mts';
import { draft, editName, fixture, storedIntent } from './support/selected-browser.mts';

// Built selected UI + real Polaris; synthetic authenticated provider responses.
test('terminal failed publication releases draft editing and never reports the previous active version as new success', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  let publishing = false;
  await f.page.route('**/api/admin/products/111/config', (route) => {
    const request = route.request();
    if (request.method() === 'POST' && request.postDataJSON().action === 'publish') {
      publishing = true;
      return route.fulfill({ status: 202, json: { kind: 'accepted', state: 'FAILED', revisionId: 'failed-revision' } });
    }
    if (request.method() !== 'GET') return route.fallback();
    const view = f.view(),
      config = required(view.config);
    config.publication = {
      ...config.publication,
      state: publishing ? 'FAILED' : 'ACTIVE',
      revisionId: publishing ? 'failed-revision' : 'old-revision',
      sourceDraftVersion: publishing ? '2' : '1',
      activeRevisionId: 'old-revision',
      requestKey: publishing ? 'm5pub_cfg-selected-111_2_1' : 'm5pub_cfg-selected-111_1_1',
      reason: publishing ? 'The request failed; review the saved draft.' : null,
    };
    config.publishedSetup = structuredClone(required(draft.selectedSetup));
    return route.fulfill({ json: view });
  });
  await f.open();
  await editName(f.page, 'A newer draft for publication');
  await f.page
    .locator('s-button[slot="primary-action"]')
    .filter({ hasText: /^Publish$/ })
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  const modal = f.page.locator('s-modal').filter({ hasText: 'Publish setup' });
  await modal.getByRole('button', { name: 'Publish preview', exact: true }).click();
  await f.page
    .getByText('Publication failed. Review the saved draft and publication status before trying again.', {
      exact: true,
    })
    .first()
    .waitFor();
  assert.equal(await storedIntent(f.page), null);
  assert.equal(await f.page.getByText('Published', { exact: true }).count(), 0);
  await editName(f.page, 'Draft remains editable after failure');
  assert.equal(
    await f.page.getByRole('textbox', { name: /^Placement name/ }).inputValue(),
    'Draft remains editable after failure',
  );
  assert.equal(f.mutations.filter((entry) => entry.method === 'PUT').length, 1);
});
