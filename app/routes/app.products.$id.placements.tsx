/**
 * Product Config Placements Layout
 *
 * Renders nested placement routes (list, edit).
 */

import type { LoaderFunctionArgs } from "react-router";
import { Outlet } from "react-router";
import { getProductConfig } from "../lib/services/product-configs.server";
import { AppError } from "../lib/errors.server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;

  if (!id) {
    throw new Response("Config ID required", { status: 400 });
  }

  const shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  try {
    const config = await getProductConfig(shop.id, id);
    return { config: { id: config.id, name: config.name }, shopId: shop.id };
  } catch (error) {
    if (error instanceof AppError && error.status === 404) {
      throw new Response("Config not found", { status: 404 });
    }
    throw error;
  }
};

export default function ProductPlacementsLayout() {
  return <Outlet />;
}
