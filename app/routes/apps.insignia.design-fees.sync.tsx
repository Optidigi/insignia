// design-fees: POST /apps/insignia/design-fees/sync
// Storefront passes the live /cart.js contents → server returns orphaned charge
// rows so the storefront can /cart/change.js qty=0 them. Once the storefront
// confirms removal (commit=true), the server deletes the charge rows + frees
// the slots.

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { AppError, ErrorCodes } from "../lib/errors.server";
import { designFeesEnabled } from "../lib/services/design-fees/feature-flag.server";
import {
  detectOrphanCharges,
  commitOrphanRemoval,
  type CartLineRef,
} from "../lib/services/design-fees/sync.server";

function jsonResponse(data: unknown, status = 200, origin?: string): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(data), { status, headers });
}

// design-fees: modern Shopify cart tokens include `?key=…` suffix.
const CART_TOKEN_FORMAT = /^[A-Za-z0-9_\-?=&:.+~]{1,512}$/;

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
      return jsonResponse({ orphans: [], removed: 0 }, 200, origin);
    }

    const shop = await db.shop.findUnique({
      where: { shopifyDomain: shopDomain },
      select: { id: true },
    });
    if (!shop) return jsonResponse({ error: { code: "NOT_FOUND", message: "Shop not found" } }, 404, origin);

    let body: {
      cartToken?: string;
      cartLines?: Array<{
        key?: string;
        variant_id?: number;
        properties?: Record<string, string> | null;
      }>;
      // when true, server commits the deletion after detection (storefront
      // already removed the lines client-side)
      commit?: boolean;
    };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: { code: ErrorCodes.BAD_REQUEST, message: "Invalid JSON" } }, 400, origin);
    }

    const cartToken = body.cartToken;
    if (typeof cartToken !== "string" || !CART_TOKEN_FORMAT.test(cartToken)) {
      return jsonResponse(
        { error: { code: ErrorCodes.BAD_REQUEST, message: "Invalid cartToken" } },
        400,
        origin,
      );
    }

    const cartLines: CartLineRef[] = Array.isArray(body.cartLines)
      ? body.cartLines
          .filter((l) => typeof l === "object" && l !== null && typeof l.key === "string" && typeof l.variant_id === "number")
          .map((l) => ({
            key: l.key as string,
            variant_id: l.variant_id as number,
            properties: l.properties ?? null,
          }))
      : [];

    const orphans = await detectOrphanCharges({
      shopId: shop.id,
      cartToken,
      cartLines,
    });

    if (body.commit === true && orphans.length > 0) {
      const r = await commitOrphanRemoval({ decisions: orphans });
      return jsonResponse({ orphans, removed: r.removed }, 200, origin);
    }

    return jsonResponse({ orphans, removed: 0 }, 200, origin);
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof AppError) {
      return jsonResponse({ error: { code: error.code, message: error.message } }, error.status);
    }
    console.error("[design-fees/sync] error:", error);
    return jsonResponse(
      { error: { code: "INTERNAL_ERROR", message: "Failed to sync design-fee charges" } },
      500,
    );
  }
};
