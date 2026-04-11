/**
 * Admin API: Decoration Methods
 * 
 * GET    /admin/methods      - List all methods
 * POST   /admin/methods      - Create a method
 * GET    /admin/methods/:id  - Get a method
 * PUT    /admin/methods/:id  - Update a method
 * DELETE /admin/methods/:id  - Delete a method
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  listMethods,
  createMethod,
  CreateMethodSchema,
} from "../lib/services/methods.server";
import { handleError, Errors, validateOrThrow } from "../lib/errors.server";

/**
 * GET /admin/methods - List all decoration methods
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    
    // Get shop from session
    const shop = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });

    if (!shop) {
      return Errors.notFound("Shop");
    }

    const methods = await listMethods(shop.id);

    return { methods };
  } catch (error) {
    return handleError(error);
  }
};

/**
 * POST /admin/methods - Create a new decoration method
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    
    // Get shop from session
    const shop = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });

    if (!shop) {
      return Errors.notFound("Shop");
    }

    const body = await request.json();
    const input = validateOrThrow(CreateMethodSchema, body, "Invalid method data");

    const method = await createMethod(shop.id, input);

    return data({ method }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
};
