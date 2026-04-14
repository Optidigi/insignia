/**
 * GET /apps/insignia/:productId[?variantId=Y]
 *
 * Pretty-URL entry point for the storefront customization wizard.
 * Splat route catches /apps/insignia/* — if the segment is a numeric
 * product ID, renders the modal. Other paths fall through to 404.
 *
 * The original /apps/insignia/modal?productId=X route continues to work
 * in parallel (apps.insignia.modal.tsx). No redirects are issued.
 */

import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { AppProxyProvider } from "@shopify/shopify-app-react-router/react";
import { CustomizationModal } from "../components/storefront/CustomizationModal";

function toProductGid(id: string): string {
  return id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`;
}
function toVariantGid(id: string): string {
  return id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id}`;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const splatValue = (params["*"] ?? "").replace(/\/$/, "");
  console.log("[splat] params['*']:", JSON.stringify(params["*"]), "splatValue:", JSON.stringify(splatValue), "url:", request.url);

  // Only handle numeric product IDs — let non-numeric paths 404
  if (!splatValue || !/^\d+$/.test(splatValue)) {
    console.log("[splat] Rejecting non-numeric splat:", JSON.stringify(splatValue));
    throw new Response("Not Found", { status: 404 });
  }

  try {
    await Promise.race([
      authenticate.public.appProxy(request),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("[modal] appProxy session load timed out after 5s")), 5000)
      ),
    ]);
  } catch (e) {
    if (e instanceof Response && e.status === 400) throw e;
    console.error("[modal] appProxy session error (continuing after HMAC passed):", e);
  }

  const url = new URL(request.url);
  const rawProductId = splatValue;
  const rawVariantId = url.searchParams.get("variantId") ?? "";

  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "");
  const appUrl = `${proto}://${url.host}`;

  const productId = toProductGid(rawProductId);
  const variantId = rawVariantId ? toVariantGid(rawVariantId) : rawVariantId;

  return { productId, variantId, appUrl };
};

export async function clientLoader() {
  const url = new URL(window.location.href);
  // Extract productId from path: /apps/insignia/{productId}
  const pathSegments = url.pathname.replace(/\/$/, "").split("/");
  const rawProductId = pathSegments[pathSegments.length - 1] ?? "";
  const rawVariantId = url.searchParams.get("variantId") ?? "";
  const productId = rawProductId ? toProductGid(rawProductId) : rawProductId;
  const variantId = rawVariantId ? toVariantGid(rawVariantId) : rawVariantId;

  const baseHref = document.querySelector("base")?.getAttribute("href");
  const appUrl = baseHref
    ? baseHref.replace(/^http:\/\//, "https://").replace(/\/$/, "")
    : window.location.origin;
  return { productId, variantId, appUrl };
}
clientLoader.hydrate = true as const;

export default function PrettyModalRoute() {
  const { productId, variantId, appUrl } = useLoaderData() as {
    productId: string;
    variantId: string;
    appUrl: string;
  };

  return (
    <AppProxyProvider appUrl={appUrl}>
      <title>Customize your product</title>
      <div className="insignia-modal-page" style={{ minHeight: "100dvh" }}>
        <CustomizationModal productId={productId} variantId={variantId} />
      </div>
    </AppProxyProvider>
  );
}
