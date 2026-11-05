import { checkedMinor, parseMinor } from '@insignia/domain';
import { useState } from 'preact/hooks';
import { useAdminLocale } from '../shared/admin-i18n';
import { noSelection, selectedValue } from '../shared/admin-select';
import { localizedPurchaseMoney } from '../shared/purchase-view';

type Choice = {
  key: string;
  label: string;
  amount: string | null;
  missingPrice: { placementName: string; methodName: string; sizeName: string };
};
type Placement = { id: string; label: string; choices: Choice[] };

function formatChoiceAmount(amount: string, currency: string, locale: string): string {
  try {
    return localizedPurchaseMoney(parseMinor(amount, 2).toString(), 2, currency, locale);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Reviews saved-form decoration amounts only. Shopify supplies garment prices at purchase. */
export default function DecorationPriceReview({ placements, currency }: { placements: Placement[]; currency: string }) {
  const { t, formatLocale } = useAdminLocale();
  const [selections, setSelections] = useState<Record<string, string>>({});
  const selected = placements.flatMap((placement) => {
    const choice = placement.choices.find((item) => item.key === selections[placement.id]);
    return choice ? [choice] : [];
  });
  const unavailable = selected.filter((choice) => choice.amount === null);
  let decimal: string | null = null;
  if (['EUR', 'USD', 'GBP'].includes(currency) && unavailable.length === 0) {
    try {
      const total = selected.reduce((sum, choice) => checkedMinor(sum + parseMinor(choice.amount ?? '0', 2)), 0n);
      decimal = localizedPurchaseMoney(total.toString(), 2, currency, formatLocale);
    } catch {
      // Drafts can be invalid before save. Never show a rounded or overflowing review amount.
    }
  }
  return (
    <s-section heading={t('editor:priceReview.heading')}>
      <s-stack gap="base">
        <s-paragraph>{t('editor:priceReview.description')}</s-paragraph>
        {placements.length ? (
          placements.map((placement) => (
            <s-select
              key={placement.id}
              label={t('editor:priceReview.placementDecoration', { placementName: placement.label })}
              value={
                placement.choices.some((choice) => choice.key === selections[placement.id])
                  ? selections[placement.id]
                  : noSelection
              }
              onChange={(event) =>
                setSelections((current) => ({
                  ...current,
                  [placement.id]: selectedValue(event.currentTarget.value) ?? '',
                }))
              }
            >
              <s-option value={noSelection}>{t('editor:priceReview.noDecoration')}</s-option>
              {placement.choices.map((choice) => (
                <s-option key={choice.key} value={choice.key}>
                  {choice.label} ·{' '}
                  {choice.amount === null
                    ? t('common:summary.unavailable')
                    : formatChoiceAmount(choice.amount, currency, formatLocale)}
                </s-option>
              ))}
            </s-select>
          ))
        ) : (
          <s-paragraph>{t('editor:priceReview.noPlacements')}</s-paragraph>
        )}
        <div aria-live="polite" role="status">
          {selected.length === 0 ? (
            <s-paragraph>{t('editor:priceReview.choosePlacement')}</s-paragraph>
          ) : unavailable.length ? (
            unavailable.map((choice) => (
              <s-paragraph key={choice.key}>{t('editor:priceReview.missingPrice', choice.missingPrice)}</s-paragraph>
            ))
          ) : decimal === null ? (
            <s-paragraph>{t('editor:priceReview.invalidPrice')}</s-paragraph>
          ) : (
            <s-paragraph>
              <s-text type="strong">{t('editor:priceReview.totalPerGarment', { amount: decimal })}</s-text>
            </s-paragraph>
          )}
        </div>
      </s-stack>
    </s-section>
  );
}
