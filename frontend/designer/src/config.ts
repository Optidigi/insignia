import { z } from "zod";

const id = z
  .string()
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
    "Use letters, numbers, underscores or hyphens, with no colons.",
  );
const label = z.string().trim().min(1);
const cents = z.number().int().nonnegative();
const percent = z.number().min(0).max(100);
const movementArea = z
  .strictObject({
    x: percent,
    y: percent,
    width: z.number().positive().max(100),
    height: z.number().positive().max(100),
  })
  .refine(
    ({ x, y, width, height }) =>
      x - width / 2 >= 0 &&
      x + width / 2 <= 100 &&
      y - height / 2 >= 0 &&
      y + height / 2 <= 100,
    "The movement area must fit inside the preview image.",
  );

export const configSchema = z
  .strictObject({
    id,
    name: label,
    description: label,
    storeName: label,
    productName: label,
    productDescription: label,
    artworkOnly: z.boolean().optional(),
    optionPresentation: z
      .strictObject({
        rowOption: z.strictObject({
          label: label,
          display: z.enum(["swatch", "named-choice"]),
          labelSource: z.literal("generic-selection").optional(),
        }),
        columnOption: z.strictObject({
          label: label,
        }),
      })
      .optional(),
    basePrice: cents,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, "Use a three-letter currency code."),
    locale: label,
    garment: z.enum(["tshirt", "hoodie", "polo", "apron"]).optional(),
    preview: z.enum(["photo", "illustration"]),
    maxQuantity: z.number().int().positive(),
    artworkLater: z.boolean(),
    sizes: z.array(z.strictObject({ id, label })).min(1),
    colors: z
      .array(
        z.strictObject({
          id,
          name: label,
          nameSource: z.enum(["generic-selection", "admin-preview-product-image"]).optional(),
          hex: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour.")
            .optional(),
          images: z.record(id, label).optional(),
          availableSizeIds: z.array(id),
        }),
      )
      .min(1),
    variantMatrix: z.array(z.strictObject({
      rowId: id,
      columnId: id,
      variantId: z.string().regex(/^[1-9][0-9]{0,19}$/),
      available: z.boolean(),
    })).max(250).optional(),
    views: z
      .array(
        z.strictObject({
          id,
          label,
          illustration: z
            .enum(["front", "back", "left", "right"])
            .default("front"),
        }),
      )
      .min(1),
    positions: z
      .array(
        z.strictObject({
          id,
          name: label,
          view: id,
          x: percent,
          y: percent,
          width: z.number().positive().max(100),
          movementArea: movementArea.optional(),
          maximumHeight: z.number().positive().max(100).optional(),
          sizeLabels: z.array(label).optional(),
          price: cents,
          dimensions: z.array(z.number().positive()).min(1),
          sizePrices: z.array(cents).min(1),
          methodSizePrices: z.record(id, z.array(cents.nullable()).min(1)).optional(),
          methodIds: z.array(id).min(1),
          artworkLater: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(100),
    methods: z.array(z.strictObject({ id, label, surcharge: cents })).min(1),
  })
  .superRefine((config, ctx) => {
    function issue(path: (string | number)[], message: string) {
      ctx.addIssue({ code: "custom", path, message });
    }
    for (const key of [
      "sizes",
      "colors",
      "views",
      "positions",
      "methods",
    ] as const) {
      const seen = new Set<string>();
      config[key].forEach((entry, index) => {
        if (seen.has(entry.id))
          issue([key, index, "id"], `Duplicate ID: ${entry.id}`);
        seen.add(entry.id);
      });
    }
    const sizeIds = new Set(config.sizes.map((size) => size.id));
    const viewIds = new Set(config.views.map((view) => view.id));
    const methodIds = new Set(config.methods.map((method) => method.id));
    if (config.preview === "illustration" && !config.garment) {
      issue(
        ["garment"],
        "Illustration previews require a supported garment type.",
      );
    }
    config.positions.forEach((position, index) => {
      if (!viewIds.has(position.view))
        issue(["positions", index, "view"], `Unknown view: ${position.view}`);
      if (
        position.movementArea &&
        (Math.abs(position.x - position.movementArea.x) >
          position.movementArea.width / 2 ||
          Math.abs(position.y - position.movementArea.y) >
            position.movementArea.height / 2)
      ) {
        issue(
          ["positions", index, "movementArea"],
          "The merchant's default artwork position must be inside the movement area.",
        );
      }
      if (
        position.sizeLabels &&
        position.sizeLabels.length !== position.dimensions.length
      ) {
        issue(
          ["positions", index, "sizeLabels"],
          "Provide one display label for each priced print size.",
        );
      }
      if (position.dimensions.length !== position.sizePrices.length) {
        issue(
          ["positions", index, "sizePrices"],
          "Provide one size price for each dimension.",
        );
      }
      if (position.maximumHeight !== undefined && position.maximumHeight <= 0) {
        issue(["positions", index, "maximumHeight"], "Provide a positive maximum artwork height.");
      }
      if (position.methodSizePrices) {
        for (const methodId of position.methodIds) {
          const prices = position.methodSizePrices[methodId];
          if (!prices) {
            issue(
              ["positions", index, "methodSizePrices", methodId],
              `Provide prices for method ${methodId}.`,
            );
            continue;
          }
          if (prices.length !== position.dimensions.length) {
            issue(
              ["positions", index, "methodSizePrices", methodId],
              "Provide one price or unavailable value for each print size.",
            );
          }
          if (!prices.some((price) => price !== null)) {
            issue(
              ["positions", index, "methodSizePrices", methodId],
              "A method must have at least one available print size.",
            );
          }
        }
      }
      if (new Set(position.dimensions).size !== position.dimensions.length) {
        issue(
          ["positions", index, "dimensions"],
          "Each artwork width must be unique.",
        );
      }
      const seen = new Set<string>();
      position.methodIds.forEach((methodId, methodIndex) => {
        if (!methodIds.has(methodId))
          issue(
            ["positions", index, "methodIds", methodIndex],
            `Unknown method: ${methodId}`,
          );
        if (seen.has(methodId))
          issue(
            ["positions", index, "methodIds", methodIndex],
            `Duplicate method: ${methodId}`,
          );
        seen.add(methodId);
      });
      for (const methodId of Object.keys(position.methodSizePrices ?? {})) {
        if (!position.methodIds.includes(methodId)) {
          issue(
            ["positions", index, "methodSizePrices", methodId],
            `Unknown position method: ${methodId}`,
          );
        }
      }
    });
    const matrixIds = new Set<string>();
    const matrixCells = new Set<string>();
    config.variantMatrix?.forEach((variant, index) => {
      const key = `${variant.rowId}:${variant.columnId}`;
      if (!config.colors.some((row) => row.id === variant.rowId) || !sizeIds.has(variant.columnId))
        issue(["variantMatrix", index], "Match this variant to existing option values.");
      if (matrixIds.has(variant.variantId) || matrixCells.has(key))
        issue(["variantMatrix", index], "Each variant and option combination must be unique.");
      matrixIds.add(variant.variantId);
      matrixCells.add(key);
    });
    config.colors.forEach((color, index) => {
      if (config.variantMatrix) {
        const available = new Set(config.variantMatrix.filter((cell) => cell.rowId === color.id && cell.available).map((cell) => cell.columnId));
        if (available.size !== color.availableSizeIds.length || color.availableSizeIds.some((value) => !available.has(value)))
          issue(["colors", index, "availableSizeIds"], "Availability must match the supplied Shopify variants.");
      }
      const seen = new Set<string>();
      color.availableSizeIds?.forEach((sizeId, sizeIndex) => {
        if (!sizeIds.has(sizeId))
          issue(
            ["colors", index, "availableSizeIds", sizeIndex],
            `Unknown size: ${sizeId}`,
          );
        if (seen.has(sizeId))
          issue(
            ["colors", index, "availableSizeIds", sizeIndex],
            `Duplicate size: ${sizeId}`,
          );
        seen.add(sizeId);
      });
      for (const viewId of Object.keys(color.images ?? {})) {
        if (!viewIds.has(viewId))
          issue(["colors", index, "images", viewId], `Unknown view: ${viewId}`);
      }
      if (config.preview === "photo") {
        for (const view of config.views) {
          if (!color.images?.[view.id])
            issue(
              ["colors", index, "images", view.id],
              "Photo previews need an image for every view.",
            );
        }
      }
    });
    try {
      new Intl.NumberFormat(config.locale, {
        style: "currency",
        currency: config.currency,
      });
    } catch {
      issue(
        ["locale"],
        "Provide a valid locale and currency for price formatting.",
      );
    }
  });

export type ProductConfig = z.infer<typeof configSchema>;
