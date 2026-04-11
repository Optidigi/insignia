import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

function escapeCsvCell(value: string): string {
  const str = String(value);
  const escaped = str.replace(/"/g, '""');
  // Neutralize formula injection (Excel, Sheets, LibreOffice)
  if (/^[=+\-@\t\r]/.test(escaped)) {
    return `"'${escaped}"`;
  }
  return `"${escaped}"`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const secFetchSite = request.headers.get("Sec-Fetch-Site");
  if (secFetchSite && secFetchSite !== "same-origin") {
    return new Response("Forbidden", { status: 403 });
  }

  const shop = await db.shop.findUniqueOrThrow({
    where: { shopifyDomain: session.shop },
  });

  const lines = await db.orderLineCustomization.findMany({
    where: { productConfig: { shopId: shop.id } },
    include: { productConfig: true },
    orderBy: { createdAt: "desc" },
  });

  const csvRows: string[][] = [
    [
      "Order ID",
      "Line Item ID",
      "Product",
      "Variant",
      "Artwork Status",
      "Production Status",
      "Created At",
    ],
    ...lines.map((l) => [
      l.shopifyOrderId,
      l.shopifyLineId,
      l.productConfig.name,
      l.variantId,
      String(l.artworkStatus),
      String(l.productionStatus),
      l.createdAt.toISOString(),
    ]),
  ];

  const csv = csvRows
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="insignia-orders-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
