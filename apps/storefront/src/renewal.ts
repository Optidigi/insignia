import { type AcceptedCart, advisoryFingerprint, cartJournal, createBuyerApi, type DesiredGroup } from './buyer.ts';
import { createAjaxCartAdapter } from './cart.ts';

const LINE = '_insignia_line_v3';
/** Signed record index of a v3 line carrier: the first tail byte after the 236-character prefix
 * (layout owner packages/cart-authorization/src/line-v3.ts). Presentation-side matching only. */
function lineIndex(carrier: unknown): number | undefined {
  if (typeof carrier !== 'string' || !/^[A-Za-z0-9_-]{259,472}$/.test(carrier)) return;
  try {
    return atob(carrier.slice(236, 240).replace(/-/g, '+').replace(/_/g, '/')).charCodeAt(0);
  } catch {
    return;
  }
}

/**
 * One-step renewal of an expired signed cart set. The server decides renewability from the owned set
 * (cart-state) and renews from the stored accepted quote, re-running the full material comparison. Each
 * line carries its own authorization and quantity is not signed, so the renewed carriers replace the
 * current lines by signed index at the cart's current quantities; lines the buyer removed stay removed.
 * The vector goes through the Designer's verified cart adapter. `false` means the buyer must use the
 * Designer repair instead; no outcome here is purchase authority.
 */
export async function renewCartPrices(input: {
  proxyBase: string;
  cartRoot: string;
  productId: string;
  country: string;
  marketId: string;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const api = createBuyerApi({
    proxyBase: input.proxyBase,
    productId: input.productId,
    country: input.country,
    storage: input.storage,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });
  const cart = createAjaxCartAdapter({
    root: input.cartRoot,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    journal: cartJournal(input.storage, input.cartRoot),
  });
  const baseline = await cart.read();
  if (!baseline.customized.length) return false;
  const state = await api.private<{ groups: DesiredGroup[]; quoteId?: string; renewable?: boolean }>('cart-state', {
    lines: baseline.customized,
  });
  if (state.renewable !== true || !state.quoteId) return false;
  const renewed = await api.private<AcceptedCart>(`quotes/${state.quoteId}/renew`, {
    country: input.country,
    marketId: input.marketId,
    groups: state.groups,
    capacity: {
      ordinaryLineCount: baseline.ordinary.length,
      inputBytes: new TextEncoder().encode(JSON.stringify(baseline.items)).byteLength,
    },
    idempotencyKey: crypto.randomUUID(),
  });
  const byIndex = new Map(renewed.buckets.map((bucket) => [lineIndex(bucket.properties[LINE]), bucket]));
  const buckets: AcceptedCart['buckets'] = [];
  const used = new Set<number>();
  for (const line of baseline.customized) {
    const index = lineIndex(line.properties[LINE]);
    const renewedLine = index === undefined ? undefined : byIndex.get(index);
    // A line without a renewed carrier for its signed index (or for another variant) needs the buyer's review.
    if (index === undefined || used.has(index) || !renewedLine || renewedLine.variantId !== line.variantId)
      return false;
    used.add(index);
    buckets.push({ variantId: line.variantId, quantity: line.quantity, properties: renewedLine.properties });
  }
  const applied = await cart.apply(buckets, { expectedFingerprint: baseline.fingerprint });
  // late_effects_possible only repeats that an earlier unknown write was retired by explicit repair.
  if (applied.status !== 'applied' || !applied.cart) return false;
  await api
    .confirmCartApplication(renewed.applicationId, {
      fingerprint: await advisoryFingerprint(applied.cart.fingerprint),
      vector: buckets,
    })
    .catch(() => {});
  window.dispatchEvent(new CustomEvent('insignia-cart-updated'));
  return true;
}
