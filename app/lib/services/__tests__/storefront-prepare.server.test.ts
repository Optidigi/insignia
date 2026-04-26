// app/lib/services/__tests__/storefront-prepare.server.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

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
      updateMany: makeFn(),
    },
    variantSlot: {
      findMany: makeFn(),
      findUnique: makeFn(),
      update: makeFn(),
      updateMany: makeFn(),
    },
    $transaction: makeFn(),
    $executeRaw: makeFn(),
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
    // design-fees: required field on the new PriceResult shape
    designFees: [],
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
    // design-fees: required field on the new PriceResult shape
    designFees: [],
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
        $executeRaw: vi.fn().mockResolvedValue(undefined), // advisory lock
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

    // An existing RESERVED config
    prismaMock.customizationConfig.findFirst.mockResolvedValue({
      id: "cfg-existing",
      configHash: "abc123",
      pricingVersion: "v1",
      unitPriceCents: 1500,
      feeCents: 500,
    });
    // The slot it currently owns
    prismaMock.variantSlot.findUnique.mockResolvedValue({
      shopifyVariantId: "gid://shopify/ProductVariant/1",
      shopifyProductId: "gid://shopify/Product/99",
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
      // design-fees: empty when no cart token / feature off
      pendingDesignFeeLines: [],
      designFeeTagging: null,
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
    // Expired-slot cleanup: nothing to expire
    prismaMock.variantSlot.findMany.mockResolvedValue([]);
    prismaMock.variantSlot.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.customizationConfig.updateMany.mockResolvedValue({ count: 0 });

    makeSuccessfulTransaction();

    const adminGraphql = makeAdminGraphql();

    const result = await prepareCustomization("shop-1", "draft-1", adminGraphql);

    expect(result.slotVariantId).toBe("gid://shopify/ProductVariant/1");
    expect(result.unitPriceCents).toBe(1500);
    expect(result.feeCents).toBe(500);
    expect(result.configHash).toBe("abc123");

    // ensureVariantPoolExists must have been called
    expect(ensureVariantPoolExists).toHaveBeenCalledWith("shop-1", "method-1", adminGraphql, 1);

    // $transaction must have been called
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("throws SERVICE_UNAVAILABLE when no free slot is available", async () => {
    prismaMock.customizationDraft.findFirst.mockResolvedValue(MOCK_DRAFT);
    prismaMock.customizationConfig.findFirst.mockResolvedValue(null);
    // Expired-slot cleanup: nothing to expire
    prismaMock.variantSlot.findMany.mockResolvedValue([]);
    prismaMock.variantSlot.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.customizationConfig.updateMany.mockResolvedValue({ count: 0 });

    // Transaction returns no free slots
    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const fakeTx = {
          $executeRaw: vi.fn().mockResolvedValue(undefined), // advisory lock
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

  it("is idempotent on P2002 — concurrent /prepare returns the winner's slot without 500", async () => {
    prismaMock.customizationDraft.findFirst.mockResolvedValue(MOCK_DRAFT);
    // No existing RESERVED config at the idempotency short-circuit
    prismaMock.customizationConfig.findFirst.mockResolvedValue(null);
    // Expired-slot cleanup: nothing to expire
    prismaMock.variantSlot.findMany.mockResolvedValue([]);
    prismaMock.variantSlot.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.customizationConfig.updateMany.mockResolvedValue({ count: 0 });

    // The winner's config that was created by the concurrent call
    const WINNER_CONFIG = {
      id: "cfg-winner",
      configHash: "abc123",
      pricingVersion: "v1",
      unitPriceCents: 1500,
      feeCents: 500,
    };
    const WINNER_SLOT = {
      id: "slot-winner",
      shopifyProductId: "gid://shopify/Product/99",
      shopifyVariantId: "gid://shopify/ProductVariant/1",
    };

    // Capture the fakeTx so we can assert $executeRaw was called (advisory lock contract).
    let capturedTx: { $executeRaw: ReturnType<typeof vi.fn> } | undefined;

    // Transaction mock: advisory lock ok, free slot found, create throws P2002,
    // findFirst returns the winner's config, findUnique returns the winner's slot.
    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const fakeTx = {
          $executeRaw: vi.fn().mockResolvedValue(undefined), // advisory lock
          $queryRaw: vi.fn().mockResolvedValue([MOCK_SLOT]), // free slot found
          customizationConfig: {
            create: vi.fn().mockRejectedValue(
              new Prisma.PrismaClientKnownRequestError(
                "Unique constraint failed on the constraint: `CustomizationConfig_customizationDraftId_state_key`",
                { code: "P2002", clientVersion: "6.0.0", meta: {} }
              )
            ),
            findFirst: vi.fn().mockResolvedValue(WINNER_CONFIG),
          },
          variantSlot: {
            findUnique: vi.fn().mockResolvedValue(WINNER_SLOT),
            update: vi.fn().mockResolvedValue({}),
          },
        };
        capturedTx = fakeTx;
        return fn(fakeTx);
      }
    );

    const adminGraphql = makeAdminGraphql();

    // Must NOT throw — must return the winner's slot data
    const result = await prepareCustomization("shop-1", "draft-1", adminGraphql);

    expect(result).toEqual({
      slotVariantId: "gid://shopify/ProductVariant/1",
      configHash: "abc123",
      pricingVersion: "v1",
      unitPriceCents: 1500,
      feeCents: 500,
      // design-fees: empty when no cart token / feature off
      pendingDesignFeeLines: [],
      designFeeTagging: null,
    });

    // The Shopify variant price update must NOT be called — the winner already set it
    expect(adminGraphql).not.toHaveBeenCalledWith(
      expect.stringContaining("productVariantsBulkUpdate"),
      expect.anything()
    );

    // Advisory lock must have been called — it is part of the concurrency contract.
    // If a future refactor drops the lock, this assertion will catch it.
    expect(capturedTx!.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
