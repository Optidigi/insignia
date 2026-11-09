import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GeometryV1 } from '@insignia/visualizer/geometry';
import type { DesiredGroup } from '../src/buyer.ts';
import { createBuyerApi, replaceGroup } from '../src/buyer.ts';
import { jsonRecord, requestUrl, required } from './support.mts';

test('editing one group preserves siblings including same-product designs', () => {
  const first: DesiredGroup = {
    configRevisionId: 'r1',
    revisionContentHash: 'a'.repeat(64),
    productId: '1',
    design: { placements: [], options: [] },
    variants: [],
  };
  const sibling = { ...first, productId: '2' };
  const otherDesign = { ...first, configRevisionId: 'other' };
  const replacement = { ...first, variants: [{ variantId: '4', quantity: 3 }] };
  assert.deepEqual(replaceGroup([first, sibling, otherDesign], replacement, 0), [replacement, sibling, otherDesign]);
});

test('verified-cart notification dispatches before returning without delaying navigation for its acknowledgement', async () => {
  let finish!: (value: Response) => void;
  let sent: RequestInit | undefined;
  const api = createBuyerApi({
    proxyBase: '/apps/insignia',
    productId: '12',
    fetchImpl: async (input, init) => {
      if (requestUrl(input).includes('/sessions?'))
        return Response.json({
          capability: 'abc.def',
          sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        });
      sent = init;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
  });
  await api.confirmCartApplication('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { fingerprint: 'a'.repeat(64), vector: [] });
  assert(sent, 'notification fetch must already be dispatched before native navigation');
  assert.equal(sent.keepalive, true);
  assert.equal(sent.credentials, 'same-origin');
  assert.equal(jsonRecord(String(sent.body)).capability, 'abc.def');
  finish(Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'APPLIED' }));
});

test('large cart notifications retain normal awaited delivery instead of exceeding keepalive quota', async () => {
  let finish!: (value: Response) => void;
  let dispatched!: () => void;
  const sending = new Promise<void>((resolve) => {
    dispatched = resolve;
  });
  let sent: RequestInit | undefined;
  let returned = false;
  const api = createBuyerApi({
    proxyBase: '/apps/insignia',
    productId: '12',
    fetchImpl: async (input, init) => {
      if (requestUrl(input).includes('/sessions?'))
        return Response.json({
          capability: 'abc.def',
          sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        });
      sent = init;
      dispatched();
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
  });
  const confirmation = api
    .confirmCartApplication('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      fingerprint: 'a'.repeat(64),
      vector: [],
      padding: 'x'.repeat(50 * 1024),
    })
    .then(() => {
      returned = true;
    });
  await sending;
  assert.equal(returned, false);
  assert.notEqual(sent?.keepalive, true);
  finish(Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'APPLIED' }));
  await confirmation;
});
test('buyer and artwork API use one private capability and locale proxy prefix', async () => {
  const calls: [string, RequestInit][] = [];
  const api = createBuyerApi({
    proxyBase: '/fr/apps/custom',
    productId: '12',
    fetchImpl: async (input, init = {}) => {
      const url = requestUrl(input);
      calls.push([url, init]);
      return Response.json(
        requestUrl(input).includes('/sessions')
          ? {
              capability: 'abc.def',
              sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              expiresAt: new Date(Date.now() + 60000).toISOString(),
            }
          : { groups: [], repairRequired: false },
      );
    },
  });
  await api.private('cart-state', { groups: [] });
  await api.artwork('/api/artwork/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/status');
  assert.equal(calls.filter(([url]) => url.includes('sessions')).length, 1);
  assert.equal(required(calls[1])[0], '/fr/apps/custom/v1/cart-state');
  assert.equal(required(calls[2])[0], '/fr/apps/custom/guest/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/status');
  for (const [, init] of calls.slice(1)) {
    assert.equal(jsonRecord(String(init.body)).capability, 'abc.def');
    assert.equal(init.credentials, 'same-origin');
  }
});
test('private session survives another instance without persisting design or URLs', async () => {
  const values = new Map<string, string>();
  const storage: Pick<Storage, 'getItem' | 'setItem'> = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  let sessions = 0;
  const fetchImpl: typeof fetch = async (input) =>
    Response.json(
      requestUrl(input).includes('/sessions')
        ? {
            capability: `cap${++sessions}.def`,
            sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          }
        : { groups: [], repairRequired: false },
    );
  await createBuyerApi({ proxyBase: '/apps/insignia', productId: '12', fetchImpl, storage }).private('cart-state', {});
  await createBuyerApi({ proxyBase: '/en/apps/insignia', productId: '13', fetchImpl, storage }).private(
    'cart-state',
    {},
  );
  assert.equal(sessions, 1);
  assert.deepEqual(Object.keys(jsonRecord(required([...values.values()][0]))).sort(), [
    'capability',
    'expiresAt',
    'sessionId',
  ]);
});
test('simultaneous product controls share one owner session before any private request', async () => {
  const values = new Map<string, string>();
  const storage: Pick<Storage, 'getItem' | 'setItem'> = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  let sessions = 0;
  const caps: unknown[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = requestUrl(input);
    if (url.includes('/sessions')) {
      sessions++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Response.json({
        capability: `cap${sessions}.def`,
        sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
    }
    caps.push(jsonRecord(String(init.body)).capability);
    return Response.json({ groups: [], repairRequired: false });
  };
  await Promise.all(
    [12, 13].map((id) =>
      createBuyerApi({ proxyBase: '/apps/insignia', productId: String(id), fetchImpl, storage }).private(
        'cart-state',
        {},
      ),
    ),
  );
  assert.equal(sessions, 1);
  assert.deepEqual(caps, ['cap1.def', 'cap1.def']);
});
test('advisory cart fingerprints are bounded hashes and uncertainty persists across locales', async () => {
  const { advisoryFingerprint, cartJournal } = await import('../src/buyer.ts');
  assert.equal(await advisoryFingerprint('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const values = new Map<string, string>();
  const storage: Pick<Storage, 'getItem' | 'setItem'> = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  cartJournal(storage, '/nl/').writeUnresolved(true);
  assert.equal(cartJournal(storage, '/en/').readUnresolved(), true);
});
test('browser rejects malformed successful responses and validates geometry before state', async () => {
  const api = createBuyerApi({
    proxyBase: '/apps/insignia',
    productId: '1',
    fetchImpl: async () =>
      Response.json({
        version: 'm7-config-v1',
        productId: '1',
        revisionId: 'r',
        contentHash: 'a'.repeat(64),
        methods: [],
        placements: [],
        steps: [],
        options: [],
        variants: [],
        geometry: { version: 'wrong' },
        imageUrls: {},
        ready: true,
      }),
  });
  await assert.rejects(api.config());
  const malformed = createBuyerApi({
    proxyBase: '/apps/insignia',
    productId: '1',
    fetchImpl: async () => Response.json({ ready: true }),
  });
  await assert.rejects(malformed.config(), /Customization response unavailable/);
});
test('numeric buyer variants select existing GID-specific preview images and geometry overrides', async () => {
  const { normalizeBuyerGeometry } = await import('../src/buyer.ts');
  const geometry: GeometryV1 = {
    version: 'm5-geometry-v1',
    views: [
      {
        id: 'front',
        variantImages: [
          { variantId: 'gid://shopify/ProductVariant/123', image: { revisionId: 'image', width: 100, height: 100 } },
        ],
        placements: [
          {
            id: 'front',
            rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 },
            variantOverrides: [
              {
                variantId: 'gid://shopify/ProductVariant/123',
                rect: { centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 },
              },
            ],
          },
        ],
      },
    ],
    steps: [],
  };
  const result = normalizeBuyerGeometry(geometry);
  assert.equal(required(required(required(result.views[0]).variantImages)[0]).variantId, '123');
  assert.equal(
    required(required(required(required(result.views[0]).placements)[0]).variantOverrides)[0]?.variantId,
    '123',
  );
  assert.equal(
    required(required(required(geometry.views[0]).variantImages)[0]).variantId,
    'gid://shopify/ProductVariant/123',
  );
});

for (const [status, code, outcome, expected] of [
  [409, 'REVIEW_REQUIRED', 'declined', 'declined'],
  [409, 'REVIEW_REQUIRED', undefined, undefined],
  [500, 'REVIEW_REQUIRED', 'declined', undefined],
  [409, 'OTHER', 'declined', undefined],
  [409, 'REVIEW_REQUIRED', 'unknown', undefined],
] as const) {
  test(`terminal acceptance proof is bounded: ${status}/${code}/${outcome}`, async () => {
    const api = createBuyerApi({
      proxyBase: '/apps/insignia',
      productId: '12',
      fetchImpl: async () => Response.json({ code, acceptanceOutcome: outcome }, { status }),
    });
    await assert.rejects(api.config(), (error) => {
      assert.equal(Reflect.get(error as object, 'acceptanceOutcome'), expected);
      return true;
    });
  });
}
