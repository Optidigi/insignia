// app/lib/services/__tests__/storefront-config.server.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted db mock
// ---------------------------------------------------------------------------
const prismaMock = vi.hoisted(() => {
  const makeFn = () => vi.fn();
  return {
    productConfig: {
      findFirst: makeFn(),
    },
    variantViewConfiguration: {
      findMany: makeFn(),
    },
    shop: {
      findUnique: makeFn(),
    },
    merchantSettings: {
      findUnique: makeFn(),
    },
  };
});

vi.mock("../../../db.server", () => ({
  default: prismaMock,
}));

vi.mock("../../storage.server", () => ({
  getPresignedGetUrl: vi.fn().mockResolvedValue("https://cdn.example.com/signed-image.png"),
}));

vi.mock("../settings.server", () => ({
  getMerchantSettings: vi.fn().mockResolvedValue({
    placeholderLogoImageUrl: null,
  }),
}));

// Static imports after mocks
import { getStorefrontConfig } from "../storefront-config.server";
import { ErrorCodes } from "../../errors.server";
import { getMerchantSettings } from "../settings.server";
import { getPresignedGetUrl } from "../../storage.server";

beforeEach(() => {
  vi.resetAllMocks();
  // Restore default mocks
  vi.mocked(getMerchantSettings).mockResolvedValue({
    placeholderLogoImageUrl: null,
  } as never);
  vi.mocked(getPresignedGetUrl).mockResolvedValue(
    "https://cdn.example.com/signed-image.png"
  );
});

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const MOCK_PLACEMENT = {
  id: "placement-chest",
  name: "Chest",
  basePriceAdjustmentCents: 200,
  hidePriceWhenZero: false,
  defaultStepIndex: 0,
  displayOrder: 0,
  methodPriceOverrides: [] as Array<{
    decorationMethodId: string;
    basePriceAdjustmentCents: number;
  }>,
  steps: [
    {
      id: "step-small",
      label: "Small",
      priceAdjustmentCents: 0,
      scaleFactor: 0.5,
      displayOrder: 0,
    },
    {
      id: "step-large",
      label: "Large",
      priceAdjustmentCents: 300,
      scaleFactor: 1.0,
      displayOrder: 1,
    },
  ],
};

const MOCK_VIEW_FRONT = {
  id: "view-front",
  perspective: "front",
  displayOrder: 0,
  defaultImageKey: "shops/s1/views/front.png",
  sharedZones: true,
  placementGeometry: {
    "placement-chest": {
      centerXPercent: 50,
      centerYPercent: 30,
      maxWidthPercent: 40,
    },
  },
  placements: [MOCK_PLACEMENT],
};

const MOCK_VIEW_BACK = {
  id: "view-back",
  perspective: "back",
  displayOrder: 1,
  defaultImageKey: null, // missing image
  sharedZones: true,
  placementGeometry: {},
  placements: [],
};

const MOCK_METHOD = {
  basePriceCentsOverride: null,
  decorationMethod: {
    id: "method-1",
    name: "Screen Print",
    basePriceCents: 1000,
    hidePriceWhenZero: false,
    customerName: "Screen Printing",
    customerDescription: "Vibrant colors",
    description: "Internal desc",
    artworkConstraints: {
      fileTypes: ["png", "svg"],
      maxColors: 6,
      minDpi: 300,
    },
  },
};

function makeProductConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: "config-1",
    shopId: "shop-1",
    linkedProductIds: ["gid://shopify/Product/100"],
    views: [MOCK_VIEW_FRONT, MOCK_VIEW_BACK],
    allowedMethods: [MOCK_METHOD],
    ...overrides,
  };
}

function makeRunGraphql() {
  return vi.fn().mockResolvedValue({
    json: vi.fn().mockResolvedValue({
      data: {
        productVariant: {
          price: "29.99",
          product: { title: "Classic Tee" },
        },
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getStorefrontConfig", () => {
  it("returns full config shape with views, methods, placements for a product/variant", async () => {
    prismaMock.productConfig.findFirst.mockResolvedValue(makeProductConfig());
    prismaMock.variantViewConfiguration.findMany.mockResolvedValue([]);
    prismaMock.shop.findUnique.mockResolvedValue({ currencyCode: "USD" });

    const runGraphql = makeRunGraphql();

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      runGraphql
    );

    expect(result.productConfigId).toBe("config-1");
    expect(result.shop).toBe("test.myshopify.com");
    expect(result.productId).toBe("gid://shopify/Product/100");
    expect(result.variantId).toBe("gid://shopify/ProductVariant/200");
    expect(result.currency).toBe("USD");
    expect(result.baseProductPriceCents).toBe(2999);
    expect(result.productTitle).toBe("Classic Tee");

    // Views
    expect(result.views).toHaveLength(2);
    expect(result.views[0].perspective).toBe("front");

    // Methods
    expect(result.methods).toHaveLength(1);
    expect(result.methods[0].name).toBe("Screen Print");
    expect(result.methods[0].basePriceCents).toBe(1000);
    expect(result.methods[0].customerName).toBe("Screen Printing");

    // Placements
    expect(result.placements).toHaveLength(1);
    expect(result.placements[0].name).toBe("Chest");
    expect(result.placements[0].steps).toHaveLength(2);
  });

  it("uses basePriceCentsOverride when set on allowedMethods row", async () => {
    const methodWithOverride = {
      ...MOCK_METHOD,
      basePriceCentsOverride: 500,
    };
    prismaMock.productConfig.findFirst.mockResolvedValue(
      makeProductConfig({ allowedMethods: [methodWithOverride] })
    );
    prismaMock.variantViewConfiguration.findMany.mockResolvedValue([]);
    prismaMock.shop.findUnique.mockResolvedValue({ currencyCode: "USD" });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      makeRunGraphql()
    );

    // Override (500) should supersede method base (1000)
    expect(result.methods[0].basePriceCents).toBe(500);
  });

  it("inherits method basePriceCents when override is null", async () => {
    prismaMock.productConfig.findFirst.mockResolvedValue(makeProductConfig());
    prismaMock.variantViewConfiguration.findMany.mockResolvedValue([]);
    prismaMock.shop.findUnique.mockResolvedValue({ currencyCode: "USD" });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      makeRunGraphql()
    );

    // null override → inherit method base of 1000
    expect(result.methods[0].basePriceCents).toBe(1000);
  });

  it("placement without overrides has no pricePerMethod key", async () => {
    prismaMock.productConfig.findFirst.mockResolvedValue(makeProductConfig());
    prismaMock.variantViewConfiguration.findMany.mockResolvedValue([]);
    prismaMock.shop.findUnique.mockResolvedValue({ currencyCode: "USD" });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      makeRunGraphql()
    );

    expect(result.placements[0]).not.toHaveProperty("pricePerMethod");
  });

  it("placement with override for one method surfaces it via pricePerMethod", async () => {
    const placementWithOverride = {
      ...MOCK_PLACEMENT,
      methodPriceOverrides: [
        { decorationMethodId: "method-1", basePriceAdjustmentCents: 450 },
      ],
    };
    const viewWithOverride = {
      ...MOCK_VIEW_FRONT,
      placements: [placementWithOverride],
    };

    prismaMock.productConfig.findFirst.mockResolvedValue(
      makeProductConfig({ views: [viewWithOverride, MOCK_VIEW_BACK] })
    );
    prismaMock.variantViewConfiguration.findMany.mockResolvedValue([]);
    prismaMock.shop.findUnique.mockResolvedValue({ currencyCode: "USD" });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      makeRunGraphql()
    );

    expect(result.placements[0].pricePerMethod).toEqual({
      "method-1": 450,
    });
  });

  it("placement with overrides for multiple methods surfaces all of them", async () => {
    const placementWithOverrides = {
      ...MOCK_PLACEMENT,
      methodPriceOverrides: [
        { decorationMethodId: "method-1", basePriceAdjustmentCents: 450 },
        { decorationMethodId: "method-2", basePriceAdjustmentCents: 900 },
      ],
    };
    const viewWithOverrides = {
      ...MOCK_VIEW_FRONT,
      placements: [placementWithOverrides],
    };

    prismaMock.productConfig.findFirst.mockResolvedValue(
      makeProductConfig({ views: [viewWithOverrides, MOCK_VIEW_BACK] })
    );
    prismaMock.variantViewConfiguration.findMany.mockResolvedValue([]);
    prismaMock.shop.findUnique.mockResolvedValue({ currencyCode: "USD" });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      makeRunGraphql()
    );

    expect(result.placements[0].pricePerMethod).toEqual({
      "method-1": 450,
      "method-2": 900,
    });
  });

  it("resolves shared zone geometry from view-level placementGeometry", async () => {
    prismaMock.productConfig.findFirst.mockResolvedValue(makeProductConfig());
    prismaMock.variantViewConfiguration.findMany.mockResolvedValue([]);
    prismaMock.shop.findUnique.mockResolvedValue({ currencyCode: "USD" });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      makeRunGraphql()
    );

    // Front view has geometry for placement-chest (shared zone)
    const frontGeom = result.placements[0].geometryByViewId["view-front"];
    expect(frontGeom).toEqual({
      centerXPercent: 50,
      centerYPercent: 30,
      maxWidthPercent: 40,
      maxHeightPercent: null,
    });
  });

  it("prefers variant-specific geometry over view-level when sharedZones is off", async () => {
    const viewWithNonShared = {
      ...MOCK_VIEW_FRONT,
      sharedZones: false,
      placementGeometry: {
        "placement-chest": {
          centerXPercent: 50,
          centerYPercent: 30,
          maxWidthPercent: 40,
        },
      },
      placements: [MOCK_PLACEMENT],
    };

    prismaMock.productConfig.findFirst.mockResolvedValue(
      makeProductConfig({ views: [viewWithNonShared] })
    );

    // Variant-specific geometry overrides
    prismaMock.variantViewConfiguration.findMany.mockResolvedValue([
      {
        viewId: "view-front",
        imageUrl: null,
        productView: viewWithNonShared,
        placementGeometry: {
          "placement-chest": {
            centerXPercent: 55,
            centerYPercent: 35,
            maxWidthPercent: 45,
          },
        },
      },
    ]);
    prismaMock.shop.findUnique.mockResolvedValue({ currencyCode: "USD" });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      makeRunGraphql()
    );

    // Variant-level should win when sharedZones is false
    const frontGeom = result.placements[0].geometryByViewId["view-front"];
    expect(frontGeom).toEqual({
      centerXPercent: 55,
      centerYPercent: 35,
      maxWidthPercent: 45,
      maxHeightPercent: null,
    });
  });

  it("sets isMissingImage when view has no image key and no variant override", async () => {
    vi.mocked(getPresignedGetUrl).mockRejectedValue(new Error("not found"));

    const backViewWithPlacement = { ...MOCK_VIEW_BACK, placements: [MOCK_PLACEMENT] };
    prismaMock.productConfig.findFirst.mockResolvedValue(
      makeProductConfig({ views: [backViewWithPlacement] })
    );
    prismaMock.variantViewConfiguration.findMany.mockResolvedValue([]);
    prismaMock.shop.findUnique.mockResolvedValue({ currencyCode: "USD" });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      makeRunGraphql()
    );

    expect(result.views[0].isMissingImage).toBe(true);
    expect(result.views[0].imageUrl).toBeNull();
  });

  it("returns null geometry for placements with no geometry data on a view", async () => {
    prismaMock.productConfig.findFirst.mockResolvedValue(makeProductConfig());
    prismaMock.variantViewConfiguration.findMany.mockResolvedValue([]);
    prismaMock.shop.findUnique.mockResolvedValue({ currencyCode: "USD" });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      makeRunGraphql()
    );

    // Back view has no geometry for placement-chest
    const backGeom = result.placements[0].geometryByViewId["view-back"];
    expect(backGeom).toBeNull();
  });

  it("returns currency from shop record", async () => {
    prismaMock.productConfig.findFirst.mockResolvedValue(makeProductConfig());
    prismaMock.variantViewConfiguration.findMany.mockResolvedValue([]);
    prismaMock.shop.findUnique.mockResolvedValue({ currencyCode: "CAD" });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      makeRunGraphql()
    );

    expect(result.currency).toBe("CAD");
  });

  it("returns empty string currency when shop has no currencyCode", async () => {
    prismaMock.productConfig.findFirst.mockResolvedValue(makeProductConfig());
    prismaMock.variantViewConfiguration.findMany.mockResolvedValue([]);
    prismaMock.shop.findUnique.mockResolvedValue(null);

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      makeRunGraphql()
    );

    expect(result.currency).toBe("");
  });

  it("throws NOT_FOUND when no product config links this product", async () => {
    prismaMock.productConfig.findFirst.mockResolvedValue(null);

    await expect(
      getStorefrontConfig(
        "shop-1",
        "test.myshopify.com",
        "gid://shopify/Product/999",
        "gid://shopify/ProductVariant/999"
      )
    ).rejects.toMatchObject({
      code: ErrorCodes.NOT_FOUND,
    });
  });

  it("throws INVALID_CONFIG when config has no decoration methods", async () => {
    prismaMock.productConfig.findFirst.mockResolvedValue(
      makeProductConfig({ allowedMethods: [] })
    );

    await expect(
      getStorefrontConfig(
        "shop-1",
        "test.myshopify.com",
        "gid://shopify/Product/100",
        "gid://shopify/ProductVariant/200"
      )
    ).rejects.toMatchObject({
      code: ErrorCodes.INVALID_CONFIG,
    });
  });

  it("throws INVALID_CONFIG when config has no placements", async () => {
    const viewsWithNoPlacements = [
      { ...MOCK_VIEW_FRONT, placements: [] },
      { ...MOCK_VIEW_BACK, placements: [] },
    ];
    prismaMock.productConfig.findFirst.mockResolvedValue(
      makeProductConfig({ views: viewsWithNoPlacements })
    );

    await expect(
      getStorefrontConfig(
        "shop-1",
        "test.myshopify.com",
        "gid://shopify/Product/100",
        "gid://shopify/ProductVariant/200"
      )
    ).rejects.toMatchObject({
      code: ErrorCodes.INVALID_CONFIG,
    });
  });

  // ---------------------------------------------------------------------------
  // variantAxis detection
  // ---------------------------------------------------------------------------

  it("detects variantAxis:'size' for a size+color product", async () => {
    prismaMock.productConfig.findFirst.mockResolvedValue(makeProductConfig());
    prismaMock.variantViewConfiguration.findMany.mockResolvedValue([]);
    prismaMock.shop.findUnique.mockResolvedValue({ currencyCode: "USD" });

    const runGraphql = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        data: {
          productVariant: {
            price: "29.99",
            product: {
              title: "Classic Tee",
              variants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/200",
                    title: "S / Black",
                    price: "29.99",
                    availableForSale: true,
                    selectedOptions: [
                      { name: "Size", value: "S" },
                      { name: "Color", value: "Black" },
                    ],
                  },
                  {
                    id: "gid://shopify/ProductVariant/201",
                    title: "M / Black",
                    price: "29.99",
                    availableForSale: true,
                    selectedOptions: [
                      { name: "Size", value: "M" },
                      { name: "Color", value: "Black" },
                    ],
                  },
                ],
              },
            },
          },
        },
      }),
    });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      runGraphql
    );

    expect(result.variantAxis).toBe("size");
    // Variants are filtered to those matching the non-size options (Color=Black)
    expect(result.variants.length).toBeGreaterThanOrEqual(1);
  });

  it("detects variantAxis:'color' for a color-only product", async () => {
    prismaMock.productConfig.findFirst.mockResolvedValue(makeProductConfig());
    prismaMock.variantViewConfiguration.findMany.mockResolvedValue([]);
    prismaMock.shop.findUnique.mockResolvedValue({ currencyCode: "USD" });

    const runGraphql = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        data: {
          productVariant: {
            price: "29.99",
            product: {
              title: "Logo Cap",
              variants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/300",
                    title: "Black",
                    price: "29.99",
                    availableForSale: true,
                    selectedOptions: [{ name: "Color", value: "Black" }],
                  },
                  {
                    id: "gid://shopify/ProductVariant/301",
                    title: "Red",
                    price: "29.99",
                    availableForSale: true,
                    selectedOptions: [{ name: "Color", value: "Red" }],
                  },
                ],
              },
            },
          },
        },
      }),
    });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/300",
      runGraphql
    );

    expect(result.variantAxis).toBe("color");
    // All variants returned (no size-axis filtering)
    expect(result.variants).toHaveLength(2);
  });

  it("detects variantAxis:'option' for a single-variant default product", async () => {
    prismaMock.productConfig.findFirst.mockResolvedValue(makeProductConfig());
    prismaMock.variantViewConfiguration.findMany.mockResolvedValue([]);
    prismaMock.shop.findUnique.mockResolvedValue({ currencyCode: "USD" });

    const runGraphql = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        data: {
          productVariant: {
            price: "29.99",
            product: {
              title: "Custom Item",
              variants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/400",
                    title: "Default Title",
                    price: "29.99",
                    availableForSale: true,
                    selectedOptions: [{ name: "Title", value: "Default Title" }],
                  },
                ],
              },
            },
          },
        },
      }),
    });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/400",
      runGraphql
    );

    expect(result.variantAxis).toBe("option");
    // All variants returned
    expect(result.variants).toHaveLength(1);
  });
});
