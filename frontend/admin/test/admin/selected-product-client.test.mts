import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSelectedProductClient, SelectedProductPublicationBlocked } from '../../src/islands/selected-product-client.ts';
import { MerchantDraftSchema, SelectedProductSetupSchema } from '@insignia/contracts';
import { isUnansweredRequest } from '../../src/shared/admin-request.ts';

const product = { id: 'gid://shopify/Product/111', title: 'T-shirt', status: 'ACTIVE', imageUrl: null, variants: [] };
const draft = MerchantDraftSchema.parse({
  version: 'm5-merchant-draft-v1',
  mode: 'required',
  shopCurrency: 'USD',
  methods: [],
  placements: [],
  productionOptions: [],
  pricingRules: [],
  geometry: { version: 'm5-geometry-v1', views: [], steps: [] },
});
const setup = SelectedProductSetupSchema.parse({
  version: 'selected-product-setup-v1',
  methodBindings: {},
  product: { id: product.id, title: product.title, images: [], methods: [], views: [] },
});
const preferences = {
  version: 'merchant-preferences-v1',
  shop: 'test.myshopify.com',
  authority: 'a'.repeat(64),
  canEdit: true,
  guidanceVersion: '0',
  wordingVersion: '0',
  guidance: { dismissed: false, completedSteps: [] },
  overlays: { en: { locale: 'en', messages: {} } },
};
const key = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memory.set(k, v);
    },
    removeItem: (k: string) => {
      memory.delete(k);
    },
  };
  let currentDraft = draft,
    version = '1',
    fail = true;
  const keys: string[] = [],
    bodies: string[] = [];
  const request = async (path: string, init?: RequestInit) => {
    if (path.endsWith('preferences')) return preferences;
    if (!init)
      return {
        product,
        config: {
          configId: 'config-1',
          installationGeneration: '1',
          draftVersion: version,
          draft: currentDraft,
          currentShopCurrency: 'USD',
          publication: {
            state: 'DRAFT',
            revisionId: null,
            sourceDraftVersion: null,
            requestKey: null,
            activeRevisionId: null,
            reason: null,
            requiresAllChannelHold: null,
            functionReadiness: null,
          },
          publishEligibility: { allowed: true, reason: null },
        },
      };
    const body = String(init.body);
    bodies.push(body);
    keys.push(new Headers(init.headers).get('Idempotency-Key')!);
    currentDraft = JSON.parse(body).draft;
    version = '2';
    if (fail) {
      fail = false;
      throw new Error('Reply lost after commit');
    }
    return { kind: 'saved', draftVersion: '2' };
  };
  return { storage, request, keys, bodies };
}
test('a lost save reply survives reload and retries the exact original draft, version and operation key', async () => {
  const f = fixture();
  const first = createSelectedProductClient({ productId: product.id, ...f, newKey: () => key });
  await first.load();
  await assert.rejects(first.save(setup));
  const reloaded = createSelectedProductClient({
    productId: product.id,
    ...f,
    newKey: () => {
      throw new Error('Must reuse original identity');
    },
  });
  await reloaded.load();
  await reloaded.retry();
  assert.deepEqual(f.keys, [`${key}:save`, `${key}:save`]);
  assert.equal(f.bodies[0], f.bodies[1]);
  assert.equal(reloaded.hasPending(), false);
});
test('new edits cannot replace an unresolved save and missing journal custody sends no mutation', async () => {
  const f = fixture();
  const client = createSelectedProductClient({ productId: product.id, ...f, newKey: () => key });
  await client.load();
  await assert.rejects(client.save(setup));
  await assert.rejects(client.save({ ...setup, product: { ...setup.product, title: 'Changed after pending write' } }));
  assert.equal(f.keys.length, 1);
  const broken = createSelectedProductClient({
    productId: product.id,
    request: f.request,
    newKey: () => key,
    storage: {
      ...f.storage,
      getItem: () => null,
      setItem: () => {
        throw new Error('Storage unavailable');
      },
    },
  });
  await broken.load();
  await assert.rejects(broken.save(setup));
  assert.equal(f.keys.length, 1);
});

function configView(version = '1', state: 'DRAFT' | 'ACTIVE' | 'OPERATOR_HOLD' | 'FAILED' = 'DRAFT') {
  return {
    product,
    config: {
      configId: 'config-1',
      installationGeneration: '1',
      draftVersion: version,
      draft: { ...draft, selectedSetup: setup },
      currentShopCurrency: 'USD',
      publishedSetup: state === 'ACTIVE' ? setup : null,
      publication: {
        state,
        revisionId: state === 'ACTIVE' ? 'old-revision' : null,
        activeRevisionId: state === 'ACTIVE' ? 'old-revision' : null,
        sourceDraftVersion: state === 'ACTIVE' ? '1' : null,
        requestKey: null,
        reason: null,
        requiresAllChannelHold: false,
        functionReadiness: 'ready',
      },
      publishEligibility: { allowed: true, reason: null },
    },
  };
}
test('confirmed draft saves blocked by publication eligibility do not claim inherited changes or an unresolved mutation', async () => {
  const f = fixture();
  let saved = false;
  let publications = 0;
  const client = createSelectedProductClient({ productId: product.id, storage: f.storage, newKey: () => key,
    request: async (path, init) => {
      if (path.endsWith('preferences')) return preferences;
      if (init?.method === 'PUT') { saved = true; return { kind: 'saved', draftVersion: '2' }; }
      if (init) { publications++; throw new Error('Publication must remain blocked'); }
      const view = configView(saved ? '2' : '1');
      return saved ? { ...view, config: { ...view.config, publishEligibility: { allowed: false, reason: 'Subscription verification unavailable' } } } : view;
    },
  });
  await client.load();
  await assert.rejects(client.publish(setup), (error: unknown) => {
    assert(error instanceof SelectedProductPublicationBlocked);
    assert.equal(error.view.config?.draftVersion, '2');
    assert.equal(error.message, 'Subscription verification unavailable');
    return true;
  });
  assert.equal(publications, 0);
  assert.equal(client.hasPending(), false);
});
test('older ACTIVE cannot acknowledge a newer publication; exact retry settles only its matching revision and source', async () => {
  const f = fixture();
  let version = '1',
    publishing = false,
    latest = false;
  const mutations: { key: string; body: string }[] = [];
  const request = async (path: string, init?: RequestInit) => {
    if (path.endsWith('preferences')) return preferences;
    if (!init) {
      const value = configView(version, publishing ? 'ACTIVE' : 'DRAFT');
      if (publishing && latest) {
        value.config.publication.sourceDraftVersion = '2';
        value.config.publication.revisionId = 'new-revision';
        value.config.publication.activeRevisionId = 'new-revision';
      }
      return value;
    }
    mutations.push({ key: new Headers(init.headers).get('Idempotency-Key')!, body: String(init.body) });
    if (init.method === 'PUT') {
      version = '2';
      return { kind: 'saved', draftVersion: '2' };
    }
    publishing = true;
    return { kind: 'accepted', state: 'REMOTE_PENDING', revisionId: 'new-revision' };
  };
  const client = createSelectedProductClient({ productId: product.id, storage: f.storage, request, newKey: () => key });
  await client.load();
  await client.publish(setup);
  assert.equal(client.hasPending(), true);
  latest = true;
  await client.retry();
  assert.equal(client.hasPending(), false);
  assert.equal(mutations.length, 3);
  assert.deepEqual(mutations[2], mutations[1]);
});
test('operator-held publication cannot dispatch even a preparatory save', async () => {
  const f = fixture();
  let writes = 0;
  const client = createSelectedProductClient({
    productId: product.id,
    storage: f.storage,
    request: async (path, init) => {
      if (init) writes++;
      return path.endsWith('preferences') ? preferences : configView('1', 'OPERATOR_HOLD');
    },
  });
  await client.load();
  await assert.rejects(client.publish(setup), /reconciliation/);
  assert.equal(writes, 0);
  assert.equal(client.hasPending(), false);
});
test('authorization loss during an unknown save scrubs private custody and fences the late completion', async () => {
  const f = fixture();
  let denied = false,
    cleared = 0;
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent = new Promise<void>((resolve) => {
    started = resolve;
  });
  const request = async (path: string, init?: RequestInit) => {
    if (path.endsWith('preferences')) return preferences;
    if (!init) {
      if (denied) throw Object.assign(new Error('Denied'), { status: 403 });
      return configView();
    }
    started();
    await gate;
    return { kind: 'saved', draftVersion: '2' };
  };
  const client = createSelectedProductClient({
    productId: product.id,
    storage: f.storage,
    request,
    newKey: () => key,
    onDenied: () => {
      cleared++;
    },
  });
  await client.load();
  const saving = client.save(setup);
  await sent;
  denied = true;
  await assert.rejects(client.peek());
  release();
  await assert.rejects(saving);
  assert.equal(cleared, 1);
  const marker = f.storage.getItem(`insignia:selected-product-write:v1:${preferences.shop}:${product.id}`)!;
  assert.ok(marker);
  const parsed = JSON.parse(marker);
  assert.equal(parsed.requiresReconciliation, true);
  assert.equal(parsed.key, key);
  assert.equal('setup' in parsed, false);
  assert.equal('draft' in parsed, false);
  await assert.rejects(client.retry());
});
test('a delayed passive read cannot replace a newer confirmed save baseline', async () => {
  const f = fixture();
  let current = configView(),
    hold = false,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client = createSelectedProductClient({
    productId: product.id,
    storage: f.storage,
    newKey: () => key,
    request: async (path, init) => {
      if (path.endsWith('preferences')) return preferences;
      if (init) {
        current = configView('2');
        return { kind: 'saved', draftVersion: '2' };
      }
      const snapshot = structuredClone(current);
      if (hold) {
        hold = false;
        await gate;
      }
      return snapshot;
    },
  });
  await client.load();
  hold = true;
  const reading = client.peek();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await client.save(setup);
  release();
  assert.equal(client.adoptObservation(await reading), false);
});

test('expired private save custody resolves through the original operation barrier without replaying its draft', async () => {
  const f = fixture();
  let clock = 0;
  const first = createSelectedProductClient({ productId: product.id, ...f, newKey: () => key, now: () => clock });
  await first.load();
  await assert.rejects(first.save(setup));
  clock = 3600001;
  const calls: unknown[] = [];
  const request = async (path: string, init?: RequestInit) => {
    if (init) {
      calls.push(JSON.parse(String(init.body)));
      assert.equal(new Headers(init.headers).get('Idempotency-Key'), `${key}:reconcile`);
      return { kind: 'resolved' };
    }
    return path.endsWith('preferences') ? preferences : configView('2');
  };
  const restored = createSelectedProductClient({
    productId: product.id,
    storage: f.storage,
    request,
    now: () => clock,
  });
  await restored.load();
  assert.deepEqual(calls, [{ action: 'reconcile', stage: 'save', operationKey: key }]);
  assert.equal(restored.hasPending(), false);
  assert.equal(f.keys.length, 1);
});

test('database JSON object ordering does not turn unchanged translated Method text into another publication review', async () => {
  const candidate = SelectedProductSetupSchema.parse({
    ...setup,
    product: {
      ...setup.product,
      methods: [
        {
          id: 'print',
          name: 'Print',
          pricing: 'fixed',
          amount: '1.00',
          translations: { nl: { name: 'Druk' }, de: { name: 'Druck' } },
        },
      ],
    },
  });
  const persisted = structuredClone(candidate);
  persisted.product.methods[0]!.translations = { de: { name: 'Druck' }, nl: { name: 'Druk' } };
  const f = fixture();
  let saved = false,
    published = false,
    publishes = 0;
  const client = createSelectedProductClient({
    productId: product.id,
    storage: f.storage,
    newKey: () => key,
    request: async (path, init) => {
      if (path.endsWith('preferences')) return preferences;
      if (init?.method === 'PUT') {
        saved = true;
        return { kind: 'saved', draftVersion: '2' };
      }
      if (init) {
        published = true;
        publishes++;
        return { kind: 'accepted', state: 'ACTIVE', revisionId: 'new-revision' };
      }
      const value = configView(saved ? '2' : '1', published ? 'ACTIVE' : 'DRAFT');
      value.config.draft = { ...draft, selectedSetup: persisted };
      if (published) {
        value.config.publishedSetup = persisted;
        value.config.publication.revisionId = 'new-revision';
        value.config.publication.activeRevisionId = 'new-revision';
        value.config.publication.sourceDraftVersion = '2';
      }
      return value;
    },
  });
  await client.load();
  await client.publish(candidate);
  assert.equal(publishes, 1);
  assert.equal(client.hasPending(), false);
});

test('a newly required Method keep/remove review is adopted before any publication request', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const candidate = SelectedProductSetupSchema.parse({
    ...setup,
    product: {
      ...setup.product,
      methods: [{ id: 'print', name: 'Print', pricing: 'fixed', amount: '1.00' }],
      views: [
        {
          id: 'front',
          name: 'Front',
          imageUrl: '',
          imageWidth: 100,
          imageHeight: 100,
          placements: [
            {
              id: 'chest',
              name: 'Chest',
              rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 },
              widthCm: '1',
              heightCm: '1',
              methodIds: ['print'],
              sizes: [],
              logoLaterAllowed: true,
            },
          ],
        },
      ],
    },
    methodBindings: {
      print: {
        catalogMethodId: id,
        observedVersion: '1',
        name: { source: 'catalog', value: 'Print' },
        explanation: { source: 'catalog', value: '' },
        translations: {},
        prices: { default: { source: 'catalog', value: '1.00' } },
        review: null,
      },
    },
  });
  const persisted = structuredClone(candidate);
  persisted.methodBindings.print!.review = { reason: 'unassigned', catalogVersion: '1', decision: 'pending' };
  const f = fixture();
  let saved = false,
    publishes = 0;
  const client = createSelectedProductClient({
    productId: product.id,
    storage: f.storage,
    newKey: () => key,
    request: async (path, init) => {
      if (path.endsWith('preferences')) return preferences;
      if (init?.method === 'PUT') {
        saved = true;
        return { kind: 'saved', draftVersion: '2' };
      }
      if (init) {
        publishes++;
        throw new Error('Review must happen first');
      }
      const value = configView(saved ? '2' : '1');
      value.config.draft = { ...draft, selectedSetup: saved ? persisted : candidate };
      return value;
    },
  });
  await client.load();
  await assert.rejects(client.publish(candidate), /Review/);
  assert.equal(publishes, 0);
  assert.equal(client.hasPending(), false);
});
test('an explicit server no-effect rejection closes the publication attempt rather than trapping edits', async () => {
  const f = fixture();
  let saved = false;
  const client = createSelectedProductClient({
    productId: product.id,
    storage: f.storage,
    newKey: () => key,
    request: async (path, init) => {
      if (path.endsWith('preferences')) return preferences;
      if (init?.method === 'PUT') {
        saved = true;
        return { kind: 'saved', draftVersion: '2' };
      }
      if (init && JSON.parse(String(init.body)).action === 'reconcile')
        return { kind: 'resolved', publicationRecorded: false };
      if (init) throw Object.assign(new Error('Review required'), { status: 422, noEffect: true });
      return configView(saved ? '2' : '1');
    },
  });
  await client.load();
  await assert.rejects(client.publish(setup));
  assert.equal(client.hasPending(), false);
});

test('a publication validation rejection is durably fenced before local custody is released', async () => {
  const f = fixture();
  let saved = false,
    publications = 0,
    reconciliations = 0;
  const request = async (path: string, init?: RequestInit) => {
    if (path.endsWith('preferences')) return preferences;
    if (!init) return configView(saved ? '2' : '1');
    if (init.method === 'PUT') {
      saved = true;
      return { kind: 'saved', draftVersion: '2' };
    }
    const body = JSON.parse(String(init.body));
    if (body.action === 'reconcile') {
      assert.deepEqual(body, { action: 'reconcile', stage: 'publish', operationKey: key });
      assert.equal(new Headers(init.headers).get('Idempotency-Key'), `${key}:reconcile`);
      reconciliations++;
      return { kind: 'resolved', publicationRecorded: false };
    }
    publications++;
    throw Object.assign(new Error('The selected Shopify image changed'), { status: 422 });
  };
  const client = createSelectedProductClient({ productId: product.id, storage: f.storage, request, newKey: () => key });
  await client.load();
  await assert.rejects(client.publish(setup), /image changed/);
  assert.equal(reconciliations, 1);
  assert.equal(publications, 1);
  assert.equal(client.hasPending(), false);
});

test('expired ambiguous publication reconciles absent and committed original intents before choosing a retry', async () => {
  for (const recorded of [false, true]) {
    const f = fixture();
    let clock = 0,
      saved = false,
      publications = 0,
      reconciliations = 0;
    const request = async (path: string, init?: RequestInit) => {
      if (path.endsWith('preferences')) return preferences;
      if (!init) return configView(saved ? '2' : '1');
      if (init.method === 'PUT') {
        saved = true;
        return { kind: 'saved', draftVersion: '2' };
      }
      const body = JSON.parse(String(init.body));
      if (body.action === 'reconcile') {
        reconciliations++;
        return { kind: 'resolved', publicationRecorded: recorded };
      }
      publications++;
      if (publications === 1) throw new Error('Acknowledgement lost');
      assert.equal(new Headers(init.headers).get('Idempotency-Key'), `${key}:publish`);
      assert.deepEqual(body, { action: 'publish', configId: 'config-1', draftVersion: '2' });
      return { kind: 'accepted', state: 'PREPARING', revisionId: 'original-revision' };
    };
    const first = createSelectedProductClient({
      productId: product.id,
      storage: f.storage,
      request,
      newKey: () => key,
      now: () => clock,
    });
    await first.load();
    await assert.rejects(first.publish(setup));
    clock = 3600001;
    const next = createSelectedProductClient({ productId: product.id, storage: f.storage, request, now: () => clock });
    await next.load();
    if (next.hasPending()) await next.retry();
    assert.equal(reconciliations, recorded ? 2 : 1);
    assert.equal(publications, recorded ? 2 : 1);
    assert.equal(next.hasPending(), recorded, 'Only a genuinely recorded pending publication retains custody');
  }
});

test('business denial scrubs the proposal and a fresh authorized load fences the rejected publication without replay', async () => {
  const f = fixture();
  let saved = false,
    publications = 0,
    reconciliations = 0;
  const request = async (path: string, init?: RequestInit) => {
    if (path.endsWith('preferences')) return preferences;
    if (!init) return configView(saved ? '2' : '1');
    if (init.method === 'PUT') {
      saved = true;
      return { kind: 'saved', draftVersion: '2' };
    }
    if (JSON.parse(String(init.body)).action === 'reconcile') {
      reconciliations++;
      return { kind: 'resolved', publicationRecorded: false };
    }
    publications++;
    throw Object.assign(new Error('Plan does not permit publication'), { status: 403 });
  };
  const first = createSelectedProductClient({ productId: product.id, storage: f.storage, request, newKey: () => key });
  await first.load();
  await assert.rejects(first.publish(setup));
  const marker = JSON.parse(f.storage.getItem(`insignia:selected-product-write:v1:${preferences.shop}:${product.id}`)!);
  assert.equal(marker.requiresReconciliation, true);
  assert.equal(marker.setup, undefined);
  assert.equal(marker.draft, undefined);
  const next = createSelectedProductClient({ productId: product.id, storage: f.storage, request });
  await next.load();
  assert.equal(next.hasPending(), false);
  assert.equal(publications, 1);
  assert.equal(reconciliations, 1);
});
test('oversized authoring content is rejected before any mutation or pending custody', async () => {
  const f = fixture();
  const client = createSelectedProductClient({ productId: product.id, ...f, newKey: () => key });
  await client.load();
  const translations = Object.fromEntries(
    Array.from({ length: 32 }, (_, index) => [`en-x-l${index}`, { explanation: 'x'.repeat(2000) }]),
  );
  const large = {
    ...setup,
    product: {
      ...setup.product,
      methods: Array.from({ length: 32 }, (_, index) => ({
        id: `method_${index}`,
        name: 'Print',
        pricing: 'product' as const,
        amount: '',
        translations,
      })),
    },
  };
  await assert.rejects(client.save(large), /qualified save size/);
  assert.equal(f.keys.length, 0);
  assert.equal(client.hasPending(), false);
});
test('a different oversized proposal cannot erase an earlier unknown save operation', async () => {
  const f = fixture();
  const client = createSelectedProductClient({ productId: product.id, ...f, newKey: () => key });
  await client.load();
  await assert.rejects(client.save(setup));
  const journalKey = `insignia:selected-product-write:v1:${preferences.shop}:${product.id}`,
    original = f.storage.getItem(journalKey);
  const translations = Object.fromEntries(
    Array.from({ length: 32 }, (_, index) => [`en-x-l${index}`, { explanation: 'x'.repeat(2000) }]),
  );
  const large = {
    ...setup,
    product: {
      ...setup.product,
      methods: Array.from({ length: 32 }, (_, index) => ({
        id: `method_${index}`,
        name: 'Print',
        pricing: 'product' as const,
        amount: '',
        translations,
      })),
    },
  };
  await assert.rejects(client.save(large), /original pending/);
  assert.equal(f.storage.getItem(journalKey), original);
  assert.equal(f.keys.length, 1);
  await client.retry();
  assert.equal(client.hasPending(), false);
  assert.equal(f.keys.length, 2);
  assert.equal(f.bodies[0], f.bodies[1]);
});
test('a matching terminal failed publication releases custody without claiming the prior active revision as success', async () => {
  const f = fixture();
  let saved = false,
    publishing = false;
  const candidate = {
    ...setup,
    product: { ...setup.product, methods: [{ id: 'print', name: 'Print', pricing: 'product' as const, amount: '' }] },
  };
  const client = createSelectedProductClient({
    productId: product.id,
    storage: f.storage,
    newKey: () => key,
    request: async (path, init) => {
      if (path.endsWith('preferences')) return preferences;
      if (init?.method === 'PUT') {
        saved = true;
        return { kind: 'saved', draftVersion: '2' };
      }
      if (init) {
        publishing = true;
        return { kind: 'accepted', state: 'FAILED', revisionId: 'failed-revision' };
      }
      const value = configView(saved ? '2' : '1', publishing ? 'FAILED' : 'DRAFT');
      value.config.draft = { ...draft, selectedSetup: candidate };
      if (publishing) {
        value.config.publication.revisionId = 'failed-revision';
        value.config.publication.sourceDraftVersion = '2';
        value.config.publication.activeRevisionId = 'old-revision';
        value.config.publishedSetup = setup;
      }
      return value;
    },
  });
  await client.load();
  const result = await client.publish(candidate);
  assert.equal(result.config?.publication.state, 'FAILED');
  assert.equal(result.config?.publication.activeRevisionId, 'old-revision');
  assert.equal(client.hasPending(), false);
});

/** Scripted save answers: `lose` is a 503, `reject` the server's coded 422; the fence (reconcile) works or is down. */
function scriptedSaves(writes: ('lose' | 'reject' | 'ok')[], fence: 'ok' | 'down') {
  const sent: { key: string; action: string }[] = [];
  let saved = false;
  const request = async (path: string, init?: RequestInit) => {
    if (path.endsWith('preferences')) return preferences;
    if (!init) return configView(saved ? '2' : '1');
    const action = JSON.parse(String(init.body)).action;
    sent.push({ key: new Headers(init.headers).get('Idempotency-Key')!, action });
    if (action === 'reconcile') {
      if (fence === 'down') throw Object.assign(new Error('Admin service unavailable'), { status: 503 });
      return { kind: 'resolved' };
    }
    const next = writes.shift();
    if (next === 'lose') throw Object.assign(new Error('Admin service unavailable'), { status: 503 });
    if (next === 'reject')
      throw Object.assign(new Error('Review the configuration validation errors before saving or publishing.'), {
        status: 422,
        code: 'SETUP_SIZE_INVALID',
        noEffect: true,
      });
    saved = true;
    return { kind: 'saved', draftVersion: '2' };
  };
  return { request, sent };
}

test('a first save the server rejects with a 422 leaves no pending write, even when its fence cannot be sent', async () => {
  const f = fixture();
  const server = scriptedSaves(['reject'], 'down');
  const client = createSelectedProductClient({ productId: product.id, storage: f.storage, request: server.request, newKey: () => key });
  await client.load();
  await assert.rejects(client.save(setup), { status: 422, code: 'SETUP_SIZE_INVALID' });
  assert.equal(client.hasPending(), false, 'The rejected request is final; a corrected save is a new request');
});

test('after a 422 the corrected save is a new request with its own key', async () => {
  const f = fixture();
  const server = scriptedSaves(['reject', 'ok'], 'ok');
  const keys = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
  const client = createSelectedProductClient({ productId: product.id, storage: f.storage, request: server.request, newKey: () => keys.shift()! });
  await client.load();
  await assert.rejects(client.save(setup), { status: 422 });
  assert.equal(client.hasPending(), false);
  await client.save({ ...setup, product: { ...setup.product, title: 'Corrected' } });
  assert.deepEqual(
    server.sent.filter((entry) => entry.action === 'save').map((entry) => entry.key),
    ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:save', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:save'],
  );
  assert.equal(client.hasPending(), false);
});

test('a lost reply (503) keeps the write pending for Retry; a later 422 for that retry closes it once the fence is recorded', async () => {
  const f = fixture();
  const server = scriptedSaves(['lose', 'reject'], 'ok');
  const client = createSelectedProductClient({ productId: product.id, storage: f.storage, request: server.request, newKey: () => key });
  await client.load();
  await assert.rejects(client.save(setup), { status: 503 });
  assert.equal(client.hasPending(), true, 'An unconfirmed write stays in custody for Retry');
  await assert.rejects(client.retry(), { status: 422 });
  assert.equal(client.hasPending(), false);
});

test('a 422 for a retried write whose fence cannot be sent keeps the original identity in custody', async () => {
  const f = fixture();
  const server = scriptedSaves(['lose', 'reject'], 'down');
  const client = createSelectedProductClient({ productId: product.id, storage: f.storage, request: server.request, newKey: () => key });
  await client.load();
  await assert.rejects(client.save(setup), { status: 503 });
  await assert.rejects(client.retry(), { status: 422 });
  assert.equal(client.hasPending(), true, 'An earlier attempt of this key may still have committed');
});

for (const outcome of ['ACTIVE', 'FAILED'] as const)
  test(`#436: an unanswered publish settles from a later read by its exact request key: ${outcome}`, async () => {
    const f = fixture();
    let saved = false,
      published = false;
    const candidate = {
      ...setup,
      product: { ...setup.product, methods: [{ id: 'print', name: 'Print', pricing: 'product' as const, amount: '' }] },
    };
    // The server keeps its own canonical form of the saved setup, not byte-identical to the journal.
    const canonical = { ...candidate, product: { ...candidate.product, title: `${candidate.product.title} (stored)` } };
    const client = createSelectedProductClient({
      productId: product.id,
      storage: f.storage,
      newKey: () => key,
      request: async (path, init) => {
        if (path.endsWith('preferences')) return preferences;
        if (init?.method === 'PUT') {
          saved = true;
          return { kind: 'saved', draftVersion: '2' };
        }
        if (init) throw new Error('Admin request timed out');
        const value = configView(saved ? '2' : '1', published ? outcome : 'DRAFT');
        value.config.draft = { ...draft, selectedSetup: published ? canonical : candidate };
        if (published) {
          value.config.publication.revisionId = 'new-revision';
          value.config.publication.activeRevisionId = outcome === 'ACTIVE' ? 'new-revision' : 'old-revision';
          value.config.publication.sourceDraftVersion = '2';
          Object.assign(value.config.publication, { requestKey: `${key}:publish` });
          value.config.publishedSetup = outcome === 'ACTIVE' ? canonical : null;
        }
        return value;
      },
    });
    await client.load();
    await assert.rejects(client.publish(candidate), /timed out/);
    assert.equal(client.hasPendingPublication(), true, 'the unanswered request keeps its custody');
    published = true;
    const later = await client.peek();
    // Another request's outcome for the same draft does not settle this one, even when its
    // published setup has exactly the journaled bytes.
    const other = structuredClone(later);
    other.config!.publication.requestKey = 'another-key:publish';
    if (outcome === 'ACTIVE') other.config!.publishedSetup = candidate;
    assert.equal(client.adoptObservation(other), true);
    assert.equal(client.hasPending(), true);
    assert.equal(client.adoptObservation(later), true);
    assert.equal(client.hasPending(), false);
  });

/** #468: a publish whose staff session ended between steps; the server answers `continue` `stops` times. */
function continuingPublication(stops: number) {
  const f = fixture();
  let saved = false,
    published = false;
  const sent: { key: string | null; body: string; continuationValidityMs: number | undefined }[] = [];
  const client = createSelectedProductClient({
    productId: product.id,
    storage: f.storage,
    newKey: () => key,
    request: async (path, init, continuationValidityMs) => {
      if (path.endsWith('preferences')) return preferences;
      if (init?.method === 'PUT') {
        saved = true;
        return { kind: 'saved', draftVersion: '2' };
      }
      if (init) {
        sent.push({
          key: new Headers(init.headers).get('Idempotency-Key'),
          body: String(init.body),
          continuationValidityMs,
        });
        if (sent.length <= stops)
          return {
            kind: 'continue',
            revisionId: 'new-revision',
            minimumValidityMs: 30000,
            message: 'Publication is still in progress.',
          };
        published = true;
        return { kind: 'accepted', state: 'ACTIVE', revisionId: 'new-revision' };
      }
      const value = configView(saved ? '2' : '1', published ? 'ACTIVE' : 'DRAFT');
      if (published) {
        value.config.publication.revisionId = 'new-revision';
        value.config.publication.activeRevisionId = 'new-revision';
        value.config.publication.sourceDraftVersion = '2';
        Object.assign(value.config.publication, { requestKey: `${key}:publish` });
      }
      return value;
    },
  });
  return { client, sent, storage: f.storage };
}

test('#468: a continue answer re-sends the same publish once with the requested token validity', async () => {
  const f = continuingPublication(1);
  await f.client.load();
  const view = await f.client.publish(setup);
  assert.equal(view.config?.publication.state, 'ACTIVE');
  assert.equal(f.sent.length, 2);
  const [first, second] = f.sent;
  assert.equal(first?.continuationValidityMs, undefined, 'the first send uses the ordinary token window');
  assert.equal(second?.continuationValidityMs, 30000);
  assert.equal(second?.key, `${key}:publish`);
  assert.equal(second?.key, first?.key);
  assert.equal(second?.body, first?.body, 'the same request bytes');
  assert.equal(f.client.hasPending(), false, 'settled');
});

test('#468: a publish that keeps answering continue is followed, not failed or re-sent forever', async () => {
  const f = continuingPublication(Number.POSITIVE_INFINITY);
  await f.client.load();
  await assert.rejects(f.client.publish(setup), (error) => {
    assert.equal(isUnansweredRequest(error), true, 'the editor follows it like a sent publish without an answer');
    return true;
  });
  assert.equal(f.sent.length, 4, 'three continuations');
  assert.equal(f.client.hasPendingPublication(), true, 'the original request keeps its custody');
  const stored = JSON.parse(f.storage.getItem(`insignia:selected-product-write:v1:${preferences.shop}:${product.id}`)!);
  assert.equal(stored.acceptedRevisionId, 'new-revision', 'its operation identity is kept for settlement');
});
