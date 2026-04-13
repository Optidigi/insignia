// app/lib/services/__tests__/storefront-cart-confirm.server.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted db mock
// ---------------------------------------------------------------------------
const prismaMock = vi.hoisted(() => {
  const makeFn = () => vi.fn();
  return {
    customizationConfig: {
      findFirst: makeFn(),
      update: makeFn(),
    },
    variantSlot: {
      update: makeFn(),
    },
    $transaction: makeFn(),
  };
});

vi.mock("../../../db.server", () => ({
  default: prismaMock,
}));

// Static imports after mocks
import { cartConfirm } from "../storefront-cart-confirm.server";
import { ErrorCodes } from "../../errors.server";

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const MOCK_CONFIG = {
  id: "cfg-1",
  shopId: "shop-1",
  customizationDraftId: "draft-1",
  state: "RESERVED",
  variantSlotId: "slot-1",
  variantSlot: {
    id: "slot-1",
    state: "RESERVED",
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cartConfirm", () => {
  it("transitions RESERVED config and slot to IN_CART (happy path)", async () => {
    prismaMock.customizationConfig.findFirst.mockResolvedValue(MOCK_CONFIG);

    // $transaction executes the callback
    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const fakeTx = {
          customizationConfig: {
            update: vi.fn().mockResolvedValue({}),
          },
          variantSlot: {
            update: vi.fn().mockResolvedValue({}),
          },
        };
        return fn(fakeTx);
      }
    );

    const result = await cartConfirm("shop-1", "draft-1");

    expect(result).toEqual({ ok: true });

    // Verify findFirst was queried for RESERVED state
    expect(prismaMock.customizationConfig.findFirst).toHaveBeenCalledWith({
      where: { shopId: "shop-1", customizationDraftId: "draft-1", state: "RESERVED" },
      include: { variantSlot: true },
    });

    // Verify transaction was called
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

    // Verify the transaction body updates config and slot
    const txFn = prismaMock.$transaction.mock.calls[0][0] as (tx: unknown) => Promise<void>;
    const spyTx = {
      customizationConfig: { update: vi.fn().mockResolvedValue({}) },
      variantSlot: { update: vi.fn().mockResolvedValue({}) },
    };
    await txFn(spyTx);

    expect(spyTx.customizationConfig.update).toHaveBeenCalledWith({
      where: { id: "cfg-1" },
      data: { state: "IN_CART", inCartAt: expect.any(Date) },
    });
    expect(spyTx.variantSlot.update).toHaveBeenCalledWith({
      where: { id: "slot-1" },
      data: { state: "IN_CART", inCartUntil: expect.any(Date) },
    });
  });

  it("sets inCartUntil TTL to ~7 days in the future", async () => {
    prismaMock.customizationConfig.findFirst.mockResolvedValue(MOCK_CONFIG);

    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const spyTx = {
          customizationConfig: { update: vi.fn().mockResolvedValue({}) },
          variantSlot: { update: vi.fn().mockResolvedValue({}) },
        };
        await fn(spyTx);
        // Capture the inCartUntil value from the slot update call
        const slotUpdateData = spyTx.variantSlot.update.mock.calls[0][0].data;
        const inCartUntil = slotUpdateData.inCartUntil as Date;
        const diffMs = inCartUntil.getTime() - Date.now();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        // Should be approximately 7 days (within a small tolerance for test execution time)
        expect(diffDays).toBeGreaterThan(6.9);
        expect(diffDays).toBeLessThanOrEqual(7.01);
        return undefined;
      }
    );

    await cartConfirm("shop-1", "draft-1");
  });

  it("throws NOT_FOUND when customizationId does not exist", async () => {
    prismaMock.customizationConfig.findFirst.mockResolvedValue(null);

    await expect(
      cartConfirm("shop-1", "nonexistent-draft")
    ).rejects.toMatchObject({
      code: ErrorCodes.NOT_FOUND,
      message: expect.stringContaining("Customization not found"),
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when config is already IN_CART (query filters for RESERVED only)", async () => {
    // findFirst returns null because the WHERE clause filters state: "RESERVED"
    // and the config is IN_CART
    prismaMock.customizationConfig.findFirst.mockResolvedValue(null);

    await expect(
      cartConfirm("shop-1", "already-in-cart-draft")
    ).rejects.toMatchObject({
      code: ErrorCodes.NOT_FOUND,
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when config is EXPIRED (query filters for RESERVED only)", async () => {
    // findFirst returns null because the WHERE clause filters state: "RESERVED"
    // and the config is EXPIRED
    prismaMock.customizationConfig.findFirst.mockResolvedValue(null);

    await expect(
      cartConfirm("shop-1", "expired-draft")
    ).rejects.toMatchObject({
      code: ErrorCodes.NOT_FOUND,
      message: expect.stringContaining("not in RESERVED state"),
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("skips slot update when config has no linked variantSlotId", async () => {
    const configNoSlot = {
      ...MOCK_CONFIG,
      variantSlotId: null,
      variantSlot: null,
    };
    prismaMock.customizationConfig.findFirst.mockResolvedValue(configNoSlot);

    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const spyTx = {
          customizationConfig: { update: vi.fn().mockResolvedValue({}) },
          variantSlot: { update: vi.fn().mockResolvedValue({}) },
        };
        await fn(spyTx);
        // variantSlot.update should NOT have been called
        expect(spyTx.variantSlot.update).not.toHaveBeenCalled();
        return undefined;
      }
    );

    const result = await cartConfirm("shop-1", "draft-1");
    expect(result).toEqual({ ok: true });
  });
});
