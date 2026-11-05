import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { createAdminTranslator } from "@insignia/ui-localization/admin";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundled = await build({
  entryPoints: [
    path.join(root, "src/config.ts"),
    path.join(root, "src/option-presentation.ts"),
    path.join(root, "src/model.ts"),
    path.join(root, "src/color-search.ts"),
    path.join(root, "src/position-geometry.ts"),
    path.join(root, "src/admin-preview.tsx"),
  ],
  bundle: true,
  format: "esm",
  write: false,
  outdir: path.join(root, ".config-check-unused"),
  loader: { ".css": "empty" },
});
async function loadModule(filename: string) {
  const output = bundled.outputFiles.find(
    (file) => path.basename(file.path) === filename,
  );
  assert.ok(output, `Missing bundled module ${filename}`);
  return import(
    `data:text/javascript;base64,${Buffer.from(output.contents).toString("base64")}`
  );
}
const { configSchema } = (await loadModule("config.js") as typeof import("../src/config"));
const { resolveOptionPresentation } = (await loadModule("option-presentation.js") as typeof import("../src/option-presentation"));
const { createProductModel, totalQuantity, isValidQuantity } =
  (await loadModule("model.js") as typeof import("../src/model"));
const { filterColors } = (await loadModule("color-search.js") as typeof import("../src/color-search"));
const previousWindow = globalThis.window;
const previousDocument = globalThis.document;
Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: {
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  localStorage: { getItem: () => null },
  addEventListener() {},
  removeEventListener() {},
} });
Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: {
  documentElement: { dataset: {}, style: {} },
  querySelector: () => null,
} });
const { buildCustomerPreviewConfig, adminPreviewNoticeMessage } = (await loadModule("admin-preview.js") as typeof import("../src/admin-preview"));
if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
else globalThis.window = previousWindow;
if (previousDocument === undefined) Reflect.deleteProperty(globalThis, "document");
else globalThis.document = previousDocument;
const {
  artworkFootprint,
  availablePrintSizes,
  availablePrintSizesForImages,
  clampArtworkCenter,
  clampArtworkCenterForImages,
  isArtworkCenterAllowed,
  isArtworkCenterAllowedForImages,
  printSizeLabel,
  printWidthPercent,
  printWidthPercentForArtwork,
  resolvePrintCenter,
} = (await loadModule("position-geometry.js") as typeof import("../src/position-geometry"));
const fixtureDirectory = path.join(root, "src/scenarios");
const fixtureFiles = (await readdir(fixtureDirectory))
  .filter((file) => file.endsWith(".json"))
  .sort();
const fixtures = await Promise.all(
  fixtureFiles.map(async (filename) => ({
    filename,
    config: configSchema.parse(JSON.parse(
      await readFile(path.join(fixtureDirectory, filename), "utf8"),
    )),
  })),
);
const classic = fixtures.find(({ config }) => config.id === "classic")?.config;
assert.ok(
  classic,
  "The classic scenario is needed for price regression checks.",
);

function rejectChange(change: (config: import("../src/config").ProductConfig) => void, expectedPath: string) {
  const candidate = structuredClone(classic!);
  change(candidate);
  const parsed = configSchema.safeParse(candidate);
  assert.equal(
    parsed.success,
    false,
    "Invalid fixture must fail at the config boundary.",
  );
  assert.ok(
    parsed.error.issues.some((issue) => issue.path.join(".") === expectedPath),
    `Expected an error at ${expectedPath}, got ${JSON.stringify(parsed.error.issues)}`,
  );
}

test("the fourteen shipped scenarios are present", () => {
  const ids = new Set(fixtures.map(({ config }) => config.id));
  for (const id of [
    "classic",
    "phone-case",
    "phone-case-options",
    "colour-studio",
    "extended-sizes",
    "front-only",
    "minimal",
    "one-size-apron",
    "staff-polo",
    "team-hoodie",
    "many-placements",
    "many-widths",
    "large-palette",
    "long-content",
  ]) {
    assert.ok(ids.has(id), `Missing scenario ${id}`);
  }
  assert.equal(
    ids.size,
    fixtures.length,
    "Scenario IDs must be unique across files.",
  );
});

test("apparel fixtures explicitly provide their colour and size presentation", () => {
  const legacyConfigs = fixtures.filter(
    ({ config }) => config.id !== "phone-case-options",
  );
  for (const { config: candidate } of legacyConfigs) {
    const parsed = configSchema.parse(candidate);
    assert.ok(parsed.optionPresentation);
    assert.deepEqual(resolveOptionPresentation(parsed.optionPresentation), {
      rowOption: {
        label: "Colour",
        display: "swatch",
      },
      columnOption: {
        label: "Size",
      },
    });
  }
});

test("option presentation metadata accepts named choices and rejects malformed labels or modes", () => {
  const candidate = structuredClone(classic!);
  candidate.optionPresentation = {
    rowOption: {
      label: "Finish",
      display: "named-choice",
    },
    columnOption: {
      label: "capacity",
    },
  };
  assert.deepEqual(
    resolveOptionPresentation(configSchema.parse(candidate).optionPresentation),
    candidate.optionPresentation,
  );

  Reflect.set(candidate.optionPresentation!.rowOption, "display", "hex-card");
  const invalidMode = configSchema.safeParse(candidate);
  assert.equal(invalidMode.success, false);
  assert.ok(
    invalidMode.error.issues.some(
      (issue) => issue.path.join(".") === "optionPresentation.rowOption.display",
    ),
  );

  candidate.optionPresentation.rowOption.display = "named-choice";
  candidate.optionPresentation.columnOption.label = "  ";
  const invalidLabel = configSchema.safeParse(candidate);
  assert.equal(invalidLabel.success, false);
  assert.ok(
    invalidLabel.error.issues.some(
      (issue) => issue.path.join(".") === "optionPresentation.columnOption.label",
    ),
  );
});

test("phone-case model and finish labels retain the shared legacy quantity matrix", () => {
  const candidate = fixtures.find(
    ({ config }) => config.id === "phone-case-options",
  )?.config;
  assert.ok(candidate);
  const config = configSchema.parse(candidate);
  assert.deepEqual(config.optionPresentation, {
    rowOption: {
      label: "Finish",
      display: "named-choice",
    },
    columnOption: {
      label: "Model",
    },
  });
  assert.equal(config.colors.length, 2);
  assert.deepEqual(config.sizes.map(({ id }) => id), ["model-a", "model-b"]);
  assert.equal(config.colors[0]?.images?.back, config.colors[1]?.images?.back);
  const model = createProductModel(config);
  assert.equal(model.isSizeAvailable("matte", "model-a"), true);
  assert.equal(model.isSizeAvailable("gloss", "model-b"), true);
  assert.equal(
    model.printPrice(model.initialPrint("case-back")),
    config.positions[0].price + config.positions[0].sizePrices[0],
  );
});

for (const { filename, config } of fixtures) {
  test(`${filename} parses and every initial placement has a finite cent price`, () => {
    const parsed = configSchema.parse(config);
    const model = createProductModel(parsed);
    assert.equal(model.unitPrice([]), parsed.basePrice);
    for (const position of parsed.positions) {
      const print = model.initialPrint(position.id);
      assert.equal(print.id, position.id);
      assert.equal(print.artworkId, null);
      assert.ok(position.methodIds.includes(print.method));
      assert.ok(position.dimensions[print.size] > 0);
      assert.ok(Number.isSafeInteger(model.printPrice(print)));
      assert.ok(model.printPrice(print) >= 0);
      assert.ok(Number.isSafeInteger(model.unitPrice([print])));
    }
  });
}

test("classic cart totals remain €87.25 for five chest prints and €187.25 with large backs added", () => {
  const model = createProductModel(configSchema.parse(classic!));
  const quantities = { "white:m": 3, "black:l": 2 };
  const chest = model.initialPrint("left-chest");
  assert.equal(totalQuantity(quantities), 5);
  assert.equal(model.unitPrice([chest]) * totalQuantity(quantities), 8725);
  assert.equal(
    model.unitPrice([chest, { ...model.initialPrint("back"), size: 2 }]) *
      totalQuantity(quantities),
    18725,
  );
  assert.equal(
    model.printPrice({ ...chest, size: 2, method: "embroidery" }),
    1650,
  );
});

test("single-method placements initialize with their supported method", () => {
  const polo = fixtures.find(
    ({ config }) => config.id === "staff-polo",
  )?.config;
  assert.ok(polo);
  const model = createProductModel(configSchema.parse(polo));
  assert.equal(model.initialPrint("left-chest").method, "embroidery");
});

test("optional height envelopes contain tall artwork and preserve legacy sizing and prices", () => {
  const legacyPosition = configSchema.parse(classic!).positions[0];
  assert.ok(legacyPosition);
  assert.equal(
    printWidthPercentForArtwork(legacyPosition, 2, 0.5, 1),
    printWidthPercent(legacyPosition, 2),
    "existing scenarios without a height envelope keep their current width",
  );

  const boundedPosition = { ...legacyPosition, maximumHeight: 10 };
  const fittedWidth = printWidthPercentForArtwork(boundedPosition, 2, 0.5, 1);
  const fittedFootprint = artworkFootprint({ x: 50, y: 50 }, fittedWidth, 0.5, 1);
  assert.equal(fittedWidth, 7.5);
  assert.ok(fittedFootprint);
  assert.ok(fittedFootprint.height <= boundedPosition.maximumHeight * 1.5);

  const boundedConfig = structuredClone(classic!);
  boundedConfig.positions[0].maximumHeight = 10;
  const boundedModel = createProductModel(configSchema.parse(boundedConfig));
  const legacyModel = createProductModel(configSchema.parse(classic!));
  const print = { ...boundedModel.initialPrint("left-chest"), size: 2 };
  assert.equal(boundedModel.printPrice(print), legacyModel.printPrice(print));
});

test("exact method-by-size tables show unavailable combinations without changing legacy scenarios", () => {
  const candidate = structuredClone(classic!);
  const position = candidate.positions[0];
  assert.ok(position);
  position.methodSizePrices = {
    print: [null, null, 550],
    embroidery: [null, 675, null],
  };
  const config = configSchema.parse(candidate);
  const model = createProductModel(config);
  const initial = model.initialPrint(position.id);
  assert.equal(initial.size, 1);
  assert.equal(initial.method, "embroidery");
  assert.equal(model.printPrice(initial), 675);
  assert.equal(model.printPrice({ ...initial, size: 2, method: "print" }), 550);
  assert.equal(model.isCombinationAvailable(position.id, 1, "print"), false);
  assert.throws(
    () => model.printPrice({ ...initial, method: "print" }),
    /Unavailable print option/,
  );
  const methodChanged = model.updatePrintOption(initial, { method: "print" });
  assert.deepEqual(
    { method: methodChanged?.method, size: methodChanged?.size },
    { method: "print", size: 2 },
    "changing methods moves to its first priced size when needed",
  );
  assert.equal(
    model.updatePrintOption(methodChanged!, { size: 1 }),
    null,
    "changing size never silently switches away from the selected method",
  );
  const legacyModel = createProductModel(configSchema.parse(classic!));
  assert.equal(legacyModel.printPrice({ ...legacyModel.initialPrint("left-chest"), size: 2 }), 1250);
});

test("customer preview includes ready placements and discloses omitted draft placements", () => {
  const rect = { centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.2 };
  const size = { id: "small", name: "Small", widthPercent: "100", prices: {} };
  const product = {
    id: "tote",
    title: "Canvas tote",
    images: [],
    methods: [{ id: "print", name: "Print", pricing: "fixed" as const, amount: "5.00" }],
    views: [{
      id: "front",
      name: "Front",
      imageUrl: "https://cdn.example.test/tote.png",
      imageWidth: 1000,
      imageHeight: 1000,
      placements: [
        {
          id: "ready",
          name: "Front",
          rect,
          widthCm: "",
          heightCm: "",
          methodIds: ["print"],
          sizes: [size],
          logoLaterAllowed: false,
          customPlacementAllowed: false,
        },
        {
          id: "movement-incomplete",
          name: "Sleeve",
          rect,
          widthCm: "",
          heightCm: "",
          methodIds: ["print"],
          sizes: [size],
          logoLaterAllowed: false,
          customPlacementAllowed: true,
        },
        {
          id: "unpriced",
          name: "Back",
          rect,
          widthCm: "",
          heightCm: "",
          methodIds: [],
          sizes: [size],
          logoLaterAllowed: false,
          customPlacementAllowed: false,
        },
      ],
    }],
  };
  const config = buildCustomerPreviewConfig(product, "http://127.0.0.1:62168");
  assert.equal(config.positions.length, 1);
  assert.equal(config.positions[0].name, "Front");
  assert.equal("previewNotice" in config, false, "translated preview copy stays out of the product domain model");
  const message = adminPreviewNoticeMessage(1, 3, createAdminTranslator().t);
  assert.match(message, /Artwork preview only/);
  assert.match(message, /1 of 3 placements are available/);
});

test("the customer preview config accommodates a 40-placement product", () => {
  const candidate = structuredClone(classic!);
  const source = candidate.positions[0];
  assert.ok(source);
  for (let index = candidate.positions.length; index < 40; index += 1) {
    candidate.positions.push({ ...structuredClone(source), id: `extra-${index}` });
  }
  assert.equal(configSchema.parse(candidate).positions.length, 40);
});

for (const collection of ["sizes", "colors", "views", "positions", "methods"] as const) {
  test(`duplicate ${collection} IDs reject`, () => {
    rejectChange(
      (config) =>
        (config[collection] as unknown[]).push(structuredClone(config[collection][0])),
      `${collection}.${classic![collection].length}.id`,
    );
  });
}

const invalidCases: [string, (config: import("../src/config").ProductConfig) => void, string][] = [
  [
    "empty methods",
    (config) => {
      config.methods = [];
    },
    "methods",
  ],
  [
    "no method at a placement",
    (config) => {
      config.positions[0].methodIds = [];
    },
    "positions.0.methodIds",
  ],
  [
    "unknown method",
    (config) => {
      config.positions[0].methodIds = ["missing"];
    },
    "positions.0.methodIds.0",
  ],
  [
    "unknown placement view",
    (config) => {
      config.positions[0].view = "missing";
    },
    "positions.0.view",
  ],
  [
    "missing photo view asset",
    (config) => {
      delete config.colors[0].images!.back;
    },
    "colors.0.images.back",
  ],
  [
    "missing all photo assets",
    (config) => {
      delete config.colors[0].images;
    },
    "colors.0.images.front",
  ],
  [
    "unknown photo view",
    (config) => {
      config.colors[0].images!.missing = "/missing.jpg";
    },
    "colors.0.images.missing",
  ],
  [
    "dimension and price mismatch",
    (config) => {
      config.positions[0].sizePrices.pop();
    },
    "positions.0.sizePrices",
  ],
  [
    "missing option availability",
    (config) => {
      Reflect.deleteProperty(config.colors[0], "availableSizeIds");
    },
    "colors.0.availableSizeIds",
  ],
  [
    "unknown available size",
    (config) => {
      config.colors[0].availableSizeIds = ["missing"];
    },
    "colors.0.availableSizeIds.0",
  ],
  [
    "duplicate available size",
    (config) => {
      config.colors[0].availableSizeIds = ["m", "m"];
    },
    "colors.0.availableSizeIds.1",
  ],
  [
    "colon in variant ID",
    (config) => {
      config.colors[0].id = "white:cream";
    },
    "colors.0.id",
  ],
  [
    "negative price",
    (config) => {
      config.basePrice = -1;
    },
    "basePrice",
  ],
  [
    "fractional cents",
    (config) => {
      config.positions[0].price = 750.5;
    },
    "positions.0.price",
  ],
  [
    "zero physical width",
    (config) => {
      config.positions[0].dimensions[0] = 0;
    },
    "positions.0.dimensions.0",
  ],
  [
    "out-of-range placement",
    (config) => {
      config.positions[0].x = 101;
    },
    "positions.0.x",
  ],
];
for (const [name, change, expectedPath] of invalidCases) {
  test(`${name} rejects with a useful field path`, () =>
    rejectChange(change, expectedPath));
}

test("size availability honors explicit restrictions and rejects unknown variants", () => {
  const candidate = structuredClone(classic!);
  candidate.colors[0].availableSizeIds = ["m"];
  const model = createProductModel(configSchema.parse(candidate));
  assert.equal(model.isSizeAvailable("white", "m"), true);
  assert.equal(model.isSizeAvailable("white", "s"), false);
  assert.equal(model.isSizeAvailable("black", "s"), true);
  assert.equal(model.isSizeAvailable("missing", "m"), false);
  assert.equal(model.isSizeAvailable("black", "missing"), false);
});

test("invalid print selections cannot silently produce a cart price", () => {
  const model = createProductModel(configSchema.parse(classic!));
  const front = model.initialPrint("front");
  assert.throws(() => model.printPrice({ ...front, size: -1 }));
  assert.throws(() => model.printPrice({ ...front, size: 99 }));
  assert.throws(() => model.printPrice({ ...front, method: "embroidery" }));
});

test("view IDs can be renamed without changing their illustration or geometry", () => {
  const candidate = structuredClone(classic!);
  const original = candidate.views[0];
  const oldId = original.id;
  original.id = "camera-angle-204";
  for (const position of candidate.positions) {
    if (position.view === oldId) position.view = original.id;
  }
  for (const color of candidate.colors) {
    color.images![original.id] = color.images![oldId];
    delete color.images![oldId];
  }
  const config = configSchema.parse(candidate);
  assert.equal(config.views[0].illustration, original.illustration);
  assert.equal(config.positions[0].view, original.id);
  assert.ok(
    createProductModel(config).imageFor(config.colors[0].id, original.id),
  );
});

test("the preview accepts 100 placements and rejects 101", () => {
  const candidate = structuredClone(classic!);
  candidate.positions = Array.from({ length: 100 }, (_, i) => ({
    ...candidate.positions[0],
    id: `position-${i}`,
  }));
  assert.equal(configSchema.safeParse(candidate).success, true);
  candidate.positions.push({ ...candidate.positions[0], id: "position-100" });
  assert.equal(configSchema.safeParse(candidate).success, false);
});

test("artwork later follows the individual placement policy with a product default", () => {
  const candidate = structuredClone(classic!);
  candidate.artworkLater = true;
  candidate.positions[0].artworkLater = false;
  candidate.positions[1].artworkLater = true;
  const model = createProductModel(configSchema.parse(candidate));
  assert.equal(model.canDeferArtwork(candidate.positions[0].id), false);
  assert.equal(model.canDeferArtwork(candidate.positions[1].id), true);
  assert.equal(model.canDeferArtwork(candidate.positions[2].id), true);
  candidate.artworkLater = false;
  const required = createProductModel(configSchema.parse(candidate));
  assert.equal(required.canDeferArtwork(candidate.positions[1].id), true);
  assert.equal(required.canDeferArtwork(candidate.positions[2].id), false);
});

test("photo products may omit garment defaults while illustration products require one", () => {
  const photoWithoutGarment = structuredClone(classic!);
  delete photoWithoutGarment.garment;
  assert.equal(configSchema.safeParse(photoWithoutGarment).success, true);

  const minimal = fixtures.find(({ config }) => config.id === "minimal")?.config;
  assert.ok(minimal);
  const illustrationWithoutGarment = structuredClone(minimal);
  delete illustrationWithoutGarment.garment;
  const parsed = configSchema.safeParse(illustrationWithoutGarment);
  assert.equal(parsed.success, false);
  assert.ok(
    parsed.error.issues.some((issue) => issue.path.join(".") === "garment"),
    "Illustration configs without a supported garment should identify the missing field.",
  );
});

test("phone-case schematic is a non-garment portrait fixture with an inset, camera-clear area", async () => {
  const phoneCase = fixtures.find(({ config }) => config.id === "phone-case")?.config;
  assert.ok(phoneCase);
  const config = configSchema.parse(phoneCase);
  assert.equal(config.preview, "photo");
  assert.equal(config.garment, undefined);
  assert.equal(config.productName, "Phone case");
  assert.equal(config.views.length, 1);
  assert.equal(config.views[0]?.label, "Back");

  const position = config.positions[0];
  assert.ok(position?.movementArea);
  assert.deepEqual(position.sizeLabels, ["Small", "Medium", "Large"]);
  assert.ok(position.movementArea.width < 60 && position.movementArea.height < 60);
  assert.ok(position.movementArea.x - position.movementArea.width / 2 > 25);
  assert.ok(position.movementArea.x + position.movementArea.width / 2 < 75);
  assert.ok(position.movementArea.y - position.movementArea.height / 2 > 30);
  assert.ok(position.movementArea.y + position.movementArea.height / 2 < 85);

  const imagePath = path.join(root, "public", config.colors[0].images!.back.slice(1));
  const svg = await readFile(imagePath, "utf8");
  const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  assert.ok(viewBox, "The fixture asset should declare a measurable portrait viewBox.");
  const imageAspect = Number(viewBox[1]) / Number(viewBox[2]);
  assert.equal(imageAspect, 0.6, "Use the actual 600 × 1000 schematic aspect ratio.");
  assert.deepEqual(availablePrintSizes(position, 0.5, imageAspect), [0, 1]);
  assert.deepEqual(availablePrintSizes(position, 300 / 180, imageAspect), [0, 1, 2]);

  const model = createProductModel(config);
  const print = model.initialPrint(position.id);
  assert.equal(model.printPrice({ ...print, size: 0 }), position.price + position.sizePrices[0]);
  assert.equal(model.printPrice({ ...print, size: 2 }), position.price + position.sizePrices[2]);
});

test("classic exposes customer movement only for left chest, without changing its priced size presets", () => {
  const config = configSchema.parse(classic!);
  const leftChest = config.positions.find(({ id }) => id === "left-chest");
  const rightChest = config.positions.find(({ id }) => id === "right-chest");
  assert.ok(leftChest?.movementArea);
  assert.equal(rightChest?.movementArea, undefined);
  assert.deepEqual(leftChest.dimensions, [10, 12, 15]);
  assert.deepEqual(leftChest.sizePrices, [0, 250, 500]);
  assert.deepEqual(leftChest.sizeLabels, ["Small", "Medium", "Large"]);
  assert.equal(leftChest.movementArea.x, 63);
  assert.equal(leftChest.movementArea.y, 28);
  assert.equal(printSizeLabel(leftChest, 0), "Small");
  assert.equal(printSizeLabel(leftChest, 2), "Large");
  assert.equal(
    printSizeLabel(config.positions.find(({ id }) => id === "right-chest")!, 0),
    "10 cm",
  );
});

test("movement areas use a center and full image-space extents and stay inside the image", () => {
  rejectChange((config) => {
    config.positions[0].movementArea = {
      x: 90,
      y: 50,
      width: 30,
      height: 20,
    };
  }, "positions.0.movementArea");
  rejectChange((config) => {
    config.positions[0].movementArea = {
      x: 50,
      y: 50,
      width: 0,
      height: 20,
    };
  }, "positions.0.movementArea.width");
});

test("relative size labels must be present for every priced size and contain readable text", () => {
  rejectChange((config) => {
    config.positions[0].sizeLabels = ["Small", "Large"];
  }, "positions.0.sizeLabels");
  rejectChange((config) => {
    config.positions[0].sizeLabels = ["Small", " ", "Large"];
  }, "positions.0.sizeLabels.1");
});

test("custom center is kept per print and omission resolves to the merchant default", () => {
  const leftChest = configSchema.parse(classic!).positions[0];
  const baseline: import("../src/model").Print = { id: leftChest.id, artworkId: "north", size: 1, method: "print" };
  assert.deepEqual(resolvePrintCenter(leftChest, baseline), { x: 63, y: 28 });
  assert.deepEqual(
    resolvePrintCenter(leftChest, { ...baseline, position: { x: 68, y: 31 } }),
    { x: 68, y: 31 },
  );
  assert.equal(
    createProductModel(configSchema.parse(classic!)).printPrice({
      ...baseline,
      position: { x: 68, y: 31 },
    }),
    createProductModel(configSchema.parse(classic!)).printPrice(baseline),
  );
});

test("artwork footprints account for both artwork and source-image aspect ratios", () => {
  assert.deepEqual(
    artworkFootprint({ x: 50, y: 50 }, 20, 2, 0.75),
    { x: 40, y: 46.25, width: 20, height: 7.5 },
  );
  assert.deepEqual(
    artworkFootprint({ x: 50, y: 50 }, 20, 0.5, 1),
    { x: 40, y: 30, width: 20, height: 40 },
  );
  assert.equal(artworkFootprint({ x: 50, y: 50 }, 20, 0, 1), null);
});

test("movement clamps the whole artwork footprint and rejects presets that cannot fit", () => {
  const area = { x: 63, y: 28, width: 32, height: 28 };
  assert.deepEqual(
    clampArtworkCenter({ x: 99, y: 0 }, area, 15, 0.9375, 1),
    { x: 71.5, y: 22 },
  );
  assert.equal(isArtworkCenterAllowed({ x: 63, y: 28 }, area, 15, 0.9375, 1), true);
  assert.equal(isArtworkCenterAllowed({ x: 79, y: 28 }, area, 15, 0.9375, 1), false);
  assert.equal(clampArtworkCenter({ x: 63, y: 28 }, area, 30, 0.5, 1), null);
});

test("available print sizes follow the complete artwork footprint without changing their prices", () => {
  const leftChest = configSchema.parse(classic!).positions[0];
  assert.deepEqual(availablePrintSizes(leftChest, 0.9375, 1), [0, 1, 2]);
  const narrow = {
    ...leftChest,
    movementArea: { ...leftChest.movementArea!, width: 12, height: 14 },
  };
  assert.deepEqual(availablePrintSizes(narrow, 0.9375, 1), [0, 1]);
  const immovable = { ...leftChest, movementArea: undefined };
  assert.deepEqual(availablePrintSizes(immovable, 0.9375, 1), []);
  assert.equal(printWidthPercent(leftChest, 2), 15);
});

test("shared custom positions satisfy every selected garment image aspect ratio", () => {
  const area = { x: 63, y: 28, width: 32, height: 28 };
  const selectedImageAspects = [0.8, 1.2];
  assert.deepEqual(
    clampArtworkCenterForImages(
      { x: 63, y: 40 },
      area,
      15,
      1,
      selectedImageAspects,
    ),
    { x: 63, y: 33 },
  );
  assert.equal(
    isArtworkCenterAllowedForImages(
      { x: 63, y: 28 }, area, 15, 1, selectedImageAspects,
    ),
    true,
  );
  assert.equal(
    isArtworkCenterAllowedForImages(
      { x: 63, y: 40 }, area, 15, 1, selectedImageAspects,
    ),
    false,
  );
  assert.equal(
    clampArtworkCenterForImages({ x: 63, y: 28 }, area, 15, 0.5, [0.8, 2]),
    null,
  );
  const leftChest = configSchema.parse(classic!).positions[0];
  assert.deepEqual(
    availablePrintSizesForImages(leftChest, 0.5, selectedImageAspects),
    [0],
  );
  assert.deepEqual(
    availablePrintSizesForImages(leftChest, 0.9375, selectedImageAspects),
    [0, 1, 2],
  );
  assert.equal(
    availablePrintSizesForImages(leftChest, 0.9375, [] ).length,
    0,
    "unknown selected image dimensions must fail closed",
  );
});

test("unknown illustration angles reject rather than silently changing the preview", () => {
  rejectChange((config) => {
    Reflect.set(config.views[0], "illustration", "diagonal");
  }, "views.0.illustration");
});

test("duplicate artwork widths reject instead of creating ambiguous options", () => {
  rejectChange((config) => {
    config.positions[0].dimensions[1] = config.positions[0].dimensions[0];
  }, "positions.0.dimensions");
});

test("all twelve configured widths retain independent prices", () => {
  const widths = fixtures.find(
    ({ config }) => config.id === "many-widths",
  )?.config;
  assert.ok(widths);
  const config = configSchema.parse(widths);
  const model = createProductModel(config);
  const position = config.positions[0];
  assert.equal(position.dimensions.length, 12);
  const print = model.initialPrint(position.id);
  position.dimensions.forEach((_, size) => {
    assert.equal(
      model.printPrice({ ...print, size }),
      position.price + position.sizePrices[size],
    );
  });
});

test("colour search ignores accents, repeated spaces and letter case", () => {
  const palette = fixtures.find(
    ({ config }) => config.id === "large-palette",
  )!.config;
  assert.equal(
    filterColors(palette.colors, "  CREME   rose  ", palette.locale)[0].name,
    "Crème rose",
  );
});

test("colour search matches words in any order and preserves merchant ordering", () => {
  const palette = fixtures.find(
    ({ config }) => config.id === "large-palette",
  )!.config;
  assert.equal(
    filterColors(palette.colors, "blue royal", palette.locale)[0].name,
    "Royal blue",
  );
  assert.deepEqual(
    filterColors(palette.colors, "   ", palette.locale),
    palette.colors,
  );
  assert.deepEqual(
    filterColors(palette.colors, "no-such-colour", palette.locale),
    [],
  );
});

test("quantities reject fractions, negatives, non-finite values and over-limit counts", () => {
  for (const value of [
    -1,
    0.5,
    1000,
    Number.NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.equal(isValidQuantity(value, 999), false);
  }
  for (const value of [0, 1, 120, 999])
    assert.equal(isValidQuantity(value, 999), true);
});


test("unknown option semantics use named generic choices without fabricated swatches", () => {
  const candidate = structuredClone(classic!);
  delete candidate.optionPresentation;
  for (const row of candidate.colors) delete row.hex;
  const config = configSchema.parse(candidate);
  assert.equal(config.colors[0].hex, undefined);
  assert.deepEqual(resolveOptionPresentation(config.optionPresentation), {
    rowOption: { label: "Option", display: "named-choice" },
    columnOption: { label: "Option",},
  });
});

test("explicitly empty availability offers no options instead of assuming every combination", () => {
  const candidate = structuredClone(classic!);
  candidate.colors[0].availableSizeIds = [];
  const model = createProductModel(configSchema.parse(candidate));
  assert.equal(model.isSizeAvailable(candidate.colors[0].id, candidate.sizes[0].id), false);
});

test("exact option labels are retained without singularization or title casing", () => {
  const candidate = structuredClone(classic!);
  candidate.optionPresentation = {
    rowOption: { label: "eSIM / Maat", display: "named-choice" },
    columnOption: { label: "Storage (GB)",},
  };
  const resolved = resolveOptionPresentation(configSchema.parse(candidate).optionPresentation);
  assert.equal(resolved.rowOption.label, "eSIM / Maat");
  assert.equal(resolved.columnOption.label, "Storage (GB)");
});
