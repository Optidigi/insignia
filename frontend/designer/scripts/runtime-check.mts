import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { DesignerEvent, DesignerState } from '../src/designer-state';
import type { CartReceipt, CartRequest, DesignerPorts, UploadRequest } from '../src/runtime';

const bundle = await build({
  stdin: {
    contents:
      'export * from "./src/designer-state"; export * from "./src/runtime"; export * from "./src/demo/local-runtime"; export * from "./src/config"; export * from "./src/shopify-variant-matrix"; export * from "./src/model"; export * from "./src/commit-failure";',
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const temporary = await mkdtemp(join(tmpdir(), 'insignia-runtime-check-'));
after(() => rm(temporary, { recursive: true, force: true }));
const moduleFile = join(temporary, 'runtime.mjs');
await writeFile(moduleFile, bundle.outputFiles[0]!.text);
const {
  createDesignerState,
  hasDraftChanges,
  hasUnappliedDraft,
  productDesignEditRequiresConfirmation,
  designerReducer,
  createDesignerRuntime,
  canCommitDesign,
  configSchema,
  createProductModel,
  buildShopifyVariantMatrix,
  createLocalRuntime,
  commitFailure,
  commitFailureView,
} = (await import(pathToFileURL(moduleFile).href)) as typeof import('../src/designer-state') &
  typeof import('../src/commit-failure') &
  typeof import('../src/runtime') &
  typeof import('../src/demo/local-runtime') &
  typeof import('../src/config') &
  typeof import('../src/shopify-variant-matrix') &
  typeof import('../src/model');
function ready() {
  return designerReducer(
    createDesignerState({
      rules: {
        positions: [
          {
            id: 'front',
            name: 'Front',
            price: 0,
            sizePrices: [0],
            view: 'front',
            dimensions: [10],
            methodIds: ['print'],
            x: 50,
            y: 50,
            width: 20,
          },
        ],
        colorIds: ['white'],
        sizeIds: ['s'],
        availableSizes: { white: ['s'] },
        maxQuantity: 100,
        deferablePositions: [],
      },
      view: 'front',
      color: 'white',
      prints: [{ id: 'front', artworkId: 'logo', method: 'print', size: 0 }],
      active: 'front',
      expanded: 'front',
      artworks: [{ id: 'logo', name: 'Logo', url: '/logo.svg', width: 30, height: 20 }],
      designerOpen: true,
    }),
    { type: 'quantity-entered', color: 'white', size: 's', value: 2 },
  );
}
function harness(
  ports: {
    review?: DesignerPorts['review'];
    artwork: { upload(file: File, request: UploadRequest): Promise<unknown> };
    cart: { commit(request: CartRequest): Promise<unknown> };
  },
  initial: DesignerState = ready(),
  options?: Parameters<typeof createDesignerRuntime>[3],
) {
  let state = designerReducer(initial, { type: 'step-selected', step: 2 });
  const dispatch = (event: DesignerEvent) => {
    state = designerReducer(state, event);
  };
  const runtime = createDesignerRuntime(ports as DesignerPorts, () => state, dispatch, options);
  return {
    runtime,
    dispatch,
    get state() {
      return state;
    },
  };
}
function delayed() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const receipt = (request: CartRequest): CartReceipt => ({
  kind: 'applied',
  requestId: request.requestId,
  designId: request.design.id,
  operation: request.operation,
  authority: 'local-preview',
});
test('commit waits for an applied receipt and prevents a second submission', async () => {
  const deferred = delayed();
  let calls = 0;
  let request!: CartRequest;
  const app = harness({
    artwork: {
      upload: async () => {
        throw Error();
      },
    },
    cart: {
      commit: async (value) => {
        calls++;
        request = value;
        return deferred.promise;
      },
    },
  });
  const pending = app.runtime.commit();
  assert.equal(app.state.open, true);
  assert.equal(app.state.completion, null);
  assert.equal(app.state.commit.kind, 'pending');
  await app.runtime.commit();
  assert.equal(calls, 1);
  deferred.resolve(receipt(request));
  await pending;
  assert.equal(app.state.open, false);
  assert.equal(app.state.completion!.operation, 'added');
});

test('a rejected or malformed commit stays open and preserves the draft for retry', async () => {
  for (const commit of [
    async () => {
      throw new Error('offline');
    },
    async () => undefined,
    async (request: CartRequest) => ({ ...receipt(request), requestId: 'wrong' }),
  ]) {
    const app = harness({
      artwork: {
        upload: async () => {
          throw Error();
        },
      },
      cart: { commit },
    });
    const prints = structuredClone(app.state.prints);
    const quantities = { ...app.state.quantities };
    await app.runtime.commit();
    assert.equal(app.state.open, true);
    assert.equal(app.state.completion, null);
    assert.equal(app.state.commit.kind, 'failed');
    assert.deepEqual(app.state.prints, prints);
    assert.deepEqual(app.state.quantities, quantities);
  }
});

test('closing cancels an outstanding commit and ignores its later receipt even after reopen', async () => {
  const deferred = delayed();
  let request!: CartRequest;
  const app = harness({
    artwork: {
      upload: async () => {
        throw Error();
      },
    },
    cart: {
      commit: async (value) => {
        request = value;
        return deferred.promise;
      },
    },
  });
  const pending = app.runtime.commit();
  app.runtime.cancel();
  app.dispatch({ type: 'product-return-requested' });
  app.dispatch({ type: 'designer-reopened' });
  assert.equal(request.signal.aborted, true);
  deferred.resolve(receipt(request));
  await pending;
  assert.equal(app.state.open, true);
  assert.equal(app.state.completion, null);
  const late = designerReducer(app.state, {
    type: 'cart-commit-succeeded',
    requestId: request.requestId,
    receipt: receipt(request),
  });
  assert.equal(late, app.state, 'the reducer separately rejects results after cancellation');
});

test('an old completion cannot finish a newer commit', async () => {
  const first = delayed();
  const second = delayed();
  const requests: CartRequest[] = [];
  const app = harness({
    artwork: {
      upload: async () => {
        throw Error();
      },
    },
    cart: {
      commit: async (request) => {
        requests.push(request);
        return requests.length === 1 ? first.promise : second.promise;
      },
    },
  });
  const pendingFirst = app.runtime.commit();
  app.runtime.cancelCommit();
  const pendingSecond = app.runtime.commit();
  first.resolve(receipt(requests[0]));
  await pendingFirst;
  assert.equal(
    (app.state.commit as Extract<DesignerState['commit'], { kind: 'pending' }>).requestId,
    requests[1].requestId,
  );
  assert.equal(app.state.completion, null);
  second.resolve(receipt(requests[1]));
  await pendingSecond;
  assert.equal(app.state.completion!.requestId, requests[1].requestId);
});

test('local add and edit update the host-owned snapshots without putting a cart in editor state', async () => {
  const local = createLocalRuntime();
  const app = harness(local.ports);
  assert.equal('cart' in app.state, false);
  await app.runtime.commit();
  const first = local.savedDesigns()[0];
  assert.equal(first.quantities['white:s'], 2);
  assert.equal(app.state.completion!.authority, 'local-preview');
  app.dispatch({ type: 'product-design-edit-requested', design: first });
  app.dispatch({ type: 'quantity-entered', color: 'white', size: 's', value: 3 });
  app.dispatch({ type: 'step-selected', step: 2 });
  await app.runtime.commit();
  assert.equal(local.savedDesigns().length, 1);
  assert.equal(local.savedDesigns()[0].id, first.id);
  assert.equal(local.savedDesigns()[0].quantities['white:s'], 3);
  assert.equal(first.quantities['white:s'], 2);
  assert.equal(app.state.completion!.operation, 'updated');
  app.dispatch({
    type: 'product-design-edit-requested',
    design: local.savedDesigns()[0],
  });
  app.dispatch({ type: 'step-selected', step: 2 });
  await app.runtime.commit();
  assert.equal(app.state.completion, null, 'an unchanged edit cannot add or update again');
});

test('the deterministic local failure adapter cannot produce a saved design or completion', async () => {
  const local = createLocalRuntime({ failCommit: true });
  const app = harness(local.ports);
  await app.runtime.commit();
  assert.equal(app.state.commit.kind, 'failed');
  assert.equal(app.state.open, true);
  assert.equal(app.state.completion, null);
  assert.deepEqual(local.savedDesigns(), []);
});

test('a canceled upload aborts its port and ignores late artwork', async () => {
  const deferred = delayed();
  let request!: UploadRequest;
  const app = harness({
    artwork: {
      upload: async (_file, value) => {
        request = value;
        return deferred.promise;
      },
    },
    cart: {
      commit: async () => {
        throw Error();
      },
    },
  });
  app.dispatch({ type: 'modal-opened', modal: { kind: 'artwork', positionId: 'front' } });
  const pending = app.runtime.upload(new File(['test'], 'new.png', { type: 'image/png' }), 'front');
  assert.equal(app.state.upload.kind, 'reading');
  app.runtime.cancelUpload();
  app.dispatch({ type: 'modal-closed' });
  deferred.resolve({
    id: 'late',
    name: 'new.png',
    url: '/new.png',
    width: 10,
    height: 10,
  });
  await pending;
  assert.equal(request.signal.aborted, true);
  assert.equal(app.state.artworks.length, 1);
  assert.equal(app.state.prints[0].artworkId, 'logo');
});

test('upload through an injected port applies artwork and a newer rejected file retires an older read', async () => {
  const deferred = delayed();
  let calls = 0;
  const artwork = { id: 'new', name: 'new.png', url: '/new.png', width: 10, height: 10 };
  const app = harness({
    artwork: {
      upload: async () => {
        calls++;
        return calls === 1 ? artwork : deferred.promise;
      },
    },
    cart: {
      commit: async () => {
        throw Error();
      },
    },
  });
  app.dispatch({ type: 'modal-opened', modal: { kind: 'artwork', positionId: 'front' } });
  await app.runtime.upload(new File(['test'], 'new.png', { type: 'image/png' }), 'front');
  assert.equal(app.state.prints[0].artworkId, 'new');
  assert.equal(app.state.modal.kind, 'closed');
  app.dispatch({ type: 'modal-opened', modal: { kind: 'artwork', positionId: 'front' } });
  const older = app.runtime.upload(new File(['test'], 'older.png', { type: 'image/png' }), 'front');
  await app.runtime.upload(new File(['test'], 'wrong.txt', { type: 'text/plain' }), 'front');
  deferred.resolve({ ...artwork, id: 'older' });
  await older;
  assert.equal(app.state.upload.kind, 'failed');
  assert.equal(app.state.prints[0].artworkId, 'new');
  assert.equal(calls, 2);
});

test('the per-visitor session limit fails the upload with its own reason and the server wait (#348)', async () => {
  const failWith = async (error: unknown) => {
    const app = harness({
      artwork: {
        upload: async (_file, request) => {
          request.onProgress?.('uploading');
          throw error;
        },
      },
      cart: {
        commit: async () => {
          throw Error();
        },
      },
    });
    app.dispatch({ type: 'modal-opened', modal: { kind: 'artwork', positionId: 'front' } });
    await app.runtime.upload(new File(['test'], 'new.png', { type: 'image/png' }), 'front');
    return app.state.upload;
  };
  const limited = Object.assign(new Error('Customization request could not be completed.'), {
    status: 429,
    code: 'SESSION_RATE_LIMITED',
    retryAfter: 1500,
  });
  const { token: _token, ...failed } = (await failWith(limited)) as { token?: number };
  assert.deepEqual(failed, {
    kind: 'failed',
    target: 'front',
    reason: 'session-limited',
    retryAfterSeconds: 1500,
    fileName: 'new.png',
  });
  // The owner's upload quota is a different limit, with its own reason and wait (#337).
  const quota = (await failWith(Object.assign(new Error('quota'), { status: 429, code: 'RATE_LIMITED', retryAfter: 60 }))) as {
    reason?: string;
    retryAfterSeconds?: number;
  };
  assert.equal(quota.reason, 'rate-limited');
  assert.equal(quota.retryAfterSeconds, 60);
});

test('retrying an unchanged snapshot reuses its idempotency key and design identity, with a fresh UI request ID', async () => {
  const requests: CartRequest[] = [];
  const app = harness({
    artwork: {
      upload: async () => {
        throw Error();
      },
    },
    cart: {
      commit: async (request) => {
        requests.push(request);
        if (requests.length === 1) throw new Error('response lost');
        return receipt(request);
      },
    },
  });
  await app.runtime.commit();
  await app.runtime.commit();
  assert.notEqual(requests[0].requestId, requests[1].requestId);
  assert.equal(requests[0].idempotencyKey, requests[1].idempotencyKey);
  assert.equal(requests[0].design.id, requests[1].design.id);
});

test('the local host applies an identical transport retry only once', async () => {
  const local = createLocalRuntime();
  const request = {
    requestId: 'first',
    idempotencyKey: 'same-attempt',
    design: { id: 'one', prints: ready().prints, quantities: { 'white:s': 2 } },
    artworks: ready().artworks,
    operation: 'added' as const,
    signal: new AbortController().signal,
  };
  await local.ports.cart.commit(request);
  const repeated = await local.ports.cart.commit({ ...request, requestId: 'retry' });
  assert.equal(repeated.requestId, 'retry');
  assert.equal(local.savedDesigns().length, 1);
});

test('the core can bundle without a local host, fixture catalog or browser-upload implementation', async () => {
  const isolated = await build({
    entryPoints: [fileURLToPath(new URL('../src/designer.tsx', import.meta.url))],
    bundle: true,
    write: false,
    metafile: true,
    outdir: 'unused',
    format: 'esm',
    platform: 'browser',
    treeShaking: true,
  });
  const inputs = Object.keys(isolated.metafile.inputs);
  assert.equal(
    inputs.some((path) =>
      /(?:\/demo\/|scenario-catalog|scenarios\/|storefront-host-preview|admin-preview|preview-shell)/.test(path),
    ),
    false,
  );
  const javascript = isolated.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  assert.doesNotMatch(javascript, /Shopify host preview|simulated host result|North outdoor club|FileReader/);
});

test('a separately started identical new design gets its own host identity and application', async () => {
  const local = createLocalRuntime();
  const app = harness(local.ports);
  const originalPrint = structuredClone(app.state.prints[0]);
  await app.runtime.commit();
  const firstId = local.savedDesigns()[0].id;
  app.dispatch({ type: 'new-design-requested' });
  app.dispatch({ type: 'designer-reopened' });
  app.dispatch({ type: 'position-added', print: originalPrint });
  app.dispatch({ type: 'quantity-entered', color: 'white', size: 's', value: 2 });
  app.dispatch({ type: 'step-selected', step: 2 });
  await app.runtime.commit();
  assert.equal(local.savedDesigns().length, 2);
  assert.notEqual(local.savedDesigns()[1].id, firstId);
});

function matrixReady() {
  const state = ready();
  return {
    ...state,
    rules: {
      ...state.rules,
      sizeIds: ['s', 'm', 'l'],
      // This stale local list must never override Shopify cells.
      availableSizes: { white: ['s', 'm', 'l'] },
      variantMatrix: [
        { rowId: 'white', columnId: 's', variantId: '9007199254740993123', available: true },
        { rowId: 'white', columnId: 'm', variantId: '1002', available: false },
      ],
    },
  };
}

test('exact cells reject unavailable and absent quantities, including stale saved values', () => {
  const state = matrixReady();
  for (const size of ['m', 'l']) {
    assert.equal(designerReducer(state, { type: 'quantity-entered', color: 'white', size, value: 1 }), state);
    const stale = { ...state, step: 2 as const, quantities: { 'white:s': 2, [`white:${size}`]: 1 } };
    assert.equal(canCommitDesign(stale), false);
  }
  assert.equal(canCommitDesign({ ...state, step: 2 as const, quantities: { 'white:s': 2, 'invented:key': 1 } }), false);
  const missingAvailability = { ...state, rules: { ...state.rules, variantMatrix: undefined, availableSizes: {} } };
  assert.equal(
    designerReducer(missingAvailability, { type: 'quantity-entered', color: 'white', size: 's', value: 1 }),
    missingAvailability,
  );
});

test('runtime derives raw Shopify identities from current configured cells on every commit', async () => {
  const requests: CartRequest[] = [];
  const local = createLocalRuntime();
  const app = harness(
    {
      ...local.ports,
      cart: {
        commit: async (request) => {
          requests.push(request);
          return local.ports.cart.commit(request);
        },
      },
    },
    matrixReady(),
  );
  await app.runtime.commit();
  assert.deepEqual(requests[0].design.variants, [{ variantId: '9007199254740993123', quantity: 2 }]);
  assert.deepEqual(local.savedDesigns()[0].variants, requests[0].design.variants);
  const stale = { ...local.savedDesigns()[0], variants: [{ variantId: 'invented', quantity: 99 }] };
  app.dispatch({ type: 'product-design-edit-requested', design: stale });
  app.dispatch({ type: 'quantity-entered', color: 'white', size: 's', value: 3 });
  app.dispatch({ type: 'step-selected', step: 2 });
  await app.runtime.commit();
  assert.deepEqual(requests[1].design.variants, [{ variantId: '9007199254740993123', quantity: 3 }]);
});

test('reducer commit snapshots ignore supplied quantities, prints and invented Shopify identities', () => {
  const state: DesignerState = { ...matrixReady(), step: 2 };
  const next = designerReducer(state, {
    type: 'cart-commit-requested',
    requestId: 'request',
    design: {
      id: 'design',
      prints: [],
      quantities: { 'white:m': 99 },
      variants: [{ variantId: 'invented', quantity: 99 }],
    },
  });
  assert.equal(next.commit.kind, 'pending');
  assert.deepEqual(next.commit.design.quantities, { 'white:s': 2 });
  assert.deepEqual(next.commit.design.prints, state.prints);
  assert.deepEqual(next.commit.design.variants, [{ variantId: '9007199254740993123', quantity: 2 }]);
});

test('a demo without Shopify identities cannot accept a Shopify cart receipt', async () => {
  const app = harness({
    artwork: {
      upload: async () => {
        throw Error();
      },
    },
    cart: {
      commit: async (request: CartRequest) => ({ ...receipt(request), authority: 'shopify' }),
    },
  });
  await app.runtime.commit();
  assert.equal(app.state.commit.kind, 'failed');
  assert.equal(app.state.completion, null);
  assert.equal(app.state.open, true);
});

test('validated product configuration carries its selected exact cell through the cart port', async () => {
  const source = {
    variants: [
      {
        id: '1001',
        label: 'Supplier text / never split',
        available: true,
        selectedOptions: [
          { name: 'Material', value: 'Cotton / cotton blend' },
          { name: 'Pack', value: '10' },
        ],
      },
      {
        id: '1002',
        label: 'Something else',
        available: false,
        selectedOptions: [
          { name: 'Material', value: 'Cotton / cotton blend' },
          { name: 'Pack', value: '20' },
        ],
      },
    ],
  };
  const matrix = buildShopifyVariantMatrix(source);
  assert.equal(matrix.status, 'ready');
  const base = JSON.parse(await readFile(new URL('../src/scenarios/classic.json', import.meta.url), 'utf8'));
  const config = configSchema.parse({
    ...base,
    preview: 'illustration',
    colors: matrix.colors,
    sizes: matrix.sizes,
    variantMatrix: matrix.variantMatrix,
    optionPresentation: matrix.optionPresentation,
  });
  const position = config.positions[0];
  const model = createProductModel(config);
  const initial = createDesignerState({
    rules: {
      positions: config.positions,
      colorIds: config.colors.map((row) => row.id),
      sizeIds: config.sizes.map((column) => column.id),
      availableSizes: Object.fromEntries(config.colors.map((row) => [row.id, row.availableSizeIds])),
      variantMatrix: config.variantMatrix,
      maxQuantity: config.maxQuantity,
      deferablePositions: [],
    },
    view: config.views[0].id,
    color: config.colors[0].id,
    prints: [{ ...model.initialPrint(position.id), artworkId: 'logo' }],
    active: position.id,
    expanded: position.id,
    artworks: ready().artworks,
    designerOpen: true,
  });
  const selected = config.variantMatrix!.find((cell) => cell.variantId === '1001');
  const populated = designerReducer(initial, {
    type: 'quantity-entered',
    color: selected!.rowId,
    size: selected!.columnId,
    value: 7,
  });
  let request!: CartRequest;
  const app = harness(
    {
      artwork: {
        upload: async () => {
          throw Error();
        },
      },
      cart: {
        commit: async (value) => {
          request = value;
          return { ...receipt(value), authority: 'shopify' };
        },
      },
    },
    populated,
  );
  await app.runtime.commit();
  assert.deepEqual(request.design.quantities, { [`${selected!.rowId}:${selected!.columnId}`]: 7 });
  assert.deepEqual(request.design.variants, [{ variantId: source.variants[0].id, quantity: 7 }]);
  assert.equal(app.state.completion!.authority, 'shopify');
  assert.equal(app.state.open, true, 'verified completion retains the original editor');
  assert.equal(canCommitDesign(app.state), false);
});

test('real quote preparation preserves the draft, issues no cart effect, and final consent reuses the prepared identity', async () => {
  const requests: CartRequest[] = [];
  let release: (() => void) | undefined;
  let cartWrites = 0;
  let state = designerReducer(ready(), { type: 'step-selected', step: 2 });
  const ports: DesignerPorts = {
    artwork: {
      upload: async () => {
        throw new Error('unused');
      },
    },
    review: {
      prepare: async (request) => {
        requests.push(request);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    },
    cart: {
      commit: async (request) => {
        cartWrites++;
        requests.push(request);
        return {
          kind: 'applied',
          requestId: request.requestId,
          designId: request.design.id,
          operation: request.operation,
          authority: 'local-preview',
        };
      },
    },
  };
  const runtime = createDesignerRuntime(
    ports,
    () => state,
    (event) => {
      state = designerReducer(state, event);
    },
  );
  const before = structuredClone(state.prints);
  const preparing = runtime.commit(true);
  assert.equal(state.commit.kind, 'preparing');
  assert.equal(runtime.reviewing, true);
  state = designerReducer(state, { type: 'step-selected', step: 1 });
  assert.equal(state.step, 1, 'quote preparation must not trap navigation');
  assert.equal(cartWrites, 0);
  assert(release);
  release();
  await preparing;
  assert.equal(state.commit.kind, 'idle');
  assert.equal(state.open, true);
  assert.deepEqual(state.prints, before);
  state = designerReducer(state, {type:'step-selected',step:2});
  await runtime.commit();
  assert.equal(cartWrites, 1);
  assert.equal(requests[0]?.idempotencyKey, requests[1]?.idempotencyKey);
  assert.equal(requests[0]?.design.id, requests[1]?.design.id);
  assert.equal(state.open, false);
});

test('quantity-step preparation is reused on Review and changed intent cancels stale preparation', async () => {
  let state = designerReducer(ready(), {type:'step-selected',step:1});
  const pending: {request:CartRequest; finish:()=>void}[] = [];
  const runtime = createDesignerRuntime({
    artwork:{upload:async()=>{throw Error('unused');}},
    cart:{commit:async()=>{throw Error('no purchase during preparation');}},
    review:{prepare:request=>new Promise<void>(finish=>pending.push({request,finish}))},
  },()=>state,event=>{state=designerReducer(state,event);});
  const first=runtime.commit(true);
  assert.equal(state.commit.kind,'preparing');
  assert.equal(state.step,1);
  assert.equal(runtime.reviewIntentId,pending[0]?.request.idempotencyKey);
  state=designerReducer(state,{type:'quantity-entered',color:'white',size:'s',value:3});
  assert.equal(runtime.reviewIntentId,undefined,'retired intent cannot own partial review data');
  runtime.cancelPreparation();
  assert.equal(pending[0]?.request.signal.aborted,true);
  const second=runtime.commit(true);
  assert.equal(pending[1]?.request.design.quantities['white:s'],3);
  pending[0]?.finish(); await first;
  assert.equal(runtime.prepared,false,'late old result cannot qualify new quantities');
  pending[1]?.finish(); await second;
  assert.equal(runtime.prepared,true);
  state=designerReducer(state,{type:'step-selected',step:2});
  await runtime.commit(true);
  assert.equal(pending.length,2,'entering Review reuses the settled quantity-step quote');
});

test('returning to an older intent after replacing its review prepares a matching attempt again', async () => {
  let state=designerReducer(ready(),{type:'step-selected',step:1});
  const requests:CartRequest[]=[];
  const releases:(()=>void)[]=[];
  const runtime=createDesignerRuntime({artwork:{upload:async()=>{throw Error('unused');}},cart:{commit:async()=>{throw Error('no cart write');}},review:{prepare:request=>{
    requests.push(request);return new Promise<void>(resolve=>releases.push(resolve));
  }}},()=>state,event=>{state=designerReducer(state,event);});
  const first=runtime.commit(true);releases[0]?.();await first;
  assert.equal(runtime.prepared,true);
  state=designerReducer(state,{type:'quantity-entered',color:'white',size:'s',value:3});
  const second=runtime.commit(true);
  state=designerReducer(state,{type:'quantity-entered',color:'white',size:'s',value:2});
  runtime.cancelPreparation();
  assert.equal(runtime.prepared,false,'the previous displayed proposal no longer owns the current attempt');
  const third=runtime.commit(true);
  releases[1]?.();releases[2]?.();await Promise.all([second,third]);
  assert.equal(requests.length,3);
  assert.notEqual(requests[0]?.idempotencyKey,requests[2]?.idempotencyKey);
  assert.equal(runtime.prepared,true);
});

test('restored cart review can reauthorize unchanged choices without inventing dirty production edits', async () => {
  const original = ready();
  const saved = { id: 'existing-cart-design', prints: original.prints, quantities: { 'white:s': 2 } };
  const restored = createDesignerState({
    rules: original.rules,
    view: original.view,
    color: original.color,
    prints: original.prints,
    active: original.active,
    expanded: original.expanded,
    artworks: original.artworks,
    designerOpen: true,
    initialDesign: saved,
    requiresCartReview: true,
  });
  const h = harness(
    {
      artwork: {
        upload: async () => {
          throw new Error('unused');
        },
      },
      cart: {
        commit: async (request) => ({
          kind: 'applied',
          requestId: request.requestId,
          designId: request.design.id,
          operation: request.operation,
          authority: 'local-preview',
        }),
      },
    },
    restored,
  );
  assert.equal(canCommitDesign(h.state), true);
  assert.deepEqual(h.state.prints, saved.prints);
  await h.runtime.commit();
  assert.equal(h.state.requiresCartReview, false);
});

test('post-order reuse of existing artwork waits for the attachment port and never duplicates local artwork identity', async () => {
  const initial = ready();
  const sourcePosition = initial.rules.positions[0];
  assert(sourcePosition);
  let state = createDesignerState({
    rules: { ...initial.rules, positions: [sourcePosition, { ...sourcePosition, id: 'back', name: 'Back' }] },
    view: initial.view,
    color: initial.color,
    prints: [...initial.prints, { id: 'back', method: 'print', size: 0, artworkId: null }],
    active: 'back',
    expanded: 'back',
    artworks: initial.artworks,
    designerOpen: true,
  });
  state = designerReducer(state, { type: 'modal-opened', modal: { kind: 'artwork', positionId: 'back' } });
  let settle: ((artwork: (typeof initial.artworks)[number]) => void) | undefined;
  const ports: DesignerPorts = {
    artwork: {
      upload: async () => {
        throw new Error('unused');
      },
      apply: async (artwork, request) => {
        assert.equal(request.target, 'back');
        return new Promise((resolve) => {
          settle = resolve;
        });
      },
    },
    cart: {
      commit: async () => {
        throw new Error('unused');
      },
    },
  };
  const runtime = createDesignerRuntime(
    ports,
    () => state,
    (event) => {
      state = designerReducer(state, event);
    },
  );
  const applying = runtime.apply('logo', 'back');
  assert.equal(state.upload.kind, 'reading');
  assert.equal(state.prints.find((print) => print.id === 'back')?.artworkId, null);
  assert(settle);
  const artwork = initial.artworks[0];
  assert(artwork);
  settle(artwork);
  await applying;
  assert.equal(state.prints.find((print) => print.id === 'back')?.artworkId, 'logo');
  assert.equal(state.artworks.filter((artwork) => artwork.id === 'logo').length, 1);
  assert.equal(state.modal.kind, 'closed');
});

test('production choices keep existing default-first semantics and restored values through pending failure/retry', async () => {
  const original = ready(),
    rules = { ...original.rules, productionOptions: [{ id: 'packing', valueIds: ['plain', 'gift'] }] };
  const make = (initialDesign?: import('../src/model').Design) =>
    createDesignerState({
      rules,
      view: original.view,
      color: original.color,
      prints: original.prints,
      active: original.active,
      expanded: original.expanded,
      artworks: original.artworks,
      designerOpen: true,
      ...(initialDesign ? { initialDesign, requiresCartReview: true } : {}),
    });
  assert.deepEqual(make().productionChoices, { packing: 'plain' });
  const saved = {
    id: 'saved',
    prints: original.prints,
    quantities: { 'white:s': 2 },
    options: [{ optionId: 'packing', valueId: 'gift' }],
  };
  let restored = designerReducer(make(saved), { type: 'step-selected', step: 2 });
  assert.deepEqual(restored.productionChoices, { packing: 'gift' });
  assert.equal(canCommitDesign(restored), true);
  assert.equal(
    designerReducer(restored, { type: 'production-option-selected', optionId: 'packing', valueId: 'unknown' }),
    restored,
  );
  restored = designerReducer(restored, { type: 'production-option-selected', optionId: 'packing', valueId: '' });
  assert.equal(canCommitDesign(restored), false);
  restored = designerReducer(restored, { type: 'production-option-selected', optionId: 'packing', valueId: 'gift' });
  const requests: CartRequest[] = [];
  let release: (() => void) | undefined;
  const h = harness(
    {
      artwork: {
        upload: async () => {
          throw Error('unused');
        },
      },
      cart: {
        commit: async (request) => {
          requests.push(request);
          if (requests.length === 1) {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            throw Error('lost response');
          }
          return {
            kind: 'applied',
            requestId: request.requestId,
            designId: request.design.id,
            operation: request.operation,
            authority: 'shopify',
          };
        },
      },
    },
    restored,
  );
  const pending = h.runtime.commit();
  assert.deepEqual(h.state.productionChoices, { packing: 'gift' });
  const locked = designerReducer(h.state, {
    type: 'production-option-selected',
    optionId: 'packing',
    valueId: 'plain',
  });
  assert.equal(locked, h.state);
  assert(release);
  release();
  await pending;
  assert.deepEqual(h.state.productionChoices, { packing: 'gift' });
  await h.runtime.commit();
  assert.equal(requests[0]?.idempotencyKey, requests[1]?.idempotencyKey);
  assert.deepEqual(
    requests.map((request) => request.design.options),
    [saved.options, saved.options],
  );
});

test('changing only a production choice after failure creates a distinct attempt without repurposing the old request', async () => {
  const initial = ready();
  initial.rules = { ...initial.rules, productionOptions: [{ id: 'packing', valueIds: ['plain', 'gift'] }] };
  initial.productionChoices = { packing: 'plain' };
  const requests: CartRequest[] = [];
  const h = harness({ artwork: { upload: async () => { throw Error('unused'); } }, cart: {
    commit: async (request) => { requests.push(request); throw Error('application failed'); },
  } }, initial);
  await h.runtime.commit();
  h.dispatch({ type: 'production-option-selected', optionId: 'packing', valueId: 'gift' });
  await h.runtime.commit();
  assert.equal(requests.length, 2);
  assert.notEqual(requests[0]?.idempotencyKey, requests[1]?.idempotencyKey);
  assert.deepEqual(requests[0]?.design.options, [{ optionId: 'packing', valueId: 'plain' }]);
  assert.deepEqual(requests[1]?.design.options, [{ optionId: 'packing', valueId: 'gift' }]);
});

test('preview renewal updates media without changing intent or dialogs, and terminal loss never revives artwork', async () => {
  let state = ready();
  const expiresAt = new Date(Date.now() + 1000).toISOString();
  state.artworks = state.artworks.map((artwork) => ({ ...artwork, previewExpiresAt: expiresAt }));
  const prints = structuredClone(state.prints), quantities = structuredClone(state.quantities);
  const ports: DesignerPorts = { artwork: {
    upload: async () => { throw Error('unused'); },
    renew: async (artwork) => ({ ...artwork, url: '/renewed.png', previewExpiresAt: new Date(Date.now() + 60000).toISOString() }),
  }, cart: { commit: async () => { throw Error('unused'); } } };
  const runtime = createDesignerRuntime(ports, () => state, (event) => { state = designerReducer(state, event); });
  await runtime.renew(state.artworks[0]!);
  assert.equal(state.artworks[0]?.url, '/renewed.png');
  assert.deepEqual(state.prints, prints); assert.deepEqual(state.quantities, quantities);
  ports.artwork.renew = async () => { throw Object.assign(Error('gone'), { status: 410 }); };
  await runtime.renew(state.artworks[0]!);
  assert.equal(state.artworks.length, 0);
  assert.deepEqual(state.prints, prints);
});

 test('required quote review is not edited content and same-design editing never discards a draft', () => {
  let state = ready();
  state = { ...state, editing: 'saved', requiresCartReview: true, baseline: { id: 'saved', prints: structuredClone(state.prints), quantities: structuredClone(state.quantities), variants: [] } };
  assert.equal(hasDraftChanges(state), false);
  assert.equal(hasUnappliedDraft(state), true);
  assert.equal(productDesignEditRequiresConfirmation(state, 'other'), false);
  state = designerReducer(state, { type: 'quantity-entered', color: 'white', size: 's', value: 3 });
  assert.equal(hasDraftChanges(state), true);
  assert.equal(productDesignEditRequiresConfirmation(state, 'other'), true);
  assert.equal(productDesignEditRequiresConfirmation(state, 'saved'), false);
});

test('upload progress keeps selected intent unchanged and cancelled progress cannot revive an upload', async () => {
  const deferred = delayed();
  let request: UploadRequest | undefined;
  const app = harness({ artwork: { upload: async (_file, next) => { request = next; return deferred.promise; } }, cart: { commit: async () => { throw Error('unused'); } } });
  app.dispatch({ type: 'step-selected', step: 0 });
  app.dispatch({ type: 'modal-opened', modal: { kind: 'artwork', positionId: 'front' } });
  const before = structuredClone(app.state.prints);
  const pending = app.runtime.upload(new File(['image'], 'progress.png', { type: 'image/png' }), 'front');
  assert(request);
  request.onProgress?.('uploading');
  assert.equal(app.state.upload.kind === 'reading' && app.state.upload.phase, 'uploading');
  request.onProgress?.('processing');
  assert.equal(app.state.upload.kind === 'reading' && app.state.upload.phase, 'processing');
  assert.deepEqual(app.state.prints, before);
  app.runtime.cancelUpload();
  app.dispatch({ type: 'modal-closed' });
  const cancelled = app.state;
  request.onProgress?.('uploading');
  deferred.resolve({ id: 'late', name: 'late.png', url: '/late.png', width: 1, height: 1 });
  await pending;
  assert.equal(app.state, cancelled);
});

for (const [phase, status, reason] of [
  ['uploading', 503, 'upload-failed'],
  ['processing', 503, 'processing-failed'],
  ['processing', 422, 'inspection-rejected'],
  ['processing', 410, 'artwork-expired'],
] as const) test(`real upload failure reports ${reason} without applying unverified artwork`, async () => {
  const app = harness({ artwork: { upload: async (_file, request) => { request.onProgress?.(phase); throw Object.assign(Error('private provider detail'), { status }); } }, cart: { commit: async () => { throw Error('unused'); } } });
  app.dispatch({ type: 'step-selected', step: 0 });
  app.dispatch({ type: 'modal-opened', modal: { kind: 'artwork', positionId: 'front' } });
  const before = structuredClone(app.state.prints);
  await app.runtime.upload(new File(['image'], 'failure.png', { type: 'image/png' }), 'front');
  assert.equal(app.state.upload.kind === 'failed' && app.state.upload.reason, reason);
  assert.deepEqual(app.state.prints, before);
  assert.equal(app.state.modal.kind, 'artwork');
});

test('restored unpurchased edits compare against accepted cart intent, and reverting removes only the dirty warning', () => {
  const original = ready();
  const baseline = { id: 'restored', prints: structuredClone(original.prints), quantities: structuredClone(original.quantities), variants: [] };
  let state = createDesignerState({ rules: original.rules, view: original.view, color: original.color, prints: original.prints, active: original.active, expanded: original.expanded, artworks: original.artworks, designerOpen: true, requiresCartReview: true,
    initialDesign: { ...baseline, quantities: { 'white:s': 4 } }, initialBaseline: baseline });
  assert.equal(hasDraftChanges(state), true);
  assert.equal(productDesignEditRequiresConfirmation(state, 'other'), true);
  state = designerReducer(state, { type: 'quantity-entered', color: 'white', size: 's', value: 2 });
  assert.equal(hasDraftChanges(state), false);
  assert.equal(productDesignEditRequiresConfirmation(state, 'other'), false);
  assert.equal(hasUnappliedDraft(state), true);
});

test('terminal decline retires only the failed attempt; unchanged intent needs fresh preparation and separate consent', async () => {
  const requests: CartRequest[] = []; const preparations: CartRequest[] = [];
  const h = harness({artwork:{upload:async()=>{throw Error('unused')}},review:{prepare:async request=>{preparations.push(request)}},cart:{commit:async request=>{requests.push(request);throw Object.assign(Error('declined'),{acceptanceOutcome:'declined'});}}});
  await h.runtime.commit(true); await h.runtime.commit();
  const artworks = structuredClone(h.state.artworks);
  await h.runtime.commit(true);
  assert.equal(preparations.length,2);
  assert.notEqual(preparations[1]?.idempotencyKey,requests[0]?.idempotencyKey);
  assert.equal(requests.length,1);
  assert.deepEqual(h.state.artworks,artworks);
  await h.runtime.commit();
  assert.equal(requests[1]?.idempotencyKey,preparations[1]?.idempotencyKey);
});

test('a definite cart refusal shows its own message and lets Review prepare again', async () => {
  const preparations: CartRequest[] = [];
  let refusal: Record<string, unknown> = {cartRejected:true,stock:true,detail:'Only 2 left.'};
  const h = harness({artwork:{upload:async()=>{throw Error('unused')}},review:{prepare:async request=>{preparations.push(request)}},cart:{commit:async()=>{throw Object.assign(Error('refused'),refusal);}}});
  await h.runtime.commit(true); await h.runtime.commit();
  assert.deepEqual(h.state.commit, { kind: 'failed', cause: 'cart-rejected-stock', preparation: false, detail: 'Only 2 left.' });
  // A refusal that is not about stock keeps neutral wording (NB3).
  refusal = {cartRejected:true,stock:false};
  await h.runtime.commit();
  assert.deepEqual(h.state.commit, { kind: 'failed', cause: 'cart-rejected', preparation: false });
  await h.runtime.commit(true);
  assert.equal(preparations.length, 2, 'Review is not a no-op after a refusal');
});

test('late declined response from a canceled commit cannot retire the resumed attempt', async () => {
  let reject!: (error: Error) => void;
  const requests: CartRequest[] = [];
  const h = harness({artwork:{upload:async()=>{throw Error('unused')}},cart:{commit:async request=>{requests.push(request); if(requests.length===1) return new Promise((_resolve,no)=>{reject=no}); throw Error('unknown');}}});
  const first = h.runtime.commit(); h.runtime.cancel();
  await h.runtime.commit();
  reject(Object.assign(Error('late decline'),{acceptanceOutcome:'declined'})); await first;
  await h.runtime.commit();
  assert.equal(requests[0]?.idempotencyKey,requests[1]?.idempotencyKey);
  assert.equal(requests[1]?.idempotencyKey,requests[2]?.idempotencyKey);
});

test('prepared readiness expires without retiring the original attempt identity', async () => {
  const now = Date.now();
  const originalNow = Date.now;
  const app = harness({ artwork: { upload: async () => ({}) }, review: { prepare: async () => ({ expiresAt: new Date(now + 1000).toISOString() }) }, cart: { commit: async (request) => receipt(request) } });
  try {
    await app.runtime.commit(true);
    const identity = app.runtime.reviewIntentId;
    assert.equal(app.runtime.prepared, true);
    Date.now = () => now + 1001;
    assert.equal(app.runtime.prepared, false);
    assert.equal(app.runtime.reviewIntentId, identity);
  } finally { Date.now = originalNow; }
});

test('refreshed terms require a separate Add without reporting cart failure', async () => {
  let calls = 0;
  const app = harness({ artwork: { upload: async () => ({}) }, cart: { commit: async (request) => {
    if (++calls === 1) throw Object.assign(new Error('Review refreshed terms'), { reviewRequired: true, expiresAt: new Date(Date.now() + 60000).toISOString() });
    return receipt(request);
  } } });
  await app.runtime.commit();
  assert.equal(app.state.commit.kind, 'idle');
  assert.equal(app.state.completion, null);
  assert.equal(app.runtime.prepared, true);
  assert.equal(calls, 1);
  await app.runtime.commit();
  assert.equal((app.state.completion as CartReceipt | null)?.kind, 'applied');
});

test('refresh preparation is cancellable and its late result cannot clear newer work', async () => {
  const held = delayed();
  const newer = delayed();
  const requests: CartRequest[] = [];
  const app = harness({ artwork: { upload: async () => ({}) }, cart: { commit: async (request) => {
    requests.push(request);
    request.onPreparing?.();
    return requests.length === 1 ? held.promise : newer.promise;
  } } });
  const first = app.runtime.commit();
  assert.equal(app.state.commit.kind, 'preparing');
  app.runtime.cancelPreparation();
  app.dispatch({ type: 'step-selected', step: 1 });
  app.dispatch({ type: 'quantity-entered', color: 'white', size: 's', value: 3 });
  assert.equal(app.state.step, 1);
  app.dispatch({ type: 'step-selected', step: 2 });
  const second = app.runtime.commit();
  assert.equal(app.state.commit.kind, 'preparing');
  assert.notEqual(requests[0].requestId, requests[1].requestId);
  held.resolve({});
  await first;
  assert.equal(app.state.commit.kind, 'preparing');
  newer.resolve({});
  await second;
});

test('an ambiguous dispatched attempt replays its identity after the presentation deadline', async () => {
  const now = Date.now();
  const originalNow = Date.now;
  const requests: CartRequest[] = [];
  let preparations = 0;
  const app = harness({ artwork: { upload: async () => ({}) }, review: { prepare: async () => { preparations++; return { expiresAt: new Date(now + 1000).toISOString() }; } }, cart: { commit: async (request) => {
    requests.push(request);
    if (requests.length === 1) throw Error('Unknown acceptance');
    return receipt(request);
  } } });
  try {
    await app.runtime.commit(true);
    await app.runtime.commit();
    Date.now = () => now + 1001;
    assert.equal(app.runtime.prepared, true, 'deadline cannot revoke reconciliation of an unknown dispatch');
    await app.runtime.commit(true);
    assert.equal(preparations, 1);
    await app.runtime.commit();
    assert.equal(requests[1].idempotencyKey, requests[0].idempotencyKey);
    assert.equal(requests[1].design.id, requests[0].design.id);
  } finally { Date.now = originalNow; }
});

test('preflight failure has no dispatched acceptance and loses expired readiness', async () => {
  const now = Date.now();
  const originalNow = Date.now;
  const app = harness({ artwork: { upload: async () => ({}) }, review: { prepare: async () => ({ expiresAt: new Date(now + 1000).toISOString() }) }, cart: { commit: async (request) => {
    request.onPreparing?.();
    throw Error('Cart read unavailable');
  } } });
  try {
    await app.runtime.commit(true);
    await app.runtime.commit();
    assert.equal(app.state.commit.kind, 'failed');
    assert.equal(app.state.commit.kind === 'failed' && app.state.commit.preparation, true);
    Date.now = () => now + 1001;
    assert.equal(app.runtime.prepared, false);
  } finally { Date.now = originalNow; }
});


test('verified inline completion retains media expiry and renewal while rejecting editing and resubmission', async () => {
  const initial = ready();
  initial.rules = { ...initial.rules, variantMatrix: [{ rowId: 'white', columnId: 's', variantId: '7', available: true }] };
  const app = harness({ artwork: { upload: async () => ({}) }, cart: { commit: async request => ({ ...receipt(request), authority: 'shopify' }) } }, initial);
  await app.runtime.commit();
  assert.equal(app.state.completion?.authority, 'shopify');
  const current = app.state.artworks[0]!;
  const expired = designerReducer(app.state, { type: 'artwork-preview-expired', id: current.id, expectedExpiry: current.previewExpiresAt });
  assert.equal(expired.artworks[0]?.url, '', 'expired capability cannot stay presented while navigation is blocked');
  const fresh = { ...current, url: 'https://example.test/renewed.png', previewExpiresAt: '2099-02-01T00:00:00Z' };
  const renewed = designerReducer(expired, { type: 'artwork-preview-refreshed', artwork: fresh, expectedExpiry: current.previewExpiresAt });
  assert.equal(renewed.artworks[0]?.url, fresh.url);
  const unavailable = designerReducer(renewed, { type: 'artwork-unavailable', id: fresh.id, expectedExpiry: fresh.previewExpiresAt });
  assert.equal(unavailable.artworks.some(artwork => artwork.id === fresh.id), false);
  assert.equal(unavailable.completion, app.state.completion, 'lifecycle changes preserve verified completion');
  assert.equal(designerReducer(unavailable, { type: 'step-selected', step: 0 }), unavailable);
  assert.equal(canCommitDesign(unavailable), false);
  const closed = designerReducer(unavailable, { type: 'close-requested' });
  assert.equal(closed.open, false);
  assert.equal(closed.modal.kind, 'closed');
  assert.equal(closed.completion, null, 'closing retires the inline completion as the existing product-return action does');
});


test('a cart over the signed-set capacity fails preparation as a cart limit, not an unavailable quote (#335)', async () => {
  const limit = () => Object.assign(Error('Cart limit reached'), { code: 'CAPACITY_EXCEEDED' });
  const reviewing = harness({
    artwork: { upload: async () => ({}) },
    review: { prepare: async () => { throw limit(); } },
    cart: { commit: async () => { throw Error('no purchase during preparation'); } },
  });
  await reviewing.runtime.commit(true);
  assert.deepEqual(reviewing.state.commit, { kind: 'failed', cause: 'capacity', preparation: true });
  const adding = harness({
    artwork: { upload: async () => ({}) },
    cart: { commit: async request => { request.onPreparing?.(); throw limit(); } },
  });
  await adding.runtime.commit();
  assert.deepEqual(adding.state.commit, { kind: 'failed', cause: 'capacity', preparation: true });
  const lines = harness({
    artwork: { upload: async () => ({}) },
    review: { prepare: async () => { throw Object.assign(limit(), { cartLines: true }); } },
    cart: { commit: async () => { throw Error('unused'); } },
  });
  await lines.runtime.commit(true);
  assert.deepEqual(lines.state.commit, { kind: 'failed', cause: 'cart-lines', preparation: true });
  const other = harness({
    artwork: { upload: async () => ({}) },
    review: { prepare: async () => { throw Error('Quote unavailable'); } },
    cart: { commit: async () => { throw Error('unused'); } },
  });
  await other.runtime.commit(true);
  assert.deepEqual(other.state.commit, { kind: 'failed', cause: 'unknown', preparation: true });
});

test('a buyer error code becomes one failure cause, with a bounded wait only where the cause names one (#337)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const failing = (fields: Record<string, unknown>) => () => Promise.reject(Object.assign(Error('Raw English server message'), fields));
  const reviewing = harness({
    artwork: { upload: async () => ({}) },
    review: { prepare: failing({ status: 409, code: 'BUSY', retryAfter: 2 }) },
    cart: { commit: async () => { throw Error('unused'); } },
  });
  await reviewing.runtime.commit(true);
  assert.deepEqual(reviewing.state.commit, { kind: 'failed', cause: 'busy', preparation: true, retryAfterSeconds: 2, waiting: true });
  // #362 follow-up: the session limit at Add to cart, with no upload before it.
  const adding = harness({
    artwork: { upload: async () => ({}) },
    cart: { commit: failing({ status: 429, code: 'SESSION_RATE_LIMITED', retryAfter: 1500.4 }) },
  });
  await adding.runtime.commit();
  assert.deepEqual(adding.state.commit, { kind: 'failed', cause: 'session-limited', preparation: false, retryAfterSeconds: 1501 });
  // An unknown code is a generic failure; a wait beyond the one-hour window is capped.
  for (const [fields, expected] of [
    [{ code: 'NOT_A_BUYER_CODE' }, { kind: 'failed', cause: 'unknown', preparation: false }],
    [{ code: 'RATE_LIMITED', retryAfter: 1e12 }, { kind: 'failed', cause: 'rate-limited', preparation: false, retryAfterSeconds: 3600, waiting: true }],
    [{ code: 'CART_BUSY', retryAfter: -5 }, { kind: 'failed', cause: 'cart-busy', preparation: false }],
  ] as const) {
    const h = harness({ artwork: { upload: async () => ({}) }, cart: { commit: failing(fields) } });
    await h.runtime.commit();
    assert.deepEqual(h.state.commit, expected, JSON.stringify(fields));
  }
});


test('REVIEW_REQUIRED at Add to cart is a definite no-commit: Retry reviews again under a new key (#337)', async () => {
  const commits: CartRequest[] = [];
  const preparations: CartRequest[] = [];
  const h = harness({
    artwork: { upload: async () => ({}) },
    review: { prepare: async (request) => { preparations.push(request); } },
    cart: { commit: async (request) => { commits.push(request); throw Object.assign(Error('Review required'), { status: 409, code: 'REVIEW_REQUIRED' }); } },
  });
  await h.runtime.commit(true);
  await h.runtime.commit();
  assert.deepEqual(h.state.commit, { kind: 'failed', cause: 'review-required', preparation: true });
  assert.equal(commitFailureView(h.state.commit as never, 'en').action, 'retry-review');
  await h.runtime.commit(true);
  assert.equal(preparations.length, 2, 'Retry prepares the current terms again');
  assert.notEqual(preparations[1]?.idempotencyKey, commits[0]?.idempotencyKey, 'the rejected acceptance key is retired');
  assert.equal(commits.length, 1);
});

test('Retry waits for Retry-After on BUSY and RATE_LIMITED; the runtime owns the timer (#337)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let calls = 0;
  const h = harness({
    artwork: { upload: async () => ({}) },
    cart: { commit: async () => { calls++; throw Object.assign(Error('Busy'), { status: 409, code: 'BUSY', retryAfter: 3 }); } },
  });
  await h.runtime.commit();
  assert.deepEqual(h.state.commit, { kind: 'failed', cause: 'busy', preparation: false, retryAfterSeconds: 3, waiting: true });
  assert.equal(commitFailureView(h.state.commit as never, 'en').waiting, true);
  await h.runtime.commit();
  assert.equal(calls, 1, 'nothing is re-sent while the wait runs');
  t.mock.timers.tick(2999);
  assert.equal(h.state.commit.kind === 'failed' && 'waiting' in h.state.commit && h.state.commit.waiting, true);
  t.mock.timers.tick(1);
  assert.deepEqual(h.state.commit, { kind: 'failed', cause: 'busy', preparation: false, retryAfterSeconds: 3, waiting: false });
  await h.runtime.commit();
  assert.equal(calls, 2, 'Add to cart repeats once the wait has passed');
  // Without Retry-After there is nothing to wait for.
  assert.deepEqual(commitFailure({ code: 'RATE_LIMITED' }, true), { cause: 'rate-limited', preparation: true, waiting: false });
});

test('each failure cause routes its own primary action; the cart lock is never a review failure (#337)', () => {
  const action = (failure: Parameters<typeof commitFailureView>[0]) => commitFailureView(failure, 'en').action;
  assert.equal(action(commitFailure({ code: 'UNAVAILABLE' }, true)), 'retry-review');
  assert.equal(action(commitFailure({ code: 'UNAVAILABLE' }, false)), 'retry-add');
  assert.equal(action(commitFailure({}, true)), 'retry-review');
  assert.equal(action(commitFailure({ code: 'CART_BUSY' }, false)), 'retry-add');
  // The cart lock is only taken while applying an accepted set, never while preparing.
  assert.deepEqual(commitFailure({ code: 'CART_BUSY' }, true), { cause: 'unknown', preparation: true });
  assert.equal(action(commitFailure({ code: 'CAPACITY_EXCEEDED' }, true)), 'edit-quantities');
  assert.equal(action(commitFailure({ code: 'ARTWORK_EXPIRED' }, false)), 'replace-artwork');
  assert.equal(action(commitFailure({ code: 'PRODUCT_UNAVAILABLE' }, true)), 'close');
});
test('explicit preparation Retry recovers a transient preflight read before quote expiry without accepting', async () => {
  const preparations: CartRequest[] = [];
  const commits: CartRequest[] = [];
  let cartReadAvailable = false;
  const app = harness({
    artwork: { upload: async () => ({}) },
    review: { prepare: async request => {
      preparations.push(request);
      return { expiresAt: new Date(Date.now() + 60000).toISOString() };
    } },
    cart: { commit: async request => {
      commits.push(request);
      request.onPreparing?.();
      if (!cartReadAvailable) throw Error('Transient preflight read');
      request.onMutating?.();
      return receipt(request);
    } },
  });
  await app.runtime.commit(true);
  await app.runtime.commit();
  assert.equal(app.state.commit.kind === 'failed' && app.state.commit.preparation, true);
  assert.equal(app.runtime.prepared, true, 'the original quote has not expired');
  cartReadAvailable = true;
  await app.runtime.commit(true);
  assert.equal(preparations.length, 2, 'Retry must perform preparation rather than hit the prepared shortcut');
  assert.equal(preparations[1].idempotencyKey, preparations[0].idempotencyKey);
  assert.equal(commits.length, 1, 'preparation retry cannot accept or apply a cart');
  assert.equal(app.state.commit.kind, 'idle');
  assert.equal(app.state.completion, null);
  await app.runtime.commit();
  assert.equal(commits.length, 2);
  assert.equal(commits[1].idempotencyKey, commits[0].idempotencyKey);
  assert.notEqual(app.state.completion, null);
});

test('close confirmation keeps draft, cancels safely and resumes exact intent', () => {
  const original = ready();
  const requested = designerReducer(original, { type: 'close-requested' });
  assert.equal(requested.open, true);
  assert.equal(requested.modal.kind, 'confirm-close');
  assert.deepEqual(requested.prints, original.prints);
  assert.deepEqual(requested.quantities, original.quantities);
  const canceled = designerReducer(requested, { type: 'modal-closed' });
  assert.equal(canceled.open, true);
  assert.deepEqual(canceled.prints, original.prints);
  const closed = designerReducer(requested, { type: 'product-return-requested' });
  assert.equal(closed.open, false);
  const resumed = designerReducer(closed, { type: 'designer-reopened' });
  assert.deepEqual(resumed.prints, original.prints);
  assert.deepEqual(resumed.quantities, original.quantities);
  assert.equal(resumed.open, true);
});

test('a resumable draft opens behind the continue prompt as an unsaved new design (#347)', () => {
  const draft = { id: 'draft', prints: [{ id: 'front', artworkId: 'logo', method: 'print', size: 0 }], quantities: { 'white:s': 3 } };
  const base = ready();
  const offered = createDesignerState({
    rules: base.rules,
    view: 'front',
    color: 'white',
    prints: [],
    active: 'front',
    expanded: null,
    artworks: base.artworks,
    designerOpen: true,
    resumeDraft: draft,
  });
  assert.equal(offered.modal.kind, 'resume-draft');
  assert.equal(JSON.stringify(offered.prints), JSON.stringify(draft.prints));
  assert.deepEqual(offered.quantities, draft.quantities);
  assert.equal(offered.editing, null, 'the draft is not in the cart: it is added, never updated');
  assert.equal(offered.baseline, null);
  assert.equal(hasDraftChanges(offered), true, 'close asks, and same-page reopen keeps it');
  assert.equal(canCommitDesign({ ...offered, step: 2 }), false, 'no quote while the buyer decides');
  // Continue, Escape and the close button all only close the prompt and keep the draft.
  const continued = designerReducer(offered, { type: 'modal-closed' });
  assert.equal(continued.modal.kind, 'closed');
  assert.equal(JSON.stringify(continued.prints), JSON.stringify(draft.prints));
  assert.deepEqual(continued.quantities, draft.quantities);
  assert.equal(canCommitDesign({ ...continued, step: 2 }), true);
  // Start new opens clean.
  const fresh = designerReducer(offered, { type: 'new-design-requested' });
  assert.equal(fresh.modal.kind, 'closed');
  assert.deepEqual(fresh.prints, []);
  assert.deepEqual(fresh.quantities, {});
  assert.equal(hasDraftChanges(fresh), false);
});

test('a draft that could not be restored opens a clean Designer with a dismissible notice (#347)', () => {
  const base = ready();
  const notified = createDesignerState({
    rules: base.rules,
    view: 'front',
    color: 'white',
    prints: [],
    active: 'front',
    expanded: null,
    artworks: [],
    designerOpen: true,
    draftUnavailable: true,
  });
  assert.equal(notified.recovery.kind === 'message' && notified.recovery.reason, 'draft-unavailable');
  assert.equal(notified.modal.kind, 'closed', 'no continue prompt');
  assert.equal(hasDraftChanges(notified), false, 'the Designer is clean');
  assert.equal(designerReducer(notified, { type: 'recovery-dismissed' }).recovery.kind, 'none');
});

test('empty clean design closes without asking for confirmation', () => {
  const original = { ...ready(), prints: [], quantities: {}, artworks: [] };
  const closed = designerReducer(original, { type: 'close-requested' });
  assert.equal(closed.open, false);
  assert.equal(closed.modal.kind, 'closed');
});

test('closing an active upload asks without aborting and can keep the same request running', async () => {
  const deferred = delayed();
  let request!: UploadRequest;
  const app = harness({ artwork: { upload: async (_file, value) => { request = value; return deferred.promise; } }, cart: { commit: async () => { throw Error('unused'); } } });
  app.dispatch({ type: 'modal-opened', modal: { kind: 'artwork', positionId: 'front' } });
  const pending = app.runtime.upload(new File(['image'], 'pending.png', { type: 'image/png' }), 'front');
  app.dispatch({ type: 'upload-close-requested' });
  assert.equal(app.state.modal.kind, 'confirm-upload-cancel');
  assert.equal(app.state.upload.kind, 'reading');
  assert.equal(request.signal.aborted, false);
  app.dispatch({ type: 'upload-continue-requested' });
  assert.equal(app.state.modal.kind, 'artwork');
  deferred.resolve({ id: 'accepted', name: 'pending.png', url: '/pending.png', width: 10, height: 10 });
  await pending;
  assert.equal(app.state.prints[0].artworkId, 'accepted');
});

test('upload success or failure while interruption confirmation is open settles to the real result', async () => {
  for (const outcome of ['success', 'failure'] as const) {
    const deferred = delayed();
    const app = harness({ artwork: { upload: async () => deferred.promise }, cart: { commit: async () => { throw Error('unused'); } } });
    app.dispatch({ type: 'modal-opened', modal: { kind: 'artwork', positionId: 'front' } });
    const pending = app.runtime.upload(new File(['image'], 'pending.png', { type: 'image/png' }), 'front');
    app.dispatch({ type: 'upload-close-requested' });
    if (outcome === 'success') deferred.resolve({ id: 'accepted', name: 'pending.png', url: '/pending.png', width: 10, height: 10 });
    else deferred.reject(new Error('unavailable'));
    await pending;
    assert.equal(app.state.modal.kind, outcome === 'success' ? 'closed' : 'artwork');
    assert.equal(app.state.prints[0].artworkId, outcome === 'success' ? 'accepted' : 'logo');
  }
});

test('an upload finishing while closing the customizer keeps the close decision with the real result', async () => {
  for (const outcome of ['success', 'failure'] as const) {
    const deferred = delayed();
    const app = harness({ artwork: { upload: async () => deferred.promise }, cart: { commit: async () => { throw Error('unused'); } } });
    app.dispatch({ type: 'modal-opened', modal: { kind: 'artwork', positionId: 'front' } });
    const pending = app.runtime.upload(new File(['image'], 'pending.png', { type: 'image/png' }), 'front');
    app.dispatch({ type: 'close-requested' });
    assert.deepEqual(app.state.modal, { kind: 'confirm-upload-cancel', positionId: 'front', destination: 'customizer' });
    if (outcome === 'success') deferred.resolve({ id: 'accepted', name: 'pending.png', url: '/pending.png', width: 10, height: 10 });
    else deferred.reject(new Error('unavailable'));
    await pending;
    assert.equal(app.state.open, true);
    // Success: the edited design asks the ordinary close question. Failure: the error stays visible.
    assert.equal(app.state.modal.kind, outcome === 'success' ? 'confirm-close' : 'artwork');
    assert.equal(app.state.prints[0].artworkId, outcome === 'success' ? 'accepted' : 'logo');
    if (outcome === 'failure') assert.equal(app.state.upload.kind, 'failed');
  }
});

test('closing the customizer from a rejected upload asks without carrying the stale upload error', async () => {
  const app = harness({ artwork: { upload: async () => { throw Error('unused'); } }, cart: { commit: async () => { throw Error('unused'); } } });
  app.dispatch({ type: 'modal-opened', modal: { kind: 'artwork', positionId: 'front' } });
  await app.runtime.upload(new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' }), 'front');
  assert.equal(app.state.upload.kind, 'failed');
  app.dispatch({ type: 'close-requested' });
  assert.equal(app.state.modal.kind, 'confirm-close');
  assert.deepEqual(app.state.upload, { kind: 'idle' }, 'the upload dialog closed, so its error must not follow');
});

test('three rejected uploads in a row leave the next valid upload able to finish (#349 sequence)', async () => {
  const requests: UploadRequest[] = [];
  const app = harness({
    artwork: {
      upload: async (file, request) => {
        requests.push(request);
        request.onProgress?.('uploading');
        request.onProgress?.('processing');
        if (file.name === 'corrupt.png') throw Object.assign(new Error('rejected'), { status: 422 });
        return { id: 'logo-asset', name: file.name, url: '/logo.png', width: 10, height: 10 };
      },
    },
    cart: { commit: async () => { throw Error('unused'); } },
  });
  app.dispatch({ type: 'modal-opened', modal: { kind: 'artwork', positionId: 'front' } });
  const rejected: string[] = [];
  for (const file of [
    new File(['not a png'], 'corrupt.png', { type: 'image/png' }),
    new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge-noise.png', { type: 'image/png' }),
    new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' }),
  ]) {
    await app.runtime.upload(file, 'front');
    assert.equal(app.state.upload.kind, 'failed');
    if (app.state.upload.kind === 'failed') rejected.push(app.state.upload.reason);
  }
  assert.deepEqual(rejected, ['inspection-rejected', 'file-too-large', 'unsupported-file-type']);
  await app.runtime.upload(new File(['png'], 'logo.png', { type: 'image/png' }), 'front');
  assert.deepEqual(app.state.upload, { kind: 'idle' });
  assert.equal(app.state.modal.kind, 'closed');
  assert.equal(app.state.prints[0].artworkId, 'logo-asset');
  assert.equal(requests.length, 2, 'only server-checked files reach the upload port');
});

test('an artwork check that outlasts the client timeout ends with a retryable message and aborts the check', { timeout: 5000 }, async () => {
  let request!: UploadRequest;
  const app = harness(
    {
      artwork: {
        upload: async (_file, value) => {
          request = value;
          value.onProgress?.('uploading');
          value.onProgress?.('processing');
          return new Promise((_resolve, reject) =>
            value.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }),
          );
        },
      },
      cart: { commit: async () => { throw Error('unused'); } },
    },
    ready(),
    { processingTimeoutMs: 20 },
  );
  app.dispatch({ type: 'modal-opened', modal: { kind: 'artwork', positionId: 'front' } });
  const pending = app.runtime.upload(new File(['png'], 'logo.png', { type: 'image/png' }), 'front');
  assert.equal(app.state.upload.kind, 'reading');
  await pending;
  assert.equal(request.signal.aborted, true);
  // Read after the await; the earlier assertion narrowed the getter's type to 'reading'.
  const settled = (): DesignerState['upload'] => app.state.upload;
  const { token: _token, ...failure } = settled() as Extract<DesignerState['upload'], { kind: 'failed' }>;
  assert.deepEqual(failure, { kind: 'failed', target: 'front', reason: 'processing-timeout', fileName: 'logo.png' });
  assert.equal(app.state.modal.kind, 'artwork');
});

test('the client check timeout covers only the checking phase and is cleared by a result', { timeout: 5000 }, async () => {
  for (const phase of ['uploading', 'settled'] as const) {
    const deferred = delayed();
    let request!: UploadRequest;
    const app = harness(
      {
        artwork: {
          upload: async (_file, value) => {
            request = value;
            value.onProgress?.('uploading');
            if (phase === 'settled') {
              value.onProgress?.('processing');
              return { id: 'quick', name: 'logo.png', url: '/logo.png', width: 10, height: 10 };
            }
            return deferred.promise;
          },
        },
        cart: { commit: async () => { throw Error('unused'); } },
      },
      ready(),
      { processingTimeoutMs: 20 },
    );
    app.dispatch({ type: 'modal-opened', modal: { kind: 'artwork', positionId: 'front' } });
    const pending = app.runtime.upload(new File(['png'], 'logo.png', { type: 'image/png' }), 'front');
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(request.signal.aborted, false, phase);
    if (phase === 'uploading') {
      assert.equal(app.state.upload.kind, 'reading');
      deferred.resolve({ id: 'slow-transfer', name: 'logo.png', url: '/logo.png', width: 10, height: 10 });
    }
    await pending;
    assert.deepEqual(app.state.upload, { kind: 'idle' }, phase);
  }
});

test('confirmed upload cancellation retains previous artwork and ignores the late result', async () => {
  const deferred = delayed();
  let request!: UploadRequest;
  const app = harness({ artwork: { upload: async (_file, value) => { request = value; return deferred.promise; } }, cart: { commit: async () => { throw Error('unused'); } } });
  app.dispatch({ type: 'modal-opened', modal: { kind: 'artwork', positionId: 'front' } });
  const pending = app.runtime.upload(new File(['image'], 'pending.png', { type: 'image/png' }), 'front');
  const previous = structuredClone(app.state.prints);
  app.dispatch({ type: 'upload-close-requested' });
  app.runtime.cancelUpload();
  app.dispatch({ type: 'modal-closed' });
  deferred.resolve({ id: 'late', name: 'late.png', url: '/late.png', width: 10, height: 10 });
  await pending;
  assert.equal(request.signal.aborted, true);
  assert.deepEqual(app.state.prints, previous);
  assert.equal(app.state.modal.kind, 'closed');
  assert.equal(app.state.upload.kind, 'idle');
});

test('public close request preserves the existing pending-cart cancel and late-receipt behavior', async () => {
  const deferred = delayed();
  let request!: CartRequest;
  const app = harness({ artwork: { upload: async () => { throw Error('unused'); } }, cart: { commit: async value => { request = value; return deferred.promise; } } });
  const pending = app.runtime.commit();
  assert.equal(app.state.commit.kind, 'pending');
  app.dispatch({ type: 'close-requested' });
  assert.equal(app.state.open, false);
  assert.equal(app.state.modal.kind, 'closed');
  app.runtime.cancel();
  app.dispatch({ type: 'designer-reopened' });
  deferred.resolve(receipt(request));
  await pending;
  assert.equal(request.signal.aborted, true);
  assert.equal(app.state.completion, null);
  assert.equal(app.state.prints[0].artworkId, 'logo');
});


test('a stale close gesture cannot add a confirmation to a closed workflow during a design switch', () => {
  const closed = designerReducer(ready(), { type: 'product-return-requested' });
  const stale = designerReducer(closed, { type: 'close-requested' });
  assert.equal(stale, closed);
  const resumed = designerReducer(stale, { type: 'designer-reopened' });
  assert.equal(resumed.open, true);
  assert.equal(resumed.modal.kind, 'closed');
});

function expiringHarness(ports: { prepare: DesignerPorts['review'] extends infer R ? R extends { prepare: infer P } ? P : never : never; commit(request: CartRequest): Promise<unknown> }) {
  return harness({ artwork: { upload: async () => ({}) }, review: { prepare: ports.prepare }, cart: { commit: ports.commit } });
}
async function withClock<T>(offset: number, run: () => Promise<T> | T): Promise<T> {
  const originalNow = Date.now;
  Date.now = () => originalNow() + offset;
  try { return await run(); } finally { Date.now = originalNow; }
}

test('an expired displayed quote stays addable and the port can re-propose and apply it in the same click', async () => {
  const commits: CartRequest[] = [];
  const app = expiringHarness({
    prepare: async () => ({ expiresAt: new Date(Date.now() + 300_000).toISOString() }),
    commit: async (request) => {
      commits.push(request);
      request.onPreparing?.();
      request.onMutating?.();
      return receipt(request);
    },
  });
  await app.runtime.commit(true);
  await withClock(301_000, async () => {
    assert.equal(app.runtime.prepared, false);
    assert.equal(app.runtime.expired, true, 'the displayed proposal is expired, not unavailable');
    assert.equal(canCommitDesign(app.state), true);
    const first = app.runtime.commit();
    const doubleClick = app.runtime.commit();
    await Promise.all([first, doubleClick]);
  });
  assert.equal(commits.length, 1, 'a double click cannot start a second application or proposal');
  assert.equal((app.state.completion as CartReceipt | null)?.kind, 'applied');
});

test('an expired quote whose fresh terms changed returns to the normal review state and needs another click', async () => {
  let calls = 0;
  const app = expiringHarness({
    prepare: async () => ({ expiresAt: new Date(Date.now() + 300_000).toISOString() }),
    commit: async (request) => {
      if (++calls === 1) {
        request.onPreparing?.();
        throw Object.assign(new Error('Review the refreshed quote'), { reviewRequired: true, expiresAt: new Date(Date.now() + 300_000).toISOString() });
      }
      return receipt(request);
    },
  });
  await app.runtime.commit(true);
  await withClock(301_000, async () => {
    await app.runtime.commit();
    assert.equal(app.state.commit.kind, 'idle');
    assert.equal(app.state.completion, null);
    assert.equal(app.runtime.prepared, true);
    assert.equal(app.runtime.expired, false);
    await app.runtime.commit();
  });
  assert.equal(calls, 2);
  assert.equal((app.state.completion as CartReceipt | null)?.kind, 'applied');
});

test('returning to an expired quote refreshes it once, silently, without a busy state', async () => {
  const preparations: CartRequest[] = [];
  const held = delayed();
  const app = expiringHarness({
    prepare: async (request) => {
      preparations.push(request);
      if (preparations.length === 2) await held.promise;
      return { expiresAt: new Date(Date.now() + 300_000).toISOString() };
    },
    commit: async () => { throw Error('no cart write'); },
  });
  assert.equal(app.runtime.refreshExpired(), false, 'nothing displayed yet');
  await app.runtime.commit(true);
  assert.equal(app.runtime.refreshExpired(), false, 'an unexpired quote is not re-proposed');
  await withClock(301_000, async () => {
    assert.equal(app.runtime.refreshExpired(), true);
    assert.equal(app.runtime.refreshExpired(), false, 'repeated visibility events cannot stack proposals');
    assert.equal(app.state.commit.kind, 'refreshing');
    assert.equal(app.runtime.expired, true, 'the previous total stays displayed while refreshing');
    held.resolve(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(app.state.commit.kind, 'idle');
    assert.equal(app.runtime.prepared, true);
    assert.equal(app.runtime.refreshExpired(), false);
  });
  assert.equal(preparations.length, 2);
  assert.equal(preparations[1]?.idempotencyKey, preparations[0]?.idempotencyKey);
});

test('Add during a silent refresh supersedes it and its late result cannot change the add', async () => {
  const held = delayed();
  const commits: CartRequest[] = [];
  let preparations = 0;
  const app = expiringHarness({
    prepare: async () => {
      if (++preparations === 2) await held.promise;
      return { expiresAt: new Date(Date.now() + 300_000).toISOString() };
    },
    commit: async (request) => {
      commits.push(request);
      request.onPreparing?.();
      request.onMutating?.();
      return receipt(request);
    },
  });
  await app.runtime.commit(true);
  await withClock(301_000, async () => {
    assert.equal(app.runtime.refreshExpired(), true);
    await app.runtime.commit();
    held.resolve(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(commits.length, 1);
  assert.equal((app.state.completion as CartReceipt | null)?.kind, 'applied');
});

test('a failed silent refresh shows the existing preparation retry state', async () => {
  let preparations = 0;
  const app = expiringHarness({
    prepare: async () => {
      if (++preparations === 2) throw Object.assign(Error('Entitlement unavailable'), { status: 503 });
      return { expiresAt: new Date(Date.now() + 300_000).toISOString() };
    },
    commit: async () => { throw Error('no cart write'); },
  });
  await app.runtime.commit(true);
  await withClock(301_000, async () => {
    assert.equal(app.runtime.refreshExpired(), true);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(app.state.commit.kind === 'failed' && app.state.commit.preparation, true);
});

test('reducer: refreshing is cancellable and only its own request can fail it', () => {
  const state = designerReducer(ready(), { type: 'step-selected', step: 2 });
  const design = { id: 'design', prints: state.prints, quantities: state.quantities };
  const refreshing = designerReducer(state, { type: 'cart-commit-requested', requestId: 'r', design, preparation: true, refresh: true });
  assert.equal(refreshing.commit.kind, 'refreshing');
  assert.equal(designerReducer(refreshing, { type: 'cart-commit-failed', requestId: 'other', failure: { cause: 'unknown', preparation: true } }), refreshing);
  assert.equal(designerReducer(refreshing, { type: 'cart-commit-canceled' }).commit.kind, 'idle');
  assert.equal(designerReducer(refreshing, { type: 'cart-commit-requested', requestId: 'add', design }).commit.kind, 'pending');
});
