import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMethodCatalogTransport, type MethodJournalStorage } from '../../src/islands/method-catalog-transport.ts';

const id = 'cc756ade-f50a-4f5c-94b7-fd320a7a75e6';
const configuration = {
  id,
  name: 'Print',
  explanation: '',
  pricing: 'fixed' as const,
  amount: '3.50',
  assignment: 'manual' as const,
  productIds: [],
  tags: [],
  tagMatch: 'any' as const,
};
function storage(): MethodJournalStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
const scope = { shop: 'example.myshopify.com', authority: 'a'.repeat(64), currency: 'USD' as const };
test('Method writes survive a lost reply and reload with the identical command and idempotency identity', async () => {
  const journal = storage();
  const sends: { key: string | null; body: string | undefined }[] = [];
  let lost = true;
  const request = async (_path: string, init?: RequestInit) => {
    sends.push({
      key: new Headers(init?.headers).get('Idempotency-Key'),
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    if (lost) {
      lost = false;
      throw new Error('Lost reply');
    }
    return { kind: 'created', method: { configuration, version: '1', currency: 'USD' } };
  };
  const first = createMethodCatalogTransport({ ...scope, records: [], storage: journal, request });
  await assert.rejects(first.persist([configuration]), /Lost reply/);
  await assert.rejects(first.persist([{ ...configuration, name: 'Changed request' }]), /original Method write/);
  const reloaded = createMethodCatalogTransport({ ...scope, records: [], storage: journal, request });
  await reloaded.resume();
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[1], sends[0]);
  await reloaded.persist([configuration]);
  assert.equal(sends.length, 2);
});
test('Method command journals cannot be resumed under another authorization generation', async () => {
  const journal = storage();
  let calls = 0;
  await assert.rejects(
    createMethodCatalogTransport({
      ...scope,
      records: [],
      storage: journal,
      request: async () => {
        throw new Error('Lost reply');
      },
    }).persist([configuration]),
  );
  await createMethodCatalogTransport({
    ...scope,
    authority: 'b'.repeat(64),
    records: [],
    storage: journal,
    request: async () => {
      calls++;
      return {};
    },
  }).resume();
  assert.equal(calls, 0);
});

test('API reload keeps stored legacy product identities, and method usage comes from product setups', async () => {
  const { methodConfigurationForPicker } = await import('../../src/islands/method-catalog-transport.ts');
  const { productsUsing } = await import('../../examples/admin/support/method-configuration.mts');
  const record = { ...configuration, productIds: ['111'] };
  const product = { id: 'gid://shopify/Product/111', title: 'Shirt', image: '', tags: [], setup: [] };
  assert.deepEqual(methodConfigurationForPicker(record).productIds, [product.id]);
  assert.deepEqual(productsUsing(record, [product]), []);
  const using = { ...product, setup: [{ methodId: id, locations: 1, pricedLocations: 1 }] };
  assert.deepEqual(productsUsing({ ...record, productIds: [] }, [product, using]), [using]);
});

test("the editor's Add method creates one library method with the Methods page's command and a reusable identity", async () => {
  const { createLibraryMethod } = await import('../../src/islands/method-catalog-transport.ts');
  const sends: { path: string; init: RequestInit }[] = [];
  const created = { ...configuration, name: 'Flock', pricing: 'product' as const, amount: '' };
  let lost = true;
  const request = async (path: string, init?: RequestInit) => {
    assert.ok(init);
    sends.push({ path, init });
    if (lost) {
      lost = false;
      throw new Error('Lost reply');
    }
    return { kind: 'created', method: { configuration: created, version: '1' } };
  };
  const input = { id, key: 'b7e4ad31-6f0b-4a43-9a4b-8d1f5f3c2e10', name: 'Flock', authority: scope.authority, currency: scope.currency, request };
  await assert.rejects(createLibraryMethod(input), /Lost reply/);
  const method = await createLibraryMethod(input);
  assert.deepEqual(method, { configuration: created, version: '1' });
  assert.equal(sends.length, 2);
  for (const { path, init } of sends) {
    const headers = new Headers(init.headers);
    assert.equal(path, '/api/admin/methods');
    assert.equal(init.method, 'POST');
    assert.equal(headers.get('Idempotency-Key'), input.key);
    assert.equal(headers.get('X-Insignia-Method-Authority'), scope.authority);
    assert.equal(headers.get('X-Insignia-Method-Currency'), 'USD');
    assert.deepEqual(JSON.parse(String(init.body)), {
      configuration: {
        id,
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
  }
  await assert.rejects(
    createLibraryMethod({ ...input, request: async () => ({ kind: 'created', method: { configuration: { ...created, id: 'cc756ade-f50a-4f5c-94b7-fd320a7a75e7' }, version: '1' } }) }),
    /identity mismatch/,
  );
});

test('explicitly saving an equal Method price adopts current currency through one versioned write, never during load', async () => {
  const calls: RequestInit[] = [];
  const transport = createMethodCatalogTransport({
    ...scope,
    currency: 'EUR',
    records: [{ configuration, version: '1', currency: 'USD' }],
    storage: storage(),
    request: async (_path, init) => {
      assert.ok(init);
      calls.push(init);
      assert.equal(init.method, 'PUT');
      assert.equal(new Headers(init.headers).get('X-Insignia-Method-Currency'), 'EUR');
      assert.deepEqual(JSON.parse(String(init.body)), { configuration, version: '1' });
      return { kind: 'saved', method: { configuration, version: '2', currency: 'EUR' } };
    },
  });
  assert.equal(transport.currentRecords()[0]?.currency, 'USD');
  await transport.persist([configuration]);
  assert.equal(calls.length, 1, 'A reviewed same nominal amount still needs a currency metadata write');
  assert.equal(transport.currentRecords()[0]?.currency, 'EUR');
  await transport.persist([configuration]);
  assert.equal(calls.length, 1);
});
test('#451: a Shopify BUSY 409 keeps the Method journal so the identical command is retried', async () => {
  const journal = storage();
  const sends: (string | null)[] = [];
  let busy = true;
  const request = async (_path: string, init?: RequestInit) => {
    sends.push(new Headers(init?.headers).get('Idempotency-Key'));
    if (busy) {
      busy = false;
      throw Object.assign(new Error('Shopify is busy right now. Wait a few seconds and try again.'), {
        status: 409,
        code: 'BUSY',
      });
    }
    return { kind: 'created', method: { configuration, version: '1', currency: 'USD' } };
  };
  const first = createMethodCatalogTransport({ ...scope, records: [], storage: journal, request });
  await assert.rejects(first.persist([configuration]), /Shopify is busy/);
  const reloaded = createMethodCatalogTransport({ ...scope, records: [], storage: journal, request });
  await reloaded.resume();
  assert.equal(sends.length, 2);
  assert.equal(sends[1], sends[0]);
});
