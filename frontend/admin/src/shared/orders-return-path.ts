import { PurchaseViewSchema } from '@insignia/contracts';
import { parseArtworkFilter } from './artwork-status.ts';

const ordersPath = '/admin/orders';
export function isOrderCursorStack(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 1000 &&
    value.every((cursor: unknown) => PurchaseViewSchema.shape.purchaseId.safeParse(cursor).success)
  );
}

/** A bounded cursor trail lets a breadcrumb retain Previous without browser history. */
export function orderCursorTrail(raw: string | null, before: string | undefined): string[] | null {
  if (!raw || raw.length > 1480 || !before) return null;
  const trail = raw.split(',');
  return isOrderCursorStack(trail) && trail.length <= 40 && trail.at(-1) === before ? trail : null;
}

/** Retain list controls only. Never carry host, credentials or another destination. */
export function ordersReturnPath(value: string | null): string {
  if (!value || value.length > 2048 || (value !== ordersPath && !value.startsWith(`${ordersPath}?`))) return ordersPath;
  const input = new URLSearchParams(value.slice(ordersPath.length + 1));
  const output = new URLSearchParams();
  const artwork = parseArtworkFilter(input.get('artwork'));
  if (artwork !== 'all') output.set('artwork', artwork);
  const search = input.get('q');
  if (search && search.length <= 128) output.set('q', search);
  const before = PurchaseViewSchema.shape.purchaseId.safeParse(input.get('before'));
  if (before.success) output.set('before', before.data);
  const trail = orderCursorTrail(input.get('trail'), before.success ? before.data : undefined);
  if (trail) output.set('trail', trail.join(','));
  if (input.get('sort') === 'date-asc') output.set('sort', 'date-asc');
  for (const key of ['createdFrom', 'createdBefore'] as const) {
    const date = PurchaseViewSchema.shape.orderCreatedAt.safeParse(input.get(key));
    if (date.success) output.set(key, date.data);
  }
  return output.size ? `${ordersPath}?${output}` : ordersPath;
}

export function orderDetailHref(purchaseId: string): string {
  const detail = `${ordersPath}/${encodeURIComponent(purchaseId)}`;
  let returnTo = ordersReturnPath(typeof location === 'undefined' ? null : location.pathname + location.search);
  if (returnTo !== ordersPath && typeof history !== 'undefined') {
    const state: unknown = history.state;
    const stack =
      state && typeof state === 'object' && 'insigniaOrderCursors' in state ? state.insigniaOrderCursors : null;
    const query = new URLSearchParams(returnTo.slice(ordersPath.length + 1));
    const trail = isOrderCursorStack(stack)
      ? orderCursorTrail(stack.join(','), query.get('before') ?? undefined)
      : null;
    if (trail && trail.length > 0) {
      query.set('trail', trail.join(','));
      const candidate = `${ordersPath}?${query}`;
      if (candidate.length <= 2048) returnTo = ordersReturnPath(candidate);
    }
  }
  return returnTo === ordersPath ? detail : `${detail}?${new URLSearchParams({ returnTo })}`;
}
