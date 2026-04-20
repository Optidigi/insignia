import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getPresignedGetUrl } from "../lib/storage.server";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shopifyOrderId = decodeURIComponent(params.id ?? "");

  const shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, currencyCode: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const olcs = await db.orderLineCustomization.findMany({
    where: { shopifyOrderId, productConfig: { shopId: shop.id } },
    include: {
      productConfig: {
        select: {
          name: true,
          views: {
            include: {
              placements: { select: { id: true, name: true }, orderBy: { displayOrder: "asc" } },
            },
          },
        },
      },
      customizationConfig: {
        select: { decorationMethod: { select: { name: true, artworkConstraints: true } } },
      },
    },
  });
  if (olcs.length === 0) throw new Response("Order not found", { status: 404 });

  // Fetch logo assets
  const logoAssetIds = new Set<string>();
  for (const olc of olcs) {
    const map = olc.logoAssetIdsByPlacementId as Record<string, string | null> | null;
    if (map) Object.values(map).forEach(id => { if (id) logoAssetIds.add(id); });
  }
  const logoAssets = logoAssetIds.size > 0
    ? await db.logoAsset.findMany({ where: { id: { in: Array.from(logoAssetIds) }, shopId: shop.id } })
    : [];
  const logoPreviewUrls: Record<string, string> = {};
  await Promise.all(logoAssets.map(async a => {
    if (a.previewPngUrl) {
      try { logoPreviewUrls[a.id] = await getPresignedGetUrl(a.previewPngUrl, 86400); } catch { /**/ }
    }
  }));
  const logoMap = Object.fromEntries(logoAssets.map(a => [a.id, a]));

  // Fetch Shopify order name and line item data
  let orderName = `#${shopifyOrderId.replace(/\D/g, "").slice(-6)}`;
  const lineData: Record<string, { title: string; variantTitle: string; quantity: number }> = {};
  try {
    const resp = await admin.graphql(
      `#graphql
      query GetPrintData($id: ID!) {
        order(id: $id) {
          name
          lineItems(first: 50) {
            edges {
              node { id title quantity variant { title } }
            }
          }
        }
      }`,
      { variables: { id: shopifyOrderId } }
    );
    const data = await resp.json() as {
      data?: {
        order?: {
          name?: string;
          lineItems?: {
            edges: Array<{
              node: { id: string; title: string; quantity: number; variant?: { title?: string } | null };
            }>;
          };
        };
      };
    };
    if (data.data?.order?.name) orderName = data.data.order.name;
    for (const edge of data.data?.order?.lineItems?.edges ?? []) {
      lineData[edge.node.id] = {
        title: edge.node.title,
        variantTitle: edge.node.variant?.title ?? "",
        quantity: edge.node.quantity,
      };
    }
  } catch { /**/ }

  const safeOrderName = escapeHtml(orderName);

  // Build HTML
  const lineHtml = olcs.map((olc, idx) => {
    const ld = lineData[olc.shopifyLineId];
    const method = olc.customizationConfig?.decorationMethod?.name ?? "Unknown";
    const constraints = olc.customizationConfig?.decorationMethod?.artworkConstraints as {
      fileTypes?: string[];
      maxColors?: number;
      minDpi?: number;
    } | null;
    const allPlacements = olc.productConfig?.views.flatMap(v => v.placements) ?? [];
    const assetMap = olc.logoAssetIdsByPlacementId as Record<string, string | null> | null;

    const lineDesc = ld
      ? `${escapeHtml(ld.title)}${ld.variantTitle ? ` — ${escapeHtml(ld.variantTitle)}` : ""} × ${ld.quantity}`
      : escapeHtml(olc.shopifyLineId);

    const placementsHtml = allPlacements.map(p => {
      const assetId = assetMap?.[p.id];
      const asset = assetId ? logoMap[assetId] : null;
      const previewUrl = assetId ? logoPreviewUrls[assetId] : null;
      return `
        <tr>
          <td style="padding:8px;border:1px solid #e5e7eb;">
            ${previewUrl
              ? `<img src="${escapeHtml(previewUrl)}" style="width:60px;height:60px;object-fit:contain;" alt="Logo"/>`
              : '<div style="width:60px;height:60px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:10px;color:#9ca3af;">No logo</div>'}
          </td>
          <td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(p.name)}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;">${asset ? escapeHtml(asset.originalFileName ?? "—") : "⚠ Pending"}</td>
        </tr>`;
    }).join("");

    return `
      <div style="page-break-after:always;padding:24px;">
        <h2 style="margin:0 0 4px;font-size:18px;">Line ${idx + 1} of ${olcs.length}</h2>
        <p style="margin:0 0 16px;color:#6b7280;font-size:14px;">${lineDesc}</p>
        <p style="margin:0 0 4px;"><strong>Decoration:</strong> ${escapeHtml(method)}</p>
        ${constraints
          ? `<p style="margin:0 0 16px;font-size:12px;color:#6b7280;">File types: ${escapeHtml(constraints.fileTypes?.join(", ") ?? "any")} · Max colors: ${escapeHtml(String(constraints.maxColors ?? "—"))} · Min DPI: ${escapeHtml(String(constraints.minDpi ?? "—"))}</p>`
          : ""}
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Preview</th>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Placement</th>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">File</th>
            </tr>
          </thead>
          <tbody>${placementsHtml}</tbody>
        </table>
      </div>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Production Sheet — ${safeOrderName}</title>
  <style>
    body { font-family: -apple-system, sans-serif; margin: 0; color: #111; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    @media print {
      .no-print { display: none; }
      @page { margin: 20mm; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="padding:16px;background:#f9fafb;border-bottom:1px solid #e5e7eb;">
    <button onclick="window.print()" style="padding:8px 16px;background:#4f46e5;color:#fff;border:none;border-radius:6px;cursor:pointer;">Print production sheet</button>
  </div>
  <div style="padding:24px 24px 0;">
    <h1>Production Sheet — ${safeOrderName}</h1>
    <p style="color:#6b7280;margin:0 0 4px;">${olcs.length} customized line${olcs.length > 1 ? "s" : ""}</p>
  </div>
  ${lineHtml}
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
