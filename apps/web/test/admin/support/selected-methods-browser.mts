import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { MethodConfigurationSchema, type VersionedMethodConfiguration } from '@insignia/contracts';
import { catalog, fixture, preferences, product } from './selected-browser.mts';

export async function methodsFixture(
  t: TestContext,
  options: {
    empty?: boolean;
    loseFirstReply?: boolean;
    readOnly?: boolean;
    holdWrite?: boolean;
    currency?: 'USD' | 'EUR';
  } = {},
) {
  const f = await fixture(t);
  let records: VersionedMethodConfiguration[] = options.empty ? [] : structuredClone(catalog.methods);
  const writes: { method: string; key: string; body: string }[] = [];
  const receipts = new Map<string, unknown>();
  let denied = false;
  let releaseWrite: (() => void) | undefined;
  let startedWrite: (() => void) | undefined;
  const writeStarted = new Promise<void>((resolve) => {
    startedWrite = resolve;
  });
  await f.page.route('**/api/admin/preferences', (route) =>
    route.fulfill({ json: { ...preferences, canEdit: !options.readOnly } }),
  );
  await f.page.route('**/api/admin/products?*', (route) =>
    route.fulfill({ json: { products: [product], nextCursor: null } }),
  );
  await f.page.route(/\/api\/admin\/methods(?:\/[^/?]+)?(?:\?.*)?$/, async (route) => {
    const request = route.request();
    assert.equal(request.headers().authorization, 'Bearer synthetic-selected-token');
    assert.equal(request.headers().cookie, undefined);
    if (denied) return route.fulfill({ status: 403, json: { error: 'Current authorization required' } });
    if (request.method() === 'GET')
      return route.fulfill({
        json: { ...catalog, currency: options.currency ?? 'USD', canEdit: !options.readOnly, methods: records },
      });
    const key = request.headers()['idempotency-key'];
    assert.ok(key);
    assert.equal(request.headers()['x-insignia-method-authority'], catalog.authority);
    assert.equal(request.headers()['x-insignia-method-currency'], options.currency ?? 'USD');
    writes.push({ method: request.method(), key, body: request.postData() ?? '' });
    if (options.holdWrite && writes.length === 1)
      await new Promise<void>((resolve) => {
        releaseWrite = resolve;
        assert.ok(startedWrite);
        startedWrite();
      });
    if (options.readOnly) return route.fulfill({ status: 403, json: { error: 'Edit permission required' } });
    const body = request.postDataJSON();
    let receipt = receipts.get(key);
    if (!receipt) {
      if (request.method() === 'DELETE') {
        const id = new URL(request.url()).pathname.split('/').at(-1);
        const prior = records.find((record) => record.configuration.id === id);
        assert.ok(prior);
        assert.equal(body.version, prior.version);
        records = records.filter((record) => record.configuration.id !== id);
        receipt = { kind: 'deleted' };
      } else {
        const configuration = MethodConfigurationSchema.parse(body.configuration);
        const prior = records.find((record) => record.configuration.id === configuration.id);
        if (request.method() === 'PUT') {
          assert.ok(prior);
          assert.equal(body.version, prior.version);
        } else assert.equal(prior, undefined);
        const record = {
          configuration,
          currency: options.currency ?? 'USD',
          version: prior ? String(BigInt(prior.version) + 1n) : '1',
        };
        records = prior
          ? records.map((item) => (item.configuration.id === configuration.id ? record : item))
          : [...records, record];
        receipt = { kind: request.method() === 'POST' ? 'created' : 'saved', method: record };
      }
      receipts.set(key, receipt);
    }
    if (options.loseFirstReply && writes.length === 1) return route.abort('failed');
    return route.fulfill({ status: request.method() === 'POST' ? 201 : 200, json: receipt });
  });
  async function open(path = '/admin/methods') {
    await f.page.goto(`${f.base}${path}?locale=en`);
    await f.page.locator('.method-workflow').waitFor({ state: 'visible' });
    await f.page.waitForFunction(() => document.documentElement.dataset.adminReady === 'true');
  }
  return {
    ...f,
    open,
    writes,
    records: () => records,
    writeStarted,
    release: () => {
      assert.ok(releaseWrite);
      releaseWrite();
    },
    revoke: () => {
      denied = true;
    },
  };
}
export async function saveMethod(page: import('playwright').Page) {
  const response = page.waitForResponse(
    (response) =>
      ['POST', 'PUT'].includes(response.request().method()) &&
      new URL(response.url()).pathname.startsWith('/api/admin/methods'),
  );
  await page.locator('ui-save-bar button[variant="primary"]').evaluate((button: HTMLButtonElement) => button.click());
  return response;
}
