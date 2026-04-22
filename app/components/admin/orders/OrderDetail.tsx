/**
 * OrderDetail — Polaris Web Component render layer for the order detail page.
 *
 * Consumes the loader from app/routes/app.orders.$id.tsx.
 * Does NOT import from @shopify/polaris — uses <s-*> WC elements exclusively
 * (except for the ArtworkUploader island inside PlacementsTable, which is a
 * Polaris React DropZone preserved exactly as-is).
 *
 * Layout: <s-page inlineSize="large"> with main content + aside slot for
 * sidebar cards (OrderSummaryCard, PlanningCard, ProductionNotesCard,
 * StatusHistoryCard). The aside slot only renders when inlineSize="large".
 *
 * Toast: via useToast() (app-bridge.client.ts). Zero window.shopify calls.
 * Labels: terminology.ts for every status string.
 * Fetchers: useFetcher for all mutations (status advance, save note).
 */

import { useState, useCallback } from "react";
import { useLoaderData } from "react-router";
import type { loader } from "../../../routes/app.orders.$id";
import { useToast, printUrl } from "../../../lib/admin/app-bridge.client";
import LineItemCard from "./LineItemCard";
import OrderSummaryCard from "./OrderSummaryCard";
import PlanningCard from "./PlanningCard";
import ProductionNotesCard from "./ProductionNotesCard";
import StatusHistoryCard from "./StatusHistoryCard";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OrderDetail() {
  const {
    shopifyOrderId,
    orderName,
    lines,
    logoAssetMap,
    productionQcEnabled,
    shopDomain,
    customer,
    allShopifyLineItems,
    currencyCode,
    orderDataError,
    linePreviewData,
    notes,
  } = useLoaderData<typeof loader>();

  const showToast = useToast();

  // hasPendingArtwork: true when any line is still waiting for customer upload.
  const hasPendingArtwork = lines.some((l) => l.artworkStatus === "PENDING_CUSTOMER");

  // orderStatusUrl: first non-null value across lines (all share the same
  // Shopify order, so any populated line gives the right URL).
  const orderStatusUrl =
    lines.find((l) => l.orderStatusUrl != null)?.orderStatusUrl ?? null;

  // Dismiss state for the success banner.
  const [successBannerDismissed, setSuccessBannerDismissed] = useState(false);

  // Copy-link feedback.
  const [copySuccess, setCopySuccess] = useState(false);

  const handleCopyLink = useCallback(() => {
    if (!orderStatusUrl) return;
    navigator.clipboard.writeText(orderStatusUrl).then(() => {
      setCopySuccess(true);
      showToast("Upload link copied to clipboard");
      setTimeout(() => setCopySuccess(false), 2000);
    }).catch(() => {
      showToast("Failed to copy link", { isError: true });
    });
  }, [orderStatusUrl, showToast]);

  // Quantity lookup: allShopifyLineItems keyed by Shopify line id.
  const quantityByShopifyLineId: Record<string, number> = {};
  for (const item of allShopifyLineItems) {
    quantityByShopifyLineId[item.id] = item.quantity;
  }

  // Shopify admin URL for print.
  const printPageUrl = `/app/orders/${encodeURIComponent(shopifyOrderId)}/print`;
  const shopifyAdminOrderUrl = `https://${shopDomain}/admin/orders/${shopifyOrderId.replace(/\D/g, "")}`;

  return (
    <s-page heading={orderName} inlineSize="large">
      {/* Breadcrumb */}
      <s-link slot="breadcrumb-actions" href="/app/orders">
        Orders
      </s-link>

      {/* Secondary actions */}
      <s-button
        slot="secondary-actions"
        variant="secondary"
        disabled
        accessibilityLabel="Download artwork — bulk download coming soon"
      >
        Download artwork
      </s-button>
      <s-button
        slot="secondary-actions"
        variant="secondary"
        onClick={() => printUrl(printPageUrl)}
        accessibilityLabel="Print production sheet for this order"
      >
        Print production sheet
      </s-button>
      <s-button
        slot="secondary-actions"
        variant="secondary"
        href={shopifyAdminOrderUrl}
        target="_blank"
        accessibilityLabel="View order in Shopify admin"
      >
        View in Shopify
      </s-button>

      {/* ── Data error banner ── */}
      {orderDataError && (
        <s-banner
          tone="critical"
          heading="Some order data couldn't be loaded"
        >
          <s-paragraph>
            Customer and pricing information from Shopify may be incomplete.
            The customization details below are still accurate.
          </s-paragraph>
        </s-banner>
      )}

      {/* ── Artwork status banner ── */}
      {hasPendingArtwork ? (
        <s-banner
          heading="Artwork pending — waiting for customer"
          tone="warning"
          dismissible={false}
        >
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Customer chose to upload artwork later. Copy and send the upload
              link, or send a reminder email.
            </s-paragraph>
            {orderStatusUrl != null && (
              <s-stack direction="inline" gap="small-200" alignItems="end">
                <s-text-field
                  label="Upload link"
                  labelAccessibilityVisibility="exclusive"
                  value={orderStatusUrl}
                  readOnly={true}
                />
                <s-button
                  variant="secondary"
                  icon="duplicate"
                  accessibilityLabel="Copy upload link"
                  onClick={handleCopyLink}
                >
                  {copySuccess ? "Copied!" : "Copy link"}
                </s-button>
                <s-button
                  variant="secondary"
                  icon="email"
                  disabled={true}
                  accessibilityLabel="Send reminder — coming soon"
                >
                  Send reminder
                </s-button>
              </s-stack>
            )}
          </s-stack>
        </s-banner>
      ) : (
        !successBannerDismissed && (
          <s-banner
            heading="Artwork provided — ready for production"
            tone="success"
            dismissible={true}
            onDismiss={() => setSuccessBannerDismissed(true)}
          >
            <s-paragraph>
              All artwork has been uploaded. Review each placement below and
              mark as in production when ready.
            </s-paragraph>
          </s-banner>
        )
      )}

      {/* ── Line item cards (main content) ── */}
      <s-stack direction="block" gap="base">
        {lines.map((line) => (
          <LineItemCard
            key={line.id}
            line={line}
            quantity={quantityByShopifyLineId[line.shopifyLineId]}
            views={linePreviewData[line.id] ?? null}
            logoAssetMap={logoAssetMap}
            productionQcEnabled={productionQcEnabled}
          />
        ))}
      </s-stack>

      <s-stack alignItems="center" paddingBlock="large">
        <s-text color="subdued">
          Learn more about{" "}
          <s-link
            href="https://help.shopify.com/en/manual/orders"
            target="_blank"
          >
            fulfilling decorated orders
          </s-link>
          .
        </s-text>
      </s-stack>

      {/* ── Aside / Sidebar ── */}
      <s-box slot="aside">
        <OrderSummaryCard
          shopifyOrderId={shopifyOrderId}
          shopDomain={shopDomain}
          customer={customer}
          allShopifyLineItems={allShopifyLineItems}
          lines={lines}
          currencyCode={currencyCode}
        />
        <PlanningCard />
        <ProductionNotesCard
          notes={notes}
          shopifyOrderId={shopifyOrderId}
        />
        <StatusHistoryCard lines={lines} />
      </s-box>
    </s-page>
  );
}
