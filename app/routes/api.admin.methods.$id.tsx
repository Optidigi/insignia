/**
 * Admin API: Single Decoration Method
 * 
 * GET    /admin/methods/:id  - Get a method
 * PUT    /admin/methods/:id  - Update a method
 * DELETE /admin/methods/:id  - Delete a method
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  getMethod,
  updateMethod,
  deleteMethod,
  UpdateMethodSchema,
} from "../lib/services/methods.server";
import { handleError, Errors, validateOrThrow } from "../lib/errors.server";

/**
 * GET /admin/methods/:id - Get a single decoration method
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const { id } = params;

    if (!id) {
      return Errors.badRequest("Method ID required");
    }

    // Get shop from session
    const shop = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });

    if (!shop) {
      return Errors.notFound("Shop");
    }

    const method = await getMethod(shop.id, id);

    return { method };
  } catch (error) {
    return handleError(error);
  }
};

/**
 * PUT/DELETE /admin/methods/:id
 */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const { id } = params;

    if (!id) {
      return Errors.badRequest("Method ID required");
    }

    // Get shop from session
    const shop = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });

    if (!shop) {
      return Errors.notFound("Shop");
    }

    const httpMethod = request.method.toUpperCase();

    if (httpMethod === "PUT") {
      const body = await request.json();
      const input = validateOrThrow(UpdateMethodSchema, body, "Invalid method data");

      const updated = await updateMethod(shop.id, id, input);
      return { method: updated };
    }

    if (httpMethod === "DELETE") {
      await deleteMethod(shop.id, id);
      return { success: true };
    }

    return Errors.badRequest("Invalid method");
  } catch (error) {
    return handleError(error);
  }
};
