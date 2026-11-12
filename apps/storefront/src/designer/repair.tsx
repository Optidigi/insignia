import { createCustomerTranslator } from '@insignia/ui-localization/customer';
import { useState } from 'preact/hooks';
import type { DesignerQuoteReview } from '../../../../frontend/designer/src/quote-review';
import { quoteReviewMoney } from '../../../../frontend/designer/src/quote-review';
import type { EarlierSessionCart } from '../buyer';
export type RepairAction = 'start' | 'remove-group' | 'remove-all' | 'confirm' | 'retry' | 'cart';
export type RepairState = {
  canStart: boolean;
  canRemoveGroup: boolean;
  canRemoveAll?: boolean;
  /** The cart line changed under the Designer: starting reopens its design from the cart (#341). */
  reopensCartLine?: boolean;
  /**
   * The cart's customized lines were accepted in an earlier session and cannot be changed here (#340):
   * `valid` lines can be kept for checkout, `expired` ones only removed. Never set with `reopensCartLine`,
   * and it always comes with `canStart: false`, so no reopen or start action appears beside it.
   */
  earlierSession?: EarlierSessionCart;
};
export function DesignerRepair({
  locale,
  wording,
  canStart,
  canRemoveGroup,
  canRemoveAll = true,
  reopensCartLine = false,
  earlierSession,
  onAction,
  onClose,
}: {
  locale?: string;
  wording?: import('@insignia/contracts').MerchantCustomerWordingView;
  canStart: boolean;
  canRemoveGroup: boolean;
  canRemoveAll?: boolean;
  reopensCartLine?: boolean;
  earlierSession?: EarlierSessionCart;
  onAction(action: RepairAction): Promise<DesignerQuoteReview | undefined>;
  onClose(): void;
}) {
  const { t, formatLocale } = createCustomerTranslator(locale, {
    wordingOverlay: wording?.overlays[createCustomerTranslator(locale).canonicalRequestedLocale ?? 'en'] ?? null,
  });
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [review, setReview] = useState<DesignerQuoteReview>();
  async function action(kind: RepairAction) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const next = await onAction(kind);
      if (next) setReview(next);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  const heading = earlierSession
    ? 'customer:recovery.earlierSession'
    : canRemoveAll
      ? 'customer:recovery.repairRequired'
      : 'customer:chrome.unavailable';
  return (
    <main className="admin-preview-message">
      <section aria-label={t(earlierSession ? heading : 'customer:recovery.repairRequired')}>
        <div className="section-heading">
          <h1>{t(heading)}</h1>
        </div>
        {earlierSession ? (
          <p>
            {t(
              earlierSession === 'valid'
                ? 'customer:recovery.earlierSessionHelp'
                : 'customer:recovery.earlierSessionExpiredHelp',
            )}
          </p>
        ) : (
          canRemoveAll && <p>{t('customer:recovery.repairHelp')}</p>
        )}
        {failed && (
          <p className="cart-submit-error" role="alert">
            {t('customer:recovery.cartCommitFailed')}
          </p>
        )}
        <div className="dialog-actions">
          {review ? (
            <>
              <h2>{t('customer:recovery.remainingItems')}</h2>
              <dl className="review-costs">
                {review.groups.map((group) => (
                  <div key={group.id}>
                    <dt>
                      {group.label} · {t('customer:quantities.quantityCount', { count: group.quantity })}
                    </dt>
                    <dd>
                      {group.totalMinor === undefined
                        ? t('common:summary.unavailable')
                        : quoteReviewMoney(group.totalMinor, review.currency, review.exponent, formatLocale)}
                    </dd>
                  </div>
                ))}
              </dl>
              <strong>
                {review.totalMinor === undefined
                  ? t('common:summary.unavailable')
                  : quoteReviewMoney(review.totalMinor, review.currency, review.exponent, formatLocale)}
              </strong>
              <button type="button" className="primary-button" disabled={busy} onClick={() => void action('confirm')}>
                {t('customer:recovery.confirmRemoval')}
              </button>
              <button type="button" className="text-action" disabled={busy} onClick={() => setReview(undefined)}>
                {t('common:actions.cancel')}
              </button>
            </>
          ) : (
            <>
              {earlierSession === 'valid' && (
                <button type="button" className="primary-button" disabled={busy} onClick={() => void action('cart')}>
                  {t('customer:chrome.viewCart')}
                </button>
              )}
              {/* An earlier session's lines win: this session can neither reopen nor replace them. */}
              {canStart && !earlierSession && (
                <button type="button" className="primary-button" disabled={busy} onClick={() => void action('start')}>
                  {t(reopensCartLine ? 'customer:recovery.reopenFromCart' : 'customer:recovery.startNew')}
                </button>
              )}
              {canRemoveGroup && (
                <button
                  type="button"
                  className="text-action"
                  disabled={busy}
                  onClick={() => void action('remove-group')}
                >
                  {t('customer:recovery.removeGroup')}
                </button>
              )}
              {canRemoveAll && (
                <button type="button" className="text-action" disabled={busy} onClick={() => void action('remove-all')}>
                  {t('customer:recovery.removeAll')}
                </button>
              )}
            </>
          )}
          {/* Another try cannot change which session owns the cart's lines. */}
          {!review && !earlierSession && (
            <button type="button" className="text-action" disabled={busy} onClick={() => void action('retry')}>
              {t('common:actions.retry')}
            </button>
          )}
          <button type="button" className="text-action" disabled={busy} onClick={onClose}>
            {t('common:actions.close')}
          </button>
        </div>
      </section>
    </main>
  );
}
