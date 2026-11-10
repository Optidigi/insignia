import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { type AjaxItem, fetchBody, requestUrl } from './support.mts';

const bundle = await build({
  entryPoints: [new URL('../src/renewal.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const source = bundle.outputFiles[0];
assert(source);
const temporary = await mkdtemp(join(tmpdir(), 'insignia-cart-renewal-'));
const moduleFile = join(temporary, 'renewal.mjs');
await writeFile(moduleFile, source.text);
after(() => rm(temporary, { recursive: true, force: true }));
const { renewCartPrices } = (await import(pathToFileURL(moduleFile).href)) as typeof import('../src/renewal.ts');

const quoteId = '11111111-1111-4111-8111-111111111111',
  applicationId = '22222222-2222-4222-8222-222222222222';
const group = {
  productId: '11',
  configRevisionId: 'revision',
  revisionContentHash: 'a'.repeat(64),
  design: {
    placements: [
      {
        placementId: 'front',
        methodId: 'print',
        stepId: 'small',
        artwork: { kind: 'deferred' as const, intentId: 'i' },
      },
    ],
    options: [],
  },
  variants: [{ variantId: '102', quantity: 2 }],
};

function fixture(options: { renewable?: boolean; renew?: Response; renewedQuantity?: number } = {}) {
  let items: AjaxItem[] = [
    { key: 'ordinary', variant_id: 101, quantity: 3, properties: { Gift: 'Yes' } },
    {
      key: 'custom',
      variant_id: 102,
      quantity: 2,
      properties: { _insignia_quote_v2: 'old', _insignia_member_v2: 'old-member' },
    },
  ];
  const attributes: Record<string, string> = { _insignia_quote_v2: 'old' };
  const values = new Map<string, string>([
    [
      'insignia-buyer-session:/apps/insignia',
      JSON.stringify({ capability: 'abc.def', sessionId: 's', expiresAt: new Date(Date.now() + 60000).toISOString() }),
    ],
  ]);
  const calls: string[] = [],
    writes: string[] = [],
    renewBodies: Record<string, unknown>[] = [];
  const fetchImpl: typeof fetch = async (url, init = {}) => {
    const path = new URL(requestUrl(url), 'https://fixture.test').pathname;
    calls.push(path);
    if (path.endsWith('/v1/cart-state'))
      return Response.json({ groups: [group], quoteId, repairRequired: true, renewable: options.renewable ?? true });
    if (path.endsWith(`/v1/quotes/${quoteId}/renew`)) {
      renewBodies.push(JSON.parse(String(init.body)));
      return (
        options.renew ??
        Response.json({
          quoteId,
          setId: applicationId,
          validThroughDay: 30000,
          applicationId,
          buckets: [
            {
              variantId: '102',
              quantity: options.renewedQuantity ?? 2,
              properties: { _insignia_quote_v2: 'new', _insignia_member_v2: 'new-member' },
            },
          ],
          desired: [group],
        })
      );
    }
    if (path.endsWith('/confirm')) return Response.json({ id: applicationId, status: 'APPLIED' });
    if (path.includes('/v1/')) throw new Error(`unexpected buyer call ${path}`);
    if (init.method === 'POST') {
      writes.push(path);
      const body = fetchBody(init);
      if (path.endsWith('/cart/update.js')) {
        if (body.updates) items = items.filter((item) => body.updates?.[item.key] !== 0);
        if (body.attributes) Object.assign(attributes, body.attributes);
      } else if (path.endsWith('/cart/add.js'))
        for (const item of body.items ?? [])
          items.push({ key: 'renewed', variant_id: item.id, quantity: item.quantity, properties: item.properties });
    }
    return Response.json({ items, attributes, currency: 'USD' });
  };
  const run = async () => {
    const events: string[] = [];
    const previous = Reflect.get(globalThis, 'window');
    const target = new EventTarget();
    target.addEventListener('insignia-cart-updated', (event) => events.push(event.type));
    Reflect.set(globalThis, 'window', target);
    try {
      const result = await renewCartPrices({
        proxyBase: '/apps/insignia',
        cartRoot: '/',
        productId: '11',
        country: 'US',
        marketId: '42',
        storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) },
        fetchImpl,
      });
      return { result, events };
    } finally {
      if (previous === undefined) Reflect.deleteProperty(globalThis, 'window');
      else Reflect.set(globalThis, 'window', previous);
    }
  };
  return { run, calls, writes, renewBodies, items: () => items, attributes };
}

test('an expired unchanged set renews with the owned cart groups and applies through the verified cart adapter', async () => {
  const f = fixture();
  const { result, events } = await f.run();
  assert.equal(result, true);
  assert.equal(f.calls.includes('/apps/insignia/v1/sessions'), false, 'renewal uses the owning tab session only');
  const [body] = f.renewBodies;
  assert.ok(body);
  assert.equal(body.capability, 'abc.def');
  assert.equal(body.country, 'US');
  assert.equal(body.marketId, '42');
  assert.deepEqual(body.groups, [group]);
  assert.deepEqual(body.capacity, {
    ordinaryLineCount: 1,
    inputBytes: (body.capacity as { inputBytes: number }).inputBytes,
  });
  assert.match(String(body.idempotencyKey), /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    f.items().map((item) => [item.key, item.quantity, item.properties]),
    [
      ['ordinary', 3, { Gift: 'Yes' }],
      ['renewed', 2, { _insignia_member_v2: 'new-member', _insignia_quote_v2: 'new' }],
    ],
  );
  assert.equal(f.attributes._insignia_quote_v2, 'new');
  assert.ok(f.calls.includes(`/apps/insignia/v1/cart-applications/${applicationId}/confirm`));
  assert.deepEqual(events, ['insignia-cart-updated']);
});

test('a set the server does not call renewable leaves the cart to Designer repair', async () => {
  const f = fixture({ renewable: false });
  assert.equal((await f.run()).result, false);
  assert.deepEqual(f.renewBodies, []);
  assert.deepEqual(f.writes, []);
});

test('REVIEW_REQUIRED or entitlement denial never writes the cart', async () => {
  for (const [status, code] of [
    [409, 'REVIEW_REQUIRED'],
    [403, 'ENTITLEMENT_DENIED'],
  ] as const) {
    const f = fixture({ renew: Response.json({ code, message: 'x', requestId: 'r' }, { status }) });
    await assert.rejects(f.run(), (error: { code?: string }) => error.code === code);
    assert.deepEqual(f.writes, []);
  }
});

test('a renewed vector that differs from the observed cart is not applied', async () => {
  const f = fixture({ renewedQuantity: 3 });
  assert.equal((await f.run()).result, false);
  assert.deepEqual(f.writes, []);
});
