/**
 * GET /apps/insignia/modal
 *
 * Full-page storefront customization wizard (Upload → Placement → Size → Review).
 * Loaded via App Proxy; productId and variantId from query params.
 * Canonical: docs/storefront/modal-spec.md, docs/notes/design-intent/storefront-modal.md
 *
 * The HTML <base href> needed for cross-origin module loading is emitted by
 * `app/root.tsx` for any /apps/* path using SHOPIFY_APP_URL. We do NOT wrap
 * the leaf in <AppProxyProvider> here — doing so emits a SECOND <base> tag
 * inside <body>, which iOS Safari (WebKit) honors when resolving the dynamic
 * `import("/assets/entry.client-…js")` that comes after it in the streamed
 * body. The second base resolves to the storefront origin (no asset there)
 * and the import rejects, leaving the modal stuck on the SSR skeleton.
 * One <base> in <head> from root.tsx is sufficient and HTML-spec compliant.
 */

import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { CustomizationModal } from "../components/storefront/CustomizationModal";

// Normalize numeric IDs to Shopify GIDs (supports both formats)
function toProductGid(id: string): string {
  return id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`;
}
function toVariantGid(id: string): string {
  return id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // authenticate.public.appProxy validates the Shopify HMAC signature first.
  // If HMAC is invalid it throws Response(400) — we let that propagate.
  // After HMAC validation it tries to load/refresh the offline session.
  // Session errors (expired token, refresh failure → Response(500) or
  // HttpResponseError) must NOT crash the modal: the loader only needs the
  // URL params, not the session. Security is fully covered by the HMAC check.
  try {
    // Race against a 5-second timeout: token-refresh hangs (e.g. Shopify API slow)
    // must not block the modal render. Shopify's App Proxy kills the connection
    // after ~30 s, so we need to respond well within that window. Security is
    // fully covered by the HMAC check that happens synchronously at the top of
    // authenticate.public.appProxy — if HMAC is invalid it throws 400 before the
    // network calls begin, and that 400 still propagates (see catch below).
    await Promise.race([
      authenticate.public.appProxy(request),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("[modal] appProxy session load timed out after 5s")), 5000)
      ),
    ]);
  } catch (e) {
    if (e instanceof Response && e.status === 400) throw e; // invalid HMAC — reject
    // Anything else (session expiry, token refresh failure, timeout, etc.) — log and continue
    console.error("[modal] appProxy session error (continuing after HMAC passed):", e);
  }

  const url = new URL(request.url);
  // Support both long params (productId/variantId) and short params (p/v)
  const rawProductId = url.searchParams.get("productId") ?? url.searchParams.get("p") ?? "";
  const rawVariantId = url.searchParams.get("variantId") ?? url.searchParams.get("v") ?? "";

  const productId = rawProductId ? toProductGid(rawProductId) : rawProductId;
  const variantId = rawVariantId ? toVariantGid(rawVariantId) : rawVariantId;

  return { productId, variantId };
};

/**
 * clientLoader — runs on the client for ALL client-side data loads (navigations,
 * revalidations, hydration when hydrate=true).
 *
 * WHY THIS EXISTS
 * ---------------
 * `app/root.tsx` injects <base href="https://<app-host>"> for /apps/* paths so
 * JS/CSS assets load from the app server (cross-origin under App Proxy). But
 * the HTML <base> element also affects JavaScript fetch() URL resolution — a
 * React Router _data= revalidation fetch with a relative URL resolves against
 * the base URL and goes directly to the app backend, bypassing the Shopify
 * proxy entirely. Without the proxy, there is no HMAC signature →
 * authenticate.public.appProxy throws 400.
 *
 * By exporting a clientLoader we intercept all client-side data loads and read
 * the params directly from window.location, so no _data= fetch ever reaches the
 * backend without HMAC. Security is guaranteed by the server loader's HMAC check
 * on the initial (SSR) request.
 */
export async function clientLoader() {
  const url = new URL(window.location.href);
  const rawProductId = url.searchParams.get("productId") ?? url.searchParams.get("p") ?? "";
  const rawVariantId = url.searchParams.get("variantId") ?? url.searchParams.get("v") ?? "";
  const productId = rawProductId ? toProductGid(rawProductId) : rawProductId;
  const variantId = rawVariantId ? toVariantGid(rawVariantId) : rawVariantId;
  const rawReturnUrl = url.searchParams.get("returnUrl");
  // Reject self-referential returnUrl values — if the customer lands back on
  // /apps/insignia/* the modal would re-open in a loop. Also strip any value
  // that is not a clean store-relative path (open-redirect guard).
  const returnUrl =
    rawReturnUrl &&
    /^\/(?!\/|\\)/.test(rawReturnUrl) &&
    !rawReturnUrl.startsWith("/apps/insignia/")
      ? rawReturnUrl
      : null;
  return { productId, variantId, returnUrl };
}
// Run on hydration so any hydration-time revalidation also uses this path.
clientLoader.hydrate = true as const;

export default function ModalRoute() {
  const { productId, variantId, returnUrl } = useLoaderData() as {
    productId: string;
    variantId: string;
    returnUrl: string | null;
  };

  return (
    <>
      <title>Customize your product</title>
      <div className="insignia-modal-page">
        <CustomizationModal productId={productId} variantId={variantId} returnUrl={returnUrl} />
      </div>
    </>
  );
}
