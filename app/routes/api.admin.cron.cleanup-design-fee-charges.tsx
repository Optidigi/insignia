// design-fees: cron — delete CartDesignFeeCharge older than 30 days
// AND free expired DesignFeeSlot rows.
//
// POST /api/admin/cron/cleanup-design-fee-charges
// Authorization: Bearer $CRON_SECRET
//
// No-ops cleanly when DESIGN_FEES_ENABLED=false.

import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { verifyCronToken } from "../lib/cron-auth.server";
import {
  cleanupStaleDesignFeeCharges,
  cleanupExpiredDesignFeeSlots,
} from "../lib/services/design-fees/gc.server";
import { designFeesEnabled } from "../lib/services/design-fees/feature-flag.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  verifyCronToken(request);
  if (!designFeesEnabled()) {
    return Response.json({
      deleted: 0,
      freedSlots: 0,
      skipped: "feature_disabled",
      timestamp: new Date().toISOString(),
    });
  }
  const charges = await cleanupStaleDesignFeeCharges(db);
  const slots = await cleanupExpiredDesignFeeSlots(db);
  console.log(
    `[cron/cleanup-design-fee-charges] deleted=${charges.deleted} freed_slots=${slots.freed}`,
  );
  return Response.json({
    deleted: charges.deleted,
    freedSlots: slots.freed,
    timestamp: new Date().toISOString(),
  });
};
