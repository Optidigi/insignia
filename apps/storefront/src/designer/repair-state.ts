import type { EarlierSessionCart } from '../buyer.ts';

export type RepairAction = 'start' | 'remove-group' | 'remove-all' | 'confirm' | 'retry' | 'cart';

/**
 * Why the cart repair view is shown. One cause each; a field exists only for the causes it belongs to, so an
 * earlier session's lines never come with a start or reopen offer, and only a moved cart line offers a reopen.
 */
export type RepairState =
  /** This design is still in the cart, but its line changed outside the open Designer (#341): reopen it from the cart. */
  | { cause: 'cart-changed' }
  /**
   * An earlier session accepted the cart's customized lines and this one cannot change them (#340): `valid` lines can
   * be kept for checkout, `expired` ones only removed.
   */
  | { cause: 'earlier-session'; lines: EarlierSessionCart; canRemoveAll: boolean }
  /** An unknown cart write blocks this tab until the buyer confirms a removal, even with no visible line (#339). */
  | { cause: 'unresolved-write' }
  /** The customization cannot be shown (unreadable, incompatible or unowned): only observed removal is offered. */
  | { cause: 'unavailable'; canRemoveAll: boolean }
  /**
   * The publication or this design's cart line changed, or Shopify declined the acceptance: the buyer chooses.
   * `canRemoveGroup`: this design's own cart line is still there.
   */
  | { cause: 'review-required'; canStart: boolean; canRemoveGroup: boolean; canRemoveAll: boolean };
export type RepairCause = RepairState['cause'];

type RepairCopy =
  | 'customer:recovery.repairRequired'
  | 'customer:recovery.repairHelp'
  | 'customer:chrome.unavailable'
  | 'customer:recovery.earlierSession'
  | 'customer:recovery.earlierSessionHelp'
  | 'customer:recovery.earlierSessionExpiredHelp'
  | 'customer:recovery.startNew'
  | 'customer:recovery.reopenFromCart'
  | 'customer:recovery.removeGroup'
  | 'customer:recovery.removeAll'
  | 'customer:chrome.viewCart'
  | 'common:actions.retry';
export type RepairOffer = { action: Exclude<RepairAction, 'confirm'>; label: RepairCopy; primary: boolean };
export type RepairView = {
  heading: RepairCopy;
  /** The region's accessible name. */
  label: RepairCopy;
  help?: RepairCopy;
  /** In display order (View cart, Start/Reopen, Remove group, Remove all, Retry); Close is always offered. */
  actions: RepairOffer[];
};

const removeGroup: RepairOffer = { action: 'remove-group', label: 'customer:recovery.removeGroup', primary: false };
const removeAll: RepairOffer = { action: 'remove-all', label: 'customer:recovery.removeAll', primary: false };
const retry: RepairOffer = { action: 'retry', label: 'common:actions.retry', primary: false };

/** A cart review: with nothing in the cart to remove, the customization is simply unavailable. */
function review(start: RepairCopy | undefined, canRemoveGroup: boolean, canRemoveAll: boolean): RepairView {
  return {
    heading: canRemoveAll ? 'customer:recovery.repairRequired' : 'customer:chrome.unavailable',
    label: 'customer:recovery.repairRequired',
    ...(canRemoveAll ? { help: 'customer:recovery.repairHelp' as const } : {}),
    actions: [
      ...(start ? [{ action: 'start' as const, label: start, primary: true }] : []),
      ...(canRemoveGroup ? [removeGroup] : []),
      ...(canRemoveAll ? [removeAll] : []),
      retry,
    ],
  };
}

/** The one place a repair cause's copy and offered actions are decided. */
export function repairView(state: RepairState): RepairView {
  switch (state.cause) {
    case 'review-required':
      return review(
        state.canStart ? 'customer:recovery.startNew' : undefined,
        state.canRemoveGroup,
        state.canRemoveAll,
      );
    case 'unavailable':
      return review(undefined, false, state.canRemoveAll);
    case 'unresolved-write':
      return review(undefined, false, true);
    case 'cart-changed':
      return review('customer:recovery.reopenFromCart', false, true);
    // Another try cannot change which session owns the cart's lines, and this one can neither reopen nor replace them.
    case 'earlier-session':
      return {
        heading: 'customer:recovery.earlierSession',
        label: 'customer:recovery.earlierSession',
        help:
          state.lines === 'valid'
            ? 'customer:recovery.earlierSessionHelp'
            : 'customer:recovery.earlierSessionExpiredHelp',
        actions: [
          ...(state.lines === 'valid'
            ? [{ action: 'cart' as const, label: 'customer:chrome.viewCart' as const, primary: true }]
            : []),
          ...(state.canRemoveAll ? [removeAll] : []),
        ],
      };
  }
}

/** Whether the view for `state` offers `action`. */
export function repairOffers(state: RepairState | undefined, action: RepairOffer['action']) {
  return !!state && repairView(state).actions.some((offer) => offer.action === action);
}

/** A repair state that crossed the frame, rebuilt from its known fields; anything else is `undefined`. */
export function parseRepairState(value: unknown): RepairState | undefined {
  if (!value || typeof value !== 'object' || !('cause' in value)) return undefined;
  const flag = (key: string) => {
    const field = (value as Record<string, unknown>)[key];
    return typeof field === 'boolean' ? field : undefined;
  };
  const canRemoveAll = flag('canRemoveAll');
  switch (value.cause) {
    case 'cart-changed':
    case 'unresolved-write':
      return { cause: value.cause };
    case 'unavailable':
      return canRemoveAll === undefined ? undefined : { cause: value.cause, canRemoveAll };
    case 'earlier-session': {
      const lines = 'lines' in value ? value.lines : undefined;
      return (lines === 'valid' || lines === 'expired') && canRemoveAll !== undefined
        ? { cause: value.cause, lines, canRemoveAll }
        : undefined;
    }
    case 'review-required': {
      const canStart = flag('canStart'),
        canRemoveGroup = flag('canRemoveGroup');
      return canStart === undefined || canRemoveGroup === undefined || canRemoveAll === undefined
        ? undefined
        : { cause: value.cause, canStart, canRemoveGroup, canRemoveAll };
    }
    default:
      return undefined;
  }
}
