// design-fees: tests for computeFeeDecisionsForDraft
import { vi, describe, it, expect, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => {
  const makeFn = () => vi.fn();
  return {
    placementDefinition: { findMany: makeFn() },
    designFeeCategory: { findMany: makeFn() },
    logoAsset: { findMany: makeFn() },
    cartDesignFeeCharge: { findMany: makeFn() },
  };
});

vi.mock("../../../../db.server", () => ({
  default: prismaMock,
}));

import { computeFeeDecisionsForDraft } from "../compute.server";

beforeEach(() => {
  vi.resetAllMocks();
  // Default: feature flag ON
  vi.stubEnv("DESIGN_FEES_ENABLED", "true");
});

describe("computeFeeDecisionsForDraft", () => {
  it("returns [] when DESIGN_FEES_ENABLED is not 'true'", async () => {
    vi.stubEnv("DESIGN_FEES_ENABLED", "false");
    const result = await computeFeeDecisionsForDraft({
      shopId: "shop-1",
      cartToken: "abc",
      draft: {
        methodId: "m-1",
        placements: [{ placementId: "p-1", stepIndex: 0 }],
        logoAssetIdsByPlacementId: { "p-1": "logo-1" },
      },
    });
    expect(result).toEqual([]);
  });

  it("returns [] when cartToken is null", async () => {
    const result = await computeFeeDecisionsForDraft({
      shopId: "shop-1",
      cartToken: null,
      draft: {
        methodId: "m-1",
        placements: [{ placementId: "p-1", stepIndex: 0 }],
        logoAssetIdsByPlacementId: { "p-1": "logo-1" },
      },
    });
    expect(result).toEqual([]);
  });

  it("returns one decision per (hash, category, method) tuple even across multiple placements", async () => {
    prismaMock.placementDefinition.findMany.mockResolvedValue([
      { id: "p-borst", feeCategoryId: "cat-klein" },
      { id: "p-rug", feeCategoryId: "cat-klein" }, // same category
    ]);
    prismaMock.designFeeCategory.findMany.mockResolvedValue([
      { id: "cat-klein", name: "Klein", methodId: "m-1", feeCents: 2500 },
    ]);
    prismaMock.logoAsset.findMany.mockResolvedValue([
      { id: "logo-1", contentHash: "hash-a" },
    ]);
    prismaMock.cartDesignFeeCharge.findMany.mockResolvedValue([]);

    const result = await computeFeeDecisionsForDraft({
      shopId: "shop-1",
      cartToken: "cart-token",
      draft: {
        methodId: "m-1",
        placements: [
          { placementId: "p-borst", stepIndex: 0 },
          { placementId: "p-rug", stepIndex: 0 },
        ],
        logoAssetIdsByPlacementId: { "p-borst": "logo-1", "p-rug": "logo-1" },
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      categoryId: "cat-klein",
      methodId: "m-1",
      logoContentHash: "hash-a",
      alreadyCharged: false,
      feeCentsToCharge: 2500,
    });
    expect(result[0].placementIds.sort()).toEqual(["p-borst", "p-rug"]);
  });

  it("marks tuples already in CartDesignFeeCharge as alreadyCharged with feeCentsToCharge=0", async () => {
    prismaMock.placementDefinition.findMany.mockResolvedValue([
      { id: "p-borst", feeCategoryId: "cat-klein" },
    ]);
    prismaMock.designFeeCategory.findMany.mockResolvedValue([
      { id: "cat-klein", name: "Klein", methodId: "m-1", feeCents: 2500 },
    ]);
    prismaMock.logoAsset.findMany.mockResolvedValue([
      { id: "logo-1", contentHash: "hash-a" },
    ]);
    prismaMock.cartDesignFeeCharge.findMany.mockResolvedValue([
      {
        logoContentHash: "hash-a",
        categoryId: "cat-klein",
        methodId: "m-1",
      },
    ]);

    const result = await computeFeeDecisionsForDraft({
      shopId: "shop-1",
      cartToken: "cart-token",
      draft: {
        methodId: "m-1",
        placements: [{ placementId: "p-borst", stepIndex: 0 }],
        logoAssetIdsByPlacementId: { "p-borst": "logo-1" },
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0].alreadyCharged).toBe(true);
    expect(result[0].feeCentsToCharge).toBe(0);
    expect(result[0].feeCentsSnapshot).toBe(2500);
  });

  it("returns [] when no placement maps to a category", async () => {
    prismaMock.placementDefinition.findMany.mockResolvedValue([]);
    const result = await computeFeeDecisionsForDraft({
      shopId: "shop-1",
      cartToken: "cart-token",
      draft: {
        methodId: "m-1",
        placements: [{ placementId: "p-1", stepIndex: 0 }],
        logoAssetIdsByPlacementId: { "p-1": "logo-1" },
      },
    });
    expect(result).toEqual([]);
  });

  it("uses synthetic 'pending' sentinel when logo has no contentHash (send-later mode)", async () => {
    prismaMock.placementDefinition.findMany.mockResolvedValue([
      { id: "p-1", feeCategoryId: "cat-1" },
    ]);
    prismaMock.designFeeCategory.findMany.mockResolvedValue([
      { id: "cat-1", name: "Klein", methodId: "m-1", feeCents: 2500 },
    ]);
    prismaMock.logoAsset.findMany.mockResolvedValue([
      { id: "logo-1", contentHash: null },
    ]);
    prismaMock.cartDesignFeeCharge.findMany.mockResolvedValue([]);
    const result = await computeFeeDecisionsForDraft({
      shopId: "shop-1",
      cartToken: "cart-token",
      draft: {
        methodId: "m-1",
        placements: [{ placementId: "p-1", stepIndex: 0 }],
        logoAssetIdsByPlacementId: { "p-1": "logo-1" },
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0].logoContentHash).toBe("pending");
    expect(result[0].feeCentsToCharge).toBe(2500);
  });

  it("uses 'pending' sentinel when no logo asset attached at all (send-later mode)", async () => {
    prismaMock.placementDefinition.findMany.mockResolvedValue([
      { id: "p-1", feeCategoryId: "cat-1" },
    ]);
    prismaMock.designFeeCategory.findMany.mockResolvedValue([
      { id: "cat-1", name: "Klein", methodId: "m-1", feeCents: 2500 },
    ]);
    prismaMock.logoAsset.findMany.mockResolvedValue([]);
    prismaMock.cartDesignFeeCharge.findMany.mockResolvedValue([]);
    const result = await computeFeeDecisionsForDraft({
      shopId: "shop-1",
      cartToken: "cart-token",
      draft: {
        methodId: "m-1",
        placements: [{ placementId: "p-1", stepIndex: 0 }],
        logoAssetIdsByPlacementId: { "p-1": null },
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0].logoContentHash).toBe("pending");
    expect(result[0].feeCentsToCharge).toBe(2500);
  });

  it("two categories with same logo on same draft → two decisions", async () => {
    prismaMock.placementDefinition.findMany.mockResolvedValue([
      { id: "p-borst", feeCategoryId: "cat-klein" },
      { id: "p-rug", feeCategoryId: "cat-groot" },
    ]);
    prismaMock.designFeeCategory.findMany.mockResolvedValue([
      { id: "cat-klein", name: "Klein", methodId: "m-1", feeCents: 2500 },
      { id: "cat-groot", name: "Groot", methodId: "m-1", feeCents: 3900 },
    ]);
    prismaMock.logoAsset.findMany.mockResolvedValue([
      { id: "logo-1", contentHash: "hash-a" },
    ]);
    prismaMock.cartDesignFeeCharge.findMany.mockResolvedValue([]);

    const result = await computeFeeDecisionsForDraft({
      shopId: "shop-1",
      cartToken: "cart-token",
      draft: {
        methodId: "m-1",
        placements: [
          { placementId: "p-borst", stepIndex: 0 },
          { placementId: "p-rug", stepIndex: 0 },
        ],
        logoAssetIdsByPlacementId: { "p-borst": "logo-1", "p-rug": "logo-1" },
      },
    });
    expect(result).toHaveLength(2);
    const totalCents = result.reduce((s, d) => s + d.feeCentsToCharge, 0);
    expect(totalCents).toBe(2500 + 3900);
  });
});
