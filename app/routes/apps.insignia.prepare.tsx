/**
 * POST /apps/insignia/prepare
 *
 * Reserve a slot variant and set purchasable price.
 * Canonical: docs/core/api-contracts/storefront.md, variant-pool/implementation.md
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";
import { prepareCustomization } from "../lib/services/storefront-prepare.server";
import { checkRateLimit } from "../lib/storefront/rate-limit.server";
import { AppError, ErrorCodes } from "../lib/errors.server";

function jsonResponse(data: unknown, status = 200, origin?: string, extra?: Record<string, string>): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  if (extra) Object.assign(headers, extra);
  return new Response(JSON.stringify(data), { status, headers });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } }, 405);
  }

  try {
    const { session } = await authenticate.public.appProxy(request);
    const shopDomain = session?.shop;
    if (!shopDomain) {
      // Before shopDomain is validated — do not echo untrusted Origin
      return jsonResponse(
        { error: { code: "UNAUTHORIZED", message: "Invalid or missing App Proxy signature" } },
        401
      );
    }

    const origin = `https://${shopDomain}`;

    const shop = await db.shop.findUnique({
      where: { shopifyDomain: shopDomain },
      select: { id: true },
    });
    if (!shop) {
      return jsonResponse({ error: { code: "NOT_FOUND", message: "Shop not found" } }, 404, origin);
    }

    const rateLimit = checkRateLimit(shop.id);
    if (!rateLimit.allowed) {
      return jsonResponse(
        { error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down." } },
        429,
        origin,
        { "Retry-After": String(rateLimit.retryAfter) }
      );
    }

    // design-fees: cartToken is best-effort dedup, NOT a security boundary
    let body: { customizationId?: string; cartToken?: string | null };
    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { error: { code: ErrorCodes.BAD_REQUEST, message: "Invalid JSON body" } },
        400,
        origin
      );
    }
    const customizationId = body.customizationId;
    if (!customizationId) {
      return jsonResponse(
        { error: { code: ErrorCodes.BAD_REQUEST, message: "customizationId is required" } },
        400,
        origin
      );
    }

    const ID_FORMAT = /^[a-f0-9-]{36}$/i;
    if (!ID_FORMAT.test(String(customizationId))) {
      return jsonResponse(
        { error: { code: "BAD_REQUEST", message: "Invalid customizationId format" } },
        400,
        origin
      );
    }

    // Guard: ensure product config has methods and placements before preparing
    const draft = await db.customizationDraft.findFirst({
      where: { id: String(customizationId), shopId: shop.id },
      select: { productConfigId: true },
    });
    if (!draft) {
      return jsonResponse(
        { error: { code: "NOT_FOUND", message: "Customization draft not found" } },
        404, origin
      );
    }
    const prepConfig = await db.productConfig.findFirst({
      where: { id: draft.productConfigId, shopId: shop.id },
      include: {
        allowedMethods: true,
        views: { include: { placements: true } },
      },
    });
    if (!prepConfig || prepConfig.allowedMethods.length === 0) {
      return jsonResponse(
        { error: { code: "INVALID_CONFIG", message: "Product has no decoration methods configured" } },
        422, origin
      );
    }
    if (prepConfig.views.every((v) => v.placements.length === 0)) {
      return jsonResponse(
        { error: { code: "INVALID_CONFIG", message: "Product has no placements configured" } },
        422, origin
      );
    }

    const { admin } = await unauthenticated.admin(shopDomain);

    const runGraphql = async (query: string, variables?: Record<string, unknown>) => {
      const response = await admin.graphql(query, { variables } as Record<string, unknown>);
      return response as Response;
    };

    // design-fees: validate cart token format. On invalid → null (silent degrade).
    // Modern Shopify cart tokens include a base64-ish prefix + `?key=…` suffix.
    // Allow URL-safe characters and a generous length cap. Sanity check only —
    // no security impact (token is only used as DB dedup key, never injected).
    const CART_TOKEN_FORMAT = /^[A-Za-z0-9_\-?=&:.+~]{1,512}$/;
    const rawCartToken = typeof body.cartToken === "string" ? body.cartToken : null;
    const cartToken = rawCartToken && CART_TOKEN_FORMAT.test(rawCartToken) ? rawCartToken : null;
    const result = await prepareCustomization(shop.id, String(customizationId), runGraphql, cartToken);
    return jsonResponse(result, 200, origin);
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof AppError) {
      return jsonResponse({ error: { code: error.code, message: error.message } }, error.status);
    }
    console.error("[prepare] Unexpected error:", error);
    return jsonResponse(
      { error: { code: "INTERNAL_ERROR", message: process.env.NODE_ENV === "production" ? "An unexpected error occurred" : (error instanceof Error ? error.message : "Internal error") } },
      500
    );
  }
};

