// design-fees: POST /apps/insignia/design-fees/abort-charges
// /cart/add.js failed → free reserved slots, persist nothing.

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { AppError, ErrorCodes } from "../lib/errors.server";
import { designFeesEnabled } from "../lib/services/design-fees/feature-flag.server";
import { abortDesignFeeCharges } from "../lib/services/design-fees/confirm-charges.server";

function jsonResponse(data: unknown, status = 200, origin?: string): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(data), { status, headers });
}

const UUID_FORMAT = /^[a-f0-9-]{36}$/i;

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } }, 405);
  }
  try {
    const { session } = await authenticate.public.appProxy(request);
    const shopDomain = session?.shop;
    if (!shopDomain) {
      return jsonResponse(
        { error: { code: "UNAUTHORIZED", message: "Invalid App Proxy signature" } },
        401,
      );
    }
    const origin = `https://${shopDomain}`;

    if (!designFeesEnabled()) {
      return jsonResponse({ freed: 0 }, 200, origin);
    }

    const shop = await db.shop.findUnique({
      where: { shopifyDomain: shopDomain },
      select: { id: true },
    });
    if (!shop) return jsonResponse({ error: { code: "NOT_FOUND", message: "Shop not found" } }, 404, origin);

    let body: { slotIds?: string[] };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: { code: ErrorCodes.BAD_REQUEST, message: "Invalid JSON" } }, 400, origin);
    }
    const slotIds = Array.isArray(body.slotIds)
      ? body.slotIds.filter((s): s is string => typeof s === "string" && UUID_FORMAT.test(s))
      : [];

    const result = await abortDesignFeeCharges({ slotIds });
    return jsonResponse(result, 200, origin);
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof AppError) {
      return jsonResponse({ error: { code: error.code, message: error.message } }, error.status);
    }
    console.error("[design-fees/abort-charges] error:", error);
    return jsonResponse(
      { error: { code: "INTERNAL_ERROR", message: "Failed to abort design-fee charges" } },
      500,
    );
  }
};
