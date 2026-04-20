import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ProductionStatus } from "@prisma/client";

const PRODUCTION_STATUS_ORDER: ProductionStatus[] = [
  ProductionStatus.ARTWORK_PENDING,
  ProductionStatus.ARTWORK_PROVIDED,
  ProductionStatus.IN_PRODUCTION,
  ProductionStatus.QUALITY_CHECK,
  ProductionStatus.SHIPPED,
];

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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

  const lines = await db.orderLineCustomization.findMany({
    where: { shopifyOrderId: { in: orderIds }, productConfig: { shopId: shop.id } },
    select: { id: true, productionStatus: true },
  });

  const eligible = lines.filter(l => PRODUCTION_STATUS_ORDER.indexOf(l.productionStatus) < newIndex);

  if (eligible.length > 0) {
    await db.$transaction(
      eligible.map(l =>
        db.orderLineCustomization.update({
          where: { id: l.id },
          data: { productionStatus: newStatusTyped },
        })
      )
    );
  }

  return Response.json({ advanced: eligible.length, skipped: lines.length - eligible.length });
};
