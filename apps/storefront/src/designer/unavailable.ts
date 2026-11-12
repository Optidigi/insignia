import type { DesignerQuoteReview } from '../../../../frontend/designer/src/quote-review';
import { cartJournal } from '../buyer.ts';
import { createAjaxCartAdapter } from '../cart.ts';
import { createDesignerFrame } from './frame-host.ts';
import type { createDesignerModal } from './modal';
/** Missing editable facts do not create a dummy catalogue or quote. Only observed cart removal is available. */
export async function mountUnavailableDesigner(input: {
  modal?: ReturnType<typeof createDesignerModal>;
  title?: string;
  locale: string;
  wording?: import('@insignia/contracts').MerchantCustomerWordingView;
  cartRoot: string;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  onClose(): void;
  retry(): Promise<void>;
}) {
  const cart = createAjaxCartAdapter({ root: input.cartRoot, journal: cartJournal(input.storage, input.cartRoot) });
  let canRemoveAll = false;
  try {
    canRemoveAll = (await cart.read()).customized.length > 0;
  } catch {
    /* Unobserved contents cannot offer removal. */
  }
  let reviewed: Awaited<ReturnType<typeof cart.read>> | undefined;
  const frame = createDesignerFrame({
    modal: input.modal,
    onInitializationRetry: async () => {
      frame.destroy();
      await input.retry();
    },
    title: input.title,
    locale: input.locale,
    wording: input.wording,
    repair: { canStart: false, canRemoveGroup: false, canRemoveAll },
    onClose: input.onClose,
    async onRepair(action) {
      if (action === 'retry') {
        await input.retry();
        return;
      }
      if (action === 'remove-all') {
        const actual = await cart.read();
        if (!actual.customized.length) throw new Error('No observed customization to remove');
        reviewed = actual;
        const review: DesignerQuoteReview = {
          currency: actual.currency,
          exponent: 2,
          customizedQuantity: 0,
          groups: [],
          ...(['USD', 'EUR'].includes(actual.currency) ? { totalMinor: '0' } : {}),
        };
        return review;
      }
      if (action !== 'confirm' || !reviewed) throw new Error('Observed removal review required');
      const applied = await cart.apply([], { expectedFingerprint: reviewed.fingerprint, repair: true });
      // Explicit removal is how an unknown earlier write is retired; its tombstone stays for late carriers.
      if (applied.status !== 'applied' || !applied.cart) throw new Error('Cart removal remains unresolved');
      reviewed = undefined;
      window.dispatchEvent(new CustomEvent('insignia-cart-updated'));
      frame.close();
      return;
    },
  });
  return {
    open() {
      return frame.open();
    },
    destroy: frame.destroy,
  };
}
