/**
 * POST /apps/insignia/customizations
 *
 * Persist a draft customization for pricing and later checkout.
 * Canonical: docs/core/api-contracts/storefront.md
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { createCustomizationDraft } from "../lib/services/storefront-customizations.server";
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
    // Before shopDomain is validated — do not echo untrusted Origin
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

  let body: {
    productId?: string;
    variantId?: string;
    productConfigId?: string;
    methodId?: string;
    placements?: Array<{ placementId: string; stepIndex: number }>;
    logoAssetIdsByPlacementId?: Record<string, string | null>;
    artworkStatus?: string;
  };
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: { code: ErrorCodes.BAD_REQUEST, message: "Invalid JSON body" } },
      400,
      allowedOrigin
    );
  }

  const {
    productId,
    variantId,
    productConfigId,
    methodId,
    placements,
    logoAssetIdsByPlacementId,
    artworkStatus,
  } = body;
  if (
    !productId ||
    !variantId ||
    !productConfigId ||
    !methodId ||
    !Array.isArray(placements) ||
    typeof logoAssetIdsByPlacementId !== "object"
  ) {
    return jsonResponse(
      {
        error: {
          code: ErrorCodes.BAD_REQUEST,
          message:
            "productId, variantId, productConfigId, methodId, placements (array), and logoAssetIdsByPlacementId (object) are required",
        },
      },
      400,
      allowedOrigin
    );
  }

  try {
    const result = await createCustomizationDraft(shop.id, {
      productId: String(productId),
      variantId: String(variantId),
      productConfigId: String(productConfigId),
      methodId: String(methodId),
      placements: placements.map((p) => ({
        placementId: String(p.placementId),
        stepIndex: Number(p.stepIndex),
      })),
      logoAssetIdsByPlacementId:
        logoAssetIdsByPlacementId as Record<string, string | null>,
      artworkStatus:
        artworkStatus === "PENDING_CUSTOMER" ? "PENDING_CUSTOMER" : "PROVIDED",
    });
    return jsonResponse(result, 200, `https://${shopDomain}`);
  } catch (error) {
    if (error instanceof AppError) {
      return jsonResponse(
        { error: { code: error.code, message: error.message } },
        error.status,
        `https://${shopDomain}`
      );
    }
    console.error("[customizations] Unexpected error:", error);
    return jsonResponse(
      { error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Customization failed" } },
      500,
      `https://${shopDomain}`
    );
  }
};

