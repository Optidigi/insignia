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
      'export * from "./src/designer-state"; export * from "./src/runtime"; export * from "./src/demo/local-runtime"; export * from "./src/config"; export * from "./src/shopify-variant-matrix"; export * from "./src/model";',
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
} = (await import(pathToFileURL(moduleFile).href)) as typeof import('../src/designer-state') &
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
) {
  let state = designerReducer(initial, { type: 'step-selected', step: 2 });
  const dispatch = (event: DesignerEvent) => {
    state = designerReducer(state, event);
  };
  const runtime = createDesignerRuntime(ports as DesignerPorts, () => state, dispatch);
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
