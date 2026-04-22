import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import type { OrderBlockResponse } from "./lib/types";
import { formatCollapsedSummary } from "./lib/statusHelpers";
import { BlockHeader } from "./components/BlockHeader";
import { ItemRows } from "./components/ItemRows";
import { LoadingState } from "./components/LoadingState";
import { ErrorState } from "./components/ErrorState";

export default async function () {
  render(<OrderBlockExtension />, document.body);
}

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: OrderBlockResponse };

function useOrderData(orderId: string | undefined) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    if (!orderId) {
      setState({ status: "error", message: "No order context available." });
      return;
    }
    try {
      const resp = await fetch(`/api/admin/order-block/${encodeURIComponent(orderId)}`);
      const json = (await resp.json()) as OrderBlockResponse & { error?: unknown };
      if (json.error) throw new Error(String(json.error));
      setState({ status: "ok", data: json });
    } catch (err) {
      setState({ status: "error", message: (err as Error).message });
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => clearInterval(id);
  }, [load]);

  return { state, retry: load };
}

const MAX_VISIBLE = 2;

function BlockContent({ data }: { data: OrderBlockResponse }) {
  const allComplete = data.items.every((i) => i.productionStatus === "SHIPPED");
  const visible = data.items.slice(0, MAX_VISIBLE);
  const overflow = data.items.length - MAX_VISIBLE;

  return (
    <s-stack direction="block" gap="small">
      <s-box border="base" borderRadius="large" overflow="hidden" padding="base">
        <s-stack direction="block" gap="small">
          <BlockHeader
            items={data.items}
            feeTotal={data.feeTotal}
            feeCurrencyCode={data.feeCurrencyCode}
          />
          {!allComplete && (
            <>
              <s-divider />
              <ItemRows items={visible} />
              {overflow > 0 && (
                <s-text color="subdued">+{overflow} more</s-text>
              )}
            </>
          )}
        </s-stack>
      </s-box>
      <s-stack direction="inline" justifyContent="end">
        {/* Relative URL form (per Shopify admin-extensions docs: "Relative urls
            are relative to your app"). `app:` alone would resolve to
            `/orders/:id` at the iframe root, but our authenticated routes are
            nested under `/app/` (file `app.orders.$id.tsx`), so we need the
            full `/app/orders/:id` path. */}
        <s-button variant="primary" href={`/app/orders/${encodeURIComponent(data.orderId)}`}>
          Open in Insignia
        </s-button>
      </s-stack>
    </s-stack>
  );
}

function OrderBlockExtension() {
  const orderId = (
    shopify.data as { selected?: Array<{ id?: string }> } | undefined
  )?.selected?.[0]?.id;

  const { state, retry } = useOrderData(orderId);

  if (!orderId) return null;

  if (state.status === "ok" && state.data.items.length === 0) return null;

  const collapsedSummary =
    state.status === "ok"
      ? formatCollapsedSummary(
          state.data.items,
          state.data.feeTotal,
          state.data.feeCurrencyCode
        )
      : undefined;

  return (
    <s-admin-block
      heading="Insignia Customization"
      collapsed-summary={collapsedSummary}
    >
      {state.status === "loading" && <LoadingState />}
      {state.status === "error" && (
        <ErrorState onRetry={retry} orderId={orderId} />
      )}
      {state.status === "ok" && <BlockContent data={state.data} />}
    </s-admin-block>
  );
}
