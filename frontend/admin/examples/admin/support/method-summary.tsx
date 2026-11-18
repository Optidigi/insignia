/** A concise readback of the draft; setup is separate from publication. Every product can add any method. */

import { useAdminLocale } from '../../../src/shared/admin-i18n.js';
import type { MethodConfiguration } from './method-configuration.mts';
import { formatPrice, parsePrice } from './method-workflow-prices.mts';
export default function MethodSummary({
  method,
  currency = 'EUR',
  count,
  needsSetup,
  onReview,
}: {
  method: MethodConfiguration;
  currency?: string;
  count: number;
  needsSetup: number;
  onReview(needsOnly: boolean): void;
}) {
  const { t, formatLocale } = useAdminLocale();
  const price = parsePrice(method.amount);
  return (
    <aside class="method-summary" aria-label={t('methods:summary.region')}>
      <s-stack gap="base">
        <s-heading>{t('methods:summary.title')}</s-heading>
        <s-stack gap="small">
          <s-text color="subdued">{t('methods:summary.defaultPricing')}</s-text>
          <s-paragraph>
            {method.pricing === 'product' ? (
              t('methods:summary.setEachProduct')
            ) : (
              <>
                <s-text type="strong">
                  {price.kind === 'valid'
                    ? price.minor === 0n
                      ? t('methods:summary.free')
                      : formatPrice(price.minor, formatLocale, currency)
                    : t('methods:summary.priceNotSet')}
                </s-text>{' '}
                {t('methods:summary.perPlacementPerGarment')}
              </>
            )}
          </s-paragraph>
        </s-stack>
        <s-divider />
        <s-stack gap="small">
          <s-text color="subdued">{t('methods:summary.availableTo')}</s-text>
          <s-paragraph>
            <s-text type="strong">{t('methods:summary.allProducts')}</s-text>
          </s-paragraph>
          {count > 0 && (
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-text color="subdued">
                {t('methods:summary.productsUsing', {
                  count,
                  formattedCount: new Intl.NumberFormat(formatLocale).format(count),
                })}
              </s-text>
              {needsSetup > 0 && (
                <s-badge tone="warning">
                  {t('methods:summary.needsSetup', {
                    count: needsSetup,
                    formattedCount: new Intl.NumberFormat(formatLocale).format(needsSetup),
                  })}
                </s-badge>
              )}
            </s-stack>
          )}
          {count > 0 && (
            <div>
              <s-link
                href="#method-products"
                onClick={(event) => {
                  event.preventDefault();
                  onReview(needsSetup > 0);
                }}
              >
                {needsSetup ? t('methods:summary.reviewProducts') : t('methods:summary.viewProductsUsing')}
              </s-link>
            </div>
          )}
        </s-stack>
      </s-stack>
    </aside>
  );
}
