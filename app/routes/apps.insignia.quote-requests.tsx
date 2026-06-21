/**
 * POST /apps/insignia/quote-requests
 *
 * Persist a Stitchs quote-request flow submission. This is intentionally
 * separate from the cart/variant-pool customization flow.
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";
import { AppError, ErrorCodes } from "../lib/errors.server";
import { checkRateLimit } from "../lib/storefront/rate-limit.server";
import {
  createQuoteRequest,
  QuoteRequestInputSchema,
} from "../lib/services/quote-requests.server";
import { notifyMerchantQuoteRequest } from "../lib/services/merchant-notifications.server";

function jsonResponse(data: unknown, status = 200, origin?: string, extra?: Record<string, string>): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  if (extra) Object.assign(headers, extra);
  return new Response(JSON.stringify(data), { status, headers });
}

async function getShopNotificationEmail(shopDomain: string): Promise<string | undefined> {
  if (process.env.QUOTE_REQUEST_EMAIL) return process.env.QUOTE_REQUEST_EMAIL;
  try {
    const { admin } = await unauthenticated.admin(shopDomain);
    const response = await admin.graphql(`#graphql
      query QuoteRequestShopEmail {
        shop {
          email
          contactEmail
        }
      }
    `);
    const json = (await response.json()) as {
      data?: { shop?: { email?: string | null; contactEmail?: string | null } };
    };
    return json.data?.shop?.contactEmail ?? json.data?.shop?.email ?? undefined;
  } catch (error) {
    console.warn("[quote-requests] Could not resolve shop notification email:", error);
    return undefined;
  }
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
    notifyMerchantQuoteRequest(
      shopDomain,
      {
        id: result.quoteRequestId,
        productTitle: parsed.data.productSnapshot.productTitle,
        variantTitle: parsed.data.productSnapshot.variantTitle,
        productImageUrl: parsed.data.productSnapshot.imageUrl,
        artworkStatus: parsed.data.artworkStatus,
        logoUrl: parsed.data.productSnapshot.logoUrl,
        decorationLabel: parsed.data.productSnapshot.methodLabel,
        maxFormatLabel: parsed.data.productSnapshot.maxFormatLabel,
        placementWish: parsed.data.placementWish,
        notes: parsed.data.notes,
        quantities: parsed.data.productSnapshot.quantities,
        contactName: parsed.data.contactName,
        contactEmail: parsed.data.contactEmail,
        contactPhone: parsed.data.contactPhone,
        companyName: parsed.data.companyName,
      },
      await getShopNotificationEmail(shopDomain),
    ).catch((e) =>
      console.error("[quote-requests] Notification error:", e),
    );
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
