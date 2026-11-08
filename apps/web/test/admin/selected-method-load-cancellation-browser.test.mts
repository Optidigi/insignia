import assert from 'node:assert/strict';
import { test } from 'node:test';
import { methodsFixture } from './support/selected-methods-browser.mts';

for (const phase of ['catalogue', 'products'] as const)
  test(`retiring the selected Method route aborts its pending ${phase} read`, { timeout: 20000 }, async (t) => {
    const f = await methodsFixture(t);
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    t.after(() => release.resolve());
    const pattern = phase === 'catalogue' ? '**/api/admin/methods?view=catalog' : '**/api/admin/products?*';
    let requests = 0;
    await f.page.route(pattern, async (route) => {
      requests++;
      started.resolve();
      await release.promise;
      await route.fallback().catch(() => {}); // The original fixture owns response data; cancellation may retire it.
    });
    await f.page.goto(`${f.base}/admin/methods?locale=en`);
    await started.promise;
    const failed = f.page.waitForEvent('requestfailed', {
      predicate: (request) =>
        new URL(request.url()).pathname === (phase === 'catalogue' ? '/api/admin/methods' : '/api/admin/products'),
      timeout: 2000,
    });
    await f.page.locator('astro-island[component-url*="MethodsContainer"]').evaluate((island) => {
      island.dispatchEvent(new Event('astro:unmount'));
    });
    const request = await failed;
    assert.match(request.failure()?.errorText ?? '', /abort|cancel/i);
    release.resolve();
    assert.equal(requests, 1, 'A retired load must not ask for another catalogue/product page');
    assert.equal(f.writes.length, 0, 'Read cancellation must not create a Method mutation');
  });
