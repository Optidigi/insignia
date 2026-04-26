/**
 * POST /apps/insignia/price
 *
 * Compute authoritative unit pricing for the review tab.
 * Canonical: docs/core/api-contracts/storefront.md
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";
import { computeCustomizationPrice } from "../lib/services/storefront-customizations.server";
import { AppError, ErrorCodes } from "../lib/errors.server";
import { checkRateLimit } from "../lib/storefront/rate-limit.server";

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

    const { admin } = await unauthenticated.admin(shopDomain);
    const runGraphql = async (query: string, variables?: Record<string, unknown>) => {
      return (await admin.graphql(query, { variables } as Record<string, unknown>)) as Response;
    };
    // design-fees: validate cart token format. Modern Shopify cart tokens
    // include `?key=…` suffix; allow URL-safe chars and a generous cap.
    // Sanity check only — no security impact.
    const CART_TOKEN_FORMAT = /^[A-Za-z0-9_\-?=&:.+~]{1,512}$/;
    const rawCartToken = typeof body.cartToken === "string" ? body.cartToken : null;
    const cartToken = rawCartToken && CART_TOKEN_FORMAT.test(rawCartToken) ? rawCartToken : null;
    const result = await computeCustomizationPrice(shop.id, String(customizationId), runGraphql, cartToken);
    return jsonResponse(result, 200, origin);
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof AppError) {
      return jsonResponse({ error: { code: error.code, message: error.message } }, error.status);
    }
    console.error("[price] Unexpected error:", error);
    return jsonResponse(
      { error: { code: "INTERNAL_ERROR", message: process.env.NODE_ENV === "production" ? "An unexpected error occurred" : (error instanceof Error ? error.message : "Internal error") } },
      500
    );
  }
};

