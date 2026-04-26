// app/lib/services/__tests__/storefront-config.color-fallback.test.ts
//
// Tests for the view-image-orphan-fix color-group fallback in
// `getStorefrontConfig`. When a customer selects a variant whose own
// VariantViewConfiguration row has no imageUrl (or no row at all) for a given
// view, we fall back to the earliest-uploaded same-color sibling's image.
//
// CRITICAL — MF-1 regression guard: the test
// "Both size AND color axes present — fallback fires" exercises the exact
// shape of the merchant we're fixing for (Stitchs: Size × Color products).
// If color detection is gated behind `!sizeOptionName` again, that test will
// fail.
import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted prisma mock
// ---------------------------------------------------------------------------
const prismaMock = vi.hoisted(() => ({
  productConfig: {
    findFirst: vi.fn(),
  },
  variantViewConfiguration: {
    findMany: vi.fn(),
  },
  shop: {
    findUnique: vi.fn(),
  },
  designFeeCategory: {
    findMany: vi.fn(),
  },
}));

vi.mock("../../../db.server", () => ({
  default: prismaMock,
}));

// Stub presigned-url generation to a deterministic, key-encoded URL so tests
// can assert which storage key the storefront resolved to.
vi.mock("../../storage.server", () => ({
  getPresignedGetUrl: vi.fn((key: string) => Promise.resolve(`signed::${key}`)),
}));

vi.mock("../settings.server", () => ({
  getMerchantSettings: vi.fn().mockResolvedValue({ placeholderLogoImageUrl: null }),
}));

// Static imports after mocks
import { getStorefrontConfig } from "../storefront-config.server";
import { getPresignedGetUrl } from "../../storage.server";
import { getMerchantSettings } from "../settings.server";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const VIEW_FRONT = {
  id: "view-front",
  perspective: "front",
  displayOrder: 0,
  defaultImageKey: null,
  sharedZones: true,
  placementGeometry: {},
  placements: [
    {
      id: "placement-chest",
      name: "Chest",
      basePriceAdjustmentCents: 0,
      hidePriceWhenZero: false,
      defaultStepIndex: 0,
      displayOrder: 0,
      methodPriceOverrides: [] as Array<{
        decorationMethodId: string;
        basePriceAdjustmentCents: number;
      }>,
      steps: [],
    },
  ],
};

const VIEW_BACK = {
  id: "view-back",
  perspective: "back",
  displayOrder: 1,
  defaultImageKey: null,
  sharedZones: true,
  placementGeometry: {},
  // No placement on back — that's fine; the front view satisfies the
  // "must have at least one placement" config check.
  placements: [],
};

const METHOD = {
  basePriceCentsOverride: null,
  decorationMethod: {
    id: "method-1",
    name: "Screen Print",
    basePriceCents: 0,
    hidePriceWhenZero: false,
    customerName: null,
    customerDescription: null,
    description: null,
    artworkConstraints: null,
  },
};

function makeProductConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: "config-1",
    shopId: "shop-1",
    linkedProductIds: ["gid://shopify/Product/100"],
    views: [VIEW_FRONT, VIEW_BACK],
    allowedMethods: [METHOD],
    ...overrides,
  };
}

type Variant = {
  id: string;
  title: string;
  price: string;
  availableForSale: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
};

function runGraphqlReturning(variants: Variant[], productTitle = "Product") {
  return vi.fn().mockResolvedValue({
    json: vi.fn().mockResolvedValue({
      data: {
        productVariant: {
          price: variants[0]?.price ?? "10.00",
          product: {
            title: productTitle,
            variants: { nodes: variants },
          },
        },
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getMerchantSettings).mockResolvedValue({
    placeholderLogoImageUrl: null,
  } as never);
  vi.mocked(getPresignedGetUrl).mockImplementation((key: string) =>
    Promise.resolve(`signed::${key}`)
  );
  prismaMock.designFeeCategory.findMany.mockResolvedValue([]);
  prismaMock.shop.findUnique.mockResolvedValue({ currencyCode: "USD" });
  prismaMock.productConfig.findFirst.mockResolvedValue(makeProductConfig());
});

// Helper: install the two-call sequence on the variantViewConfiguration.findMany
// mock. The storefront-config code makes (up to) two findMany calls in one
// Promise.all:
//   1. variant-only VVCs (with `include: { productView: true }`)
//   2. color-group VVCs   (with `select: { ... }`)
function setVvcMocks(opts: {
  variantOwn: Array<{ viewId: string; imageUrl: string | null; productView?: unknown; placementGeometry?: unknown }>;
  colorGroup: Array<{ viewId: string; imageUrl: string | null; createdAt: Date }>;
}) {
  prismaMock.variantViewConfiguration.findMany.mockImplementation(
    (args: { include?: unknown; select?: unknown }) => {
      // Q1: variant-own (uses `include`)
      if (args.include) return Promise.resolve(opts.variantOwn);
      // Q2: color-group (uses `select`)
      if (args.select) return Promise.resolve(opts.colorGroup);
      return Promise.resolve([]);
    }
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("getStorefrontConfig color-group image fallback (view-image-orphan-fix)", () => {
  // -----------------------------------------------------------------
  // Test 1
  // -----------------------------------------------------------------
  it("no fallback when variant has its own image — variant VVC imageUrl wins", async () => {
    setVvcMocks({
      variantOwn: [
        {
          viewId: "view-front",
          imageUrl: "shops/s1/views/view-front/variants/v200/own.png",
          productView: VIEW_FRONT,
          placementGeometry: null,
        },
      ],
      colorGroup: [
        {
          viewId: "view-front",
          imageUrl: "shops/s1/views/view-front/variants/v201/sibling.png",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      runGraphqlReturning([
        {
          id: "gid://shopify/ProductVariant/200",
          title: "Black",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [{ name: "Color", value: "Black" }],
        },
        {
          id: "gid://shopify/ProductVariant/201",
          title: "Black-2",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [{ name: "Color", value: "Black" }],
        },
      ])
    );

    const front = result.views.find((v) => v.id === "view-front")!;
    expect(front.imageUrl).toBe(
      "signed::shops/s1/views/view-front/variants/v200/own.png"
    );
    expect(front.isMissingImage).toBe(false);
  });

  // -----------------------------------------------------------------
  // Test 2
  // -----------------------------------------------------------------
  it("fallback returns sibling's image when variant has VVC with null imageUrl", async () => {
    setVvcMocks({
      variantOwn: [
        {
          viewId: "view-front",
          imageUrl: null, // own row exists but has no image
          productView: VIEW_FRONT,
          placementGeometry: null,
        },
      ],
      colorGroup: [
        {
          viewId: "view-front",
          imageUrl: "shops/s1/sibling.png",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      runGraphqlReturning([
        {
          id: "gid://shopify/ProductVariant/200",
          title: "Black",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [{ name: "Color", value: "Black" }],
        },
        {
          id: "gid://shopify/ProductVariant/201",
          title: "Black-2",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [{ name: "Color", value: "Black" }],
        },
      ])
    );

    const front = result.views.find((v) => v.id === "view-front")!;
    expect(front.imageUrl).toBe("signed::shops/s1/sibling.png");
    expect(front.isMissingImage).toBe(false);
  });

  // -----------------------------------------------------------------
  // Test 3
  // -----------------------------------------------------------------
  it("fallback returns sibling's image when variant has no VVC at all", async () => {
    setVvcMocks({
      variantOwn: [], // selected variant has no VVC row whatsoever
      colorGroup: [
        {
          viewId: "view-front",
          imageUrl: "shops/s1/sibling.png",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      runGraphqlReturning([
        {
          id: "gid://shopify/ProductVariant/200",
          title: "Black",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [{ name: "Color", value: "Black" }],
        },
        {
          id: "gid://shopify/ProductVariant/201",
          title: "Black-2",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [{ name: "Color", value: "Black" }],
        },
      ])
    );

    const front = result.views.find((v) => v.id === "view-front")!;
    expect(front.imageUrl).toBe("signed::shops/s1/sibling.png");
    expect(front.isMissingImage).toBe(false);
  });

  // -----------------------------------------------------------------
  // Test 4
  // -----------------------------------------------------------------
  it("view.defaultImageKey wins when no sibling has an image", async () => {
    const viewFrontWithDefault = {
      ...VIEW_FRONT,
      defaultImageKey: "shops/s1/views/view-front/default.png",
    };
    prismaMock.productConfig.findFirst.mockResolvedValue(
      makeProductConfig({ views: [viewFrontWithDefault, VIEW_BACK] })
    );
    setVvcMocks({
      variantOwn: [],
      colorGroup: [], // no sibling images
    });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      runGraphqlReturning([
        {
          id: "gid://shopify/ProductVariant/200",
          title: "Black",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [{ name: "Color", value: "Black" }],
        },
      ])
    );

    const front = result.views.find((v) => v.id === "view-front")!;
    expect(front.imageUrl).toBe(
      "signed::shops/s1/views/view-front/default.png"
    );
    expect(front.isMissingImage).toBe(false);
  });

  // -----------------------------------------------------------------
  // Test 5
  // -----------------------------------------------------------------
  it("no color option detected — fallback skipped, behavior identical to today", async () => {
    setVvcMocks({
      variantOwn: [],
      colorGroup: [],
    });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      // Default Title product — no color or size axis
      runGraphqlReturning([
        {
          id: "gid://shopify/ProductVariant/200",
          title: "Default Title",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [{ name: "Title", value: "Default Title" }],
        },
      ])
    );

    const front = result.views.find((v) => v.id === "view-front")!;
    expect(front.imageUrl).toBeNull();
    expect(front.isMissingImage).toBe(true);

    // Verify the color-group findMany was NOT called (no `select` arg)
    const calls = prismaMock.variantViewConfiguration.findMany.mock.calls;
    const selectCalls = calls.filter(
      (c: unknown[]) =>
        typeof c[0] === "object" && c[0] !== null && "select" in (c[0] as object)
    );
    expect(selectCalls.length).toBe(0);
  });

  // -----------------------------------------------------------------
  // Test 6
  // -----------------------------------------------------------------
  it("multiple siblings have images — deterministic pick (earliest createdAt)", async () => {
    setVvcMocks({
      variantOwn: [],
      // Both rows are for view-front. The mock has them already sorted by
      // createdAt ASC (which is what the real Prisma query returns thanks to
      // `orderBy: { createdAt: "asc" }`). The fallback map should pick the
      // earliest (first) one.
      colorGroup: [
        {
          viewId: "view-front",
          imageUrl: "shops/s1/sibling-earliest.png",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
        {
          viewId: "view-front",
          imageUrl: "shops/s1/sibling-later.png",
          createdAt: new Date("2026-02-01T00:00:00Z"),
        },
      ],
    });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      runGraphqlReturning([
        {
          id: "gid://shopify/ProductVariant/200",
          title: "Black",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [{ name: "Color", value: "Black" }],
        },
        {
          id: "gid://shopify/ProductVariant/201",
          title: "Black-2",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [{ name: "Color", value: "Black" }],
        },
        {
          id: "gid://shopify/ProductVariant/202",
          title: "Black-3",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [{ name: "Color", value: "Black" }],
        },
      ])
    );

    const front = result.views.find((v) => v.id === "view-front")!;
    expect(front.imageUrl).toBe("signed::shops/s1/sibling-earliest.png");
  });

  // -----------------------------------------------------------------
  // Test 7
  // -----------------------------------------------------------------
  it("different colors don't cross-contaminate — Black variant fallback only sees Black siblings", async () => {
    // The selected variant is Black-200. There exist Red siblings in the
    // product (Red-300), but the Prisma query is filtered to the Black
    // sibling ids, so it returns only Black siblings' VVCs. We verify two
    // things:
    //   1. The query's `where.variantId.in` is the Black sibling list.
    //   2. The resolved image URL is the Black sibling's, not the Red one.
    setVvcMocks({
      variantOwn: [],
      colorGroup: [
        {
          viewId: "view-front",
          imageUrl: "shops/s1/black-sibling.png",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      runGraphqlReturning([
        {
          id: "gid://shopify/ProductVariant/200",
          title: "Black-1",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [{ name: "Color", value: "Black" }],
        },
        {
          id: "gid://shopify/ProductVariant/201",
          title: "Black-2",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [{ name: "Color", value: "Black" }],
        },
        {
          id: "gid://shopify/ProductVariant/300",
          title: "Red-1",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [{ name: "Color", value: "Red" }],
        },
        {
          id: "gid://shopify/ProductVariant/301",
          title: "Red-2",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [{ name: "Color", value: "Red" }],
        },
      ])
    );

    // Assert resolved image is the Black sibling's
    const front = result.views.find((v) => v.id === "view-front")!;
    expect(front.imageUrl).toBe("signed::shops/s1/black-sibling.png");

    // Assert the color-group query was scoped only to Black siblings
    const calls = prismaMock.variantViewConfiguration.findMany.mock.calls;
    const colorCall = calls.find(
      (c: unknown[]) =>
        typeof c[0] === "object" && c[0] !== null && "select" in (c[0] as object)
    );
    expect(colorCall).toBeDefined();
    const where = (colorCall![0] as { where: { variantId: { in: string[] } } }).where;
    const inList = where.variantId.in.sort();
    expect(inList).toEqual(["gid://shopify/ProductVariant/201"]);
    // Red variants must NOT appear in the in-list
    expect(inList).not.toContain("gid://shopify/ProductVariant/300");
    expect(inList).not.toContain("gid://shopify/ProductVariant/301");
  });

  // -----------------------------------------------------------------
  // Test 8
  // -----------------------------------------------------------------
  it("Default Title product — no error, no fallback applied", async () => {
    setVvcMocks({
      variantOwn: [],
      colorGroup: [],
    });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200",
      runGraphqlReturning([
        {
          id: "gid://shopify/ProductVariant/200",
          title: "Default Title",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [{ name: "Title", value: "Default Title" }],
        },
      ])
    );

    expect(result.variantAxis).toBe("option");
    const front = result.views.find((v) => v.id === "view-front")!;
    expect(front.imageUrl).toBeNull();
    expect(front.isMissingImage).toBe(true);

    // No `select`-shaped findMany call should have been made
    const calls = prismaMock.variantViewConfiguration.findMany.mock.calls;
    const selectCalls = calls.filter(
      (c: unknown[]) =>
        typeof c[0] === "object" && c[0] !== null && "select" in (c[0] as object)
    );
    expect(selectCalls.length).toBe(0);
  });

  // -----------------------------------------------------------------
  // Test 9 (MF-4): the regression guard for MF-1
  // -----------------------------------------------------------------
  it("Both size AND color axes present — fallback fires (MF-1 regression guard)", async () => {
    // This is the Stitchs shape: products with BOTH Size (S/M/L/XL) and
    // Color (Black/Red) axes. Before MF-1, color detection was gated behind
    // `!sizeOptionName`, so for these products colorOptionName stayed null
    // and the fallback was a no-op. This test ensures we never re-introduce
    // that regression.
    setVvcMocks({
      variantOwn: [], // selected Black-XL has no own VVC for view-front
      colorGroup: [
        {
          viewId: "view-front",
          imageUrl: "shops/s1/black-M-sibling.png",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });

    const result = await getStorefrontConfig(
      "shop-1",
      "test.myshopify.com",
      "gid://shopify/Product/100",
      "gid://shopify/ProductVariant/200", // Black-XL
      runGraphqlReturning([
        {
          id: "gid://shopify/ProductVariant/200",
          title: "Black / XL",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [
            { name: "Size", value: "XL" },
            { name: "Color", value: "Black" },
          ],
        },
        {
          id: "gid://shopify/ProductVariant/201",
          title: "Black / M",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [
            { name: "Size", value: "M" },
            { name: "Color", value: "Black" },
          ],
        },
        {
          id: "gid://shopify/ProductVariant/202",
          title: "Black / L",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [
            { name: "Size", value: "L" },
            { name: "Color", value: "Black" },
          ],
        },
        {
          id: "gid://shopify/ProductVariant/300",
          title: "Red / M",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [
            { name: "Size", value: "M" },
            { name: "Color", value: "Red" },
          ],
        },
        {
          id: "gid://shopify/ProductVariant/301",
          title: "Red / XL",
          price: "10.00",
          availableForSale: true,
          selectedOptions: [
            { name: "Size", value: "XL" },
            { name: "Color", value: "Red" },
          ],
        },
      ])
    );

    // variantAxis is still "size" (size wins for axis selection) but the
    // color-group fallback must still fire.
    expect(result.variantAxis).toBe("size");

    const front = result.views.find((v) => v.id === "view-front")!;
    // Expect the Black-M sibling's image, NOT null and NOT a Red variant's image.
    expect(front.imageUrl).toBe("signed::shops/s1/black-M-sibling.png");
    expect(front.isMissingImage).toBe(false);

    // Sanity: confirm the color-group query was scoped to Black siblings only
    // (Black-M and Black-L), excluding the selected Black-XL itself and ALL
    // Red variants.
    const calls = prismaMock.variantViewConfiguration.findMany.mock.calls;
    const colorCall = calls.find(
      (c: unknown[]) =>
        typeof c[0] === "object" && c[0] !== null && "select" in (c[0] as object)
    );
    expect(colorCall).toBeDefined();
    const where = (colorCall![0] as { where: { variantId: { in: string[] } } }).where;
    const inList = [...where.variantId.in].sort();
    expect(inList).toEqual([
      "gid://shopify/ProductVariant/201",
      "gid://shopify/ProductVariant/202",
    ]);
  });
});
