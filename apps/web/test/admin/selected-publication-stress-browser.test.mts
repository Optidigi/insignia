import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { MerchantDraftSchema } from '@insignia/contracts';
import { required } from './support/fixtures.mts';
import { draft, editName, fixture, hostSave, storedIntent } from './support/selected-browser.mts';

async function openPublication(page: import('playwright').Page) {
  await page
    .locator('s-button[slot="primary-action"]')
    .filter({ hasText: /^Publish$/ })
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  return page.locator('s-modal').filter({ hasText: 'Publish setup' });
}
async function settleFrame(page: import('playwright').Page) {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}
async function canvasPixels(page: import('playwright').Page) {
  await settleFrame(page);
  const canvases = page.locator('.placement-canvas canvas');
  assert.equal(await canvases.count(), 3, 'All actual Konva layers must be constructed');
  // Browser screenshots inspect the rendered composite without exporting cross-origin image data from canvas.
  return canvases.first().screenshot({ animations: 'disabled' });
}

const iterations = Number(process.env.INSIGNIA_PUBLICATION_STRESS_ITERATIONS ?? '1');
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100)
  throw new Error('Invalid publication stress iteration count');
for (let iteration = 1; iteration <= iterations; iteration++) {
  const stressTest = (name: string, options: { timeout: number }, body: (t: TestContext) => Promise<void>) =>
    test(`[${iteration}/${iterations}] ${name}`, options, async (t) => {
      try {
        await body(t);
      } catch (error) {
        console.error('PUBLICATION_STRESS_FIRST_FAILURE', JSON.stringify({ iteration, name }));
        throw error;
      }
    });
  stressTest(
    'a passive current publication observation preserves dirty selected edits and never mutates',
    {
      timeout: 20000,
    },
    async (t) => {
      const f = await fixture(t);
      let active = false;
      let reads = 0;
      await f.page.route('**/api/admin/products/111/config', (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        reads++;
        const view = f.view();
        if (active) {
          const config = required(view.config);
          config.publication = {
            ...config.publication,
            state: 'ACTIVE',
            revisionId: 'activated-revision',
            activeRevisionId: 'activated-revision',
            sourceDraftVersion: '1',
            requestKey: 'm5pub_cfg-selected-111_1_1',
          };
          config.publishedSetup = structuredClone(required(draft.selectedSetup));
        }
        return route.fulfill({ json: view });
      });
      await f.open();
      const originalPixels = await canvasPixels(f.page);
      await f.page.getByRole('textbox', { name: 'Center X', exact: true }).fill('60');
      await editName(f.page, 'Preserve local edit across activation');
      const pixels = await canvasPixels(f.page);
      assert.notDeepEqual(
        pixels,
        originalPixels,
        'The actual renderer must paint the edited geometry before publication observation',
      );
      active = true;
      const observation = f.page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' && response.url().endsWith('/api/admin/products/111/config'),
      );
      await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await observation;
      assert.equal(await f.page.getByRole('textbox', { name: 'Center X', exact: true }).inputValue(), '60');
      assert.deepEqual(await canvasPixels(f.page), pixels, 'Publication metadata must not repaint a different draft');
      assert.ok(reads >= 2);
      assert.equal(
        await f.page.getByRole('textbox', { name: /^Placement name/ }).inputValue(),
        'Preserve local edit across activation',
      );
      const modal = await openPublication(f.page);
      await modal
        .getByText(
          'Replace the live setup with this one? Shoppers can customize this product with the new setup once it is live. Later edits stay in a draft until published.',
          {
            exact: true,
          },
        )
        .waitFor();
      assert.equal(f.mutations.length, 0);
    },
  );

  stressTest(
    'a current passive activation settles the exact selected publication without redispatching its command',
    {
      timeout: 20000,
    },
    async (t) => {
      const f = await fixture(t, { publicationPending: true });
      await f.open();
      const modal = await openPublication(f.page);
      await modal.getByRole('button', { name: 'Publish', exact: true }).click();
      await f.page
        .getByText('Publication is still processing. Continue the original request to check its status.', {
          exact: true,
        })
        .waitFor();
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
      await modal.waitFor({ state: 'hidden' });
      await f.page.route('**/api/admin/products/111/config', (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const view = f.view();
        const config = required(view.config);
        config.publication = {
          ...config.publication,
          state: 'ACTIVE',
          revisionId: 'revision-selected-111',
          activeRevisionId: 'revision-selected-111',
          sourceDraftVersion: '2',
          requestKey: 'm5pub_cfg-selected-111_2_1',
        };
        config.publishedSetup = MerchantDraftSchema.parse(config.draft).selectedSetup ?? null;
        return route.fulfill({ json: view });
      });
      await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await f.page.waitForFunction(
        () =>
          !sessionStorage.getItem(
            'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
          ),
      );
      await f.page.getByText('Published', { exact: true }).first().waitFor();
      assert.equal(f.mutations.length, 2, 'Readback alone settles the one original save and publication');
    },
  );

  stressTest(
    'a pre-command passive response cannot replace the newer pending selected publication or its exact custody',
    {
      timeout: 20000,
    },
    async (t) => {
      const f = await fixture(t, { publicationPending: true });
      let armed = false;
      let release: (() => void) | undefined;
      let started: (() => void) | undefined;
      const waiting = new Promise<void>((resolve) => {
        started = resolve;
      });
      await f.page.route('**/api/admin/products/111/config', async (route) => {
        if (!armed || route.request().method() !== 'GET') return route.fallback();
        armed = false;
        const old = f.view();
        await new Promise<void>((resolve) => {
          release = resolve;
          required(started)();
        });
        return route.fulfill({ json: old });
      });
      await f.open();
      armed = true;
      await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await waiting;
      try {
        const modal = await openPublication(f.page);
        await modal.getByRole('button', { name: 'Publish', exact: true }).click();
        await f.page
          .getByText('Publication is still processing. Continue the original request to check its status.', {
            exact: true,
          })
          .waitFor();
        const intent = await storedIntent(f.page);
        assert.ok(intent);
        required(release)();
        await settleFrame(f.page);
        assert.equal(await storedIntent(f.page), intent);
        assert.equal(f.mutations.length, 2);
        assert.equal(await f.page.getByText('Published', { exact: true }).count(), 0);
      } finally {
        required(release)();
      }
    },
  );

  stressTest(
    'lost save reply and reload recover the original exact body, version and operation key',
    {
      timeout: 30000,
    },
    async (t) => {
      const f = await fixture(t, { loseSaveReply: true });
      await f.open();
      await f.page.getByRole('textbox', { name: 'Center X', exact: true }).fill('60');
      await editName(f.page, 'Recover this intent');
      await hostSave(f.page);
      await f.page
        .locator('.placement-notice s-banner')
        .filter({ hasText: 'Your changes could not be confirmed.' })
        .waitFor();
      assert.ok(await storedIntent(f.page));
      await f.page.reload();
      await f.page.locator('.placement-editor').waitFor({ state: 'visible' });
      await f.page.getByRole('button', { name: 'Retry', exact: true }).click();
      await f.page.waitForFunction(
        () =>
          !sessionStorage.getItem(
            'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
          ),
      );
      const writes = f.mutations.filter((entry) => entry.method === 'PUT');
      assert.equal(writes.length, 2);
      assert.equal(writes[1]?.key, writes[0]?.key);
      assert.equal(writes[1]?.body, writes[0]?.body);
      assert.equal(f.read().selectedSetup?.product.views[0]?.placements[0]?.rect.centerX, 0.6);
      await f.page.locator('.placement-canvas-status.is-ready').waitFor();
      await canvasPixels(f.page);
      assert.equal(await f.page.getByRole('textbox', { name: /^Placement name/ }).inputValue(), 'Recover this intent');
    },
  );
}
