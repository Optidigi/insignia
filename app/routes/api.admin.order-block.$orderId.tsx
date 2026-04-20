import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getPresignedGetUrl } from "../lib/storage.server";

type PlacementBlock = {
  placementId: string;
  name: string;
  logoThumbnailUrl: string | null;
};

type LineItemBlock = {
  shopifyLineId: string;
  productName: string;
  variantLabel: string;
  quantity: number;
  decorationMethod: string;
  artworkStatus: "PROVIDED" | "PENDING_CUSTOMER";
  productionStatus: string;
  overallArtworkStatus: "PROVIDED" | "PENDING_CUSTOMER";
  firstLogoThumbnailUrl: string | null;
  placements: PlacementBlock[];
};

type OrderBlockResponse = {
  orderId: string;
  items: LineItemBlock[];
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session, cors, admin } = await authenticate.admin(request);

  const encodedOrderId = params.orderId;
  if (!encodedOrderId) {
    return cors(Response.json({ error: { code: "MISSING_ORDER_ID", message: "Order ID required" } }, { status: 400 }));
  }

  const orderId = decodeURIComponent(encodedOrderId);

  const shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    return cors(Response.json({ orderId, items: [] }));
  }

  const olcs = await db.orderLineCustomization.findMany({
    where: {
      shopifyOrderId: orderId,
      productConfig: { shopId: shop.id },
    },
    include: {
      productConfig: {
        select: {
          views: {
            include: {
              placements: { select: { id: true, name: true }, orderBy: { displayOrder: "asc" } },
            },
          },
        },
      },
      customizationConfig: {
        select: { decorationMethod: { select: { name: true } } },
      },
    },
  });

  if (olcs.length === 0) {
    return cors(Response.json({ orderId, items: [] }));
  }

  // Collect all logo asset IDs
  const logoAssetIds = new Set<string>();
  for (const olc of olcs) {
    const map = olc.logoAssetIdsByPlacementId as Record<string, string | null> | null;
    if (map) Object.values(map).forEach(id => { if (id) logoAssetIds.add(id); });
  }

  const logoAssets = logoAssetIds.size > 0
    ? await db.logoAsset.findMany({
        where: { id: { in: Array.from(logoAssetIds) }, shopId: shop.id },
        select: { id: true, previewPngUrl: true },
      })
    : [];

  const thumbnailUrls: Record<string, string | null> = {};
  await Promise.all(logoAssets.map(async (a) => {
    try {
      thumbnailUrls[a.id] = a.previewPngUrl
        ? await getPresignedGetUrl(a.previewPngUrl, 3600)
        : null;
    } catch {
      thumbnailUrls[a.id] = null;
    }
  }));

  // Fetch line item titles and variant titles from Shopify Admin GraphQL
  const lineItemData: Record<string, { title: string; variantTitle: string; quantity: number }> = {};
  try {
    const resp = await admin.graphql(
      `#graphql
      query GetOrderBlockData($id: ID!) {
        order(id: $id) {
          lineItems(first: 50) {
            edges {
              node {
                id
                title
                quantity
                variant { title }
              }
            }
          }
        }
      }`,
      { variables: { id: orderId } }
    );
    const data = await resp.json() as {
      data?: {
        order?: {
          lineItems?: {
            edges: Array<{
              node: { id: string; title: string; quantity: number; variant?: { title?: string } | null };
            }>;
          };
        };
      };
    };
    for (const edge of data.data?.order?.lineItems?.edges ?? []) {
      lineItemData[edge.node.id] = {
        title: edge.node.title,
        variantTitle: edge.node.variant?.title ?? "",
        quantity: edge.node.quantity,
      };
    }
  } catch (e) {
    console.error("[order-block] Failed to fetch Shopify line item data:", e);
    // Non-fatal: block renders without product names
  }

  const items: LineItemBlock[] = olcs.map((olc) => {
    const logoMap = olc.logoAssetIdsByPlacementId as Record<string, string | null> | null;
    const allPlacements = olc.productConfig?.views.flatMap(v => v.placements) ?? [];

    const placementBlocks: PlacementBlock[] = allPlacements.map(p => ({
      placementId: p.id,
      name: p.name,
      logoThumbnailUrl: logoMap?.[p.id] ? (thumbnailUrls[logoMap[p.id]!] ?? null) : null,
    }));

    const overallArtworkStatus: "PROVIDED" | "PENDING_CUSTOMER" =
      placementBlocks.some(p => !p.logoThumbnailUrl) || olc.artworkStatus === "PENDING_CUSTOMER"
        ? "PENDING_CUSTOMER"
        : "PROVIDED";

    const firstLogoId = logoMap
      ? Object.values(logoMap).find(id => id != null) ?? null
      : null;
    const firstLogoThumbnailUrl = firstLogoId ? (thumbnailUrls[firstLogoId] ?? null) : null;

    const shopifyLine = lineItemData[olc.shopifyLineId];

    return {
      shopifyLineId: olc.shopifyLineId,
      productName: shopifyLine?.title ?? "",
      variantLabel: shopifyLine?.variantTitle ?? "",
      quantity: shopifyLine?.quantity ?? 1,
      decorationMethod: olc.customizationConfig?.decorationMethod?.name ?? "",
      artworkStatus: olc.artworkStatus as "PROVIDED" | "PENDING_CUSTOMER",
      productionStatus: olc.productionStatus,
      overallArtworkStatus,
      firstLogoThumbnailUrl,
      placements: placementBlocks,
    };
  });

  return cors(Response.json({ orderId, items } satisfies OrderBlockResponse));
}
