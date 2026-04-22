import { describe, it, expect } from "vitest";
import { computeCmDimensions, formatCmLabel } from "../calibration";

describe("computeCmDimensions", () => {
  it("computes cm dimensions from percent geometry + pixel-per-cm calibration", () => {
    const result = computeCmDimensions(
      { maxWidthPercent: 50, maxHeightPercent: 25 },
      { naturalWidthPx: 1000, naturalHeightPx: 800 },
      1,
      10, // 10 px/cm
    );
    // widthCm = 50/100 * 1000 * 1 / 10 = 50
    // heightCm = 25/100 * 800 * 1 / 10 = 20
    expect(result).toEqual({ widthCm: 50, heightCm: 20 });
  });

  it("applies scaleFactor", () => {
    const result = computeCmDimensions(
      { maxWidthPercent: 50, maxHeightPercent: 50 },
      { naturalWidthPx: 1000, naturalHeightPx: 1000 },
      0.5,
      10,
    );
    // widthCm = 50/100 * 1000 * 0.5 / 10 = 25
    expect(result).toEqual({ widthCm: 25, heightCm: 25 });
  });

  it("falls back to maxWidthPercent when maxHeightPercent missing (legacy square zones)", () => {
    const result = computeCmDimensions(
      { maxWidthPercent: 20 },
      { naturalWidthPx: 500, naturalHeightPx: 500 },
      1,
      5,
    );
    // both axes treated as 20%
    expect(result).toEqual({ widthCm: 20, heightCm: 20 });
  });

  it("rounds to nearest whole cm", () => {
    const result = computeCmDimensions(
      { maxWidthPercent: 33, maxHeightPercent: 17 },
      { naturalWidthPx: 1000, naturalHeightPx: 1000 },
      1,
      10,
    );
    // widthCm = 33.0, heightCm = 17.0 — already integers
    expect(result?.widthCm).toBe(33);
    expect(result?.heightCm).toBe(17);
  });

  it("returns null when calibrationPxPerCm is missing", () => {
    expect(
      computeCmDimensions(
        { maxWidthPercent: 50 },
        { naturalWidthPx: 100, naturalHeightPx: 100 },
        1,
        null,
      ),
    ).toBeNull();
    expect(
      computeCmDimensions(
        { maxWidthPercent: 50 },
        { naturalWidthPx: 100, naturalHeightPx: 100 },
        1,
        0,
      ),
    ).toBeNull();
  });

  it("returns null when imageMeta is missing", () => {
    expect(
      computeCmDimensions({ maxWidthPercent: 50 }, null, 1, 10),
    ).toBeNull();
  });

  it("returns null when geom is missing", () => {
    expect(
      computeCmDimensions(null, { naturalWidthPx: 100, naturalHeightPx: 100 }, 1, 10),
    ).toBeNull();
  });

  it("treats scaleFactor of 0 as 1 (fallback)", () => {
    const result = computeCmDimensions(
      { maxWidthPercent: 50, maxHeightPercent: 50 },
      { naturalWidthPx: 1000, naturalHeightPx: 1000 },
      0,
      10,
    );
    expect(result).toEqual({ widthCm: 50, heightCm: 50 });
  });
});

describe("formatCmLabel", () => {
  it("renders with U+00D7 multiplication sign (matches storefront)", () => {
    expect(formatCmLabel({ widthCm: 21, heightCm: 8 })).toBe("21 × 8 cm");
  });

  it("returns null when dimensions null", () => {
    expect(formatCmLabel(null)).toBeNull();
  });
});
