import { describe, it, expect } from "vitest";
import {
  effectiveMethodPriceCents,
  effectivePlacementAdjustmentCents,
} from "../methods.server";

describe("effectiveMethodPriceCents", () => {
  it("returns base when override is null", () => {
    expect(effectiveMethodPriceCents(1000, null)).toBe(1000);
  });
  it("returns override when set", () => {
    expect(effectiveMethodPriceCents(1000, 500)).toBe(500);
  });
});

describe("effectivePlacementAdjustmentCents", () => {
  it("returns placementDefault when override is null", () => {
    expect(effectivePlacementAdjustmentCents(750, null)).toBe(750);
  });
  it("returns placementDefault when override is undefined", () => {
    expect(effectivePlacementAdjustmentCents(750, undefined)).toBe(750);
  });
  it("returns 0 override explicitly (free)", () => {
    expect(effectivePlacementAdjustmentCents(750, 0)).toBe(0);
  });
  it("returns positive override", () => {
    expect(effectivePlacementAdjustmentCents(750, 1200)).toBe(1200);
  });
  it("returns negative override (discount allowed)", () => {
    expect(effectivePlacementAdjustmentCents(750, -250)).toBe(-250);
  });
});
