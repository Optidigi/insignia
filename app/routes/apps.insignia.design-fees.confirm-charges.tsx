// design-fees: POST /apps/insignia/design-fees/confirm-charges
// Persists CartDesignFeeCharge rows AFTER /cart/add.js succeeds (§14.B race fix).

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { AppError, ErrorCodes } from "../lib/errors.server";
import { checkRateLimit } from "../lib/storefront/rate-limit.server";
import { designFeesEnabled } from "../lib/services/design-fees/feature-flag.server";
import { confirmDesignFeeCharges } from "../lib/services/design-fees/confirm-charges.server";

function jsonResponse(data: unknown, status = 200, origin?: string, extra?: Record<string, string>): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  if (extra) Object.assign(headers, extra);
  return new Response(JSON.stringify(data), { status, headers });
}

// design-fees: modern Shopify cart tokens include `?key=…` suffix.
// Sanity check only — no security impact.
const CART_TOKEN_FORMAT = /^[A-Za-z0-9_\-?=&:.+~]{1,512}$/;
const HEX64 = /^[a-f0-9]{64}$/i;
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
        { error: { code: "UNAUTHORIZED", message: "Invalid or missing App Proxy signature" } },
        401,
      );
    }
    const origin = `https://${shopDomain}`;

    if (!designFeesEnabled()) {
      // Feature off → no-op, but still return well-formed response
      return jsonResponse({ persisted: [], conflicts: [] }, 200, origin);
    }

    const shop = await db.shop.findUnique({
      where: { shopifyDomain: shopDomain },
      select: { id: true },
    });
    if (!shop) return jsonResponse({ error: { code: "NOT_FOUND", message: "Shop not found" } }, 404, origin);

    const rateLimit = checkRateLimit(shop.id);
    if (!rateLimit.allowed) {
      return jsonResponse(
        { error: { code: "RATE_LIMITED", message: "Too many requests" } },
        429,
        origin,
        { "Retry-After": String(rateLimit.retryAfter) },
      );
    }

    let body: {
      cartToken?: string;
      inputs?: Array<{
        tempId?: string;
        slotId?: string;
        shopifyVariantId?: string;
        shopifyLineKey?: string | null;
        feeCentsCharged?: number;
        categoryId?: string;
        methodId?: string;
        logoContentHash?: string;
      }>;
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
    const inputs = Array.isArray(body.inputs) ? body.inputs : [];
    const validInputs = inputs.filter((i) =>
      typeof i.tempId === "string" &&
      typeof i.slotId === "string" && UUID_FORMAT.test(i.slotId) &&
      typeof i.shopifyVariantId === "string" && i.shopifyVariantId.length > 0 &&
      typeof i.feeCentsCharged === "number" && i.feeCentsCharged >= 0 &&
      typeof i.categoryId === "string" && UUID_FORMAT.test(i.categoryId) &&
      typeof i.methodId === "string" && UUID_FORMAT.test(i.methodId) &&
      typeof i.logoContentHash === "string" && HEX64.test(i.logoContentHash),
    ).map((i) => ({
      tempId: i.tempId as string,
      slotId: i.slotId as string,
      shopifyVariantId: i.shopifyVariantId as string,
      shopifyLineKey: typeof i.shopifyLineKey === "string" ? i.shopifyLineKey : null,
      feeCentsCharged: Math.round(i.feeCentsCharged as number),
      categoryId: i.categoryId as string,
      methodId: i.methodId as string,
      logoContentHash: (i.logoContentHash as string).toLowerCase(),
    }));

    const result = await confirmDesignFeeCharges({
      shopId: shop.id,
      cartToken,
      inputs: validInputs,
    });
    return jsonResponse(result, 200, origin);
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof AppError) {
      return jsonResponse({ error: { code: error.code, message: error.message } }, error.status);
    }
    console.error("[design-fees/confirm-charges] error:", error);
    return jsonResponse(
      { error: { code: "INTERNAL_ERROR", message: "Failed to confirm design-fee charges" } },
      500,
    );
  }
};
