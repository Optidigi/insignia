import { type CustomerMessage, customerMessage } from '@insignia/ui-localization/customer';
import { commitFailureView } from '../../../../frontend/designer/src/commit-failure';
import type { PortFailure } from '../../../../frontend/designer/src/port-failure';

/**
 * A failed repair action's copy, worded like the Designer's own failures (#371). `retry`: repeating the confirmation
 * can succeed, so Retry takes its place. Any other failure keeps the generic copy.
 */
export function repairFailureView(
  { code, reason }: PortFailure,
  formatLocale: string,
): { message: CustomerMessage; retry: boolean } {
  switch (code) {
    // Only applying a reviewed removal takes the cart lock. Its accepted set is kept, so the retry applies it.
    case 'CART_BUSY':
      return { message: customerMessage('customer:recovery.cartBusy'), retry: true };
    // Native cart edits took the retained designs over the cart's limit; the same removal fails until the cart
    // changes. Remove all needs no signed set, so it still works.
    case 'CAPACITY_EXCEEDED':
      return {
        message: commitFailureView(
          { cause: reason === 'CART_LINES' ? 'cart-lines' : 'capacity', preparation: true },
          formatLocale,
        ).message,
        retry: false,
      };
    default:
      return { message: customerMessage('customer:recovery.cartCommitFailed'), retry: false };
  }
}
