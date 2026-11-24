import { createCustomerTranslator } from '@insignia/ui-localization/customer';
import { useEffect, useState } from 'preact/hooks';
import { portFailure } from '../../../../frontend/designer/src/port-failure';
import type { DesignerQuoteReview } from '../../../../frontend/designer/src/quote-review';
import { quoteReviewMoney } from '../../../../frontend/designer/src/quote-review';
import { repairFailureView } from './repair-failure';
import { type RepairAction, type RepairOffer, type RepairState, repairView } from './repair-state';
export function DesignerRepair({
  locale,
  wording,
  repair,
  onAction,
  onClose,
}: {
  locale?: string;
  wording?: import('@insignia/contracts').MerchantCustomerWordingView;
  repair: RepairState;
  onAction(action: RepairAction): Promise<DesignerQuoteReview | undefined>;
  onClose(): void;
}) {
  const { t, message, formatLocale } = createCustomerTranslator(locale, {
    wordingOverlay: wording?.overlays[createCustomerTranslator(locale).canonicalRequestedLocale ?? 'en'] ?? null,
  });
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<ReturnType<typeof repairFailureView>>(),
    [review, setReview] = useState<DesignerQuoteReview>();
  async function action(kind: RepairAction) {
    if (busy) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const next = await onAction(kind);
      if (next) setReview(next);
    } catch (error) {
      setFailure(repairFailureView(portFailure(error), formatLocale));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    // §8.1: Escape does exactly what Close does. Keys pressed in this frame never reach the host dialog,
    // so the view handles them: an open removal confirmation closes first, and nothing happens while an
    // action is pending (Close is disabled then). Capture on window so the suspended Designer behind this
    // view sees the key as handled.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      if (busy) return;
      if (review) setReview(undefined);
      else onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, review, onClose]);
  const view = repairView(repair);
  // Fixed slots, so the buttons keep their places (and focus) when a removal review replaces them.
  function offer(kind: RepairOffer['action']) {
    const offered = view.actions.find((candidate) => candidate.action === kind);
    return (
      offered && (
        <button
          type="button"
          className={offered.primary ? 'primary-button' : 'text-action'}
          disabled={busy}
          onClick={() => void action(kind)}
        >
          {t(offered.label)}
        </button>
      )
    );
  }
  return (
    <main className="admin-preview-message">
      <section aria-label={t(view.label)}>
        <div className="section-heading">
          <h1>{t(view.heading)}</h1>
        </div>
        {view.help && <p>{t(view.help)}</p>}
        {failure && (
          <p className="cart-submit-error" role="alert">
            {message(failure.message)}
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
                      {group.label || t('customer:review.customizedProduct')} ·{' '}
                      {t('customer:quantities.quantityCount', { count: group.quantity })}
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
                {t(failure?.retry ? 'common:actions.retry' : 'customer:recovery.confirmRemoval')}
              </button>
              <button type="button" className="text-action" disabled={busy} onClick={() => setReview(undefined)}>
                {t('common:actions.cancel')}
              </button>
            </>
          ) : (
            <>
              {offer('cart')}
              {offer('start')}
              {offer('remove-group')}
              {offer('remove-all')}
            </>
          )}
          {!review && offer('retry')}
          <button type="button" className="text-action" disabled={busy} onClick={onClose}>
            {t('common:actions.close')}
          </button>
        </div>
      </section>
    </main>
  );
}
