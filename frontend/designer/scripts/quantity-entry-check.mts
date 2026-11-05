import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
const root = new URL("../", import.meta.url).pathname;
const bundle = await build({
  stdin: {
    contents:
      'export * from "./src/quantity-layout"; export * from "./src/designer-state"; export * from "./src/config"; export * from "./src/shopify-variant-matrix";',
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const {
  quantityLayout,
  createDesignerState,
  designerReducer,
  buildCommitDesign,
  configSchema,
  buildShopifyVariantMatrix,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString("base64")}`
) as typeof import("../src/quantity-layout") & typeof import("../src/designer-state") & typeof import("../src/config") & typeof import("../src/shopify-variant-matrix");
async function fixture(id: string) {
  return configSchema.parse(
    JSON.parse(await readFile(new URL(`../src/scenarios/${id}.json`, import.meta.url), "utf8")),
  );
}

test("sparse compact quantities retain only real tuples and entering another choice survives commit", async () => {
  const config = await fixture("phone-case-options");
  const layout = quantityLayout(config);
  assert.equal(layout.kind, "compact");
  assert.equal(layout.cells.length, 3);
  const matte = config.colors[0],
    gloss = config.colors[1];
  const a = config.sizes[0],
    b = config.sizes[1];
  assert.ok(!layout.cells.some((cell) => cell.rowId === matte.id && cell.sizeId === b.id));
  assert.equal(
    layout.cells.find((cell) => cell.rowId === gloss.id && cell.sizeId === a.id)!.available,
    false,
  );
  let state = createDesignerState({
    rules: {
      positions: config.positions,
      colorIds: config.colors.map((c) => c.id),
      sizeIds: config.sizes.map((s) => s.id),
      availableSizes: Object.fromEntries(config.colors.map((c) => [c.id, c.availableSizeIds])),
      variantMatrix: config.variantMatrix,
      maxQuantity: config.maxQuantity,
      deferablePositions: [],
    },
    view: config.views[0].id,
    color: matte.id,
    active: config.positions[0].id,
    expanded: config.positions[0].id,
    prints: [
      { id: config.positions[0].id, method: config.methods[0].id, size: 0, artworkId: "logo" },
    ],
    artworks: [{ id: "logo", name: "Logo", url: "/logo.svg", width: 30, height: 20 }],
    designerOpen: true,
  });
  state = designerReducer(state, {
    type: "quantity-entered",
    color: matte.id,
    size: a.id,
    value: 2,
  });
  state = designerReducer(state, {
    type: "quantity-entered",
    color: gloss.id,
    size: b.id,
    value: 1,
  });
  assert.deepEqual(state.colorRows, [matte.id, gloss.id]);
  state = designerReducer(state, { type: "step-selected", step: 2 });
  const design = buildCommitDesign(state, "mixed");
  assert.ok(design);
  assert.deepEqual(design.variants, [
    { variantId: "900000000001", quantity: 2 },
    { variantId: "900000000003", quantity: 1 },
  ]);
});

test("all current product shapes choose a predictable layout without product-name inference", async () => {
  for (const [id, expected] of Object.entries({
    classic: "grid",
    "colour-studio": "grid",
    "extended-sizes": "grid",
    "front-only": "grid",
    "large-palette": "grid",
    "long-content": "list",
    "many-placements": "grid",
    "many-widths": "grid",
    minimal: "single",
    "one-size-apron": "compact",
    "phone-case-options": "compact",
    "phone-case": "single",
    "staff-polo": "grid",
    "team-hoodie": "grid",
  })) {
    const config = await fixture(id);
    assert.equal(quantityLayout(config).kind, expected, id);
    assert.deepEqual(
      quantityLayout({
        ...config,
        productName: "Unrelated translated title",
        optionPresentation: undefined,
      }),
      quantityLayout(config),
    );
  }
});

test("stock changes and arbitrary labels do not turn absent sparse cells into choices or change a compact layout", async () => {
  const config = await fixture("phone-case-options");
  const unavailable = {
    ...config,
    colors: config.colors.map((row) => ({ ...row, availableSizeIds: [] })),
    variantMatrix: config.variantMatrix!.map((cell) => ({ ...cell, available: false })),
  };
  assert.equal(quantityLayout(unavailable).kind, "compact");
  assert.equal(quantityLayout(unavailable).cells.length, 3);
  assert.ok(quantityLayout(unavailable).cells.every((cell) => !cell.available));
  const single = { ...config, variantMatrix: [config.variantMatrix![0]] };
  assert.equal(quantityLayout(single).kind, "single");
  assert.equal(quantityLayout(single).cells.length, 1);
});

test("quantity focus preserves unfilled groups and unavailable saved quantities can be removed", async () => {
  const config = await fixture("phone-case-options");
  const [matte, gloss] = config.colors;
  let state = createDesignerState({
    rules: {
      positions: config.positions,
      colorIds: config.colors.map((c) => c.id),
      sizeIds: config.sizes.map((s) => s.id),
      availableSizes: Object.fromEntries(config.colors.map((c) => [c.id, c.availableSizeIds])),
      variantMatrix: config.variantMatrix,
      maxQuantity: config.maxQuantity,
      deferablePositions: [],
    },
    view: config.views[0].id,
    color: matte.id,
    active: config.positions[0].id,
    expanded: config.positions[0].id,
    prints: [],
    artworks: [],
    designerOpen: true,
  });
  state = designerReducer(state, { type: "color-added", color: gloss.id });
  state = designerReducer(state, { type: "quantity-focused", color: matte.id });
  assert.deepEqual(state.colorRows, [matte.id, gloss.id]);
  assert.equal(state.color, matte.id);
  // The configuration changed after this saved vector was originally accepted.
  state = {
    ...state,
    quantities: { "gloss:model-a": 2, "matte:model-a": 3, "retired:unknown": 4 },
  };
  state = designerReducer(state, { type: "quantity-removed", key: "gloss:model-a" });
  state = designerReducer(state, { type: "quantity-removed", key: "retired:unknown" });
  assert.deepEqual(state.quantities, { "matte:model-a": 3 });
  assert.equal(designerReducer(state, { type: "quantity-removed", key: "invented" }), state);
  state = designerReducer(state, {
    type: "quantity-entered",
    color: matte.id,
    size: "model-a",
    value: Number.NaN,
  });
  assert.ok(
    Number.isNaN(state.quantities["matte:model-a"]),
    "bad numeric input stays invalid rather than becoming a valid zero",
  );
  state = designerReducer(state, {
    type: "quantity-entered",
    color: matte.id,
    size: "model-a",
    value: 0,
  });
  assert.equal(state.quantities["matte:model-a"], 0, "deliberate clearing is zero");
});

test("three actual axes retain every supplied name/value and sparse identity", async () => {
  const fixtureConfig = await fixture("phone-case-options");
  const mapped = buildShopifyVariantMatrix({
    variants: [
      {
        id: "101",
        label: "Do not parse",
        available: true,
        selectedOptions: [
          { name: "Material", value: "Cotton" },
          { name: "Pack", value: "Single" },
          { name: "Model", value: "Alpha" },
        ],
      },
      {
        id: "102",
        label: "Do not parse",
        available: true,
        selectedOptions: [
          { name: "Material", value: "Steel" },
          { name: "Pack", value: "Pair" },
          { name: "Model", value: "Beta" },
        ],
      },
      {
        id: "103",
        label: "Do not parse",
        available: false,
        selectedOptions: [
          { name: "Material", value: "Steel" },
          { name: "Pack", value: "Single" },
          { name: "Model", value: "Beta" },
        ],
      },
    ],
  });
  assert.equal(mapped.status, "ready");
  const config = configSchema.parse({
    ...fixtureConfig,
    colors: mapped.colors.map((row) => ({ ...row, images: fixtureConfig.colors[0].images })),
    sizes: mapped.sizes,
    variantMatrix: mapped.variantMatrix,
    optionPresentation: mapped.optionPresentation,
  });
  const layout = quantityLayout(config);
  assert.equal(layout.kind, "compact");
  assert.equal(layout.cells.length, 3);
  assert.deepEqual(
    config.colors.map((row) => row.name),
    [
      "Material: Cotton · Pack: Single",
      "Material: Steel · Pack: Pair",
      "Material: Steel · Pack: Single",
    ],
  );
  assert.deepEqual(
    config.sizes.map((size) => size.label),
    ["Alpha", "Beta"],
  );
});
