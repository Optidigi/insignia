// app/routes/api.admin.cron.cleanup-drafts.tsx
/**
 * Cron: Delete abandoned CustomizationDraft records older than 24 hours.
 *
 * POST /api/admin/cron/cleanup-drafts
 * Authorization: Bearer $CRON_SECRET
 *
 * Called hourly by VPS cron (see docs/ops/cron-setup.md).
 */

import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { verifyCronToken } from "../lib/cron-auth.server";
import { cleanupStaleDrafts } from "../lib/services/cron-cleanup.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  verifyCronToken(request);

  const result = await cleanupStaleDrafts(db);
  console.log(`[cron/cleanup-drafts] deleted=${result.deleted}`);

  return Response.json({ ...result, timestamp: new Date().toISOString() });
};
