import type { PurchaseGroup, PurchaseView } from '@insignia/contracts';
import { formatExactCount } from '@insignia/ui-localization/core';
import { type GeometryV1, validateGeometry } from '@insignia/ui-visualizer/geometry';
import { useEffect, useState } from 'preact/hooks';
import { useAdminLocale } from '../shared/admin-i18n.js';
import { localizedPurchaseMoney } from '../shared/purchase-view';
import AdminDisclosure from './AdminDisclosure';

export function PurchasedItemImage({
  groups,
  line,
  size = 'base',
}: {
  groups: PurchaseGroup[];
  line: PurchaseView['lines'][number];
  size?: 'small' | 'base';
}) {
  const { t } = useAdminLocale();
  const [now, setNow] = useState(Date.now);
  const candidates = groups.filter(
    (group) =>
      group.productId === line.productId && group.variants.some((variant) => variant.variantId === line.variantId),
  );
  // The retained DTO has no order-line-to-design key. An image is safe only for one matching design.
  const matching = candidates.length === 1 ? candidates : [];
  const deadline = Math.min(
    ...matching.map((group) => Date.parse(group.payloadExpiresAt)).filter((time) => time > now),
  );
  useEffect(() => {
    if (!Number.isFinite(deadline)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(deadline - Date.now(), 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [deadline, now]);
  let src: string | undefined;
  for (const group of matching) {
    if (Date.parse(group.payloadExpiresAt) <= Math.max(now, Date.now())) continue;
    try {
      const geometry = validateGeometry(group.geometry as GeometryV1);
      for (const view of geometry.views) {
        const image = view.variantImages.find((variant) => variant.variantId === line.variantId)?.image ?? view.image;
        src = image ? group.imageUrls[image.revisionId] : undefined;
        if (src) break;
      }
    } catch {
      // Erased or unavailable design metadata has no current-product fallback.
    }
    if (src) break;
  }
  return (
    <s-thumbnail
      src={src}
      alt={src ? t('orders:items.imageAlt', { itemName: line.title ?? t('orders:items.purchasedItem') }) : ''}
      size={size}
    />
  );
}

/** Purchased line values remain distinct from the full order total and Shopify settlement. */
export default function PurchaseItems({ purchase, aside = false }: { purchase: PurchaseView; aside?: boolean }) {
  const { t, formatLocale } = useAdminLocale();
  const quantity = purchase.lines.reduce((sum, line) => sum + BigInt(line.quantity), 0n);
  const products = new Map<string, PurchaseView['lines']>();
  for (const line of purchase.lines) {
    const key = JSON.stringify([line.productId, line.title ?? null]);
    const existing = products.get(key);
    if (existing) existing.push(line);
    else products.set(key, [line]);
  }
  const number = new Intl.NumberFormat(formatLocale);
  const itemCount = (value: bigint) => {
    const exact = formatExactCount(value, formatLocale);
    return exact.kind === 'plural'
      ? t('orders:counts.items', { count: exact.count, formattedCount: exact.formatted })
      : t('orders:counts.itemsExact', { formattedCount: exact.formatted });
  };
  return (
    <div slot={aside ? 'aside' : undefined} class="purchase-detail-support">
      <s-section heading={t('orders:items.heading')}>
        <s-badge slot="graphic" icon="order" size="large" />
        <s-text slot="accessory" color="subdued">
          {purchase.lines.length ? itemCount(quantity) : t('orders:items.needsVerification')}
        </s-text>
        <s-box padding="base">
          <div class="purchase-items">
            <s-stack gap="base">
              {[...products.entries()].map(([key, lines], index) => {
                const line = lines[0];
                if (!line) return null;
                const productQuantity = lines.reduce((sum, item) => sum + BigInt(item.quantity), 0n);
                const variantCount = new Set(lines.map((item) => item.variantId)).size;
                const breakdown = t('orders:items.variantBreakdown', {
                  count: variantCount,
                  formattedVariantCount: number.format(variantCount),
                  formattedItemCount: formatExactCount(productQuantity, formatLocale).formatted,
                });
                const rows = lines.map((item) => (
                  <s-stack key={item.orderLineId} gap="small-300">
                    {lines.length > 1 && <s-text>{item.variantTitle ?? t('orders:items.variantUnavailable')}</s-text>}
                    <s-grid gridTemplateColumns="minmax(0, 1fr) minmax(0, 1fr)" gap="small" alignItems="center">
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        <s-text color="subdued">
                          {localizedPurchaseMoney(
                            item.unitPriceMinor,
                            purchase.exponent,
                            purchase.currency,
                            formatLocale,
                          )}
                        </s-text>
                        <div class="purchase-quantity">
                          <s-stack direction="inline" gap="small-300" alignItems="center">
                            <s-text color="subdued">×</s-text>
                            <s-box
                              background="subdued"
                              borderRadius="small"
                              paddingInline="small-300"
                              minInlineSize="20px"
                            >
                              <s-stack alignItems="center">
                                <s-text>{number.format(item.quantity)}</s-text>
                              </s-stack>
                            </s-box>
                          </s-stack>
                        </div>
                      </s-stack>
                      <s-stack alignItems="end">
                        <s-text type="strong">
                          {localizedPurchaseMoney(
                            (BigInt(item.unitPriceMinor) * BigInt(item.quantity)).toString(),
                            purchase.exponent,
                            purchase.currency,
                            formatLocale,
                          )}
                        </s-text>
                      </s-stack>
                    </s-grid>
                  </s-stack>
                ));
                return (
                  <section key={key} aria-label={line.title ?? t('orders:items.purchasedItem')}>
                    <s-stack gap="small">
                      {index > 0 && <s-divider />}
                      <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small" alignItems="center">
                        <PurchasedItemImage groups={purchase.groups} line={line} size="small" />
                        <s-stack gap="small-300">
                          <s-text type="strong">{line.title ?? t('orders:items.purchasedItemUnavailable')}</s-text>
                          {lines.length === 1 && (
                            <s-text color="subdued">{line.variantTitle ?? t('orders:items.variantUnavailable')}</s-text>
                          )}
                        </s-stack>
                      </s-grid>
                      {lines.length > 3 ? (
                        <AdminDisclosure
                          label={breakdown}
                          actionLabels={{
                            show: t('orders:items.showBreakdown', {
                              breakdown,
                              itemName: line.title ?? t('orders:items.purchasedItem'),
                            }),
                            hide: t('orders:items.hideBreakdown', {
                              breakdown,
                              itemName: line.title ?? t('orders:items.purchasedItem'),
                            }),
                          }}
                        >
                          <s-stack gap="small">{rows}</s-stack>
                        </AdminDisclosure>
                      ) : (
                        rows
                      )}
                    </s-stack>
                  </section>
                );
              })}
              {purchase.lines.length === 0 && <s-paragraph>{t('orders:items.empty')}</s-paragraph>}
            </s-stack>
          </div>
        </s-box>
      </s-section>
    </div>
  );
}
