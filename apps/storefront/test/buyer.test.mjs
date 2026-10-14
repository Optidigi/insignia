import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBuyerApi, createRequestLane, formatMinor, replaceGroup } from '../src/buyer.ts';

test('exact money avoids floating rounding and keeps zero/three decimal currencies', () => {
  assert.equal(formatMinor('9100', 'EUR', 2), 'EUR 91.00');
  assert.equal(formatMinor('123', 'JPY', 0), 'JPY 123');
  assert.equal(formatMinor('123', 'KWD', 3), 'KWD 0.123');
});
test('editing one group preserves siblings including same-product designs', () => {
  const first = { productId: '1', design: { placements: [], options: [] }, variants: [] };
  const sibling = { ...first, productId: '2' };
  const otherDesign = { ...first, configRevisionId: 'other' };
  const replacement = { ...first, variants: [{ variantId: '4', quantity: 3 }] };
  assert.deepEqual(replaceGroup([first, sibling, otherDesign], replacement, 0), [replacement, sibling, otherDesign]);
});
test('new request aborts old generation and rejects stale response ownership', () => {
  const lane = createRequestLane();
  const first = lane.next();
  const second = lane.next();
  assert.equal(first.signal.aborted, true);
  assert.equal(lane.current(first.id), false);
  assert.equal(lane.current(second.id), true);
});
test('buyer and artwork API use one private capability and locale proxy prefix', async () => {
  const calls = [];
  const api = createBuyerApi({
    proxyBase: '/fr/apps/custom',
    productId: '12',
    fetchImpl: async (url, init) => {
      calls.push([url, init]);
      return Response.json(
        url.includes('/sessions')
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
  assert.equal(calls[1][0], '/fr/apps/custom/v1/cart-state');
  assert.equal(calls[2][0], '/fr/apps/custom/guest/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/status');
  for (const [, init] of calls.slice(1)) {
    assert.equal(JSON.parse(init.body).capability, 'abc.def');
    assert.equal(init.credentials, 'same-origin');
  }
});
test('private session survives another instance without persisting design or URLs', async () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let sessions = 0;
  const fetchImpl = async (url) =>
    Response.json(
      url.includes('/sessions')
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
  assert.deepEqual(Object.keys(JSON.parse([...values.values()][0])).sort(), ['capability', 'expiresAt', 'sessionId']);
});
test('simultaneous product controls share one owner session before any private request', async () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let sessions = 0;
  const caps = [];
  const fetchImpl = async (url, init) => {
    if (url.includes('/sessions')) {
      sessions++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Response.json({
        capability: `cap${sessions}.def`,
        sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
    }
    caps.push(JSON.parse(init.body).capability);
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
test('size controls follow permitted step count and default artwork preserves placement overrides', async () => {
  const { sizeControlKind, applyDefaultArtwork } = await import('../src/buyer.ts');
  assert.equal(sizeControlKind(3), 'slider');
  assert.equal(sizeControlKind(2), 'cards');
  assert.equal(sizeControlKind(1), 'preview');
  assert.equal(sizeControlKind(0), 'preview');
  const group = {
    design: {
      placements: [
        { placementId: 'front', artwork: { kind: 'revision', revisionId: 'old' } },
        { placementId: 'back', artwork: { kind: 'revision', revisionId: 'override' } },
      ],
      options: [],
    },
    variants: [],
  };
  const next = applyDefaultArtwork(group, { kind: 'revision', revisionId: 'new' }, new Set(['back']));
  assert.deepEqual(
    next.design.placements.map((p) => p.artwork.revisionId),
    ['new', 'override'],
  );
});
test('advisory cart fingerprints are bounded hashes and uncertainty persists across locales', async () => {
  const { advisoryFingerprint, cartJournal } = await import('../src/buyer.ts');
  assert.equal(await advisoryFingerprint('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  cartJournal(storage, '/nl/').writeUnresolved(true);
  assert.equal(cartJournal(storage, '/en/').readUnresolved(), true);
});
test('authoritative negative customization increments display exact signed money', () =>
  assert.equal(formatMinor('-1', 'EUR', 2), 'EUR -0.01'));
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
  const geometry = {
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
  assert.equal(result.views[0].variantImages[0].variantId, '123');
  assert.equal(result.views[0].placements[0].variantOverrides[0].variantId, '123');
  assert.equal(geometry.views[0].variantImages[0].variantId, 'gid://shopify/ProductVariant/123');
});
test('complete view derives every placement own size/artwork and preserves siblings across preview renewal', async () => {
  const { buildBuyerScene } = await import('../src/buyer.ts');
  const geometry = {
    version: 'm5-geometry-v1',
    views: [
      {
        id: 'front',
        image: { revisionId: 'garment', width: 100, height: 100 },
        variantImages: [],
        placements: [
          { id: 'left', rect: { centerX: 0.25, centerY: 0.5, width: 0.2, height: 0.2 } },
          { id: 'right', rect: { centerX: 0.75, centerY: 0.5, width: 0.2, height: 0.2 } },
        ],
      },
    ],
    steps: [
      { id: 'small', widthFraction: 0.5, heightFraction: 0.5 },
      { id: 'large', widthFraction: 1, heightFraction: 1 },
    ],
  };
  const placements = [
    { placementId: 'left', stepId: 'small', artwork: { kind: 'deferred', intentId: 'later' } },
    { placementId: 'right', stepId: 'large', artwork: { kind: 'revision', revisionId: 'art' } },
  ];
  const previews = { art: { assetId: 'art', url: 'https://private.example/first.png', aspectRatio: 2 } };
  const first = buildBuyerScene({
    geometry,
    viewId: 'front',
    selectedPlacementId: 'left',
    placements,
    previews,
    imageUrls: { garment: 'https://public.example/garment.png' },
  });
  assert.equal(first.artworks.length, 2);
  assert.deepEqual(
    first.artworks.map((art) => [art.placementId, art.kind, art.bounds.width]),
    [
      ['left', 'logo-later', 35],
      ['right', 'raster', 70],
    ],
  );
  const renewed = buildBuyerScene({
    geometry,
    viewId: 'front',
    selectedPlacementId: 'left',
    placements,
    previews: { art: { ...previews.art, url: 'https://private.example/renewed.png' } },
    imageUrls: { garment: 'https://public.example/garment.png' },
  });
  assert.deepEqual(renewed.artworks[0], first.artworks[0]);
  assert.equal(renewed.artworks[1].url, 'https://private.example/renewed.png');
  const unseen = buildBuyerScene({ geometry, viewId: 'unknown', placements, previews, imageUrls: {} });
  assert.deepEqual(unseen.artworks, []);
});
