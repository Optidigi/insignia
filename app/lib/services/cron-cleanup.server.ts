// app/lib/services/cron-cleanup.server.ts
/**
 * Cron cleanup operations.
 * Pure functions that accept a PrismaClient — testable without module mocking.
 * Canonical: docs/ops/cron-setup.md
 */

import type { PrismaClient } from "@prisma/client";

/**
 * Free all expired RESERVED and IN_CART variant slots and expire their linked configs.
 *
 * @param prisma - Prisma client instance
 * @returns Count of freed slots and expired configs
 */
export async function cleanupExpiredSlots(
  prisma: PrismaClient
): Promise<{ freedSlots: number; expiredConfigs: number }> {
  const now = new Date();

  const [expiredReserved, expiredInCart] = await Promise.all([
    prisma.variantSlot.findMany({
      where: { state: "RESERVED", reservedUntil: { lt: now } },
      select: { id: true, currentConfigId: true },
    }),
    prisma.variantSlot.findMany({
      where: { state: "IN_CART", inCartUntil: { lt: now } },
      select: { id: true, currentConfigId: true },
    }),
  ]);

  const allExpired = [...expiredReserved, ...expiredInCart];
  if (allExpired.length === 0) {
    return { freedSlots: 0, expiredConfigs: 0 };
  }

  const slotIds = allExpired.map((s) => s.id);
  const configIds = allExpired
    .map((s) => s.currentConfigId)
    .filter((id): id is string => id !== null);

  await prisma.variantSlot.updateMany({
    where: { id: { in: slotIds } },
    data: {
      state: "FREE",
      reservedAt: null,
      reservedUntil: null,
      inCartUntil: null,
      currentConfigId: null,
    },
  });

  let expiredConfigs = 0;
  if (configIds.length > 0) {
    const r = await prisma.customizationConfig.updateMany({
      where: { id: { in: configIds } },
      data: { state: "EXPIRED" },
    });
    expiredConfigs = r.count;
  }

  return { freedSlots: allExpired.length, expiredConfigs };
}

/**
 * Delete CustomizationDraft records older than 24 hours.
 *
 * @param prisma - Prisma client instance
 * @returns Count of deleted draft records
 */
export async function cleanupStaleDrafts(
  prisma: PrismaClient
): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const r = await prisma.customizationDraft.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { deleted: r.count };
}
