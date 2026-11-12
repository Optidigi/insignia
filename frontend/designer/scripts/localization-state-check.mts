import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { test } from "node:test";

const root = new URL("../", import.meta.url).pathname;
const bundle = await build({
  stdin: {
    contents:
      'export * from "./src/designer-state"; export * from "./src/config"; export * from "./src/model";',
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { configSchema, createProductModel, createDesignerState, designerReducer } =
  await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString("base64")}`
  ) as typeof import("../src/designer-state") & typeof import("../src/config") & typeof import("../src/model");

async function createState() {
  const config = configSchema.parse(
    JSON.parse(await readFile(new URL("../src/scenarios/classic.json", import.meta.url), "utf8")),
  );
  const position = config.positions[0];
  const color = config.colors[0];
  const print = {
    ...createProductModel(config).initialPrint(position.id),
    artworkId: "test-logo",
  };
  return {
    config,
    position,
    color,
    print,
    state: createDesignerState({
      rules: {
        positions: config.positions,
        colorIds: config.colors.map((entry) => entry.id),
        sizeIds: config.sizes.map((entry) => entry.id),
        availableSizes: Object.fromEntries(
          config.colors.map((entry) => [entry.id, entry.availableSizeIds]),
        ),
        variantMatrix: config.variantMatrix,
        maxQuantity: config.maxQuantity,
        deferablePositions: config.positions.filter((entry) => entry.artworkLater).map((entry) => entry.id),
      },
      view: config.views[0].id,
      color: color.id,
      prints: [print],
      active: position.id,
      expanded: position.id,
      artworks: [{
        id: "test-logo",
        name: "test-logo.svg",
        url: "/test-logo.svg",
        width: 300,
        height: 200,
      }],
      designerOpen: true,
    }),
  };
}

test("upload failure state carries a stable reason instead of English prose", async () => {
  const { state, position } = await createState();
  const open = designerReducer(state, {
    type: "modal-opened",
    modal: { kind: "artwork", positionId: position.id },
  });
  const failed = designerReducer(open, {
    type: "upload-rejected",
    token: 1,
    target: position.id,
    reason: "file-too-large",
  });

  assert.deepEqual(failed.upload, {
    kind: "failed",
    token: 1,
    target: position.id,
    reason: "file-too-large",
  });
  assert.equal("message" in failed.upload, false);
});

test("Undo recovery stores reason codes and content parameters", async () => {
  const { state, position } = await createState();
  const removed = designerReducer(state, {
    type: "position-removed",
    positionId: position.id,
  });

  assert.equal(removed.recovery.kind, "removed-position");
  assert.equal("message" in removed.recovery, false);
  const restored = designerReducer(removed, { type: "recovery-undone" });
  assert.equal(restored.recovery.kind, "message");
  assert.equal(restored.recovery.reason, "artwork-restored");
  assert.ok(restored.prints.some((print) => print.id === position.id));
});

test("cart failure keeps its stable reason while the attempted design remains available", async () => {
  const { state: initial, print, color, config } = await createState();
  const state = designerReducer(initial, {
    type: "quantity-entered",
    color: color.id,
    size: config.sizes[0].id,
    value: 4,
  });
  const onReview = designerReducer(state, { type: "step-selected", step: 2 });
  const design = {
    id: "saved-design",
    prints: [print],
    quantities: onReview.quantities,
  };
  const pending = designerReducer(onReview, {
    type: "cart-commit-requested",
    requestId: "request-1",
    design,
  });
  const failed = designerReducer(pending, {
    type: "cart-commit-failed",
    requestId: "request-1",
    failure: { cause: "unknown", preparation: false },
  });

  assert.deepEqual(failed.commit, {
    kind: "failed",
    cause: "unknown",
    preparation: false,
  });
  assert.equal(failed.prints[0].artworkId, design.prints[0].artworkId);
  assert.deepEqual(failed.quantities, design.quantities);
});
