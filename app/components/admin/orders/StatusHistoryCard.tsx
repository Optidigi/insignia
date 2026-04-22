/**
 * StatusHistoryCard — minimal timeline of known events.
 *
 * Real data available from the loader:
 *   - Order created date (from line.createdAt — the earliest OLC creation)
 *   - Current production status per line
 *
 * Full history tracking (individual transitions with timestamps) is not
 * stored in the schema yet. We render baseline entries + a Coming soon badge
 * to signal the roadmap intent.
 */

import type { ProductionStatus } from "@prisma/client";
import { productionStatusLabel } from "../../../lib/admin/terminology";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LineSnapshot = {
  id: string;
  productionStatus: ProductionStatus;
  productConfigName: string;
  createdAt: string;
};

type Props = {
  lines: LineSnapshot[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function StatusHistoryCard({ lines }: Props) {
  // Earliest creation date across all lines = "order placed" event.
  const orderPlacedAt =
    lines.length > 0
      ? lines.reduce((earliest, l) =>
          l.createdAt < earliest ? l.createdAt : earliest,
          lines[0].createdAt,
        )
      : null;

  return (
    <s-section heading="Status history">
      <s-stack direction="block" gap="base">
        {/* Coming soon indicator */}
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-text color="subdued">Full history tracking</s-text>
          <s-badge>Coming soon</s-badge>
        </s-stack>

        <s-stack direction="block" gap="small-400">
          {/* Order placed baseline entry */}
          {orderPlacedAt && (
            <s-stack direction="inline" gap="small-300" alignItems="start">
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  flexShrink: 0,
                  marginTop: 4,
                  background: "#6b7280",
                }}
              />
              <s-stack direction="block" gap="small-100">
                <s-text type="strong">Order placed</s-text>
                <s-text color="subdued">{formatDate(orderPlacedAt)}</s-text>
              </s-stack>
            </s-stack>
          )}

          {/* Current status per line */}
          {lines.map((line) => {
            const isTerminal =
              line.productionStatus === "SHIPPED";
            const dotColor = isTerminal ? "#16A34A" : "#2563EB";

            return (
              <s-stack
                key={line.id}
                direction="inline"
                gap="small-300"
                alignItems="start"
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    flexShrink: 0,
                    marginTop: 4,
                    background: dotColor,
                  }}
                />
                <s-stack direction="block" gap="small-100">
                  <s-text type="strong">
                    {line.productConfigName} — {productionStatusLabel(line.productionStatus)}
                  </s-text>
                  <s-text color="subdued">Current status</s-text>
                </s-stack>
              </s-stack>
            );
          })}
        </s-stack>
      </s-stack>
    </s-section>
  );
}
