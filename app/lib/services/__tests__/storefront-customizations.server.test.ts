// app/lib/services/__tests__/storefront-customizations.server.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted db + service mocks
//
// Only the slices of Prisma actually touched by computeCustomizationPrice's
// price-resolution path are mocked. getProductConfig is mocked via its
// real module so we don't have to stand up its full include graph.
// ---------------------------------------------------------------------------
const prismaMock = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    customizationDraft: {
      findFirst: fn(),
      update: fn(),
    },
    decorationMethod: {
      findUnique: fn(),
    },
    productConfigMethod: {
      findUnique: fn(),
    },
    placementDefinitionMethodPrice: {
      findMany: fn(),
    },
  };
});

vi.mock("../../../db.server", () => ({
  default: prismaMock,
}));

vi.mock("../product-configs.server", () => ({
  getProductConfig: vi.fn(),
}));

// Static imports after mocks
import { computeCustomizationPrice } from "../storefront-customizations.server";
import { getProductConfig } from "../product-configs.server";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const STEP_SMALL_ID = "step-small";
const STEP_LARGE_ID = "step-large";
const METHOD_ID = "method-1";

function baseConfig() {
  return {
    id: "config-1",
    shopId: "shop-1",
    views: [
      {
        placements: [
          {
            id: "placement-chest",
            basePriceAdjustmentCents: 200,
            steps: [
              { id: STEP_SMALL_ID, priceAdjustmentCents: 100 },
              { id: STEP_LARGE_ID, priceAdjustmentCents: 500 },
            ],
          },
        ],
      },
    ],
  };
}

function baseDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    shopId: "shop-1",
    productConfigId: "config-1",
    methodId: METHOD_ID,
    productId: "gid://shopify/Product/100",
    variantId: "gid://shopify/ProductVariant/200",
    placements: [{ placementId: "placement-chest", stepIndex: 0 }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  // Default to the shared config; individual tests override as needed.
  vi.mocked(getProductConfig).mockResolvedValue(baseConfig() as never);
  prismaMock.decorationMethod.findUnique.mockResolvedValue({ basePriceCents: 1000 });
  prismaMock.productConfigMethod.findUnique.mockResolvedValue({ basePriceCentsOverride: null });
  prismaMock.placementDefinitionMethodPrice.findMany.mockResolvedValue([]);
  prismaMock.customizationDraft.update.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeCustomizationPrice — per-method placement base fee override", () => {
  it("falls back to placement.basePriceAdjustmentCents when no override exists", async () => {
    prismaMock.customizationDraft.findFirst.mockResolvedValue(baseDraft());
    prismaMock.placementDefinitionMethodPrice.findMany.mockResolvedValue([]);

    const result = await computeCustomizationPrice("shop-1", "draft-1");

    // method (1000) + placement default (200) + step default (100) = 1300
    expect(result.feeCents).toBe(1300);
  });

  it("uses the override when a placement-method override exists for this method", async () => {
    prismaMock.customizationDraft.findFirst.mockResolvedValue(baseDraft());
    prismaMock.placementDefinitionMethodPrice.findMany.mockResolvedValue([
      { placementDefinitionId: "placement-chest", basePriceAdjustmentCents: 750 },
    ]);

    const result = await computeCustomizationPrice("shop-1", "draft-1");

    // method (1000) + placement override (750) + step default (100) = 1850
    expect(result.feeCents).toBe(1850);
  });

  it("treats a placement override of 0 as explicit free (not as absent)", async () => {
    prismaMock.customizationDraft.findFirst.mockResolvedValue(baseDraft());
    prismaMock.placementDefinitionMethodPrice.findMany.mockResolvedValue([
      { placementDefinitionId: "placement-chest", basePriceAdjustmentCents: 0 },
    ]);

    const result = await computeCustomizationPrice("shop-1", "draft-1");

    // method (1000) + placement override (0) + step default (100) = 1100
    expect(result.feeCents).toBe(1100);
  });
});
