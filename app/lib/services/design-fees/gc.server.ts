// design-fees: GC for stale charges + slots. Cron-callable.
// Cutoff defaults to 30 days per §14.H (storage is cheap, padding against
// merchants who extend cart-cookie life via cart_persistence settings).

import type { PrismaClient } from "@prisma/client";
import { cleanupExpiredDesignFeeSlots } from "./slot-pool.server";

const DEFAULT_CUTOFF_DAYS = 30;

/**
 * Delete CartDesignFeeCharge rows older than `cutoffDays` (default 30).
 * Pure-function style, mirrors cleanupStaleDrafts in cron-cleanup.server.ts.
 */
export async function cleanupStaleDesignFeeCharges(
  prisma: PrismaClient,
  opts?: { cutoffDays?: number },
): Promise<{ deleted: number }> {
  const cutoffDays = opts?.cutoffDays ?? DEFAULT_CUTOFF_DAYS;
  const cutoff = new Date(Date.now() - cutoffDays * 24 * 60 * 60 * 1000);
  const r = await prisma.cartDesignFeeCharge.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { deleted: r.count };
}

export { cleanupExpiredDesignFeeSlots };
