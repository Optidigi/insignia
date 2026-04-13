/**
 * GET /apps/insignia/modal?productId=X&variantId=Y
 *
 * Backwards-compatibility redirect to the new URL format:
 *   /apps/insignia/customize/:productId?variantId=Y
 */

import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId") ?? "";
  const variantId = url.searchParams.get("variantId") ?? "";

  if (!productId) {
    throw new Response("Missing productId", { status: 400 });
  }

  const newUrl = `/apps/insignia/customize/${productId}${variantId ? `?variantId=${variantId}` : ""}`;
  return redirect(newUrl, 301);
};
