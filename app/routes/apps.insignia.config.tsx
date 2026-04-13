/**
 * GET /apps/insignia/config
 *
 * Resource route: returns JSON only (no UI). Storefront config for the modal
 * (views, placements, methods, placeholder logo).
 * Canonical: docs/core/storefront-config.md, docs/core/api-contracts/storefront.md
 *
 * No default export = resource route per React Router; loader return is sent as response.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";
import { getStorefrontConfig } from "../lib/services/storefront-config.server";
import { checkRateLimit } from "../lib/storefront/rate-limit.server";
import { AppError } from "../lib/errors.server";
import { parseAcceptLanguage, getStorefrontTranslations } from "../lib/storefront/i18n.server";

function jsonResponse(data: unknown, status = 200, origin?: string, extra?: Record<string, string>): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  if (extra) Object.assign(headers, extra);
  return new Response(JSON.stringify(data), { status, headers });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method !== "GET") {
    return jsonResponse(
      { error: { code: "METHOD_NOT_ALLOWED", message: "GET only" } },
      405
    );
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

    const allowedOrigin = `https://${shopDomain}`;

    const shop = await db.shop.findUnique({
      where: { shopifyDomain: shopDomain },
      select: { id: true },
    });
    if (!shop) {
      return jsonResponse(
        { error: { code: "NOT_FOUND", message: "Shop not found" } },
        404,
        allowedOrigin
      );
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

    const url = new URL(request.url);
    const productId = url.searchParams.get("productId");
    const variantId = url.searchParams.get("variantId");
    if (!productId || !variantId) {
      return jsonResponse(
        { error: { code: "BAD_REQUEST", message: "productId and variantId query params are required" } },
        400,
        allowedOrigin
      );
    }

    // Normalize numeric IDs to Shopify GIDs (supports both formats)
    const toProductGid = (id: string) =>
      id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`;
    const toVariantGid = (id: string) =>
      id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id}`;
    const normalizedProductId = toProductGid(productId);
    const normalizedVariantId = toVariantGid(variantId);

    const { admin } = await unauthenticated.admin(shopDomain);
    const runGraphql = async (query: string, variables?: Record<string, unknown>) => {
      const response = await admin.graphql(query, { variables } as Record<string, unknown>);
      return response as Response;
    };

    const config = await getStorefrontConfig(shop.id, shopDomain, normalizedProductId, normalizedVariantId, runGraphql);

    if (!config.methods || config.methods.length === 0) {
      return jsonResponse(
        { error: { code: "INVALID_CONFIG", message: "Product has no decoration methods configured" } },
        422,
        allowedOrigin
      );
    }
    if (!config.placements || config.placements.length === 0) {
      return jsonResponse(
        { error: { code: "INVALID_CONFIG", message: "Product has no placements configured" } },
        422,
        allowedOrigin
      );
    }

    const locale = parseAcceptLanguage(request.headers.get("Accept-Language"));
    const translations = await getStorefrontTranslations(shop.id, locale);
    return jsonResponse({ ...config, translations, locale }, 200, allowedOrigin);
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof AppError) {
      // Return the AppError's own status (404 for not found, 400 for invalid config, etc.)
      // shopDomain may or may not be in scope here; use undefined to be safe
      return jsonResponse(
        { error: { code: error.code, message: error.message } },
        error.status
      );
    }
    console.error("[apps.insignia.config]", error);
    return jsonResponse(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Configuration failed",
        },
      },
      500
    );
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": request.headers.get("Origin") ?? "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  return new Response(null, { status: 405 });
};
