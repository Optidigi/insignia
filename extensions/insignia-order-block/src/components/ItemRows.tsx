import { useState, useRef, useEffect } from "preact/hooks";
import type { LineItemBlock } from "../lib/types";
import { ItemRow } from "./ItemRow";

const VISIBLE_COUNT = 3;

export function ItemRows({ items }: { items: LineItemBlock[] }) {
  const [expanded, setExpanded] = useState(false);
  const btnRef = useRef<Element>(null);

  useEffect(() => {
    const el = btnRef.current;
    if (!el) return;
    const handler = () => setExpanded(true);
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, []);

  if (items.length <= VISIBLE_COUNT) {
    return (
      <s-stack direction="block" gap="base">
        {items.map(item => (
          <ItemRow key={item.shopifyLineId} item={item} />
        ))}
      </s-stack>
    );
  }

  const visible = expanded ? items : items.slice(0, VISIBLE_COUNT);
  const hiddenCount = items.length - VISIBLE_COUNT;
  const hiddenPending = items
    .slice(VISIBLE_COUNT)
    .filter(i => i.overallArtworkStatus === "PENDING_CUSTOMER").length;
  const collapseLabel = hiddenPending > 0
    ? `+ ${hiddenCount} more: ${hiddenPending} awaiting artwork`
    : `+ ${hiddenCount} more`;

  return (
    <s-stack direction="block" gap="base">
      {visible.map(item => (
        <ItemRow key={item.shopifyLineId} item={item} />
      ))}
      {!expanded && (
        <s-stack direction="inline" justify-content="space-between" align-items="center">
          <s-text color="subdued">{collapseLabel}</s-text>
          <s-button variant="secondary" type="button" ref={btnRef}>
            Show all
          </s-button>
        </s-stack>
      )}
    </s-stack>
  );
}
