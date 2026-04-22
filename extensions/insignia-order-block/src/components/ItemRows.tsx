import type { LineItemBlock } from "../lib/types";
import { ItemRow } from "./ItemRow";

export function ItemRows({ items }: { items: LineItemBlock[] }) {
  return (
    <s-stack direction="block" gap="small">
      {items.map(item => (
        <ItemRow key={item.shopifyLineId} item={item} />
      ))}
    </s-stack>
  );
}
