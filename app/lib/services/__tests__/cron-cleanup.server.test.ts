// app/lib/services/__tests__/cron-cleanup.server.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { cleanupExpiredSlots, cleanupStaleDrafts } from "../cron-cleanup.server";

const db = mockDeep<PrismaClient>();

beforeEach(() => {
  mockReset(db);
});

describe("cleanupExpiredSlots", () => {
  it("frees expired RESERVED slots and expires their linked configs", async () => {
    db.variantSlot.findMany
      .mockResolvedValueOnce([{ id: "slot-1", currentConfigId: "cfg-1" }] as never)
      .mockResolvedValueOnce([] as never);
    db.variantSlot.updateMany.mockResolvedValue({ count: 1 });
    db.customizationConfig.updateMany.mockResolvedValue({ count: 1 });

    const result = await cleanupExpiredSlots(db as unknown as PrismaClient);

    expect(result).toEqual({ freedSlots: 1, expiredConfigs: 1 });
    expect(db.variantSlot.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["slot-1"] } },
      data: {
        state: "FREE",
        reservedAt: null,
        reservedUntil: null,
        inCartUntil: null,
        currentConfigId: null,
      },
    });
    expect(db.customizationConfig.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["cfg-1"] } },
      data: expect.objectContaining({ state: "EXPIRED", expiredAt: expect.any(Date) }),
    });
  });

  it("frees expired IN_CART slots", async () => {
    db.variantSlot.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ id: "slot-2", currentConfigId: null }] as never);
    db.variantSlot.updateMany.mockResolvedValue({ count: 1 });

    const result = await cleanupExpiredSlots(db as unknown as PrismaClient);

    expect(result).toEqual({ freedSlots: 1, expiredConfigs: 0 });
    expect(db.customizationConfig.updateMany).not.toHaveBeenCalled();
  });

  it("returns zeros and makes no DB writes when nothing has expired", async () => {
    db.variantSlot.findMany.mockResolvedValue([] as never);

    const result = await cleanupExpiredSlots(db as unknown as PrismaClient);

    expect(result).toEqual({ freedSlots: 0, expiredConfigs: 0 });
    expect(db.variantSlot.updateMany).not.toHaveBeenCalled();
    expect(db.customizationConfig.updateMany).not.toHaveBeenCalled();
  });

  it("only expires configs with a non-null currentConfigId", async () => {
    db.variantSlot.findMany
      .mockResolvedValueOnce([
        { id: "slot-3", currentConfigId: null },
        { id: "slot-4", currentConfigId: "cfg-4" },
      ] as never)
      .mockResolvedValueOnce([] as never);
    db.variantSlot.updateMany.mockResolvedValue({ count: 2 });
    db.customizationConfig.updateMany.mockResolvedValue({ count: 1 });

    const result = await cleanupExpiredSlots(db as unknown as PrismaClient);

    expect(result).toEqual({ freedSlots: 2, expiredConfigs: 1 });
    expect(db.customizationConfig.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["cfg-4"] } },
      data: expect.objectContaining({ state: "EXPIRED", expiredAt: expect.any(Date) }),
    });
  });
});

describe("cleanupStaleDrafts", () => {
  it("deletes drafts older than 24 hours", async () => {
    db.customizationDraft.deleteMany.mockResolvedValue({ count: 42 });

    const result = await cleanupStaleDrafts(db as unknown as PrismaClient);

    expect(result).toEqual({ deleted: 42 });

    const call = db.customizationDraft.deleteMany.mock.calls[0][0];
    const cutoff = call?.where?.createdAt?.lt as Date;
    const diff = Date.now() - cutoff.getTime();
    expect(diff).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(diff).toBeLessThan(25 * 60 * 60 * 1000);
  });

  it("returns zero when no stale drafts exist", async () => {
    db.customizationDraft.deleteMany.mockResolvedValue({ count: 0 });
    expect(await cleanupStaleDrafts(db as unknown as PrismaClient)).toEqual({ deleted: 0 });
  });
});
