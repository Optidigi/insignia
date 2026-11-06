import { createCustomerTranslator } from '@insignia/ui-localization/customer';
import { useState } from 'preact/hooks';
import type { DesignerQuoteReview } from '../../../../frontend/designer/src/quote-review';
import { quoteReviewMoney } from '../../../../frontend/designer/src/quote-review';
export type RepairAction = 'start' | 'remove-group' | 'remove-all' | 'confirm' | 'retry';
export function DesignerRepair({
  locale,
  wording,
  canStart,
  canRemoveGroup,
  onAction,
  onClose,
}: {
  locale?: string;
  wording?: import('@insignia/contracts').MerchantCustomerWordingView;
  canStart: boolean;
  canRemoveGroup: boolean;
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
  return (
    <main className="app">
      <section className="panel-content" aria-label={t('customer:recovery.repairRequired')}>
        <div className="section-heading">
          <h2>{t('customer:recovery.repairRequired')}</h2>
        </div>
        <p>{t('customer:recovery.repairHelp')}</p>
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
              {canStart && (
                <button type="button" className="primary-button" disabled={busy} onClick={() => void action('start')}>
                  {t('customer:recovery.startNew')}
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
              <button type="button" className="text-action" disabled={busy} onClick={() => void action('remove-all')}>
                {t('customer:recovery.removeAll')}
              </button>
            </>
          )}
          {!review && (
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
