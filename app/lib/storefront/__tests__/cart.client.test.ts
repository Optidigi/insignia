import { describe, it, expect } from "vitest";
import { buildGarmentProperties, buildFeeProperties } from "../cart.client";

describe("buildGarmentProperties", () => {
  it("includes customization ID and no other internal fields", () => {
    const props = buildGarmentProperties({
      customizationId: "draft-uuid",
      methodCustomerName: "Embroidery",
      placementNames: ["Left Chest"],
      artworkStatus: "PROVIDED",
    });
    expect(props._insignia_customization_id).toBe("draft-uuid");
    expect(props._insignia_method).toBeUndefined();
    expect(props._insignia_config_hash).toBeUndefined();
    expect(props._insignia_pricing_version).toBeUndefined();
  });

  it("adds human-readable Decoration and Placement properties", () => {
    const props = buildGarmentProperties({
      customizationId: "x",
      methodCustomerName: "Screen Print",
      placementNames: ["Left Chest", "Full Back"],
      artworkStatus: "PENDING_CUSTOMER",
    });
    expect(props["Decoration"]).toBe("Screen Print");
    expect(props["Placement"]).toBe("Left Chest, Full Back");
    expect(props["Artwork status"]).toBe("Artwork requested");
  });

  it("sets Artwork status to Provided when PROVIDED", () => {
    const props = buildGarmentProperties({
      customizationId: "x",
      methodCustomerName: "Embroidery",
      placementNames: [],
      artworkStatus: "PROVIDED",
    });
    expect(props["Artwork status"]).toBe("Provided");
  });
});

describe("buildFeeProperties", () => {
  it("returns only the fee marker", () => {
    expect(buildFeeProperties()).toEqual({ _insignia_fee: "true" });
  });
});
