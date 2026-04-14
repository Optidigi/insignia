/**
 * POST /apps/insignia/uploads
 *
 * Server-side file upload for buyer artwork. Accepts the file via FormData,
 * uploads to R2 server-side, processes it, and returns the created LogoAsset.
 * This avoids requiring R2 CORS configuration for the storefront domain.
 *
 * Canonical: docs/core/api-contracts/storefront.md
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { serverSideStorefrontUpload } from "../lib/services/storefront-uploads.server";
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

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file || !(file instanceof File)) {
      return jsonResponse(
        { error: { code: ErrorCodes.BAD_REQUEST, message: "file field is required (multipart/form-data)" } },
        400,
        origin
      );
    }

    const result = await serverSideStorefrontUpload(shop.id, file);
    return jsonResponse(result, 200, origin);
  } catch (error) {
    if (error instanceof AppError) {
      return jsonResponse({ error: { code: error.code, message: error.message } }, error.status, origin);
    }
    console.error("[uploads] Unexpected error:", error);
    return jsonResponse(
      { error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Upload failed" } },
      500,
      origin
    );
  }
};

