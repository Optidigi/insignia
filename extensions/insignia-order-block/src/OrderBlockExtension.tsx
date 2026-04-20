import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect } from "preact/hooks";
import type { OrderBlockResponse } from "./lib/types";
import { SummaryRow } from "./components/SummaryRow";
import { LineItemRow } from "./components/LineItemRow";

export default async function () {
  render(<OrderBlockExtension />, document.body);
}

function OrderBlockExtension() {
  const orderId = (shopify.data as { selected?: Array<{ id?: string }> } | undefined)
    ?.selected?.[0]?.id;

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
      const encodedId = encodeURIComponent(orderId!);
      // Relative URL resolves to app_url; auth header is injected automatically
      const resp = await fetch(`/api/admin/order-block/${encodedId}`);
      if (cancelled) return;

      const json = (await resp.json()) as OrderBlockResponse & { error?: unknown };
      if (json.error) throw new Error(String(json.error));
      setState({ status: "ok", payload: json });
    }

    load().catch((err: Error) => {
      if (!cancelled) setState({ status: "error", message: err.message });
    });

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (state.status === "loading") return null;
  if (state.status === "error") {
    return (
      <s-admin-block heading="Insignia">
        <s-text>{state.message}</s-text>
      </s-admin-block>
    );
  }
  if (state.payload.items.length === 0) return null;

  return (
    <s-admin-block heading="Insignia">
      <SummaryRow items={state.payload.items} orderId={state.payload.orderId} />
      {state.payload.items.map((item) => (
        <LineItemRow key={item.shopifyLineId} item={item} />
      ))}
    </s-admin-block>
  );
}
