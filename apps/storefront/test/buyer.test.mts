import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GeometryV1 } from '@insignia/visualizer/geometry';
import type { DesiredGroup } from '../src/buyer.ts';
import { createBuyerApi, replaceGroup } from '../src/buyer.ts';
import { jsonRecord, record, requestUrl, required } from './support.mts';

/** One tab's view of the browser-wide store: a distinct object over the same entries. */
function tabStorage(values: Map<string, string>) {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}
const SESSION_KEY = 'insignia-buyer-session:/apps/insignia';

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
  const storage = tabStorage(values);
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
test('a tab whose unused session expired server-side mints one replacement and retries', async () => {
  const values = new Map<string, string>();
  const storage = tabStorage(values);
  // The capability is still within its grant, but the server already expired the unused session.
  values.set(
    'insignia-buyer-session:/apps/insignia',
    JSON.stringify({
      capability: 'stale.def',
      sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    }),
  );
  let sessions = 0;
  const used: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    if (requestUrl(input).includes('/sessions'))
      return Response.json({
        capability: `fresh${++sessions}.def`,
        sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        expiresAt: new Date(Date.now() + 604800000).toISOString(),
      });
    const capability = String(jsonRecord(String(init?.body)).capability);
    used.push(capability);
    return capability === 'stale.def'
      ? Response.json({ code: 'UNAUTHORIZED', message: 'Unauthorized' }, { status: 401 })
      : Response.json({ groups: [], repairRequired: false });
  };
  const api = createBuyerApi({ proxyBase: '/apps/insignia', productId: '12', fetchImpl, storage });
  await api.private('cart-state', {});
  await api.private('cart-state', {});
  assert.equal(sessions, 1);
  assert.deepEqual(used, ['stale.def', 'fresh1.def', 'fresh1.def']);
  assert.equal(jsonRecord(required(values.get('insignia-buyer-session:/apps/insignia'))).capability, 'fresh1.def');
});

test('a replacement session that is also rejected surfaces the error without looping', async () => {
  let sessions = 0;
  let privateCalls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    if (requestUrl(input).includes('/sessions'))
      return Response.json({
        capability: `cap${++sessions}.def`,
        sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
    privateCalls++;
    return Response.json({ code: 'UNAUTHORIZED', message: 'Unauthorized' }, { status: 401 });
  };
  const api = createBuyerApi({ proxyBase: '/apps/insignia', productId: '12', fetchImpl });
  await assert.rejects(api.private('cart-state', {}), { status: 401 });
  assert.equal(sessions, 2);
  assert.equal(privateCalls, 2);
});

test('simultaneous product controls share one owner session before any private request', async () => {
  const values = new Map<string, string>();
  const storage = tabStorage(values);
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
test('tabs opening together create one shared session, and every tab follows the stored one (#340)', async () => {
  const values = new Map<string, string>();
  let sessions = 0;
  const used: unknown[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    if (requestUrl(input).includes('/sessions')) {
      const n = ++sessions;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return Response.json({
        capability: `cap${n}.def`,
        sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
    }
    used.push(jsonRecord(String(init.body)).capability);
    return Response.json({ groups: [], repairRequired: false });
  };
  // Separate storage objects stand for separate tabs: nothing in memory is shared between them.
  const [first, second] = [tabStorage(values), tabStorage(values)].map((storage) =>
    createBuyerApi({ proxyBase: '/apps/insignia', productId: '12', fetchImpl, storage }),
  );
  await Promise.all([first, second].map((api) => required(api).private('cart-state', {})));
  assert.equal(sessions, 1);
  assert.deepEqual(used, ['cap1.def', 'cap1.def']);
  // Another tab replaced the session: this instance follows it instead of its remembered one.
  values.set(
    SESSION_KEY,
    JSON.stringify({ capability: 'other.def', sessionId: 's', expiresAt: new Date(Date.now() + 60000).toISOString() }),
  );
  await required(first).private('cart-state', {});
  assert.equal(used.at(-1), 'other.def');
});
test('an expired or malformed stored session is removed and replaced', async () => {
  for (const stored of [
    JSON.stringify({ capability: 'old.def', sessionId: 's', expiresAt: new Date(Date.now() - 1).toISOString() }),
    '{not json',
  ]) {
    const values = new Map([[SESSION_KEY, stored]]);
    const used: unknown[] = [];
    const api = createBuyerApi({
      proxyBase: '/apps/insignia',
      productId: '12',
      storage: tabStorage(values),
      fetchImpl: async (input, init = {}) => {
        if (requestUrl(input).includes('/sessions'))
          return Response.json({
            capability: 'new.def',
            sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          });
        used.push(jsonRecord(String(init.body)).capability);
        return Response.json({ groups: [], repairRequired: false });
      },
    });
    await api.private('cart-state', {});
    assert.deepEqual(used, ['new.def']);
    assert.equal(jsonRecord(required(values.get(SESSION_KEY))).capability, 'new.def');
  }
});
test('a cart set owned by another session is reported as such, other reviews are not', async () => {
  const { earlierSessionCart } = await import('../src/buyer.ts');
  for (const [details, earlier] of [
    [{ reason: 'NOT_OWNED' }, 'valid'],
    [{ reason: 'NOT_OWNED_EXPIRED' }, 'expired'],
    [undefined, undefined],
  ] as const) {
    const api = createBuyerApi({
      proxyBase: '/apps/insignia',
      productId: '12',
      fetchImpl: async (input) =>
        requestUrl(input).includes('/sessions')
          ? Response.json({
              capability: 'abc.def',
              sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              expiresAt: new Date(Date.now() + 60000).toISOString(),
            })
          : Response.json(
              { code: 'REVIEW_REQUIRED', message: 'Review', requestId: 'r', ...(details ? { details } : {}) },
              { status: 409 },
            ),
    });
    const error = await api.private('cart-state', {}).catch((error: unknown) => error);
    assert.equal(record(error).status, 409);
    assert.equal(earlierSessionCart(error), earlier);
  }
});
test('an exhausted session quota keeps its reason on the port error; other 429s carry none (#371)', async () => {
  for (const [body, reason] of [
    [{ code: 'RATE_LIMITED', details: { reason: 'SESSION_QUOTA' } }, 'SESSION_QUOTA'],
    [{ code: 'RATE_LIMITED' }, undefined],
    [{ code: 'BUSY', details: { reason: 'SESSION_QUOTA' } }, undefined],
  ] as const) {
    const api = createBuyerApi({
      proxyBase: '/apps/insignia',
      productId: '12',
      fetchImpl: async (input) =>
        requestUrl(input).includes('/sessions')
          ? Response.json({
              capability: 'abc.def',
              sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              expiresAt: new Date(Date.now() + 60000).toISOString(),
            })
          : Response.json({ ...body, message: 'Limit', requestId: 'r' }, { status: 429 }),
    });
    const error = record(await api.private('quote-proposals', {}).catch((error: unknown) => error));
    assert.equal(error.code, body.code);
    assert.equal(error.reason, reason, JSON.stringify(body));
  }
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

/** Scripted private responses after one session grant; records each private call's path and body. */
function scripted(responses: (() => Response)[]) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    if (requestUrl(input).includes('/sessions'))
      return Response.json({
        capability: 'cap.def',
        sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
    calls.push({
      path: new URL(requestUrl(input), 'https://shop.invalid').pathname,
      body: jsonRecord(String(init?.body)),
    });
    return required(responses[calls.length - 1] ?? responses.at(-1))();
  };
  return { calls, api: createBuyerApi({ proxyBase: '/apps/insignia', productId: '12', fetchImpl }) };
}
const busy =
  (retryAfter: string | null = '0') =>
  () =>
    Response.json(
      { code: 'BUSY', message: 'Busy', requestId: 'r', retryable: true },
      { status: 409, headers: retryAfter === null ? {} : { 'Retry-After': retryAfter } },
    );
const review = () => Response.json({ code: 'REVIEW_REQUIRED', message: 'Review', requestId: 'r' }, { status: 409 });
const accept = 'quote-proposals/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/accept';

test('acceptance retries a BUSY response twice with the same idempotent command, then surfaces it', async () => {
  const { api, calls } = scripted([busy()]);
  await assert.rejects(api.private(accept, { hash: 'h', idempotencyKey: 'k1' }), { status: 409, code: 'BUSY' });
  assert.equal(calls.length, 3);
  assert.deepEqual(new Set(calls.map((call) => JSON.stringify(call))).size, 1, 'every retry repeats the same command');
  assert.equal(calls[0]?.body.idempotencyKey, 'k1');
});

test('acceptance honours Retry-After before retrying and returns the next outcome', async () => {
  const { api, calls } = scripted([busy('1'), review]);
  const started = Date.now();
  await assert.rejects(api.private(accept, { hash: 'h', idempotencyKey: 'k2' }), { code: 'REVIEW_REQUIRED' });
  assert.ok(Date.now() - started >= 1000, 'waited for Retry-After');
  assert.equal(calls.length, 2);
});

test('only acceptance BUSY is retried automatically', async () => {
  const proposal = scripted([busy()]);
  await assert.rejects(proposal.api.private('quote-proposals', {}), { code: 'BUSY' });
  assert.equal(proposal.calls.length, 1);
  const reviewed = scripted([review]);
  await assert.rejects(reviewed.api.private(accept, { hash: 'h', idempotencyKey: 'k3' }), { code: 'REVIEW_REQUIRED' });
  assert.equal(reviewed.calls.length, 1);
  const outage = scripted([() => new Response('<html>theme</html>', { status: 500 })]);
  await assert.rejects(outage.api.private(accept, { hash: 'h', idempotencyKey: 'k4' }), { status: 500 });
  assert.equal(outage.calls.length, 1);
});

/** Settles the scripted fetch, session grant and body reads between mocked timer ticks. */
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}

test('a BUSY whose Retry-After was stripped still waits at least one second before retrying', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { api, calls } = scripted([busy(null), review]);
  const pending = api.private(accept, { hash: 'h', idempotencyKey: 'k5' }).catch((error: unknown) => error);
  await settle();
  assert.equal(calls.length, 1);
  t.mock.timers.tick(999);
  await settle();
  assert.equal(calls.length, 1, 'no retry inside the server lock_timeout window');
  t.mock.timers.tick(251);
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(((await pending) as { code?: unknown }).code, 'REVIEW_REQUIRED');
});

test('a long Retry-After is capped at ten seconds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { api, calls } = scripted([busy('3600'), review]);
  const pending = api.private(accept, { hash: 'h', idempotencyKey: 'k6' }).catch((error: unknown) => error);
  await settle();
  t.mock.timers.tick(9_999);
  await settle();
  assert.equal(calls.length, 1);
  t.mock.timers.tick(251);
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(((await pending) as { code?: unknown }).code, 'REVIEW_REQUIRED');
});

test('aborting during the BUSY wait stops the acceptance without another attempt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { api, calls } = scripted([busy('5'), review]);
  const controller = new AbortController();
  const pending = api
    .private(accept, { hash: 'h', idempotencyKey: 'k7' }, controller.signal)
    .catch((error: unknown) => error);
  await settle();
  assert.equal(calls.length, 1);
  controller.abort(new Error('closed'));
  assert.equal(((await pending) as Error).message, 'closed');
  t.mock.timers.tick(10_000);
  await settle();
  assert.equal(calls.length, 1);
});
