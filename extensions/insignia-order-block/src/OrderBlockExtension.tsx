import { reactExtension, useApi, BlockStack, Text } from "@shopify/ui-extensions-react/admin";
import { useState, useEffect } from "react";
import type { OrderBlockResponse } from "./lib/types";
import { APP_URL } from "./lib/config";
import { SummaryRow } from "./components/SummaryRow";
import { LineItemRow } from "./components/LineItemRow";

const TARGET = "admin.order-details.block.render";
export default reactExtension(TARGET, () => <OrderBlockExtension />);

function OrderBlockExtension() {
  const { data, auth } = useApi(TARGET);
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

    let cancelled = false;

    async function load() {
      // OIDC ID token authenticates the request against authenticate.admin() on the server
      const token = await auth.idToken();
      if (cancelled) return;

      const encodedId = encodeURIComponent(orderId!);
      const resp = await fetch(`${APP_URL}/api/admin/order-block/${encodedId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (cancelled) return;

      const json = (await resp.json()) as OrderBlockResponse & { error?: unknown };
      if (json.error) throw new Error(String(json.error));
      setState({ status: "ok", payload: json });
    }

    load().catch((err: Error) => {
      if (!cancelled) setState({ status: "error", message: err.message });
    });

    return () => { cancelled = true; };
  }, [orderId, auth]);

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
