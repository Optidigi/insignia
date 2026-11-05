import { useEffect, useRef, useState } from 'preact/hooks';
import { useAdminLocale } from '../shared/admin-i18n.js';
import { orderCalendarDay, orderDayBoundary, orderDayRange } from '../shared/purchase-view.js';
import '../styles/orders-date-filter.css';

export interface OrderDateRange {
  createdFrom?: string;
  createdBefore?: string;
}
interface Props extends OrderDateRange {
  timeZone: string;
  busy: boolean;
  onApply: (range: OrderDateRange) => void;
}

function offsetDay(day: string, amount: number): string {
  const instant = new Date(`${day}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + amount);
  return instant.toISOString().slice(0, 10);
}

type DatePreset = 'any' | 'today' | '7' | '30' | '90' | 'custom';

function appliedPreset(
  createdFrom: string | undefined,
  createdBefore: string | undefined,
  timeZone: string,
): DatePreset {
  if (!createdFrom && !createdBefore) return 'any';
  if (!createdFrom || !createdBefore) return 'custom';
  try {
    const from = orderCalendarDay(new Date(createdFrom), timeZone);
    const through = orderCalendarDay(new Date(Date.parse(createdBefore) - 1), timeZone);
    const today = orderCalendarDay(new Date(), timeZone);
    for (const [value, days] of [
      ['today', 1],
      ['7', 7],
      ['30', 30],
      ['90', 90],
    ] as const) {
      if (
        from === offsetDay(today, 1 - days) &&
        through === today &&
        createdFrom === orderDayBoundary(from, timeZone) &&
        createdBefore === orderDayBoundary(offsetDay(today, 1), timeZone)
      )
        return value;
    }
  } catch {
    // Invalid stored ranges remain available through the custom editor.
  }
  return 'custom';
}

function parseRange(value: string): [string, string] {
  const [from = '', to = ''] = value.split('--');
  return [from, to];
}

export default function OrdersDateFilter({ timeZone, busy, createdFrom, createdBefore, onApply }: Props) {
  const { t } = useAdminLocale();
  const preset = appliedPreset(createdFrom, createdBefore, timeZone);
  const [custom, setCustom] = useState(preset === 'custom');
  const [range, setRange] = useState('');
  const [rangeView, setRangeView] = useState('');
  const [error, setError] = useState<'both-required' | 'end-before-start' | 'invalid-date' | 'empty-date' | null>(null);
  const picker = useRef<HTMLElementTagNameMap['s-date-picker']>(null);
  const [rangeStart, rangeEnd] = parseRange(range);
  const emptySingleDate = (() => {
    if (!rangeStart || rangeStart !== rangeEnd) return false;
    try {
      return orderDayRange(rangeStart, timeZone).isEmpty;
    } catch {
      return false;
    }
  })();
  const rangeMonth =
    rangeStart.slice(0, 7) || rangeEnd.slice(0, 7) || orderCalendarDay(new Date(), timeZone).slice(0, 7);
  useEffect(() => {
    const from = createdFrom ? orderCalendarDay(new Date(createdFrom), timeZone) : '';
    const to = createdBefore ? orderCalendarDay(new Date(Date.parse(createdBefore) - 1), timeZone) : '';
    const nextRange = from && to ? `${from}--${to}` : '';
    setRange(nextRange);
    setRangeView(from.slice(0, 7) || to.slice(0, 7));
    setCustom(appliedPreset(createdFrom, createdBefore, timeZone) === 'custom');
  }, [createdFrom, createdBefore, timeZone]);

  function updateDatePart(index: 0 | 1, value: string) {
    const parts = parseRange(range);
    parts[index] = value;
    setRange(`${parts[0]}--${parts[1]}`);
    if (/^\d{4}-\d{2}/.test(value)) setRangeView(value.slice(0, 7));
    setError(null);
  }

  function apply(first: string, last: string) {
    try {
      if (!first || !last) {
        setError('both-required');
        picker.current?.focus();
        return;
      }
      if (first && last && first > last) {
        setError('end-before-start');
        picker.current?.focus();
        return;
      }
      const firstRange = first ? orderDayRange(first, timeZone) : undefined;
      const lastRange = last ? orderDayRange(last, timeZone) : undefined;
      if (first === last && firstRange?.isEmpty) {
        setError('empty-date');
        setCustom(true);
        setRange(`${first}--${last}`);
        setRangeView(first.slice(0, 7));
        picker.current?.focus();
        return;
      }
      const nextRange = {
        ...(firstRange ? { createdFrom: firstRange.createdFrom } : {}),
        ...(lastRange ? { createdBefore: lastRange.createdBefore } : {}),
      };
      setError(null);
      onApply(nextRange);
    } catch {
      setError('invalid-date');
      picker.current?.focus();
    }
  }

  function choosePreset(value: string) {
    setError(null);
    if (value === 'custom') {
      setRangeView(rangeMonth);
      setCustom(true);
      return;
    }
    setCustom(false);
    if (value === 'any') {
      setRange('');
      onApply({});
      return;
    }
    const days = value === 'today' ? 1 : Number(value);
    if (![1, 7, 30, 90].includes(days)) return;
    const today = orderCalendarDay(new Date(), timeZone);
    apply(offsetDay(today, 1 - days), today);
  }

  function applyCustom() {
    const [first, last] = parseRange(picker.current?.value ?? range);
    apply(first, last);
  }

  return (
    <s-stack gap="small-300">
      <s-divider />
      <s-stack gap="small-200">
        {!custom ? (
          <>
            <s-choice-list
              label={t('orders:date.orderDate')}
              name="orders-order-date"
              disabled={busy}
              onChange={(event) => choosePreset(event.currentTarget.values[0] ?? 'any')}
            >
              <s-choice value="any" selected={preset === 'any'}>
                {t('orders:date.anyTime')}
              </s-choice>
              <s-choice value="today" selected={preset === 'today'}>
                {t('orders:date.today')}
              </s-choice>
              <s-choice value="7" selected={preset === '7'}>
                {t('orders:date.lastSevenDays')}
              </s-choice>
              <s-choice value="30" selected={preset === '30'}>
                {t('orders:date.lastThirtyDays')}
              </s-choice>
              <s-choice value="90" selected={preset === '90'}>
                {t('orders:date.lastNinetyDays')}
              </s-choice>
              <s-choice value="custom" selected={preset === 'custom'}>
                {t('orders:date.customRange')}
              </s-choice>
            </s-choice-list>
            {preset === 'custom' && (
              <s-button variant="tertiary" icon="calendar" onClick={() => choosePreset('custom')}>
                {t('orders:date.editCustomRange')}
              </s-button>
            )}
          </>
        ) : (
          <>
            <fieldset
              style={{ border: 0, margin: 0, padding: 0, minInlineSize: 0 }}
              aria-label={t('orders:date.customRange')}
            >
              <s-stack gap="small">
                <s-text type="strong">{t('orders:date.customRange')}</s-text>
                <div class="orders-date-fields">
                  <s-text-field
                    label={t('orders:date.from')}
                    name="orders-date-from"
                    placeholder={t('orders:date.datePlaceholder')}
                    value={rangeStart}
                    onInput={(event) => updateDatePart(0, event.currentTarget.value)}
                    disabled={busy}
                  />
                  <s-text-field
                    label={t('orders:date.to')}
                    name="orders-date-to"
                    placeholder={t('orders:date.datePlaceholder')}
                    value={rangeEnd}
                    onInput={(event) => updateDatePart(1, event.currentTarget.value)}
                    disabled={busy}
                  />
                </div>
                <div inert={busy}>
                  <s-date-picker
                    ref={picker}
                    name="orders-order-date-range"
                    type="range"
                    visibleMonths="1"
                    defaultView={rangeMonth}
                    view={rangeView || rangeMonth}
                    value={range}
                    onViewChange={(event) => setRangeView(event.currentTarget.view)}
                    onChange={(event) => {
                      const nextRange = event.currentTarget.value;
                      setRange(nextRange);
                      const [first, last] = parseRange(nextRange);
                      setRangeView(first.slice(0, 7) || last.slice(0, 7) || rangeView);
                      setError(null);
                    }}
                  />
                </div>
              </s-stack>
            </fieldset>
            {error && (
              <s-text tone="critical">
                {error === 'both-required'
                  ? t('orders:date.errors.bothRequired')
                  : error === 'end-before-start'
                    ? t('orders:date.errors.endBeforeStart')
                    : error === 'empty-date'
                      ? t('orders:date.errors.emptyDate')
                      : t('orders:date.errors.invalidDate')}
              </s-text>
            )}
            {!error && emptySingleDate && <s-text tone="critical">{t('orders:date.errors.emptyDate')}</s-text>}
            <s-stack direction="inline" gap="small-200">
              <s-button variant="primary" disabled={busy || emptySingleDate} onClick={applyCustom}>
                {t('orders:date.apply')}
              </s-button>
              <s-button
                variant="tertiary"
                disabled={busy}
                onClick={() => {
                  setCustom(false);
                  setError(null);
                }}
                icon="arrow-left"
              >
                {t('orders:date.backToPresets')}
              </s-button>
            </s-stack>
          </>
        )}
      </s-stack>
    </s-stack>
  );
}
