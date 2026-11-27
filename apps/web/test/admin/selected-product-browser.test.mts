import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MerchantDraftSchema } from '@insignia/contracts';
import { required } from './support/fixtures.mts';
import {
  artifacts,
  assertRetiredBeforeNavigation,
  authority,
  catalog,
  draft,
  editName,
  fixture,
  hostSave,
  imageUrl,
  methodId,
  routeMethodLibrary,
  storedIntent,
  watchLeavePrompts,
} from './support/selected-browser.mts';

// Scope: real built UI/client/Polaris in an isolated browser with synthetic provider HTTP.
// These are not native Shopify save-bar observations or owner visual acceptance.
test('selected desktop and mobile layouts retain their workspace columns, image and accessible panel navigation', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  const nativeLabels = await f.page
    .locator(
      's-page > s-button-group[slot="secondary-actions"] > s-button, s-page > s-button[commandfor="placement-page-actions"]',
    )
    .evaluateAll((buttons) => buttons.map((button) => button.textContent?.trim()));
  assert.deepEqual(
    nativeLabels,
    ['More actions'],
    'The panel and history controls live in the editor, clear of the host save bar (#441)',
  );
  const bounds = await f.page.locator('.placement-editor').evaluate((editor) => {
    const outline = editor.querySelector('.placement-outline')?.getBoundingClientRect();
    const canvas = editor.querySelector('.placement-workspace')?.getBoundingClientRect();
    const props = editor.querySelector('.placement-properties')?.getBoundingClientRect();
    if (!outline || !canvas || !props) throw new Error('Selected workspace panels missing');
    return {
      outline: { x: outline.x, width: outline.width },
      canvas: { x: canvas.x, width: canvas.width },
      props: { x: props.x, width: props.width },
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  assert.equal(bounds.outline.x, 4);
  assert.equal(bounds.canvas.x, 288);
  assert.equal(bounds.props.x, 952);
  assert.equal(bounds.outline.width, 280);
  assert.equal(bounds.props.width, 324);
  assert.ok(bounds.outline.x < bounds.canvas.x && bounds.canvas.x < bounds.props.x);
  assert.ok(bounds.canvas.width > 500);
  assert.equal(bounds.overflow, false);
  await f.page.screenshot({ path: new URL('desktop.png', artifacts).pathname });
  await f.page.setViewportSize({ width: 390, height: 844 });
  await f.page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await f.page.getByRole('textbox', { name: /^Placement name/ }).waitFor({ state: 'visible' });
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await f.page.getByRole('tab', { name: 'Settings', exact: true }).getAttribute('aria-selected'), 'true');
  await f.page.screenshot({ path: new URL('mobile.png', artifacts).pathname });
});

test('a selected draft edit saves through the actual journal client with its frozen scope and visible confirmed value', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  await editName(f.page, 'Chest after save');
  const savedResponse = f.page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().endsWith('/api/admin/products/111/config'),
  );
  await hostSave(f.page);
  assert.equal((await savedResponse).status(), 200);
  await f.page.waitForFunction(
    () =>
      !sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
  );
  await f.page.getByRole('textbox', { name: /^Placement name/ }).waitFor();
  assert.equal(await f.page.getByRole('textbox', { name: /^Placement name/ }).inputValue(), 'Chest after save');
  const writes = f.mutations.filter((entry) => entry.method === 'PUT');
  assert.equal(writes.length, 1);
  const written = writes[0];
  assert.ok(written);
  assert.equal(writes[0]?.authority, authority);
  assert.match(writes[0]?.key ?? '', /:save$/);
  assert.equal(
    MerchantDraftSchema.parse(JSON.parse(written.body).draft).selectedSetup?.product.views[0]?.placements[0]?.name,
    'Chest after save',
  );
});

test('delayed saves fence keyboard, programmatic native/header actions and input events from changing the committed candidate', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t, { holdSave: true });
  await f.open();
  await editName(f.page, 'Frozen save name');
  await hostSave(f.page);
  await f.saveReceived;
  await f.page.waitForFunction(() => {
    const button = document.querySelector('ui-save-bar button[variant="primary"]');
    return button instanceof HTMLButtonElement && button.disabled;
  });
  await f.page
    .locator('s-text-field[name="placement-name"]')
    .evaluate((field: HTMLElementTagNameMap['s-text-field']) => {
      field.value = 'Late injected name';
      field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    });
  await f.page.keyboard.press('Control+s');
  await hostSave(f.page);
  await f.page
    .locator('[data-placement-editor] s-button[icon="undo"]')
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  await f.page
    .locator('s-button[slot="primary-action"]')
    .filter({ hasText: /^Publish$/ })
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  assert.equal(await f.page.locator('s-modal').filter({ hasText: 'Publish setup' }).isVisible(), false);
  assert.equal(f.mutations.filter((entry) => entry.method === 'PUT').length, 1);
  f.release();
  await f.page.waitForFunction(
    () =>
      !sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
  );
  assert.equal(f.read().selectedSetup?.product.views[0]?.placements[0]?.name, 'Frozen save name');
  assert.equal(await f.page.getByRole('textbox', { name: /^Placement name/ }).inputValue(), 'Frozen save name');
});

test('a publication still in progress is continued automatically, then offers Retry with its original identity', {
  timeout: 240000,
}, async (t) => {
  const f = await fixture(t, { publicationPending: true });
  // The fake clock moves only between requests, so no request deadline elapses while one is answered.
  let inFlight = 0;
  const api = (request: import('playwright').Request) => new URL(request.url()).pathname.startsWith('/api/');
  f.page.on('request', (request) => {
    if (api(request)) inFlight++;
  });
  const settled = (request: import('playwright').Request) => {
    if (api(request)) inFlight--;
  };
  f.page.on('requestfinished', settled);
  f.page.on('requestfailed', settled);
  await f.page.clock.install();
  await f.open();
  await f.page
    .locator('s-button[slot="primary-action"]')
    .filter({ hasText: /^Publish$/ })
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  const modal = f.page.locator('s-modal').filter({ hasText: 'Publish setup' });
  await modal.getByRole('button', { name: 'Publish', exact: true }).click();
  const progress = modal.getByText('Publishing. This can take a minute or two; this page updates when it finishes.', {
    exact: true,
  });
  const pending = f.page.getByText(
    'Publication is still processing. Continue the original request to check its status.',
    { exact: true },
  );
  await progress.waitFor();
  const publishes = () => f.mutations.filter((entry) => entry.key?.endsWith(':publish'));
  // The server answers "accepted, still in progress" every time: the editor re-sends it every 5 s, showing
  // progress rather than a failure, until its five-minute bound.
  for (let step = 0; step < 2000 && (await pending.count()) === 0; step++) {
    if (publishes().length === 3) {
      assert.equal(await progress.count(), 1, 'auto-continuing shows progress');
      assert.equal(await f.page.getByRole('button', { name: 'Retry', exact: true }).count(), 0);
      assert.equal(await f.page.getByText(/could not be confirmed/).count(), 0);
    }
    if (inFlight === 0) await f.page.clock.fastForward(5_000);
    await f.page.waitForTimeout(25);
  }
  await pending.waitFor();
  const continued = publishes().length;
  assert.ok(continued > 10 && continued <= 62, `re-sent at the bounded cadence (${continued} sends)`);
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  const retryAcknowledged = f.page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && (response.request().postData() ?? '').includes('"action":"publish"'),
  );
  await f.page.getByRole('button', { name: 'Retry', exact: true }).click();
  await retryAcknowledged;
  await f.page.waitForFunction(
    () =>
      JSON.parse(
        sessionStorage.getItem(
          'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
        ) ?? 'null',
      )?.stage === 'publish',
  );
  assert.equal(
    f.mutations.filter((entry) => entry.method === 'PUT').length,
    1,
    'Publication continuation must not issue another save',
  );
  const sent = publishes();
  assert.ok(sent.length > continued);
  for (const entry of sent) {
    assert.equal(entry.key, sent[0]?.key);
    assert.equal(entry.body, sent[0]?.body);
  }
  assert.notEqual(
    sent[0]?.key,
    'm5pub_cfg-selected-111_2_1',
    'Continuation uses the HTTP intent identity, not a different server publication key',
  );
});

test('an accepted publication left in progress continues automatically until Published, without Retry', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t, { publicationPending: true });
  let sends = 0;
  await f.page.route('**/api/admin/products/111/config', async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && JSON.parse(request.postData() ?? '{}').action === 'publish') {
      sends++;
      // The server stopped making progress twice (#468 analysis, 18 Nov 2026); the third send finishes it.
      if (sends === 3) {
        await route.fallback();
        return;
      }
    }
    if (sends >= 3 && request.method() === 'GET') {
      const view = f.view();
      const config = required(view.config);
      config.publication = {
        ...config.publication,
        state: 'ACTIVE',
        activeRevisionId: 'revision-selected-111',
      };
      config.publishedSetup = MerchantDraftSchema.parse(config.draft).selectedSetup ?? null;
      return route.fulfill({ json: view });
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
  await f.page.getByText('Published', { exact: true }).first().waitFor({ timeout: 20000 });
  await modal.waitFor({ state: 'hidden' });
  assert.equal(sends, 3);
  assert.equal(await f.page.getByRole('button', { name: 'Retry', exact: true }).count(), 0);
  assert.equal(await f.page.getByText(/could not be confirmed/).count(), 0);
  assert.equal(
    await f.page.evaluate(() =>
      sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
    ),
    null,
    'the publish custody settled',
  );
});

test('read-only selected views cannot dispatch save/publication through synthetic host or keyboard actions', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t, { readOnly: true });
  await f.open();
  await f.page
    .locator('s-text-field[name="placement-name"]')
    .evaluate((field: HTMLElementTagNameMap['s-text-field']) => {
      field.value = 'Forbidden';
      field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    });
  await hostSave(f.page);
  await f.page.keyboard.press('Control+s');
  await f.page
    .locator('s-button[slot="primary-action"]')
    .filter({ hasText: /^Publish$/ })
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  const publish = f.page.locator('s-modal').filter({ hasText: 'Publish setup' });
  if (await publish.isVisible()) {
    await publish
      .getByRole('button', { name: 'Publish', exact: true })
      .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  }
  await f.page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  assert.equal(f.mutations.length, 0);
  assert.equal(await storedIntent(f.page), null);
});

test('a first selected view creates its configuration then saves one exact authoring intent', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t, { absent: true });
  await f.open();
  await f.page.locator('[data-outline-add-view]').click();
  const picker = f.page.locator('s-modal').filter({ has: f.page.locator('.placement-image-picker') });
  const choice = picker.locator('button.placement-image-choice').first();
  await choice.waitFor({ state: 'visible' });
  await f.page.waitForFunction(() => {
    const input = document.querySelector('.placement-image-picker button.placement-image-choice');
    return input instanceof HTMLButtonElement && !input.disabled;
  });
  await choice.click();
  await picker.getByRole('button', { name: 'Add view', exact: true }).click();
  await f.page.getByRole('textbox', { name: /^View name/ }).fill('First authored view');
  const saveAcknowledged = f.page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().endsWith('/api/admin/products/111/config'),
  );
  await hostSave(f.page);
  await saveAcknowledged;
  await f.page.waitForFunction(
    () =>
      !sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
  );
  const created = f.mutations.filter((entry) => JSON.parse(entry.body).action === 'create');
  const saved = f.mutations.filter((entry) => entry.method === 'PUT');
  assert.equal(created.length, 1);
  assert.equal(saved.length, 1);
  assert.equal(created[0]?.key?.replace(/:create$/, ''), saved[0]?.key?.replace(/:save$/, ''));
  assert.equal(f.read().selectedSetup?.product.views[0]?.name, 'First authored view');
  assert.equal(f.read().selectedSetup?.product.views[0]?.imageUrl, imageUrl);
});

for (const closePath of ['X', 'Escape', 'Cancel'] as const) {
  test(`Shopify-hosted Add views ${closePath} clears the host overlay and restores focus`, {
    timeout: 30000,
  }, async (t) => {
    const f = await fixture(t, { shopifyModal: true });
    await f.open();
    const trigger = f.page.locator('[data-outline-add-view]');
    await trigger.click();
    const picker = f.page
      .locator('s-modal[data-method-dialog]')
      .filter({ has: f.page.locator('.placement-image-picker') });
    await picker.waitFor({ state: 'visible' });
    await f.page.locator('[data-shopify-host-modal-scrim]').waitFor({ state: 'attached' });

    if (closePath === 'X') {
      const id = await picker.getAttribute('id');
      const imageChoice = picker.locator('button.placement-image-choice').first();
      await imageChoice.waitFor({ state: 'visible' });
      await f.page.waitForFunction(() => {
        const choice = document.querySelector('.placement-image-picker button.placement-image-choice');
        return choice instanceof HTMLButtonElement && !choice.disabled;
      });
      await imageChoice.click();
      assert.equal(await picker.getAttribute('id'), id, 'The host routing ID remains stable as the picker rerenders');
      await f.page.evaluate(() => window.dismissShopifyModal());
    } else if (closePath === 'Escape') await f.page.keyboard.press('Escape');
    else await picker.getByRole('button', { name: 'Cancel', exact: true }).click();

    await picker.waitFor({ state: 'detached' });
    await f.page.locator('[data-shopify-host-modal-scrim]').waitFor({ state: 'detached' });
    await f.page.waitForFunction(() => {
      const button = document.querySelector('[data-outline-add-view]');
      return button instanceof HTMLElement && document.activeElement === button;
    });
    assert.equal(f.mutations.length, 0, 'Closing the picker does not save a design change');
  });
}

test('applying Manage methods retires its Shopify backdrop so real clicks reach the host save bar and Publish', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t, { shopifyModal: true });
  const importedId = '0d6f3c1e-3f5a-4d0b-9a59-2e3f4f8b1c11';
  await f.page.route('**/api/admin/methods?view=catalog', (route) =>
    route.fulfill({
      json: {
        ...catalog,
        methods: [
          ...catalog.methods,
          {
            version: '1',
            currency: 'USD',
            configuration: {
              id: importedId,
              name: 'Embroidery',
              explanation: 'Stitched decoration',
              pricing: 'fixed',
              amount: '4.50',
              assignment: 'manual',
              productIds: ['111'],
              tags: [],
              tagMatch: 'any',
            },
          },
        ],
      },
    }),
  );
  await f.open();
  await f.page.getByRole('button', { name: 'Manage methods', exact: true }).click();
  const dialog = f.page.locator('s-modal[data-method-dialog]').filter({ has: f.page.locator('.pm-manager') });
  await dialog.getByRole('checkbox', { name: 'Embroidery', exact: true }).check();
  await f.page.locator('[data-shopify-host-modal-scrim]').waitFor({ state: 'attached' });
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await f.page.locator('[data-shopify-host-modal-scrim]').waitFor({ state: 'detached' });

  // Real pointer clicks: a leftover backdrop would intercept them.
  const saved = f.page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().endsWith('/api/admin/products/111/config'),
  );
  await f.page.locator('[data-shopify-host-save-bar="product-draft-save-bar"] button', { hasText: 'Save' }).click();
  assert.equal((await saved).status(), 200);
  await f.page.locator('[data-shopify-host-save-bar]').waitFor({ state: 'detached' });
  // Shopify renders the page's primary action in its host title bar; stand in for it the same way.
  await f.page
    .locator('s-button[slot="primary-action"]')
    .filter({ hasText: /^Publish$/ })
    .evaluate((declared: HTMLElementTagNameMap['s-button']) => {
      const button = document.createElement('button');
      button.textContent = declared.textContent;
      button.dataset.shopifyHostTitleBarAction = '';
      button.style.cssText = 'position:fixed;right:0;top:0;z-index:2147483646';
      button.addEventListener('click', () => declared.click());
      document.body.append(button);
    });
  await f.page.locator('[data-shopify-host-title-bar-action]').click();
  await f.page.locator('s-modal').filter({ hasText: 'Publish setup' }).waitFor({ state: 'visible' });
});

test('a product method and a same-named library method appear once in Manage methods, across untick, re-tick and Done', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t, { shopifyModal: true });
  // The library holds its own "Printing" (another ID, another price) assigned to this product.
  await f.page.route('**/api/admin/methods?view=catalog', (route) =>
    route.fulfill({
      json: {
        ...catalog,
        methods: [
          ...catalog.methods,
          {
            version: '1',
            currency: 'USD',
            configuration: {
              id: '0d6f3c1e-3f5a-4d0b-9a59-2e3f4f8b1c11',
              name: 'printing',
              explanation: '',
              pricing: 'fixed',
              amount: '5.00',
              assignment: 'manual',
              productIds: ['111'],
              tags: [],
              tagMatch: 'any',
            },
          },
        ],
      },
    }),
  );
  await f.open();
  const dialog = f.page.locator('s-modal[data-method-dialog]').filter({ has: f.page.locator('.pm-manager') });
  const rows = dialog.locator('.pm-manager__method');
  const open = async () => {
    const loaded = f.page.waitForResponse((response) => response.url().endsWith('/api/admin/methods?view=catalog'));
    await f.page.getByRole('button', { name: 'Manage methods', exact: true }).click();
    await loaded;
    await dialog.locator('.pm-manager__method').first().waitFor();
  };
  await open();
  assert.deepEqual(await rows.allInnerTexts(), ['$3.50Edit price']);
  const box = dialog.getByRole('checkbox', { name: 'Printing', exact: true });
  await box.uncheck();
  await box.check();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });

  await open();
  assert.deepEqual(await rows.allInnerTexts(), ['$3.50Edit price']);
  assert.equal(await box.isChecked(), true);
});

test("the editor's Add method creates one library method, priced on this product as an inherited binding", {
  timeout: 30000,
}, async (t) => {
  const initial = structuredClone(draft);
  initial.methods = [];
  initial.pricingRules = [];
  for (const placement of initial.placements) placement.allowedMethodIds = [];
  delete initial.labels?.methods;
  const selected = required(initial.selectedSetup);
  selected.product.methods = [];
  selected.methodBindings = {};
  for (const view of selected.product.views) for (const placement of view.placements) placement.methodIds = [];
  const f = await fixture(t, { shopifyModal: true, initialDraft: MerchantDraftSchema.parse(initial) });
  const library = await routeMethodLibrary(f.page, []);
  await f.open();
  await f.page.getByRole('button', { name: 'Choose methods', exact: true }).click();
  const manager = f.page.locator('s-modal[data-method-dialog]').filter({ has: f.page.locator('.pm-manager') });
  // A truly empty library keeps its empty state, and there is no detour to the library page.
  await manager.getByText('Add a method to your library. It becomes available on every product.').waitFor();
  assert.equal(await manager.getByRole('button', { name: 'Save draft and open library', exact: true }).count(), 0);
  await manager.getByRole('button', { name: 'Add method', exact: true }).first().click();
  const name = manager.getByRole('textbox', { name: 'Method name', exact: true });
  await manager
    .getByText('Added to your method library and available on every product. Set its placement prices next.')
    .waitFor();
  await name.fill('Flock');
  await manager.getByRole('button', { name: 'Add method', exact: true }).first().click();
  const prices = manager.locator('section[aria-label="Prices for Flock"]');
  await prices.waitFor();
  assert.equal(library.posts.length, 1);
  const [post] = library.posts;
  assert.ok(post?.key);
  assert.equal(post.authority, authority);
  assert.equal(post.currency, 'USD');
  const created = required(library.methods()[0]).configuration;
  assert.deepEqual(post.body, {
    configuration: {
      id: created.id,
      name: 'Flock',
      explanation: '',
      pricing: 'product',
      amount: '',
      assignment: 'manual',
      productIds: [],
      tags: [],
      tagMatch: 'any',
    },
  });
  await prices.getByRole('textbox', { name: 'Price for Small', exact: true }).fill('4.00');
  await manager.getByRole('button', { name: 'Done', exact: true }).click();
  await manager.waitFor({ state: 'detached' });
  assert.equal(f.mutations.length, 0, 'the product draft is saved separately');
  const saved = f.page.waitForResponse((response) => response.request().method() === 'PUT');
  await hostSave(f.page);
  await saved;
  const setup = required(f.read().selectedSetup);
  assert.equal(setup.product.methods.find((method) => method.id === created.id)?.name, 'Flock');
  const binding = required(setup.methodBindings[created.id]);
  assert.equal(binding.catalogMethodId, created.id);
  assert.equal(binding.review, null);
  // Prices typed for the placement stay product-level edits.
  assert.deepEqual(
    Object.values(binding.prices).filter((price) => price.source === 'product'),
    [{ source: 'product', value: '4.00' }],
  );
  // The library now offers it: a later catalogue read lists the new method.
  await f.page.getByRole('button', { name: 'Manage methods', exact: true }).click();
  await manager.getByRole('checkbox', { name: 'Flock', exact: true }).waitFor();
  assert.equal(library.posts.length, 1);
});

test("a refused library create (full library, permission) keeps the editor and shows Add method's failure message", {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  const answers = [
    { status: 409, json: { kind: 'conflict', message: 'The library holds up to 100 methods.' } },
    { status: 403, json: { error: 'Current tenant installation required' } },
  ];
  const keys: (string | undefined)[] = [];
  await f.page.route('**/api/admin/methods', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    keys.push(route.request().headers()['idempotency-key']);
    return route.fulfill(required(answers.shift()));
  });
  await f.open();
  await f.page.getByRole('button', { name: 'Manage methods', exact: true }).click();
  const manager = f.page.locator('s-modal[data-method-dialog]').filter({ has: f.page.locator('.pm-manager') });
  await manager.getByRole('button', { name: 'Add method', exact: true }).first().click();
  await manager.getByRole('textbox', { name: 'Method name', exact: true }).fill('Flock');
  const field = manager.locator('s-text-field[data-new-product-method]');
  for (const attempt of [1, 2]) {
    const answered = f.page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/api/admin/methods'),
    );
    await manager.getByRole('button', { name: 'Add method', exact: true }).first().click();
    await answered;
    await f.page.waitForFunction(
      () =>
        document.querySelector('s-text-field[data-new-product-method]')?.getAttribute('error') ===
        'This method could not be added. Try again.',
    );
    assert.equal(keys.length, attempt);
  }
  assert.equal(keys[1], keys[0], 'a retry of the same name repeats the same command');
  assert.equal(await field.count(), 1);
  assert.equal(f.mutations.length, 0);
  await f.page.locator('.placement-editor').waitFor({ state: 'visible' });
});

test('confirmed Leave page retires the dialog and save bar before navigating without saving', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t, { shopifyModal: true });
  await f.open();
  const dialogs = await watchLeavePrompts(f.page);
  await editName(f.page, 'Discarded by leaving');
  await f.page.locator('[data-shopify-host-save-bar="product-draft-save-bar"]').waitFor();
  // Shopify renders breadcrumbs in the host; dispatch the declared link's click.
  await f.page
    .locator('s-link[slot="breadcrumb-actions"]')
    .evaluate((link: HTMLElementTagNameMap['s-link']) => link.click());
  const leave = f.page.locator('s-modal[data-method-dialog]').filter({ hasText: 'Leave without saving?' });
  await leave.waitFor({ state: 'visible' });
  const leaveId = await leave.getAttribute('id');
  await leave.getByRole('button', { name: 'Leave page', exact: true }).click();
  await f.page.waitForURL((url) => url.pathname !== '/admin/products/111/config');
  assertRetiredBeforeNavigation(
    await f.page.evaluate(() => window.previousPageSaveBarEvents),
    'product-draft-save-bar',
    leaveId,
  );
  assert.deepEqual(dialogs, []);
  assert.equal(f.mutations.length, 0);
});

test('equal-valued explicit Method edits become dirty metadata and undo restores inheritance before an exact save', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  async function makeEqualOverride() {
    await f.page.getByRole('button', { name: 'Edit Printing price', exact: true }).click();
    const dialog = f.page.locator('s-modal').filter({ has: f.page.locator('[data-method-price-field]') });
    await dialog.getByRole('textbox', { name: /^Price per placement per item/ }).fill('3.50');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await f.page.waitForFunction(() => {
      const button = document.querySelector('ui-save-bar button[variant="primary"]');
      return button instanceof HTMLButtonElement && !button.disabled;
    });
  }
  await makeEqualOverride();
  assert.equal(f.mutations.length, 0);
  await f.page
    .locator('[data-placement-editor] s-button[icon="undo"]')
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  await f.page.waitForFunction(() => {
    const button = document.querySelector('ui-save-bar button[variant="primary"]');
    return button instanceof HTMLButtonElement && button.disabled;
  });
  assert.equal(f.mutations.length, 0);
  await makeEqualOverride();
  const savedResponse = f.page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().endsWith('/api/admin/products/111/config'),
  );
  await hostSave(f.page);
  assert.equal((await savedResponse).status(), 200);
  await f.page.waitForFunction(
    () =>
      !sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
  );
  const persisted = f.read();
  assert.equal(persisted.selectedSetup?.methodBindings[methodId]?.prices.default?.source, 'product');
  assert.equal(persisted.selectedSetup?.product.methods[0]?.amount, '3.50');
  assert.equal(
    persisted.pricingRules[0]?.rate.kind === 'fixed' && persisted.pricingRules[0].rate.amount.shopDecimal,
    '3.50',
  );
});

test('unsaved merchant preview accepts a viewBox-only SVG without production upload or cart authority', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  const popup = f.page.waitForEvent('popup');
  await f.page.locator('s-button[accessibilitylabel="Preview customization"]').evaluate((button) => {
    if (!(button instanceof HTMLElement)) throw new Error('Missing HTML preview control');
    button.click();
  });
  const preview = await popup;
  preview.setDefaultTimeout(5000);
  const requests: string[] = [];
  preview.on('request', (request) => {
    if (request.method() !== 'GET') requests.push(new URL(request.url()).pathname);
  });
  await preview.getByRole('button', { name: 'Add artwork', exact: true }).click();
  await preview.getByRole('button', { name: 'Choose artwork', exact: true }).click();
  await preview
    .locator('input[type=file]')
    .setInputFiles(new URL('../../../../frontend/designer/public/trail-logo.svg', import.meta.url).pathname);
  await preview.locator('img[src^="blob:"]').first().waitFor();
  assert.equal(
    await preview
      .locator('img[src^="blob:"]')
      .first()
      .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    true,
  );
  assert.doesNotMatch(await preview.locator('body').innerText(), /couldn.t open this image/i);
  assert.equal(f.mutations.length, 0);
  assert.deepEqual(requests, [], 'preview artwork stays browser-local');
  await preview.close();
});

test('the placement settings explain when an assigned method has no offered price', { timeout: 30000 }, async (t) => {
  const initial = structuredClone(draft);
  initial.pricingRules = [];
  const setup = required(initial.selectedSetup);
  setup.product.methods = [{ id: methodId, name: 'Printing', explanation: '', pricing: 'product', amount: '' }];
  setup.methodBindings = {};
  const f = await fixture(t, { initialDraft: MerchantDraftSchema.parse(initial) });
  await f.open();
  await f.page.getByText('Add a price for at least one available method and size.', { exact: true }).waitFor();
  assert.equal(f.mutations.length, 0);
});
