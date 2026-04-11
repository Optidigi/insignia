/**
 * POST /apps/insignia/uploads/:id/complete
 *
 * Finalize an upload and return the created logo asset (preview PNG + sanitized SVG URLs).
 * Canonical: docs/core/api-contracts/storefront.md
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { completeStorefrontUpload } from "../lib/services/storefront-uploads.server";
import { AppError, ErrorCodes } from "../lib/errors.server";
import { checkRateLimit } from "../lib/storefront/rate-limit.server";

function jsonResponse(data: unknown, status = 200, origin?: string, extra?: Record<string, string>): Response {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  if (extra) Object.assign(headers, extra);
  return new Response(JSON.stringify(data), { status, headers });
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": request.headers.get("Origin") ?? "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
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

  const shop = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true },
  });
  if (!shop) {
    return jsonResponse({ error: { code: "NOT_FOUND", message: "Shop not found" } }, 404);
  }

  const origin = `https://${shopDomain}`;

  const rateLimit = checkRateLimit(shop.id);
  if (!rateLimit.allowed) {
    return jsonResponse(
      { error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down." } },
      429,
      origin,
      { "Retry-After": String(rateLimit.retryAfter) }
    );
  }

  const uploadId = params.id;
  if (!uploadId) {
    return jsonResponse(
      { error: { code: ErrorCodes.BAD_REQUEST, message: "Upload id is required" } },
      400
    );
  }
  try {
    const result = await completeStorefrontUpload(shop.id, uploadId);
    return jsonResponse(result, 200, origin);
  } catch (error) {
    if (error instanceof AppError) {
      return jsonResponse({ error: { code: error.code, message: error.message } }, error.status, origin);
    }
    console.error("[uploads/complete] Unexpected error:", error);
    return jsonResponse(
      { error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Complete failed" } },
      500,
      origin
    );
  }
};

