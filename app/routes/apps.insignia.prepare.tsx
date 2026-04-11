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

  let body: { customizationId?: string };
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

  const { admin } = await unauthenticated.admin(shopDomain);

  const runGraphql = async (query: string, variables?: Record<string, unknown>) => {
    const response = await admin.graphql(query, { variables } as Record<string, unknown>);
    return response as Response;
  };
  try {
    const result = await prepareCustomization(shop.id, String(customizationId), runGraphql);
    return jsonResponse(result, 200, origin);
  } catch (error) {
    if (error instanceof AppError) {
      return jsonResponse({ error: { code: error.code, message: error.message } }, error.status, origin);
    }
    console.error("[prepare] Unexpected error:", error);
    return jsonResponse(
      { error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Prepare failed" } },
      500,
      origin
    );
  }
};

