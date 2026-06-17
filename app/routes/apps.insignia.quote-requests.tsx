/**
 * POST /apps/insignia/quote-requests
 *
 * Persist a Stitchs quote-request flow submission. This is intentionally
 * separate from the cart/variant-pool customization flow.
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { AppError, ErrorCodes } from "../lib/errors.server";
import { checkRateLimit } from "../lib/storefront/rate-limit.server";
import {
  createQuoteRequest,
  QuoteRequestInputSchema,
} from "../lib/services/quote-requests.server";

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

  const { session } = await authenticate.public.appProxy(request);
  const shopDomain = session?.shop;
  if (!shopDomain) {
    return jsonResponse(
      { error: { code: "UNAUTHORIZED", message: "Invalid or missing App Proxy signature" } },
      401
    );
  }

  const allowedOrigin = `https://${shopDomain}`;
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true },
  });
  if (!shop) {
    return jsonResponse({ error: { code: "NOT_FOUND", message: "Shop not found" } }, 404, allowedOrigin);
  }

  const rateLimit = checkRateLimit(shop.id);
  if (!rateLimit.allowed) {
    return jsonResponse(
      { error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down." } },
      429,
      allowedOrigin,
      { "Retry-After": String(rateLimit.retryAfter) }
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonResponse(
      { error: { code: ErrorCodes.BAD_REQUEST, message: "Invalid JSON body" } },
      400,
      allowedOrigin
    );
  }

  const parsed = QuoteRequestInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonResponse(
      {
        error: {
          code: ErrorCodes.BAD_REQUEST,
          message: "Invalid quote request",
          details: parsed.error.flatten(),
        },
      },
      400,
      allowedOrigin
    );
  }

  try {
    const result = await createQuoteRequest(shop.id, parsed.data);
    return jsonResponse(result, 200, allowedOrigin);
  } catch (error) {
    if (error instanceof AppError) {
      return jsonResponse(
        { error: { code: error.code, message: error.message } },
        error.status,
        allowedOrigin
      );
    }
    console.error("[quote-requests] Unexpected error:", error);
    return jsonResponse(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: process.env.NODE_ENV === "production" ? "An unexpected error occurred" : (error instanceof Error ? error.message : "Internal error"),
        },
      },
      500,
      allowedOrigin
    );
  }
};
