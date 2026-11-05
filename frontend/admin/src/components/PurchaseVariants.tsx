import type { PurchaseGroup, PurchaseView } from '@insignia/contracts';
import { formatExactCount } from '@insignia/ui-localization/core';
import { useAdminLocale } from '../shared/admin-i18n.js';
import AdminDisclosure from './AdminDisclosure';

/** Keep small selections visible and disclose the full retained quantity vector on demand. */
export default function PurchaseVariants({ group, lines }: { group: PurchaseGroup; lines: PurchaseView['lines'] }) {
  const { t, formatLocale } = useAdminLocale();
  const variants = group.variants.map((variant) => ({
    ...variant,
    label:
      lines.find((line) => line.productId === group.productId && line.variantId === variant.variantId)?.variantTitle ??
      t('orders:items.variantUnavailable'),
  }));
  if (variants.length <= 3)
    return (
      <s-text color="subdued">{variants.map((variant) => `${variant.label} × ${variant.quantity}`).join(' · ')}</s-text>
    );
  const quantity = variants.reduce((total, variant) => total + BigInt(variant.quantity), 0n);
  const number = new Intl.NumberFormat(formatLocale);
  const summary = t('orders:counts.variantAndItems', {
    count: variants.length,
    formattedVariantCount: number.format(variants.length),
    formattedItemCount: formatExactCount(quantity, formatLocale).formatted,
  });
  return (
    <AdminDisclosure
      label={summary}
      actionLabels={{
        show: t('orders:items.showVariantBreakdown', { summary }),
        hide: t('orders:items.hideVariantBreakdown', { summary }),
      }}
    >
      <s-stack gap="small">
        <s-grid gridTemplateColumns="minmax(0, 1fr) auto" gap="small">
          <s-text type="strong">{t('orders:items.variant')}</s-text>
          <s-text type="strong">{t('orders:items.quantity')}</s-text>
        </s-grid>
        {variants.map((variant) => (
          <s-grid key={variant.variantId} gridTemplateColumns="minmax(0, 1fr) auto" gap="small">
            <s-text color="subdued">{variant.label}</s-text>
            <s-text>{number.format(variant.quantity)}</s-text>
          </s-grid>
        ))}
      </s-stack>
    </AdminDisclosure>
  );
}
