import { withAdminDeadline } from '../admin-deadline.js';
export type OrderPresentationTarget = {
  orderId: string;
  lines: { orderLineId: string; productId: string; variantId: string }[];
};
export type OrderPresentation = {
  orderName: string | null;
  lines: { orderLineId: string; title: string | null; variantTitle: string | null }[];
};
const query = `query InsigniaOrderPresentation($id: ID!) { order(id: $id) { id name lineItems(first: 250) { nodes { id title variantTitle product { id } variant { id } } pageInfo { hasNextPage } } } }`;
const label = (value: unknown): string | null =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= 512 &&
  ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    ? value
    : null;
export async function readOrderPresentation(
  transport: { read(variables: Record<string, unknown>): Promise<unknown> },
  target: OrderPresentationTarget,
): Promise<OrderPresentation | null> {
  if (!/^gid:\/\/shopify\/Order\/[1-9][0-9]*$/.test(target.orderId) || target.lines.length > 250)
    throw new Error('Invalid order presentation target');
  const data = (await transport.read({ id: target.orderId })) as {
    order: null | {
      id: string;
      name: unknown;
      lineItems: {
        nodes: {
          id: string;
          title: unknown;
          variantTitle: unknown;
          product: { id: string } | null;
          variant: { id: string } | null;
        }[];
        pageInfo: { hasNextPage: boolean };
      };
    };
  };
  const order = data?.order;
  if (order === null) return null;
  if (
    !order ||
    order.id !== target.orderId ||
    !Array.isArray(order.lineItems?.nodes) ||
    order.lineItems.nodes.length > 250 ||
    typeof order.lineItems.pageInfo?.hasNextPage !== 'boolean'
  )
    throw new Error('Invalid order presentation identity');
  const ids = new Set<string>();
  const lines: OrderPresentation['lines'] = [];
  for (const line of order.lineItems.nodes) {
    if (!line || typeof line.id !== 'string' || ids.has(line.id)) throw new Error('Invalid order line identity');
    ids.add(line.id);
    const purchased = target.lines.find((item) => item.orderLineId === line.id);
    if (purchased && line.product?.id === purchased.productId && line.variant?.id === purchased.variantId)
      lines.push({ orderLineId: line.id, title: label(line.title), variantTitle: label(line.variantTitle) });
  }
  return { orderName: label(order.name), lines };
}
/** Read-only transport constructed only after online staff and installation checks. */
export function createOrderPresentationTransport(input: {
  shop: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(input.shop) || !input.accessToken)
    throw new Error('Invalid order transport scope');
  return {
    async read<T>(variables: Record<string, unknown>): Promise<T> {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      return withAdminDeadline(
        async (signal) => {
          const response = await (input.fetchImpl ?? fetch)(`https://${input.shop}/admin/api/2026-07/graphql.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': input.accessToken },
            body: JSON.stringify({
              query: Array.isArray(variables.ids)
                ? `query InsigniaOrderPresentations($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { id name } } }`
                : query,
              variables,
            }),
            signal,
          });
          if (!response.ok) throw new Error('Order presentation read failed');
          reader = response.body?.getReader();
          if (!reader) throw new Error('Order presentation response body missing');
          const chunks: Uint8Array[] = [];
          let bytes = 0;
          try {
            for (;;) {
              const part = await reader.read();
              if (part.done) break;
              bytes += part.value.byteLength;
              if (bytes > 1_000_000) throw new Error('Order presentation response too large');
              chunks.push(part.value);
            }
          } catch (error) {
            await reader.cancel().catch(() => {});
            throw error;
          } finally {
            reader.releaseLock();
          }
          const buffer = new Uint8Array(bytes);
          let offset = 0;
          for (const chunk of chunks) {
            buffer.set(chunk, offset);
            offset += chunk.byteLength;
          }
          let payload: unknown;
          try {
            payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
          } catch {
            throw new Error('Order presentation JSON response invalid');
          }
          if (
            !payload ||
            typeof payload !== 'object' ||
            (payload as { errors?: unknown }).errors !== undefined ||
            (payload as { data?: unknown }).data === undefined
          )
            throw new Error('Order presentation GraphQL response invalid');
          return (payload as { data: T }).data;
        },
        'Order presentation read',
        () => {
          void reader?.cancel().catch(() => {});
        },
      );
    },
  };
}
