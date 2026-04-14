// app/lib/services/__tests__/webhooks-gdpr.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted db mock
// ---------------------------------------------------------------------------
const prismaMock = vi.hoisted(() => {
  const makeFn = () => vi.fn();
  return {
    shop: {
      findUnique: makeFn(),
    },
    customizationDraft: {
      deleteMany: makeFn(),
      findMany: makeFn(),
      count: makeFn(),
    },
    // orderLineCustomization mock intentionally omitted:
    // the query was removed because OrderLineCustomization has no customerEmail
    // field and therefore cannot be filtered per customer (compliance gap).
  };
});

vi.mock("../../../db.server", () => ({
  default: prismaMock,
}));

// Static imports after mocks
import {
  handleCustomerRedact,
  handleCustomerDataRequest,
} from "../gdpr.server";

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// handleCustomerRedact
// ---------------------------------------------------------------------------

describe("handleCustomerRedact", () => {
  it("deletes only drafts matching shopId AND customerEmail", async () => {
    prismaMock.shop.findUnique.mockResolvedValue({ id: "shop-1" });
    prismaMock.customizationDraft.deleteMany.mockResolvedValue({ count: 2 });

    await handleCustomerRedact("test.myshopify.com", {
      customer: { email: "alice@example.com" },
    });

    expect(prismaMock.customizationDraft.deleteMany).toHaveBeenCalledWith({
      where: { shopId: "shop-1", customerEmail: "alice@example.com" },
    });
  });

  it("does nothing when shop not found", async () => {
    prismaMock.shop.findUnique.mockResolvedValue(null);

    await handleCustomerRedact("unknown.myshopify.com", {
      customer: { email: "alice@example.com" },
    });

    expect(prismaMock.customizationDraft.deleteMany).not.toHaveBeenCalled();
  });

  it("does nothing when customer email missing from payload", async () => {
    prismaMock.shop.findUnique.mockResolvedValue({ id: "shop-1" });

    await handleCustomerRedact("test.myshopify.com", {});

    expect(prismaMock.customizationDraft.deleteMany).not.toHaveBeenCalled();
  });

  it("does nothing when customer object exists but email is empty", async () => {
    prismaMock.shop.findUnique.mockResolvedValue({ id: "shop-1" });

    await handleCustomerRedact("test.myshopify.com", {
      customer: { email: "" },
    });

    expect(prismaMock.customizationDraft.deleteMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleCustomerDataRequest
// ---------------------------------------------------------------------------

describe("handleCustomerDataRequest", () => {
  it("returns structured data filtered by customer email", async () => {
    prismaMock.shop.findUnique.mockResolvedValue({ id: "shop-1" });
    prismaMock.customizationDraft.findMany.mockResolvedValue([
      {
        id: "draft-1",
        productId: "gid://shopify/Product/1",
        variantId: "gid://shopify/ProductVariant/1",
        createdAt: new Date("2026-01-01"),
      },
    ]);

    const result = await handleCustomerDataRequest("test.myshopify.com", {
      customer: { email: "alice@example.com" },
    });

    expect(prismaMock.customizationDraft.findMany).toHaveBeenCalledWith({
      where: { shopId: "shop-1", customerEmail: "alice@example.com" },
      select: {
        id: true,
        productId: true,
        variantId: true,
        createdAt: true,
      },
    });

    // orderLineCount is always 0: OrderLineCustomization has no customerEmail
    // field so it cannot be filtered per customer (known compliance gap).
    expect(result).toEqual({
      drafts: [
        {
          id: "draft-1",
          productId: "gid://shopify/Product/1",
          variantId: "gid://shopify/ProductVariant/1",
          createdAt: new Date("2026-01-01"),
        },
      ],
      orderLineCount: 0,
    });
  });

  it("returns empty data when shop not found", async () => {
    prismaMock.shop.findUnique.mockResolvedValue(null);

    const result = await handleCustomerDataRequest("unknown.myshopify.com", {
      customer: { email: "alice@example.com" },
    });

    expect(result).toEqual({ drafts: [], orderLineCount: 0 });
  });

  it("returns empty data when customer email missing from payload", async () => {
    prismaMock.shop.findUnique.mockResolvedValue({ id: "shop-1" });

    const result = await handleCustomerDataRequest("test.myshopify.com", {});

    expect(result).toEqual({ drafts: [], orderLineCount: 0 });
    expect(prismaMock.customizationDraft.findMany).not.toHaveBeenCalled();
  });
});
