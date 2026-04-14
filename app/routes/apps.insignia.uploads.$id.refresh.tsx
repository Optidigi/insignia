/**
 * POST /apps/insignia/uploads/:id/refresh
 *
 * Generate fresh presigned URLs for a logo asset to prevent expiry during long sessions.
 * Canonical: docs/core/api-contracts/storefront.md
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getPresignedGetUrl } from "../lib/storage.server";
import { AppError, ErrorCodes } from "../lib/errors.server";
import { checkRateLimit } from "../lib/storefront/rate-limit.server";

function jsonResponse(data: unknown, status = 200, origin?: string, extra?: Record<string, string>): Response {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  if (extra) Object.assign(headers, extra);
  return new Response(JSON.stringify(data), { status, headers });
}

// 10-minute TTL for refreshed presigned URLs
const REFRESH_TTL_SEC = 10 * 60;

export const action = async ({ request, params }: ActionFunctionArgs) => {
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

  const assetId = params.id;
  if (!assetId) {
    return jsonResponse(
      { error: { code: ErrorCodes.BAD_REQUEST, message: "Asset ID required" } },
      400
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

  try {
    // Find the logo asset and verify shop ownership
    const asset = await db.logoAsset.findFirst({
      where: { id: assetId, shopId: shop.id },
      select: { previewPngUrl: true, sanitizedSvgUrl: true },
    });
    if (!asset) {
      return jsonResponse({ error: { code: "NOT_FOUND", message: "Asset not found" } }, 404, origin);
    }

    // Generate fresh presigned URLs — DB fields store storage keys, not full URLs
    const previewUrl = await getPresignedGetUrl(asset.previewPngUrl, REFRESH_TTL_SEC);
    const sanitizedUrl = asset.sanitizedSvgUrl
      ? await getPresignedGetUrl(asset.sanitizedSvgUrl, REFRESH_TTL_SEC)
      : null;

    return jsonResponse({ previewUrl, sanitizedUrl }, 200, origin);
  } catch (error) {
    if (error instanceof AppError) {
      return jsonResponse({ error: { code: error.code, message: error.message } }, error.status, origin);
    }
    console.error("[uploads/refresh] Unexpected error:", error);
    return jsonResponse(
      { error: { code: "INTERNAL_ERROR", message: "Refresh failed" } },
      500,
      origin
    );
  }
};
