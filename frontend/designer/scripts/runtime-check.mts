import type { DesignerPorts, CartRequest, CartReceipt, UploadRequest } from "../src/runtime";
import type { DesignerState, DesignerEvent } from "../src/designer-state";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const bundle = await build({
  stdin: {
    contents:
      'export * from "./src/designer-state"; export * from "./src/runtime"; export * from "./src/demo/local-runtime"; export * from "./src/config"; export * from "./src/shopify-variant-matrix"; export * from "./src/model";',
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const {
  createDesignerState,
  designerReducer,
  createDesignerRuntime,
  canCommitDesign,
  configSchema,
  createProductModel,
  buildShopifyVariantMatrix,
  createLocalRuntime,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString("base64")}`
) as typeof import("../src/designer-state") & typeof import("../src/runtime") & typeof import("../src/demo/local-runtime") & typeof import("../src/config") & typeof import("../src/shopify-variant-matrix") & typeof import("../src/model");
function ready() {
  return designerReducer(
    createDesignerState({
      rules: {
        positions: [
          {
            id: "front",
            name: "Front", price: 0, sizePrices: [0],
            view: "front",
            dimensions: [10],
            methodIds: ["print"],
            x: 50,
            y: 50,
            width: 20,
          },
        ],
        colorIds: ["white"],
        sizeIds: ["s"],
        availableSizes: { white: ["s"] },
        maxQuantity: 100,
        deferablePositions: [],
      },
      view: "front",
      color: "white",
      prints: [{ id: "front", artworkId: "logo", method: "print", size: 0 }],
      active: "front",
      expanded: "front",
      artworks: [{ id: "logo", name: "Logo", url: "/logo.svg", width: 30, height: 20 }],
      designerOpen: true,
    }),
    { type: "quantity-entered", color: "white", size: "s", value: 2 },
  );
}
function harness(ports: { artwork: { upload(file: File, request: UploadRequest): Promise<unknown> }; cart: { commit(request: CartRequest): Promise<unknown> } }, initial: DesignerState = ready()) {
  let state = designerReducer(initial, { type: "step-selected", step: 2 });
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
  kind: "applied",
  requestId: request.requestId,
  designId: request.design.id,
  operation: request.operation,
  authority: "local-preview",
});
test("commit waits for an applied receipt and prevents a second submission", async () => {
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
  assert.equal(app.state.commit.kind, "pending");
  await app.runtime.commit();
  assert.equal(calls, 1);
  deferred.resolve(receipt(request));
  await pending;
  assert.equal(app.state.open, false);
  assert.equal(app.state.completion!.operation, "added");
});

test("a rejected or malformed commit stays open and preserves the draft for retry", async () => {
  for (const commit of [
    async () => {
      throw new Error("offline");
    },
    async () => undefined,
    async (request: CartRequest) => ({ ...receipt(request), requestId: "wrong" }),
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
    assert.equal(app.state.commit.kind, "failed");
    assert.deepEqual(app.state.prints, prints);
    assert.deepEqual(app.state.quantities, quantities);
  }
});

test("closing cancels an outstanding commit and ignores its later receipt even after reopen", async () => {
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
  app.dispatch({ type: "product-return-requested" });
  app.dispatch({ type: "designer-reopened" });
  assert.equal(request.signal.aborted, true);
  deferred.resolve(receipt(request));
  await pending;
  assert.equal(app.state.open, true);
  assert.equal(app.state.completion, null);
  const late = designerReducer(app.state, {
    type: "cart-commit-succeeded",
    requestId: request.requestId,
    receipt: receipt(request),
  });
  assert.equal(
    late,
    app.state,
    "the reducer separately rejects results after cancellation",
  );
});

test("an old completion cannot finish a newer commit", async () => {
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
  assert.equal((app.state.commit as Extract<DesignerState["commit"], { kind: "pending" }>).requestId, requests[1].requestId);
  assert.equal(app.state.completion, null);
  second.resolve(receipt(requests[1]));
  await pendingSecond;
  assert.equal(app.state.completion!.requestId, requests[1].requestId);
});

test("local add and edit update the host-owned snapshots without putting a cart in editor state", async () => {
  const local = createLocalRuntime();
  const app = harness(local.ports);
  assert.equal("cart" in app.state, false);
  await app.runtime.commit();
  const first = local.savedDesigns()[0];
  assert.equal(first.quantities["white:s"], 2);
  assert.equal(app.state.completion!.authority, "local-preview");
  app.dispatch({ type: "product-design-edit-requested", design: first });
  app.dispatch({ type: "quantity-entered", color: "white", size: "s", value: 3 });
  app.dispatch({ type: "step-selected", step: 2 });
  await app.runtime.commit();
  assert.equal(local.savedDesigns().length, 1);
  assert.equal(local.savedDesigns()[0].id, first.id);
  assert.equal(local.savedDesigns()[0].quantities["white:s"], 3);
  assert.equal(first.quantities["white:s"], 2);
  assert.equal(app.state.completion!.operation, "updated");
  app.dispatch({
    type: "product-design-edit-requested",
    design: local.savedDesigns()[0],
  });
  app.dispatch({ type: "step-selected", step: 2 });
  await app.runtime.commit();
  assert.equal(
    app.state.completion,
    null,
    "an unchanged edit cannot add or update again",
  );
});

test("the deterministic local failure adapter cannot produce a saved design or completion", async () => {
  const local = createLocalRuntime({ failCommit: true });
  const app = harness(local.ports);
  await app.runtime.commit();
  assert.equal(app.state.commit.kind, "failed");
  assert.equal(app.state.open, true);
  assert.equal(app.state.completion, null);
  assert.deepEqual(local.savedDesigns(), []);
});

test("a canceled upload aborts its port and ignores late artwork", async () => {
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
  app.dispatch({ type: "modal-opened", modal: { kind: "artwork", positionId: "front" } });
  const pending = app.runtime.upload(
    new File(["test"], "new.png", { type: "image/png" }),
    "front",
  );
  assert.equal(app.state.upload.kind, "reading");
  app.runtime.cancelUpload();
  app.dispatch({ type: "modal-closed" });
  deferred.resolve({
    id: "late",
    name: "new.png",
    url: "/new.png",
    width: 10,
    height: 10,
  });
  await pending;
  assert.equal(request.signal.aborted, true);
  assert.equal(app.state.artworks.length, 1);
  assert.equal(app.state.prints[0].artworkId, "logo");
});

test("upload through an injected port applies artwork and a newer rejected file retires an older read", async () => {
  const deferred = delayed();
  let calls = 0;
  const artwork = { id: "new", name: "new.png", url: "/new.png", width: 10, height: 10 };
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
  app.dispatch({ type: "modal-opened", modal: { kind: "artwork", positionId: "front" } });
  await app.runtime.upload(new File(["test"], "new.png", { type: "image/png" }), "front");
  assert.equal(app.state.prints[0].artworkId, "new");
  assert.equal(app.state.modal.kind, "closed");
  app.dispatch({ type: "modal-opened", modal: { kind: "artwork", positionId: "front" } });
  const older = app.runtime.upload(
    new File(["test"], "older.png", { type: "image/png" }),
    "front",
  );
  await app.runtime.upload(
    new File(["test"], "wrong.txt", { type: "text/plain" }),
    "front",
  );
  deferred.resolve({ ...artwork, id: "older" });
  await older;
  assert.equal(app.state.upload.kind, "failed");
  assert.equal(app.state.prints[0].artworkId, "new");
  assert.equal(calls, 2);
});

test("retrying an unchanged snapshot reuses its idempotency key and design identity, with a fresh UI request ID", async () => {
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
        if (requests.length === 1) throw new Error("response lost");
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

test("the local host applies an identical transport retry only once", async () => {
  const local = createLocalRuntime();
  const request = {
    requestId: "first",
    idempotencyKey: "same-attempt",
    design: { id: "one", prints: ready().prints, quantities: { "white:s": 2 } },
    artworks: ready().artworks,
    operation: "added" as const,
    signal: new AbortController().signal,
  };
  await local.ports.cart.commit(request);
  const repeated = await local.ports.cart.commit({ ...request, requestId: "retry" });
  assert.equal(repeated.requestId, "retry");
  assert.equal(local.savedDesigns().length, 1);
});

test("the core can bundle without a local host, fixture catalog or browser-upload implementation", async () => {
  const isolated = await build({
    entryPoints: [fileURLToPath(new URL("../src/designer.tsx", import.meta.url))],
    bundle: true,
    write: false,
    metafile: true,
    outdir: "unused",
    format: "esm",
    platform: "browser",
    treeShaking: true,
  });
  const inputs = Object.keys(isolated.metafile.inputs);
  assert.equal(
    inputs.some((path) =>
      /(?:\/demo\/|scenario-catalog|scenarios\/|storefront-host-preview|admin-preview|preview-shell)/.test(
        path,
      ),
    ),
    false,
  );
  const javascript = isolated.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
  assert.doesNotMatch(
    javascript,
    /Shopify host preview|simulated host result|North outdoor club|FileReader/,
  );
});

test("a separately started identical new design gets its own host identity and application", async () => {
  const local = createLocalRuntime();
  const app = harness(local.ports);
  const originalPrint = structuredClone(app.state.prints[0]);
  await app.runtime.commit();
  const firstId = local.savedDesigns()[0].id;
  app.dispatch({ type: "new-design-requested" });
  app.dispatch({ type: "designer-reopened" });
  app.dispatch({ type: "position-added", print: originalPrint });
  app.dispatch({ type: "quantity-entered", color: "white", size: "s", value: 2 });
  app.dispatch({ type: "step-selected", step: 2 });
  await app.runtime.commit();
  assert.equal(local.savedDesigns().length, 2);
  assert.notEqual(local.savedDesigns()[1].id, firstId);
});


function matrixReady() {
  const state = ready();
  return { ...state, rules: { ...state.rules,
    sizeIds: ["s", "m", "l"],
    // This stale local list must never override Shopify cells.
    availableSizes: { white: ["s", "m", "l"] },
    variantMatrix: [
      { rowId: "white", columnId: "s", variantId: "9007199254740993123", available: true },
      { rowId: "white", columnId: "m", variantId: "1002", available: false },
    ],
  } };
}

test("exact cells reject unavailable and absent quantities, including stale saved values", () => {
  const state = matrixReady();
  for (const size of ["m", "l"]) {
    assert.equal(designerReducer(state, { type: "quantity-entered", color: "white", size, value: 1 }), state);
    const stale = { ...state, step: 2 as const, quantities: { "white:s": 2, [`white:${size}`]: 1 } };
    assert.equal(canCommitDesign(stale), false);
  }
  assert.equal(canCommitDesign({ ...state, step: 2 as const, quantities: { "white:s": 2, "invented:key": 1 } }), false);
  const missingAvailability = { ...state, rules: { ...state.rules, variantMatrix: undefined, availableSizes: {} } };
  assert.equal(designerReducer(missingAvailability, { type: "quantity-entered", color: "white", size: "s", value: 1 }), missingAvailability);
});

test("runtime derives raw Shopify identities from current configured cells on every commit", async () => {
  const requests: CartRequest[] = [];
  const local = createLocalRuntime();
  const app = harness({ ...local.ports, cart: { commit: async (request) => {
    requests.push(request);
    return local.ports.cart.commit(request);
  } } }, matrixReady());
  await app.runtime.commit();
  assert.deepEqual(requests[0].design.variants, [{ variantId: "9007199254740993123", quantity: 2 }]);
  assert.deepEqual(local.savedDesigns()[0].variants, requests[0].design.variants);
  const stale = { ...local.savedDesigns()[0], variants: [{ variantId: "invented", quantity: 99 }] };
  app.dispatch({ type: "product-design-edit-requested", design: stale });
  app.dispatch({ type: "quantity-entered", color: "white", size: "s", value: 3 });
  app.dispatch({ type: "step-selected", step: 2 });
  await app.runtime.commit();
  assert.deepEqual(requests[1].design.variants, [{ variantId: "9007199254740993123", quantity: 3 }]);
});

test("reducer commit snapshots ignore supplied quantities, prints and invented Shopify identities", () => {
  const state: DesignerState = { ...matrixReady(), step: 2 };
  const next = designerReducer(state, { type: "cart-commit-requested", requestId: "request", design: {
    id: "design", prints: [], quantities: { "white:m": 99 }, variants: [{ variantId: "invented", quantity: 99 }],
  } });
  assert.equal(next.commit.kind, "pending");
  assert.deepEqual(next.commit.design.quantities, { "white:s": 2 });
  assert.deepEqual(next.commit.design.prints, state.prints);
  assert.deepEqual(next.commit.design.variants, [{ variantId: "9007199254740993123", quantity: 2 }]);
});

test("a demo without Shopify identities cannot accept a Shopify cart receipt", async () => {
  const app = harness({ artwork: { upload: async () => { throw Error(); } }, cart: {
    commit: async (request: CartRequest) => ({ ...receipt(request), authority: "shopify" }),
  } });
  await app.runtime.commit();
  assert.equal(app.state.commit.kind, "failed");
  assert.equal(app.state.completion, null);
  assert.equal(app.state.open, true);
});


test("validated product configuration carries its selected exact cell through the cart port", async () => {
  const source = { variants: [
    { id: "1001", label: "Supplier text / never split", available: true, selectedOptions: [{ name: "Material", value: "Cotton / cotton blend" }, { name: "Pack", value: "10" }] },
    { id: "1002", label: "Something else", available: false, selectedOptions: [{ name: "Material", value: "Cotton / cotton blend" }, { name: "Pack", value: "20" }] },
  ] };
  const matrix = buildShopifyVariantMatrix(source);
  assert.equal(matrix.status, "ready");
  const base = JSON.parse(await readFile(new URL("../src/scenarios/classic.json", import.meta.url), "utf8"));
  const config = configSchema.parse({ ...base, preview: "illustration", colors: matrix.colors, sizes: matrix.sizes,
    variantMatrix: matrix.variantMatrix, optionPresentation: matrix.optionPresentation });
  const position = config.positions[0];
  const model = createProductModel(config);
  const initial = createDesignerState({
    rules: { positions: config.positions, colorIds: config.colors.map((row) => row.id), sizeIds: config.sizes.map((column) => column.id),
      availableSizes: Object.fromEntries(config.colors.map((row) => [row.id, row.availableSizeIds])), variantMatrix: config.variantMatrix,
      maxQuantity: config.maxQuantity, deferablePositions: [] },
    view: config.views[0].id, color: config.colors[0].id, prints: [{ ...model.initialPrint(position.id), artworkId: "logo" }],
    active: position.id, expanded: position.id, artworks: ready().artworks, designerOpen: true,
  });
  const selected = config.variantMatrix!.find((cell) => cell.variantId === "1001");
  const populated = designerReducer(initial, { type: "quantity-entered", color: selected!.rowId, size: selected!.columnId, value: 7 });
  let request!: CartRequest;
  const app = harness({ artwork: { upload: async () => { throw Error(); } }, cart: { commit: async (value) => {
    request = value;
    return { ...receipt(value), authority: "shopify" };
  } } }, populated);
  await app.runtime.commit();
  assert.deepEqual(request.design.quantities, { [`${selected!.rowId}:${selected!.columnId}`]: 7 });
  assert.deepEqual(request.design.variants, [{ variantId: source.variants[0].id, quantity: 7 }]);
  assert.equal(app.state.completion!.authority, "shopify");
});
