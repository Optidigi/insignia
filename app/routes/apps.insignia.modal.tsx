/**
 * GET /apps/insignia/modal
 *
 * Full-page storefront customization wizard (Upload → Placement → Size → Review).
 * Loaded via App Proxy; productId and variantId from query params.
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId") ?? "";
  const variantId = url.searchParams.get("variantId") ?? "";
  const appUrl = (process.env.SHOPIFY_APP_URL ?? "").replace(/\/$/, "");

  return { productId, variantId, appUrl };
};

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
