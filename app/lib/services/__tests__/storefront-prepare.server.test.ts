// app/lib/services/__tests__/storefront-prepare.server.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted db mock — must exist before any module is imported
// ---------------------------------------------------------------------------
const prismaMock = vi.hoisted(() => {
  const makeFn = () => vi.fn();
  return {
    customizationDraft: {
      findFirst: makeFn(),
    },
    customizationConfig: {
      findFirst: makeFn(),
      create: makeFn(),
      update: makeFn(),
    },
    variantSlot: {
      findMany: makeFn(),
      update: makeFn(),
    },
    $transaction: makeFn(),
  };
});

vi.mock("../../../db.server", () => ({
  default: prismaMock,
}));

vi.mock("../variant-pool.server", () => ({
  ensureVariantPoolExists: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../storefront-customizations.server", () => ({
  computeCustomizationPrice: vi.fn().mockResolvedValue({
    unitPriceCents: 1500,
    feeCents: 500,
    breakdown: [],
    validation: { ok: true },
  }),
}));

// Static imports after mocks
import { prepareCustomization } from "../storefront-prepare.server";
import { ErrorCodes } from "../../errors.server";
import { ensureVariantPoolExists } from "../variant-pool.server";
import { computeCustomizationPrice } from "../storefront-customizations.server";

beforeEach(() => {
  vi.resetAllMocks();
  // Restore the default no-op mock for ensureVariantPoolExists after reset
  vi.mocked(ensureVariantPoolExists).mockResolvedValue(undefined);
  // Restore default pricing mock after reset
  vi.mocked(computeCustomizationPrice).mockResolvedValue({
    unitPriceCents: 1500,
    feeCents: 500,
    breakdown: [],
    validation: { ok: true },
  });
});

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const MOCK_DRAFT = {
  id: "draft-1",
  shopId: "shop-1",
  methodId: "method-1",
  unitPriceCents: 1500,
  feeCents: 500,
  configHash: "abc123",
  pricingVersion: "v1",
};

const MOCK_SLOT = {
  id: "slot-1",
  shopifyProductId: "gid://shopify/Product/99",
  shopifyVariantId: "gid://shopify/ProductVariant/1",
};

/** adminGraphql that reports the product as alive */
function makeAdminGraphql() {
  return vi.fn().mockResolvedValue({
    json: vi.fn().mockResolvedValue({
      data: {
        product: { id: "gid://shopify/Product/99" },
        productVariantsBulkUpdate: { productVariants: [], userErrors: [] },
      },
    }),
  });
}

/** $transaction mock that simulates the real transaction body, returning a slot */
function makeSuccessfulTransaction() {
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => {
      const fakeTx = {
        $queryRaw: vi.fn().mockResolvedValue([MOCK_SLOT]),
        customizationConfig: {
          create: vi.fn().mockResolvedValue({ id: "cfg-new" }),
          update: vi.fn().mockResolvedValue({}),
        },
        variantSlot: {
          update: vi.fn().mockResolvedValue({}),
        },
      };
      return fn(fakeTx);
    }
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("prepareCustomization", () => {
  it("throws NOT_FOUND when the draft is missing", async () => {
    prismaMock.customizationDraft.findFirst.mockResolvedValue(null);

    const adminGraphql = makeAdminGraphql();

    await expect(
      prepareCustomization("shop-1", "draft-missing", adminGraphql)
    ).rejects.toMatchObject({
      code: ErrorCodes.NOT_FOUND,
      message: expect.stringContaining("Customization not found"),
    });

    expect(prismaMock.customizationConfig.findFirst).not.toHaveBeenCalled();
  });

  it("is idempotent — returns existing RESERVED config data without reserving a new slot", async () => {
    prismaMock.customizationDraft.findFirst.mockResolvedValue(MOCK_DRAFT);

    // An existing RESERVED config with a linked slot
    prismaMock.customizationConfig.findFirst.mockResolvedValue({
      id: "cfg-existing",
      configHash: "abc123",
      pricingVersion: "v1",
      unitPriceCents: 1500,
      feeCents: 500,
      state: "RESERVED",
      variantSlot: {
        shopifyVariantId: "gid://shopify/ProductVariant/1",
        shopifyProductId: "gid://shopify/Product/99",
      },
    });

    // adminGraphql confirms the product still exists
    const adminGraphql = makeAdminGraphql();

    const result = await prepareCustomization("shop-1", "draft-1", adminGraphql);

    expect(result).toEqual({
      slotVariantId: "gid://shopify/ProductVariant/1",
      configHash: "abc123",
      pricingVersion: "v1",
      unitPriceCents: 1500,
      feeCents: 500,
    });

    // Must NOT have reserved a new slot
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.variantSlot.update).not.toHaveBeenCalled();

    // Verify no new slot was provisioned (idempotent path short-circuits)
    expect(vi.mocked(ensureVariantPoolExists)).not.toHaveBeenCalled();
  });

  it("reserves a slot when no prior config exists and returns pricing data", async () => {
    prismaMock.customizationDraft.findFirst.mockResolvedValue(MOCK_DRAFT);
    // No existing config
    prismaMock.customizationConfig.findFirst.mockResolvedValue(null);
    // No expired slots to recycle
    prismaMock.variantSlot.findMany.mockResolvedValue([]);

    makeSuccessfulTransaction();

    const adminGraphql = makeAdminGraphql();

    const result = await prepareCustomization("shop-1", "draft-1", adminGraphql);

    expect(result.slotVariantId).toBe("gid://shopify/ProductVariant/1");
    expect(result.unitPriceCents).toBe(1500);
    expect(result.feeCents).toBe(500);
    expect(result.configHash).toBe("abc123");

    // ensureVariantPoolExists must have been called
    expect(ensureVariantPoolExists).toHaveBeenCalledWith("shop-1", "method-1", adminGraphql);

    // $transaction must have been called
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("throws SERVICE_UNAVAILABLE when no free slot is available", async () => {
    prismaMock.customizationDraft.findFirst.mockResolvedValue(MOCK_DRAFT);
    prismaMock.customizationConfig.findFirst.mockResolvedValue(null);
    prismaMock.variantSlot.findMany.mockResolvedValue([]);

    // Transaction returns no free slots
    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const fakeTx = {
          $queryRaw: vi.fn().mockResolvedValue([]), // no free slots
          customizationConfig: { create: vi.fn() },
          variantSlot: { update: vi.fn() },
        };
        return fn(fakeTx);
      }
    );

    const adminGraphql = makeAdminGraphql();

    await expect(
      prepareCustomization("shop-1", "draft-1", adminGraphql)
    ).rejects.toMatchObject({
      code: ErrorCodes.SERVICE_UNAVAILABLE,
      message: expect.stringContaining("All customization slots are in use"),
    });
  });
});
