import { createCustomerTranslator } from '@insignia/ui-localization/customer';
import { useState } from 'preact/hooks';
import type { DesignerQuoteReview } from '../../../../frontend/designer/src/quote-review';
import { quoteReviewMoney } from '../../../../frontend/designer/src/quote-review';
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
