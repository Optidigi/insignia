// app/lib/services/__tests__/variant-pool.server.test.ts
//
// vi.mock factory runs before module imports, so we use vi.hoisted to initialise
// the mock object in the hoisted phase and reference it from both the factory and
// the test body.  Because vitest-mock-extended (ESM) cannot be require()'d inside
// vi.hoisted, we build a minimal hand-rolled mock that satisfies the Prisma calls
// exercised by these two functions.
//
import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted db mock — must be created before any module is imported
// ---------------------------------------------------------------------------
const prismaMock = vi.hoisted(() => {
  const makeFn = () => vi.fn();
  return {
    variantSlot: {
      count: makeFn(),
      findFirst: makeFn(),
      findMany: makeFn(),
      create: makeFn(),
      update: makeFn(),
      updateMany: makeFn(),
      deleteMany: makeFn(),
    },
    decorationMethod: {
      findFirst: makeFn(),
    },
    customizationConfig: {
      updateMany: makeFn(),
    },
    $transaction: makeFn(),
  };
});

vi.mock("../../../db.server", () => ({
  default: prismaMock,
}));

// Static imports after mocks
import { provisionVariantPool, ensureVariantPoolExists } from "../variant-pool.server";
import { ErrorCodes } from "../../errors.server";

const TARGET_POOL_SIZE = 25;

// Reset all mocks between tests
beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: make a standard adminGraphql mock
// ---------------------------------------------------------------------------
function makeAdminGraphql(productExists = true) {
  return vi.fn().mockResolvedValue({
    json: vi.fn().mockResolvedValue({
      data: {
        publications: { edges: [{ node: { id: "pub-1", name: "Online Store" } }] },
        publishablePublish: { userErrors: [] },
        productCreate: {
          product: {
            id: "gid://shopify/Product/99",
            variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/1" } }] },
          },
          userErrors: [],
        },
        productVariantsBulkUpdate: { productVariants: [], userErrors: [] },
        productVariantsBulkCreate: {
          productVariants: Array.from({ length: TARGET_POOL_SIZE - 1 }, (_, i) => ({
            id: `gid://shopify/ProductVariant/${i + 2}`,
          })),
          userErrors: [],
        },
        // ensureVariantsAlwaysPurchasable fetches the product with its variants
        product: productExists
          ? { id: "gid://shopify/Product/99", variants: { edges: [] } }
          : null,
        inventoryItemUpdate: { inventoryItem: { tracked: false }, userErrors: [] },
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// provisionVariantPool
// ---------------------------------------------------------------------------

describe("provisionVariantPool", () => {
  it("is idempotent — skips Shopify calls and returns existing product ID + count when slots already exist", async () => {
    prismaMock.variantSlot.count.mockResolvedValue(TARGET_POOL_SIZE);
    prismaMock.variantSlot.findFirst.mockResolvedValue({
      shopifyProductId: "gid://shopify/Product/42",
    });

    const adminGraphql = vi.fn();

    const result = await provisionVariantPool("shop-1", "method-1", "Screen Print", adminGraphql);

    expect(result).toEqual({
      productId: "gid://shopify/Product/42",
      slotCount: TARGET_POOL_SIZE,
    });
    expect(adminGraphql).not.toHaveBeenCalled();
  });

  it("provisions a new pool when no slots exist — calls productCreate with UNLISTED and inserts DEFAULT_SLOT_COUNT DB rows", async () => {
    prismaMock.variantSlot.count.mockResolvedValue(0);

    // $transaction called with an array of prisma.variantSlot.create calls
    prismaMock.$transaction.mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) return ops.map(() => ({}));
      return (ops as (tx: unknown) => Promise<unknown>)(prismaMock);
    });

    const adminGraphql = makeAdminGraphql(true);

    const result = await provisionVariantPool("shop-1", "method-1", "Screen Print", adminGraphql);

    expect(result.productId).toBe("gid://shopify/Product/99");
    expect(result.slotCount).toBe(TARGET_POOL_SIZE);

    // productCreate must have been called with status: "UNLISTED"
    const createCall = adminGraphql.mock.calls.find((args) =>
      String(args[0]).includes("productCreate")
    );
    expect(createCall).toBeDefined();
    const variables = createCall![1] as { product: { status: string } };
    expect(variables.product.status).toBe("UNLISTED");

    // $transaction called once with an array of TARGET_POOL_SIZE create operations
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    const txArg = prismaMock.$transaction.mock.calls[0][0];
    expect(Array.isArray(txArg)).toBe(true);
    expect((txArg as unknown[]).length).toBe(TARGET_POOL_SIZE);
  });
});

// ---------------------------------------------------------------------------
// ensureVariantPoolExists
// ---------------------------------------------------------------------------

describe("ensureVariantPoolExists", () => {
  it("provisions when no slots exist yet — looks up the method and calls provisionVariantPool", async () => {
    // No existing slot
    prismaMock.variantSlot.findFirst.mockResolvedValue(null);
    // Method is found
    prismaMock.decorationMethod.findFirst.mockResolvedValue({
      id: "method-1",
      shopId: "shop-1",
      name: "Embroidery",
    });
    // provisionVariantPool will check count (returns 0 → provisions)
    prismaMock.variantSlot.count.mockResolvedValue(0);
    prismaMock.$transaction.mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) return ops.map(() => ({}));
      return (ops as (tx: unknown) => Promise<unknown>)(prismaMock);
    });

    const adminGraphql = makeAdminGraphql(true);

    await expect(
      ensureVariantPoolExists("shop-1", "method-1", adminGraphql)
    ).resolves.toBeUndefined();

    expect(prismaMock.decorationMethod.findFirst).toHaveBeenCalledWith({
      where: { id: "method-1", shopId: "shop-1" },
    });

    // Verify that a new fee product was created in Shopify
    const createCall = adminGraphql.mock.calls.find(
      (args) => typeof args[0] === "string" && args[0].includes("productCreate")
    );
    expect(createCall).toBeDefined();
  });

  it("throws NOT_FOUND when no slots exist and decorationMethod is not found", async () => {
    prismaMock.variantSlot.findFirst.mockResolvedValue(null);
    prismaMock.decorationMethod.findFirst.mockResolvedValue(null);

    const adminGraphql = makeAdminGraphql(true);

    await expect(
      ensureVariantPoolExists("shop-1", "method-missing", adminGraphql)
    ).rejects.toMatchObject({
      code: ErrorCodes.NOT_FOUND,
      message: expect.stringContaining("Method not found"),
    });
  });

  it("re-provisions when slots exist but the Shopify product was deleted", async () => {
    // Initial findFirst returns a slot
    prismaMock.variantSlot.findFirst
      .mockResolvedValueOnce({ shopifyProductId: "gid://shopify/Product/OLD" })
      // After deletion the idempotency count check returns 0 (no slots)
      .mockResolvedValue(null);

    // Stale slots to clean up
    prismaMock.variantSlot.findMany.mockResolvedValue([
      { id: "slot-1", currentConfigId: "cfg-1" },
      { id: "slot-2", currentConfigId: null },
    ]);
    prismaMock.customizationConfig.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.variantSlot.deleteMany.mockResolvedValue({ count: 2 });

    // Method found for re-provisioning
    prismaMock.decorationMethod.findFirst.mockResolvedValue({
      id: "method-1",
      shopId: "shop-1",
      name: "Embroidery",
    });

    // After re-provision, variantSlot.count returns 0 so it creates a new pool
    prismaMock.variantSlot.count.mockResolvedValue(0);
    prismaMock.$transaction.mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) return ops.map(() => ({}));
      return (ops as (tx: unknown) => Promise<unknown>)(prismaMock);
    });

    // adminGraphql: first call returns null product (existence check),
    // subsequent calls return full success data
    const jsonMock = vi
      .fn()
      .mockResolvedValueOnce({ data: { product: null } }) // product existence check
      .mockResolvedValue({
        data: {
          publications: { edges: [{ node: { id: "pub-1", name: "Online Store" } }] },
          publishablePublish: { userErrors: [] },
          productCreate: {
            product: {
              id: "gid://shopify/Product/NEW",
              variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/10" } }] },
            },
            userErrors: [],
          },
          productVariantsBulkUpdate: { productVariants: [], userErrors: [] },
          productVariantsBulkCreate: {
            productVariants: Array.from({ length: 9 }, (_, i) => ({
              id: `gid://shopify/ProductVariant/${i + 11}`,
            })),
            userErrors: [],
          },
          product: { id: "gid://shopify/Product/NEW", variants: { edges: [] } },
          inventoryItemUpdate: { inventoryItem: { tracked: false }, userErrors: [] },
        },
      });

    const adminGraphql = vi.fn().mockReturnValue({ json: jsonMock });

    await expect(
      ensureVariantPoolExists("shop-1", "method-1", adminGraphql)
    ).resolves.toBeUndefined();

    // Stale slots must be deleted
    expect(prismaMock.variantSlot.deleteMany).toHaveBeenCalledWith({
      where: { shopId: "shop-1", methodId: "method-1" },
    });
    // Active config linked to slot-1 (cfg-1) must be expired via slot-side
    // currentConfigId lookup, not the dropped variantSlotId back-pointer.
    expect(prismaMock.customizationConfig.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["cfg-1"] }, state: { in: ["RESERVED", "IN_CART"] } },
      data: { state: "EXPIRED", expiredAt: expect.any(Date) },
    });
  });
});
