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
import { cleanupStaleDrafts, cleanupStaleUploadSessions } from "../lib/services/cron-cleanup.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  verifyCronToken(request);

  const [draftsResult, uploadsResult] = await Promise.all([
    cleanupStaleDrafts(db),
    cleanupStaleUploadSessions(db),
  ]);
  console.log(`[cron/cleanup-drafts] drafts=${draftsResult.deleted} uploads=${uploadsResult.deleted}`);

  return Response.json({
    deletedDrafts: draftsResult.deleted,
    deletedUploadSessions: uploadsResult.deleted,
    timestamp: new Date().toISOString(),
  });
};
