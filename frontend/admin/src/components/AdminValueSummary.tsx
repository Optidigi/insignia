import { useRef } from 'preact/hooks';
import { useAdminLocale } from '../shared/admin-i18n';
import { useTextOverflow } from '../shared/admin-text-overflow';

/** A compact table value with full labels available by keyboard, pointer and touch. */
export default function AdminValueSummary({
  id,
  values,
  label,
  viewAllLabel,
  resourceName,
  emptyLabel,
}: {
  id: string;
  values: readonly string[] | null;
  label: string;
  viewAllLabel?: string;
  resourceName?: string;
  emptyLabel?: string;
}) {
  const first = values?.[0];
  const { t, formatLocale } = useAdminLocale();
  const summary = useRef<HTMLElementTagNameMap['s-paragraph']>(null);
  const overflowing = useTextOverflow(summary, first ?? '');
  if (values === null) return <s-text color="subdued">{t('common:summary.unavailable')}</s-text>;
  if (!first) return <s-text color="subdued">{emptyLabel ?? t('admin-shell:shared.summary.empty')}</s-text>;
  const showDetails = values.length > 1 || overflowing;
  return (
    <s-grid
      data-admin-value-summary
      gridTemplateColumns={showDetails ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)'}
      gap="small-200"
      alignItems="center"
      inlineSize="100%"
    >
      <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        <s-paragraph ref={summary} lineClamp={2}>
          {first}
        </s-paragraph>
      </div>
      {showDetails && (
        <>
          <s-button
            variant="tertiary"
            commandFor={id}
            accessibilityLabel={viewAllLabel ?? t('admin-shell:shared.summary.viewAllValues')}
          >
            {values.length > 1
              ? `+${new Intl.NumberFormat(formatLocale).format(values.length - 1)}`
              : t('admin-shell:shared.summary.view')}
          </s-button>
          <s-popover id={id} inlineSize="280px">
            <div class="admin-value-summary-scroll">
              <s-scroll-box
                overflow="auto"
                accessibilityRole="region"
                accessibilityLabel={label}
                minBlockSize="0px"
                maxBlockSize="360px"
              >
                <s-box padding="base">
                  <s-stack gap="small">
                    {resourceName && <s-text fontWeight="semibold">{resourceName}</s-text>}
                    <s-text fontWeight={resourceName ? 'base' : 'semibold'} color={resourceName ? 'subdued' : 'base'}>
                      {label}
                    </s-text>
                    {values.map((value, index) => (
                      <div key={`${index}-${value}`} style={{ overflowWrap: 'anywhere' }}>
                        <s-text>{value}</s-text>
                      </div>
                    ))}
                  </s-stack>
                </s-box>
              </s-scroll-box>
            </div>
          </s-popover>
        </>
      )}
    </s-grid>
  );
}
