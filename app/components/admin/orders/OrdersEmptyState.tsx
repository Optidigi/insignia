/**
 * Empty state variants for the Orders index page.
 *
 * variant="never"    — shop has zero orders (no customizations ever)
 * variant="filtered" — filters are active but 0 rows match
 *
 * Uses Polaris Web Components exclusively. No @shopify/polaris imports.
 */

interface OrdersEmptyStateProps {
  variant: "never" | "filtered";
  /** Whether the "Awaiting Artwork" tab is active (affects filtered message). */
  isAwaitingTab?: boolean;
}

export function OrdersEmptyState({
  variant,
  isAwaitingTab = false,
}: OrdersEmptyStateProps) {
  if (variant === "never") {
    return (
      <s-section accessibilityLabel="No orders yet">
        <s-stack direction="block" gap="large" alignItems="center">
          <s-box paddingBlock="large-200">
            <s-stack direction="block" gap="base" alignItems="center">
              <s-heading>No customized orders yet</s-heading>
              <s-paragraph>
                Orders with Insignia customizations will appear here after
                customers complete purchases.
              </s-paragraph>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>
    );
  }

  // variant === "filtered"
  const heading = isAwaitingTab
    ? "No orders awaiting artwork"
    : "No orders match your filters";

  const message = isAwaitingTab
    ? "Orders where customers chose to provide artwork later will appear here."
    : "Try adjusting your search, method, date range, or artwork status filters.";

  return (
    <s-section accessibilityLabel="No matching orders">
      <s-stack direction="block" gap="large" alignItems="center">
        <s-box paddingBlock="large-200">
          <s-stack direction="block" gap="base" alignItems="center">
            <s-heading>{heading}</s-heading>
            <s-paragraph>{message}</s-paragraph>
          </s-stack>
        </s-box>
      </s-stack>
    </s-section>
  );
}
