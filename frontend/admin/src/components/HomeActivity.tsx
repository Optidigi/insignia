import { formatExactCount } from '@insignia/ui-localization/core';
import { useId, useState } from 'preact/hooks';
import { useAdminLocale } from '../shared/admin-i18n.js';
import { type HomeActivityRange, homeActivityChange, homeActivityPeriod } from '../shared/home-activity-period.js';
import { homeSparklinePoints } from '../shared/home-sparkline.js';
import type { HomeStatistics } from '../shared/merchant-home.js';
import '../styles/home-activity.css';

export interface HomeActivityProps {
  statistics: HomeStatistics;
}

const metrics = [{ key: 'customizedOrders' }, { key: 'customizedItems' }] as const;

export default function HomeActivity({ statistics }: HomeActivityProps) {
  const { t, formatLocale } = useAdminLocale();
  const id = `home-activity-${useId()}`;
  const [range, setRange] = useState<HomeActivityRange>(30);
  const percentFormat = new Intl.NumberFormat(formatLocale, { style: 'percent', maximumFractionDigits: 0 });
  const formattedCount = (value: bigint | number) =>
    formatExactCount(typeof value === 'bigint' ? value : BigInt(value), formatLocale).formatted;
  if (statistics.state === 'restricted') return null;
  const period = statistics.state === 'ready' ? homeActivityPeriod(statistics, range) : undefined;
  const canChoosePeriod = statistics.state === 'ready' && statistics.series?.length === 30;
  const periodDays = period?.periodDays ?? 30;
  const periodLabel = t(
    periodDays === 7 ? 'home:activity.period.lastSevenDays' : 'home:activity.period.lastThirtyDays',
  );
  const periodControl = (
    <div class="home-activity__period">
      {canChoosePeriod ? (
        <>
          <s-button variant="tertiary" icon="calendar" commandFor={`${id}-period`}>
            {periodLabel}
          </s-button>
          <s-menu id={`${id}-period`} accessibilityLabel={t('home:activity.period.menu')}>
            <s-button onClick={() => setRange(7)}>{t('home:activity.period.lastSevenDays')}</s-button>
            <s-button onClick={() => setRange(30)}>{t('home:activity.period.lastThirtyDays')}</s-button>
          </s-menu>
        </>
      ) : (
        <s-text color="subdued">{periodLabel}</s-text>
      )}
    </div>
  );
  return (
    <section class="home-activity" aria-label={t('home:activity.label')} data-home-section="statistics">
      {statistics.state === 'unavailable' ? (
        <div class="home-activity__unavailable">
          <s-text color="subdued">{periodLabel}</s-text>
          <s-paragraph color="subdued">{t('home:activity.unavailable')}</s-paragraph>
        </div>
      ) : statistics.state === 'loading' ? (
        <div role="status" aria-label={t('home:loading.activity')} aria-busy="true">
          <div class="home-activity__band" aria-hidden="true">
            {periodControl}
            {metrics.map((metric) => (
              <div class="home-activity__cell" key={metric.key}>
                <s-stack gap="small">
                  <s-box background="subdued" borderRadius="base" inlineSize="110px" blockSize="12px" />
                  <s-box background="subdued" borderRadius="base" inlineSize="36px" blockSize="20px" />
                </s-stack>
              </div>
            ))}
          </div>
        </div>
      ) : period ? (
        <div class="home-activity__band">
          {periodControl}
          {metrics.map((metric) => {
            const values = period.series?.map((day) => day[metric.key]) ?? [];
            const previousValues = period.previousPeriod?.series?.map((day) => day[metric.key]) ?? [];
            const chartValues = [...values, ...previousValues].map((value) =>
              typeof value === 'bigint' ? value : BigInt(value),
            );
            const chartMaximum = chartValues.reduce((maximum, value) => (value > maximum ? value : maximum), 0n);
            const toChartScale = (value: bigint | number) => {
              if (chartMaximum === 0n) return 0;
              const exact = typeof value === 'bigint' ? value : BigInt(value);
              return Number((exact * 1_000_000n) / chartMaximum) / 1_000_000;
            };
            const options = { width: 80, height: 20, maximum: 1 };
            const points = homeSparklinePoints(values.map(toChartScale), options);
            const previousPoints = homeSparklinePoints(previousValues.map(toChartScale), options);
            const change = homeActivityChange(period[metric.key], period.previousPeriod?.[metric.key]);
            const metricLabel = t(`home:activity.metrics.${metric.key}`);
            const metricDefinition = t(`home:activity.metrics.${metric.key}Definition`);
            const currentCount = formattedCount(period[metric.key]);
            const changeKind =
              change === undefined ? undefined : change < 0 ? 'decrease' : change > 0 ? 'increase' : 'unchanged';
            const formattedChange = change === undefined ? undefined : percentFormat.format(Math.abs(change));
            const changeSummary =
              changeKind && formattedChange
                ? t(`home:activity.change.${changeKind}`, {
                    formattedPercent: formattedChange,
                    days: formattedCount(period.periodDays),
                  })
                : '';
            const accessibilityLabel = changeKind
              ? t('home:activity.metricLinkWithChange', { metricLabel, formattedCount: currentCount, changeSummary })
              : t('home:activity.metricLink', { metricLabel, formattedCount: currentCount });
            const definitionId = `${id}-${metric.key}`;
            const tooltipId = `${definitionId}-tooltip`;
            return (
              <div key={metric.key} class="home-activity__cell">
                <s-clickable
                  href="/admin/orders"
                  padding="small"
                  borderRadius="large-200"
                  interestFor={tooltipId}
                  accessibilityLabel={accessibilityLabel}
                >
                  <div class="home-activity__metric">
                    <div class="home-activity__label">
                      <span class="home-activity__label-text">{metricLabel}</span>
                    </div>
                    <div class="home-activity__value-row">
                      <div class="home-activity__numbers">
                        <s-text fontWeight="semibold">{currentCount}</s-text>
                        {change !== undefined && (
                          <span class="home-activity__change" role="img" aria-label={changeSummary}>
                            {change !== 0 && (
                              <s-icon
                                type={change > 0 ? 'arrow-up' : 'arrow-down'}
                                tone={change > 0 ? 'success' : 'neutral'}
                                size="small"
                              />
                            )}
                            <s-text tone={change > 0 ? 'success' : 'neutral'}>
                              {percentFormat.format(Math.abs(change))}
                            </s-text>
                          </span>
                        )}
                      </div>
                      {points && (
                        <svg class="home-activity__sparkline" viewBox="0 0 80 20" aria-hidden="true" focusable="false">
                          {previousPoints && <polyline class="home-activity__previous-line" points={previousPoints} />}
                          {values.length === 1 ? (
                            <circle cx="40" cy={18 - toChartScale(values[0] ?? 0) * 16} r="1.5" />
                          ) : (
                            <polyline points={points} />
                          )}
                        </svg>
                      )}
                    </div>
                  </div>
                </s-clickable>
                <s-tooltip id={tooltipId}>{metricDefinition}</s-tooltip>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
