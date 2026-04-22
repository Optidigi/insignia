/**
 * OrderSummaryCard — sidebar card with customer info and order financials.
 *
 * Customer section: name (link to Shopify admin), email (mailto link),
 * graceful null coalesce when customer data was unavailable.
 *
 * Financials: product subtotal (sum of allShopifyLineItems), customization
 * fees (sum of unitPriceCents from customized lines), grand total.
 *
 * "View in Shopify" links to the order in the Shopify admin using shopDomain.
 *
 * Currency: Intl.NumberFormat with loader's currencyCode, fallback "USD".
 */

// ---------------------------------------------------------------------------
// Types (subset of loader return)
// ---------------------------------------------------------------------------

type AllShopifyLineItem = {
  id: string;
  title: string;
  quantity: number;
  variantTitle: string;
  amount: string;
  currencyCode: string;
};

type CustomizedLine = {
  id: string;
  shopifyLineId: string;
  unitPriceCents: number;
};

type Customer = {
  name: string;
  email: string;
} | null;

type Props = {
  shopifyOrderId: string;
  shopDomain: string;
  customer: Customer;
  allShopifyLineItems: AllShopifyLineItem[];
  lines: CustomizedLine[];
  currencyCode: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(amount: number, currencyCode: string): string {
  const code = currencyCode || "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OrderSummaryCard({
  shopifyOrderId,
  shopDomain,
  customer,
  allShopifyLineItems,
  lines,
  currencyCode,
}: Props) {
  // Product subtotal — sum of (amount × quantity) from all Shopify line items.
  const productSubtotal = allShopifyLineItems.reduce((acc, item) => {
    return acc + parseFloat(item.amount || "0") * (item.quantity ?? 1);
  }, 0);

  // Customization fees — sum of unitPriceCents for all customized lines.
  const customizationFeesCents = lines.reduce((acc, l) => acc + (l.unitPriceCents ?? 0), 0);
  const customizationFees = customizationFeesCents / 100;

  const grandTotal = productSubtotal + customizationFees;

  // Shopify admin URL for this order.
  const shopifyAdminUrl = `https://${shopDomain}/admin/orders/${shopifyOrderId.replace(/\D/g, "")}`;

  return (
    <s-section heading="Order summary">
      <s-stack direction="block" gap="base">
        {/* Customer info */}
        <s-stack direction="block" gap="small-200">
          {customer ? (
            <>
              <s-stack direction="inline" justifyContent="space-between">
                <s-text color="subdued">Customer</s-text>
                <s-link href={shopifyAdminUrl} target="_blank">
                  {customer.name}
                </s-link>
              </s-stack>
              {customer.email && (
                <s-stack direction="inline" justifyContent="space-between">
                  <s-text color="subdued">Email</s-text>
                  <s-link href={`mailto:${customer.email}`}>
                    {customer.email}
                  </s-link>
                </s-stack>
              )}
            </>
          ) : (
            <s-text color="subdued">No customer information available</s-text>
          )}
        </s-stack>

        <s-divider />

        {/* Financials */}
        <s-stack direction="block" gap="small-200">
          <s-stack direction="inline" justifyContent="space-between">
            <s-text color="subdued">Product subtotal</s-text>
            <s-text>{formatMoney(productSubtotal, currencyCode)}</s-text>
          </s-stack>
          <s-stack direction="inline" justifyContent="space-between">
            <s-text color="subdued">Customization fees</s-text>
            <s-text>{formatMoney(customizationFees, currencyCode)}</s-text>
          </s-stack>
          <s-stack direction="inline" justifyContent="space-between">
            <s-text type="strong">Total</s-text>
            <s-text type="strong">{formatMoney(grandTotal, currencyCode)}</s-text>
          </s-stack>
        </s-stack>

        <s-divider />

        {/* View in Shopify */}
        <s-button
          variant="tertiary"
          icon="external"
          href={shopifyAdminUrl}
          target="_blank"
          accessibilityLabel="View order in Shopify admin"
        >
          View in Shopify
        </s-button>
      </s-stack>
    </s-section>
  );
}
