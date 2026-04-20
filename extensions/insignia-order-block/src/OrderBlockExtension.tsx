import { reactExtension, useApi, BlockStack, Text } from "@shopify/ui-extensions-react/admin";
import { useState, useEffect } from "react";
import type { OrderBlockResponse } from "./lib/types";
import { SummaryRow } from "./components/SummaryRow";
import { LineItemRow } from "./components/LineItemRow";

const TARGET = "admin.order-details.block.render";
export default reactExtension(TARGET, () => <OrderBlockExtension />);

function OrderBlockExtension() {
  const { data } = useApi(TARGET);
  const orderId = (data as { selected?: Array<{ id?: string }> } | undefined)?.selected?.[0]?.id;

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ok"; payload: OrderBlockResponse }
  >({ status: "loading" });

  useEffect(() => {
    if (!orderId) {
      setState({ status: "error", message: "No order context available." });
      return;
    }

    const encodedId = encodeURIComponent(orderId);
    fetch(`/api/admin/order-block/${encodedId}`)
      .then(r => r.json())
      .then((json: OrderBlockResponse & { error?: unknown }) => {
        if (json.error) throw new Error(String(json.error));
        setState({ status: "ok", payload: json });
      })
      .catch((err: Error) => setState({ status: "error", message: err.message }));
  }, [orderId]);

  if (state.status === "loading") return null;
  if (state.status === "error") {
    return <Text>Insignia: {state.message}</Text>;
  }
  if (state.payload.items.length === 0) return null;

  return (
    <BlockStack gap="base">
      <SummaryRow items={state.payload.items} orderId={state.payload.orderId} />
      {state.payload.items.map(item => (
        <LineItemRow key={item.shopifyLineId} item={item} />
      ))}
    </BlockStack>
  );
}
