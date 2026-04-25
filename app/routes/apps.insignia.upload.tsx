/**
 * GET/POST /apps/insignia/upload
 *
 * Storefront page for post-purchase artwork upload.
 * Customers who selected "provide artwork later" during checkout use this page
 * to upload their logo. URL comes from the artwork reminder email.
 *
 * Query params:
 *   orderId  — Shopify Order GID (e.g. gid://shopify/Order/12345)
 *   lineId   — Shopify Line Item GID (e.g. gid://shopify/LineItem/67890)
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { serverSideStorefrontUpload } from "../lib/services/storefront-uploads.server";
import { AppError } from "../lib/errors.server";
import { checkRateLimit } from "../lib/storefront/rate-limit.server";

// ============================================================================
// Loader — validates order + line and returns order context
// ============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.public.appProxy(request);
    const shopDomain = session?.shop;
    if (!shopDomain) {
      throw new Response("Unauthorized", { status: 401 });
    }

    const url = new URL(request.url);
    const orderId = url.searchParams.get("orderId") ?? "";
    const lineId = url.searchParams.get("lineId") ?? "";

    const shop = await db.shop.findUnique({
      where: { shopifyDomain: shopDomain },
      select: { id: true },
    });
    if (!shop) throw new Response("Shop not found", { status: 404 });

    const rateLimit = checkRateLimit(shop.id);
    if (!rateLimit.allowed) {
      throw new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down." } }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": String(rateLimit.retryAfter) },
      });
    }

    if (!orderId || !lineId) {
      return { status: "missing_params", orderId, lineId, shopDomain };
    }

    const orderLine = await db.orderLineCustomization.findFirst({
      where: {
        shopifyOrderId: orderId,
        shopifyLineId: lineId,
        productConfig: { shopId: shop.id },
      },
      select: {
        id: true,
        artworkStatus: true,
        productConfigId: true,
      },
    });

    if (!orderLine) {
      return { status: "not_found", orderId, lineId, shopDomain };
    }

    if (orderLine.artworkStatus === "PROVIDED") {
      return { status: "already_uploaded", orderId, lineId, shopDomain };
    }

    if (orderLine.artworkStatus !== "PENDING_CUSTOMER") {
      return { status: "not_pending", orderId, lineId, shopDomain };
    }

    return { status: "ready", orderId, lineId, shopDomain };
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof AppError) {
      throw new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), {
        status: error.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("[upload] Loader unexpected error:", error);
    throw new Response("An unexpected error occurred", { status: 500 });
  }
};

// ============================================================================
// Action — handles file upload and updates artwork status
// ============================================================================

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.public.appProxy(request);
    const shopDomain = session?.shop;
    if (!shopDomain) {
      return { success: false, error: "Unauthorized" };
    }

    const shop = await db.shop.findUnique({
      where: { shopifyDomain: shopDomain },
      select: { id: true },
    });
    if (!shop) return { success: false, error: "Shop not found" };

    const rateLimit = checkRateLimit(shop.id);
    if (!rateLimit.allowed) {
      return { success: false, error: "Too many requests. Please slow down." };
    }

    const formData = await request.formData();
    const orderId = formData.get("orderId") as string | null;
    const lineId = formData.get("lineId") as string | null;
    const file = formData.get("file") as File | null;

    if (!orderId || !lineId) {
      return { success: false, error: "Missing order or line ID" };
    }

    if (!file || !(file instanceof File) || file.size === 0) {
      return { success: false, error: "Please select a file to upload" };
    }

    // Validate file type
    const allowed = ["image/svg+xml", "image/png", "application/pdf", "image/jpeg"];
    if (!allowed.includes(file.type)) {
      return { success: false, error: "Invalid file type. Please upload SVG, PNG, PDF, or JPEG." };
    }

    // Validate file size (5 MB)
    if (file.size > 5 * 1024 * 1024) {
      return { success: false, error: "File too large (maximum 5 MB)" };
    }

    // Find and verify the order line
    const orderLine = await db.orderLineCustomization.findFirst({
      where: {
        shopifyOrderId: orderId,
        shopifyLineId: lineId,
        productConfig: { shopId: shop.id },
      },
      select: {
        id: true,
        artworkStatus: true,
        productConfigId: true,
      },
    });

    if (!orderLine) return { success: false, error: "Order not found" };
    if (orderLine.artworkStatus === "PROVIDED") {
      return { success: false, error: "Artwork has already been uploaded for this order" };
    }
    if (orderLine.artworkStatus !== "PENDING_CUSTOMER") {
      return { success: false, error: "This order is not waiting for customer artwork" };
    }

    // Upload the file using the existing storefront upload service
    const uploadResult = await serverSideStorefrontUpload(shop.id, file);
    const logoAssetId = uploadResult.logoAsset.id;

    // Get all placement definitions for this product config (via views)
    const placements = await db.placementDefinition.findMany({
      where: { productView: { productConfigId: orderLine.productConfigId } },
      select: { id: true },
    });

    // Build the placement → logo asset mapping (same logo for all placements)
    const logoAssetIdsByPlacementId: Record<string, string> = {};
    for (const p of placements) {
      logoAssetIdsByPlacementId[p.id] = logoAssetId;
    }
    // If no placements defined, use a fallback key
    if (placements.length === 0) {
      logoAssetIdsByPlacementId["default"] = logoAssetId;
    }

    // Update the order line customization
    await db.orderLineCustomization.update({
      where: { id: orderLine.id },
      data: {
        artworkStatus: "PROVIDED",
        logoAssetIdsByPlacementId,
      },
    });

    return { success: true, error: null };
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof AppError) {
      return { success: false, error: error.message };
    }
    console.error("[upload] Unexpected error:", error);
    return { success: false, error: process.env.NODE_ENV === "production" ? "Upload failed — please try again" : (error instanceof Error ? error.message : "Upload failed") };
  }
};

// ============================================================================
// Component
// ============================================================================

export default function CustomerUploadPage() {
  const loaderData = useLoaderData() as Awaited<ReturnType<typeof loader>>;
  const actionData = useActionData() as { success: boolean; error: string | null } | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const { orderId, lineId, status } = loaderData;

  return (
    <>
      <title>Upload Your Artwork</title>
      <div style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        backgroundColor: "#f6f6f7",
        padding: "24px 16px",
      }}>
        <div style={{
          width: "100%",
          maxWidth: 520,
          backgroundColor: "#fff",
          borderRadius: 12,
          padding: "40px 32px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        }}>
          {/* Already uploaded */}
          {status === "already_uploaded" && (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 12px" }}>Artwork already submitted</h1>
              <p style={{ color: "#6d7175", margin: "0 0 24px" }}>
                We have already received your artwork for this order. Our team will be in touch when it&apos;s been processed.
              </p>
            </>
          )}

          {/* Not found / invalid */}
          {(status === "not_found" || status === "missing_params" || status === "not_pending") && (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 12px" }}>Link not valid</h1>
              <p style={{ color: "#6d7175", margin: "0 0 24px" }}>
                This upload link is no longer valid or has already been used. Please contact us if you need help.
              </p>
            </>
          )}

          {/* Success state */}
          {status === "ready" && actionData?.success && (
            <>
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>&#10003;</div>
                <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 12px" }}>Artwork submitted!</h1>
                <p style={{ color: "#6d7175", margin: 0 }}>
                  Thank you — we have received your logo and will apply it to your order. You&apos;ll hear from us soon.
                </p>
              </div>
            </>
          )}

          {/* Upload form */}
          {status === "ready" && !actionData?.success && (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 8px" }}>Upload your logo</h1>
              <p style={{ color: "#6d7175", margin: "0 0 28px", fontSize: 14 }}>
                Please upload your artwork file. We accept SVG, PNG, PDF, and JPEG (max 5 MB).
              </p>

              {actionData?.error && (
                <div style={{
                  backgroundColor: "#fff4f4",
                  border: "1px solid #ffd2d2",
                  borderRadius: 8,
                  padding: "12px 16px",
                  marginBottom: 20,
                  color: "#bf0711",
                  fontSize: 14,
                }}>
                  {actionData.error}
                </div>
              )}

              <Form method="post" encType="multipart/form-data">
                <input type="hidden" name="orderId" value={orderId} />
                <input type="hidden" name="lineId" value={lineId} />

                <div style={{ marginBottom: 20 }}>
                  <label htmlFor="artwork-file" style={{ display: "block", fontWeight: 500, marginBottom: 8, fontSize: 14 }}>
                    Artwork file
                  </label>
                  <input
                    id="artwork-file"
                    type="file"
                    name="file"
                    accept=".svg,.png,.pdf,.jpg,.jpeg"
                    required
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "10px",
                      border: "1px solid #d1d5db",
                      borderRadius: 8,
                      fontSize: 14,
                      cursor: "pointer",
                    }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "12px",
                    backgroundColor: isSubmitting ? "#8c9196" : "#008060",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: isSubmitting ? "not-allowed" : "pointer",
                    transition: "background-color 0.15s",
                  }}
                >
                  {isSubmitting ? "Uploading\u2026" : "Submit artwork"}
                </button>
              </Form>
            </>
          )}
        </div>
      </div>
    </>
  );
}
