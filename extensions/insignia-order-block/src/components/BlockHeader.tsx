import type { LineItemBlock, OrderBlockResponse } from "../lib/types";
import { overallBadge, formatSummaryLine } from "../lib/statusHelpers";

type BlockHeaderProps = {
  items: LineItemBlock[];
  feeTotal: OrderBlockResponse["feeTotal"];
  feeCurrencyCode: OrderBlockResponse["feeCurrencyCode"];
};

export function BlockHeader({
  items,
  feeTotal,
  feeCurrencyCode,
}: BlockHeaderProps) {
  const badge = overallBadge(items);
  const summary = formatSummaryLine(items, feeTotal, feeCurrencyCode);

  return (
    <s-grid gridTemplateColumns="1fr auto" alignItems="center">
      <s-text color="subdued">{summary}</s-text>
      <s-badge tone={badge.tone} icon={badge.icon}>{badge.label}</s-badge>
    </s-grid>
  );
}
