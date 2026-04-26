// design-fees: tests for cleanupStaleDesignFeeCharges
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { cleanupStaleDesignFeeCharges } from "../gc.server";

const db = mockDeep<PrismaClient>();

beforeEach(() => {
  mockReset(db);
});

describe("cleanupStaleDesignFeeCharges", () => {
  it("deletes charges older than 30 days by default", async () => {
    db.cartDesignFeeCharge.deleteMany.mockResolvedValue({ count: 7 });
    const result = await cleanupStaleDesignFeeCharges(db as unknown as PrismaClient);
    expect(result).toEqual({ deleted: 7 });
    const call = db.cartDesignFeeCharge.deleteMany.mock.calls[0][0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cutoff = (call?.where?.createdAt as any)?.lt as Date;
    const diff = Date.now() - cutoff.getTime();
    expect(diff).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(diff).toBeLessThan(31 * 24 * 60 * 60 * 1000);
  });

  it("respects a custom cutoffDays", async () => {
    db.cartDesignFeeCharge.deleteMany.mockResolvedValue({ count: 0 });
    await cleanupStaleDesignFeeCharges(db as unknown as PrismaClient, { cutoffDays: 7 });
    const call = db.cartDesignFeeCharge.deleteMany.mock.calls[0][0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cutoff = (call?.where?.createdAt as any)?.lt as Date;
    const diff = Date.now() - cutoff.getTime();
    expect(diff).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(diff).toBeLessThan(8 * 24 * 60 * 60 * 1000);
  });
});
