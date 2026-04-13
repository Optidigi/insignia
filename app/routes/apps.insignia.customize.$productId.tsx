/**
 * GET /apps/insignia/customize/:productId
 *
 * Full-page storefront customization wizard (Upload → Placement → Size → Review).
 * Loaded via App Proxy; productId from URL path, variantId from optional query param.
 * Canonical: docs/storefront/modal-spec.md, docs/notes/design-intent/storefront-modal.md
 *
 * This route owns its own proxy authentication and AppProxyProvider so it is
 * self-contained. AppProxyProvider MUST live in the leaf UI route that serves the
 * HTML, not in a shared parent layout. The Shopify docs caution that any route
 * using AppProxyProvider "should match the pathname of the proxy URL exactly" —
 * placing it in a layout that also covers JSON resource routes causes those routes
 * to receive the HTML <base> tag rewrite, which is incorrect.
 */

import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { AppProxyProvider } from "@shopify/shopify-app-react-router/react";
import { CustomizationModal } from "../components/storefront/CustomizationModal";

// Normalize numeric IDs to Shopify GIDs (supports both formats)
function toProductGid(id: string): string {
  return id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`;
}
function toVariantGid(id: string): string {
  return id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id}`;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
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
  const rawProductId = params.productId ?? "";
  const rawVariantId = url.searchParams.get("variantId") ?? "";
  // Nginx Proxy Manager terminates TLS and proxies to the container over plain
  // HTTP. url.origin is therefore "http://insignia.optidigi.nl" — serving that
  // as <base href> causes mixed-content failures on the HTTPS storefront page,
  // blocking all JS/CSS bundle loads. X-Forwarded-Proto carries the original
  // scheme; fall back to url.protocol if the header is absent.
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "");
  const appUrl = `${proto}://${url.host}`;

  const productId = rawProductId ? toProductGid(rawProductId) : rawProductId;
  const variantId = rawVariantId ? toVariantGid(rawVariantId) : rawVariantId;

  return { productId, variantId, appUrl };
};

/**
 * clientLoader — runs on the client for ALL client-side data loads (navigations,
 * revalidations, hydration when hydrate=true).
 *
 * WHY THIS EXISTS
 * ---------------
 * AppProxyProvider injects <base href="https://<app-tunnel>"> so JS/CSS assets
 * load from the app server. But the HTML <base> element also affects JavaScript
 * fetch() URL resolution — a React Router _data= revalidation fetch with a
 * relative URL resolves against the base URL and goes directly to the backend,
 * bypassing the Shopify proxy entirely. Without the proxy, there is no HMAC
 * signature → authenticate.public.appProxy throws 400.
 *
 * By exporting a clientLoader we intercept all client-side data loads and read
 * the params directly from window.location, so no _data= fetch ever reaches the
 * backend without HMAC. Security is guaranteed by the server loader's HMAC check
 * on the initial (SSR) request.
 */
export async function clientLoader() {
  const url = new URL(window.location.href);
  // productId is the last path segment: /apps/insignia/customize/{productId}
  const pathSegments = url.pathname.replace(/\/$/, "").split("/");
  const rawProductId = pathSegments[pathSegments.length - 1] ?? "";
  const rawVariantId = url.searchParams.get("variantId") ?? "";
  const productId = rawProductId ? toProductGid(rawProductId) : rawProductId;
  const variantId = rawVariantId ? toVariantGid(rawVariantId) : rawVariantId;
  // Read appUrl from the <base> tag that AppProxyProvider injected on the server
  // render. Force https:// — if a stale http:// slips through from an old SSR,
  // mixed-content would block every bundle load. Trim trailing slash too.
  const baseHref = document.querySelector("base")?.getAttribute("href");
  const appUrl = baseHref
    ? baseHref.replace(/^http:\/\//, "https://").replace(/\/$/, "")
    : window.location.origin;
  return { productId, variantId, appUrl };
}
// Run on hydration so any hydration-time revalidation also uses this path.
clientLoader.hydrate = true as const;

export default function ModalRoute() {
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
