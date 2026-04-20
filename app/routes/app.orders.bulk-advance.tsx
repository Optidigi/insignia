import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ProductionStatus } from "@prisma/client";
import { syncOrderTags } from "../lib/services/order-tags.server";

const PRODUCTION_STATUS_ORDER: ProductionStatus[] = [
  ProductionStatus.ARTWORK_PENDING,
  ProductionStatus.ARTWORK_PROVIDED,
  ProductionStatus.IN_PRODUCTION,
  ProductionStatus.QUALITY_CHECK,
  ProductionStatus.SHIPPED,
];

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const orderIds = formData.getAll("orderId") as string[];
  const newStatus = formData.get("newStatus") as string;

  if (!orderIds.length || !newStatus) {
    return Response.json({ error: "Missing orderIds or newStatus" }, { status: 400 });
  }
  if (!PRODUCTION_STATUS_ORDER.includes(newStatus as ProductionStatus)) {
    return Response.json({ error: "Invalid status" }, { status: 400 });
  }

  const shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) return Response.json({ error: "Shop not found" }, { status: 404 });

  const newStatusTyped = newStatus as ProductionStatus;
  const newIndex = PRODUCTION_STATUS_ORDER.indexOf(newStatusTyped);

  // Only advance lines that are at the immediately preceding status — prevents
  // skipping ARTWORK_PROVIDED when bulk-advancing to IN_PRODUCTION.
  const preceding = newIndex > 0 ? PRODUCTION_STATUS_ORDER[newIndex - 1] : null;
  if (!preceding) {
    return Response.json({ error: "Cannot advance to the first status" }, { status: 400 });
  }

  const lines = await db.orderLineCustomization.findMany({
    where: { shopifyOrderId: { in: orderIds }, productConfig: { shopId: shop.id } },
    select: { id: true, productionStatus: true, shopifyOrderId: true },
  });

  const eligible = lines.filter(l => l.productionStatus === preceding);

  if (eligible.length > 0) {
    await db.$transaction(
      eligible.map(l =>
        db.orderLineCustomization.update({
          where: { id: l.id },
          data: { productionStatus: newStatusTyped },
        })
      )
    );

    // Fire-and-forget tag sync for each affected order
    const affectedOrderIds = [...new Set(eligible.map(l => l.shopifyOrderId))];
    for (const orderId of affectedOrderIds) {
      syncOrderTags(orderId, shop.id, admin).catch(e =>
        console.error(`[bulk-advance] Tag sync failed for ${orderId}:`, e)
      );
    }
  }

  return Response.json({ advanced: eligible.length, skipped: lines.length - eligible.length });
};
