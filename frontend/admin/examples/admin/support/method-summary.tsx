/** A concise readback of the draft; setup is separate from publication. */

import { useAdminLocale } from '../../../src/shared/admin-i18n.js';
import type { MethodConfiguration } from './method-configuration.mts';
import { formatPrice, parsePrice } from './method-workflow-prices.mts';
export default function MethodSummary({
  method,
  count,
  needsSetup,
  onReview,
}: {
  method: MethodConfiguration;
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
                      : formatPrice(price.minor, formatLocale)
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
            <s-text type="strong">
              {t('methods:summary.products', {
                count,
                formattedCount: new Intl.NumberFormat(formatLocale).format(count),
              })}
            </s-text>{' '}
            {method.assignment === 'manual'
              ? t('methods:summary.manualAssignment')
              : method.tags.length
                ? t('methods:summary.matchingTags', {
                    count: method.tags.length,
                    formattedCount: new Intl.NumberFormat(formatLocale).format(method.tags.length),
                    match:
                      method.tagMatch === 'all'
                        ? t('methods:workflow.assignment.allTags')
                        : t('methods:workflow.assignment.anyTag'),
                  })
                : t('methods:summary.noTagsSelected')}
          </s-paragraph>
          {count > 0 && (
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-text color="subdued">
                {t('methods:summary.configured', {
                  formattedCount: new Intl.NumberFormat(formatLocale).format(count - needsSetup),
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
          <div>
            <s-link
              href="#method-products"
              onClick={(event) => {
                event.preventDefault();
                onReview(needsSetup > 0);
              }}
            >
              {needsSetup
                ? t('methods:summary.reviewProducts')
                : count
                  ? t('methods:summary.viewAssignedProducts')
                  : method.assignment === 'tags'
                    ? t('methods:summary.reviewTagRules')
                    : t('methods:summary.assignProducts')}
            </s-link>
          </div>
        </s-stack>
      </s-stack>
    </aside>
  );
}
