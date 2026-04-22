import { describe, it, expect } from "vitest";
import {
  productionStatusLabel,
  productionStatusTone,
  artworkStatusLabel,
  artworkStatusTone,
  lineItemArtworkSummary,
  indexArtworkBadge,
} from "../terminology";

describe("productionStatusLabel", () => {
  it("maps every ProductionStatus enum value to a terminology-locked label", () => {
    expect(productionStatusLabel("ARTWORK_PENDING")).toBe("Awaiting artwork");
    expect(productionStatusLabel("ARTWORK_PROVIDED")).toBe("Ready to produce");
    expect(productionStatusLabel("IN_PRODUCTION")).toBe("In production");
    expect(productionStatusLabel("QUALITY_CHECK")).toBe("Quality check");
    expect(productionStatusLabel("SHIPPED")).toBe("Complete");
  });

  it("never returns 'Shipped' or 'Pending' (terminology lock)", () => {
    const values: Array<Parameters<typeof productionStatusLabel>[0]> = [
      "ARTWORK_PENDING",
      "ARTWORK_PROVIDED",
      "IN_PRODUCTION",
      "QUALITY_CHECK",
      "SHIPPED",
    ];
    for (const v of values) {
      const label = productionStatusLabel(v);
      expect(label).not.toMatch(/^Shipped$/i);
      expect(label).not.toMatch(/^Pending$/i);
      expect(label).not.toMatch(/Logo/i);
    }
  });
});

describe("productionStatusTone", () => {
  it("maps every enum to a valid Polaris WC tone", () => {
    const tones = {
      ARTWORK_PENDING: "warning",
      ARTWORK_PROVIDED: "info",
      IN_PRODUCTION: "info",
      QUALITY_CHECK: "info",
      SHIPPED: "success",
    } as const;
    for (const [status, tone] of Object.entries(tones)) {
      expect(productionStatusTone(status as keyof typeof tones)).toBe(tone);
    }
  });
});

describe("artworkStatusLabel + tone", () => {
  it("returns correct labels and tones", () => {
    expect(artworkStatusLabel("PROVIDED")).toBe("Provided");
    expect(artworkStatusLabel("PENDING_CUSTOMER")).toBe("Awaiting");
    expect(artworkStatusTone("PROVIDED")).toBe("success");
    expect(artworkStatusTone("PENDING_CUSTOMER")).toBe("warning");
  });
});

describe("lineItemArtworkSummary", () => {
  it("all placements provided → Artwork provided / success", () => {
    expect(lineItemArtworkSummary(["PROVIDED", "PROVIDED"])).toEqual({
      label: "Artwork provided",
      tone: "success",
    });
  });

  it("all pending → Awaiting artwork / warning", () => {
    expect(
      lineItemArtworkSummary(["PENDING_CUSTOMER", "PENDING_CUSTOMER"]),
    ).toEqual({ label: "Awaiting artwork", tone: "warning" });
  });

  it("mixed → Partial artwork / warning", () => {
    expect(
      lineItemArtworkSummary(["PROVIDED", "PENDING_CUSTOMER"]),
    ).toEqual({ label: "Partial artwork", tone: "warning" });
  });

  it("empty → No placements / info", () => {
    expect(lineItemArtworkSummary([])).toEqual({
      label: "No placements",
      tone: "info",
    });
  });
});

describe("indexArtworkBadge", () => {
  it("pending > 0 → Awaiting artwork / warning", () => {
    expect(indexArtworkBadge(3)).toEqual({ label: "Awaiting artwork", tone: "warning" });
  });
  it("pending === 0 → Provided / success", () => {
    expect(indexArtworkBadge(0)).toEqual({ label: "Provided", tone: "success" });
  });
});
