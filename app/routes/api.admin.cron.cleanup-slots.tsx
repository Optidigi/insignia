// app/routes/api.admin.cron.cleanup-slots.tsx
/**
 * Cron: Free expired variant slots and expire linked customization configs.
 *
 * POST /api/admin/cron/cleanup-slots
 * Authorization: Bearer $CRON_SECRET
 *
 * Called every 5 minutes by VPS cron (see docs/ops/cron-setup.md).
 * Safe to call more frequently — no-ops when nothing has expired.
 */

import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { verifyCronToken } from "../lib/cron-auth.server";
import { cleanupExpiredSlots } from "../lib/services/cron-cleanup.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  verifyCronToken(request);

  const result = await cleanupExpiredSlots(db);
  console.log(
    `[cron/cleanup-slots] freed=${result.freedSlots} expired_configs=${result.expiredConfigs}`
  );

  return Response.json({ ...result, timestamp: new Date().toISOString() });
};
