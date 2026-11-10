import { type AcceptedCart, advisoryFingerprint, cartJournal, createBuyerApi, type DesiredGroup } from './buyer.ts';
import { createAjaxCartAdapter } from './cart.ts';

const vector = (lines: readonly { variantId: string; quantity: number }[]) =>
  JSON.stringify(lines.map((line) => [line.variantId, line.quantity]).sort());

/**
 * One-step renewal of an expired but otherwise unchanged signed cart set. The server decides
 * renewability from the owned set (cart-state) and renewal re-runs the full material comparison;
 * the renewed vector goes through the Designer's verified cart adapter. `false` means the buyer
 * must use the Designer repair instead; no outcome here is purchase authority.
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
  // Renewal re-signs the same physical vector; anything else needs the buyer's review.
  if (vector(renewed.buckets) !== vector(baseline.customized)) return false;
  const applied = await cart.apply(renewed.buckets, { expectedFingerprint: baseline.fingerprint });
  if (applied.status !== 'applied' || applied.recovery || !applied.cart) return false;
  await api
    .confirmCartApplication(renewed.applicationId, {
      fingerprint: await advisoryFingerprint(applied.cart.fingerprint),
      vector: renewed.buckets,
    })
    .catch(() => {});
  window.dispatchEvent(new CustomEvent('insignia-cart-updated'));
  return true;
}
