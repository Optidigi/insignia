// design-fees: admin route for DesignFeeCategory CRUD.
// POST: create, PATCH: update, DELETE: delete.
// Authenticate via the embedded admin session.

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { AppError, handleError } from "../lib/errors.server";
import { designFeesEnabled } from "../lib/services/design-fees/feature-flag.server";
import {
  createCategory,
  updateCategory,
  deleteCategory,
} from "../lib/services/design-fees/categories.server";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    if (!designFeesEnabled()) {
      return json({ error: { code: "FEATURE_DISABLED", message: "Design fees feature is disabled" } }, 404);
    }
    const { session } = await authenticate.admin(request);
    const shop = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });
    if (!shop) {
      return json({ error: { code: "NOT_FOUND", message: "Shop not found" } }, 404);
    }

    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "create") {
      const methodId = String(formData.get("methodId") || "");
      const name = String(formData.get("name") || "");
      const feeCents = parseInt(String(formData.get("feeCents") || "0"), 10) || 0;
      const displayOrderRaw = formData.get("displayOrder");
      const displayOrder = displayOrderRaw != null ? parseInt(String(displayOrderRaw), 10) : 0;
      const created = await createCategory(shop.id, methodId, {
        name,
        feeCents,
        displayOrder: Number.isNaN(displayOrder) ? 0 : displayOrder,
      });
      return json({ ok: true, category: created });
    }

    if (intent === "update") {
      const id = String(formData.get("id") || "");
      const nameRaw = formData.get("name");
      const feeCentsRaw = formData.get("feeCents");
      const displayOrderRaw = formData.get("displayOrder");
      const updated = await updateCategory(shop.id, id, {
        name: nameRaw != null ? String(nameRaw) : undefined,
        feeCents: feeCentsRaw != null ? parseInt(String(feeCentsRaw), 10) || 0 : undefined,
        displayOrder: displayOrderRaw != null ? parseInt(String(displayOrderRaw), 10) || 0 : undefined,
      });
      return json({ ok: true, category: updated });
    }

    if (intent === "delete") {
      const id = String(formData.get("id") || "");
      await deleteCategory(shop.id, id);
      return json({ ok: true, deleted: true });
    }

    return json({ error: { code: "BAD_REQUEST", message: "Invalid intent" } }, 400);
  } catch (error) {
    if (error instanceof AppError) {
      return json({ error: { code: error.code, message: error.message } }, error.status);
    }
    if (error instanceof Response) throw error;
    return handleError(error);
  }
};
