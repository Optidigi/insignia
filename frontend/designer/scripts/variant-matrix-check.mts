import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const bundle = await build({
  stdin: { contents: 'export * from "./src/shopify-variant-matrix"; export * from "./src/model";', resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, format: "esm", platform: "node",
});
const { buildShopifyVariantMatrix, createProductModel: rawCreateProductModel } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString("base64")}`) as typeof import("../src/shopify-variant-matrix") & typeof import("../src/model");
const createProductModel = (config: unknown) => rawCreateProductModel(config as import("../src/config").ProductConfig);
const variant = (id: string, options: [string, string][] | null, available = true) => ({ id, label: "A title that must never be parsed / Blue / XL", available, selectedOptions: options?.map(([name, value]) => ({ name, value })) ?? null });
const options = (variants: ReturnType<typeof variant>[]) => buildShopifyVariantMatrix({ variants });

test("sparse three-option products retain only actual tuples and exact variant identities", () => {
  const result = options([
    variant("9007199254740993123", [["Material", "A / B"], ["Finish", "C"], ["Length", "10"]]),
    variant("1002", [["Material", "A"], ["Finish", "B / C"], ["Length", "20"]], false),
    variant("1003", [["Length", "20"], ["Finish", "C"], ["Material", "A / B"]]),
  ]);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.optionNames, ["Material", "Finish", "Length"]);
  assert.equal(result.colors.length, 2);
  assert.equal(result.sizes.length, 2);
  assert.equal(result.variantMatrix.length, 3);
  assert.deepEqual(result.variantMatrix.map((cell) => cell.variantId), ["9007199254740993123", "1002", "1003"]);
  assert.equal(result.colors.every((row) => !("hex" in row)), true);
  assert.notEqual((result as Extract<ReturnType<typeof options>, {status: "ready"}>).colors[0].id, result.colors[1].id);
  assert.match((result as Extract<ReturnType<typeof options>, {status: "ready"}>).colors[0].id, /^[a-zA-Z0-9_-]+$/);
  const unavailable = result.variantMatrix[1];
  assert.equal(unavailable.available, false);
  assert.deepEqual(result.colors[1].availableSizeIds, []);
  const model = createProductModel({ ...result, locale: "en-US", currency: "USD" });
  assert.equal(model.isSizeAvailable(unavailable.rowId, unavailable.columnId), false);
  assert.equal(model.isSizeAvailable(result.colors[1].id, result.sizes[0].id), false);
  assert.equal(model.isSizeAvailable((result as Extract<ReturnType<typeof options>, {status: "ready"}>).colors[0].id, result.sizes[1].id), true);
  const changedTitles = options([variant("9007199254740993123", [["Material", "A / B"], ["Finish", "C"], ["Length", "10"]])]);
  assert.equal((changedTitles as Extract<ReturnType<typeof options>, { status: "ready" }>).colors[0].id, (result as Extract<ReturnType<typeof options>, {status: "ready"}>).colors[0].id);
});

test("known one-option variants use a generic row and actual option columns", () => {
  const result = options([variant("101", [["Pack count", "10"]]), variant("102", [["Pack count", "20"]])]);
  assert.equal(result.status, "ready");
  assert.equal(result.colors.length, 1);
  assert.equal((result as Extract<ReturnType<typeof options>, {status: "ready"}>).colors[0].name, "Selection");
  assert.deepEqual(result.sizes.map((column) => column.label), ["10", "20"]);
  assert.equal(result.optionPresentation.columnOption.label, "Pack count");
  assert.equal(result.optionPresentation.rowOption.display, "named-choice");
});

test("unknown, malformed and ambiguous options return an explicit unsupported reason", () => {
  const cases = [
    [{ variants: [] }, "no-variants"],
    [{ variants: [variant("002", [["A", "a"]])] }, "invalid-variant-id"],
    [{ variants: [variant("invented", [["A", "a"]])] }, "invalid-variant-id"],
    [{ variants: [variant("gid://shopify/ProductVariant/222", [["A", "a"]])] }, "invalid-variant-id"],
    [{ variants: [variant("222", [["A", "a"]]), variant("gid://shopify/ProductVariant/222", [["A", "b"]])] }, "invalid-variant-id"],
    [{ variants: [variant("1", null)] }, "unknown-options"],
    [{ variants: [variant("1", [])] }, "unknown-options"],
    [{ variants: [variant("1", [["A", "a"]]), variant("1", [["A", "b"]])] }, "duplicate-variant-id"],
    [{ variants: [variant("1", [["A", "a"], ["A", "b"]])] }, "duplicate-option-name"],
    [{ variants: [variant("1", [["A", "a"]]), variant("2", [["B", "b"]])] }, "inconsistent-option-names"],
    [{ variants: [variant("1", [["A", "a"]]), variant("2", [["A", "a"]])] }, "duplicate-option-tuple"],
    [{ variants: [variant("1", [["A", "a"], ["B", "b"], ["C", "c"], ["D", "d"]])] }, "too-many-options"],
    [{ variants: [{ ...variant("1", [["A", "a"]]), available: undefined }] }, "invalid-input"],
  ];
  for (const [input, reason] of cases) assert.deepEqual(buildShopifyVariantMatrix(input), { status: "unsupported", reason });
});

test("model fails closed when explicit availability or exact cells are absent", () => {
  const basic = { locale: "en-US", currency: "USD", colors: [{ id: "row", name: "Known" }], sizes: [{ id: "col", label: "Known" }] };
  assert.equal(createProductModel(basic).isSizeAvailable("row", "col"), false);
  assert.equal(createProductModel({ ...basic, colors: [{ ...basic.colors[0], availableSizeIds: ["col"] }] }).isSizeAvailable("row", "col"), true);
  assert.equal(createProductModel({ ...basic, colors: [{ ...basic.colors[0], availableSizeIds: ["col"] }], variantMatrix: [] }).isSizeAvailable("row", "col"), false);
});

test('actual Shopify swatches select the local swatch presentation without inferring option names', () => {
  const variants = [
    {
      ...variant('201', [
        ['Afwerking', 'Ocean'],
        ['Maat', 'M'],
      ]),
      selectedOptions: [
        { name: 'Afwerking', value: 'Ocean', swatch: { color: '#123456' } },
        { name: 'Maat', value: 'M' },
      ],
    },
    {
      ...variant('202', [
        ['Afwerking', 'Snow'],
        ['Maat', 'M'],
      ]),
      selectedOptions: [
        { name: 'Afwerking', value: 'Snow', swatch: { color: '#FFFFFF' } },
        { name: 'Maat', value: 'M' },
      ],
    },
  ];
  const result = buildShopifyVariantMatrix({ variants });
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.equal(result.optionPresentation.rowOption.display, 'swatch');
  assert.deepEqual(
    result.colors.map((row) => row.hex),
    ['#123456', '#FFFFFF'],
  );
  assert.deepEqual(
    result.variantMatrix.map((cell) => cell.variantId),
    ['201', '202'],
  );
  const incomplete = buildShopifyVariantMatrix({
    variants: [
      variants[0],
      {
        ...variants[1],
        selectedOptions: [
          { name: 'Afwerking', value: 'Snow' },
          { name: 'Maat', value: 'M' },
        ],
      },
    ],
  });
  assert.equal(incomplete.status, 'ready');
  if (incomplete.status === 'ready') assert.equal(incomplete.optionPresentation.rowOption.display, 'named-choice');
});

test('missing, malformed, conflicting and composite swatches fall back without fabricated colours', () => {
  const selected = (id: string, color: unknown) => ({
    ...variant(id, [
      ['Colour', 'Blue'],
      ['Size', id],
    ]),
    selectedOptions: [
      { name: 'Colour', value: 'Blue', swatch: { color } },
      { name: 'Size', value: id },
    ],
  });
  for (const variants of [
    [selected('201', 'blue')],
    [selected('201', '#123456'), selected('202', '#654321')],
    [selected('201', '#123456'), selected('202', null)],
    [selected('201', '#123456'), selected('202', null), selected('203', '#123456')],
  ]) {
    const result = buildShopifyVariantMatrix({ variants });
    assert.equal(result.status, 'ready');
    if (result.status === 'ready') assert.equal(result.optionPresentation.rowOption.display, 'named-choice');
  }
  const composite = buildShopifyVariantMatrix({ variants: [selected('201', '#123456')] }, ['Colour', 'Size']);
  assert.equal(composite.status, 'ready');
  if (composite.status === 'ready') assert.equal(composite.optionPresentation.rowOption.display, 'named-choice');
});
