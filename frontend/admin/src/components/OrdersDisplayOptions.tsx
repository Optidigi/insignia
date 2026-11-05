import { useAdminLocale } from '../shared/admin-i18n.js';

export const orderColumns = ['date', 'total', 'payment', 'artwork', 'methods', 'items'] as const;
export type OrderColumn = (typeof orderColumns)[number];
export type OrderSort = 'date-desc' | 'date-asc';
type Translate = ReturnType<typeof useAdminLocale>['t'];

export function orderColumnLabels(t: Translate): Record<OrderColumn, string> {
  return {
    date: t('orders:table.columns.date'),
    total: t('orders:table.columns.total'),
    payment: t('orders:table.columns.payment'),
    artwork: t('orders:table.columns.artwork'),
    methods: t('orders:table.columns.methods'),
    items: t('orders:table.columns.items'),
  };
}

interface OrdersDisplayOptionsProps {
  columnOrder: OrderColumn[];
  shownColumns: OrderColumn[];
  sort: OrderSort;
  busy: boolean;
  canSort?: boolean;
  onToggle: (key: OrderColumn) => void;
  onSort: (value: OrderSort) => void;
}

export default function OrdersDisplayOptions({
  canSort = true,
  columnOrder,
  shownColumns,
  sort,
  busy,
  onToggle,
  onSort,
}: OrdersDisplayOptionsProps) {
  const { t } = useAdminLocale();
  const labels = orderColumnLabels(t);
  return (
    <>
      <s-button
        variant="tertiary"
        icon="layout-columns-3"
        accessibilityLabel={t('orders:display.accessibleLabel')}
        commandFor="orders-display"
      />
      <s-popover id="orders-display" inlineSize="280px">
        <div class="admin-index-overlay-scroll">
          <s-box padding="small-200">
            <s-stack gap="small-300">
              {canSort && (
                <s-stack gap="small-200">
                  <s-stack direction="inline" alignItems="center" gap="small-200">
                    <s-icon type="sort" />
                    <s-text>{t('orders:display.sortBy')}</s-text>
                    <s-text color="subdued">{t('orders:table.columns.date')}</s-text>
                  </s-stack>
                  <s-choice-list
                    label={t('orders:display.dateOrder')}
                    name="orders-date-sort"
                    disabled={busy}
                    onChange={(event) => {
                      const value = event.currentTarget.values[0];
                      if (!busy && (value === 'date-desc' || value === 'date-asc')) onSort(value);
                    }}
                  >
                    <s-choice value="date-desc" selected={sort === 'date-desc'}>
                      {t('orders:display.newestFirst')}
                    </s-choice>
                    <s-choice value="date-asc" selected={sort === 'date-asc'}>
                      {t('orders:display.oldestFirst')}
                    </s-choice>
                  </s-choice-list>
                </s-stack>
              )}
              {canSort && <s-divider />}
              <s-text fontWeight="medium" color="subdued">
                {t('orders:display.columns')}
              </s-text>
              <s-stack gap="none">
                {columnOrder.map((column) => {
                  const label = labels[column];
                  const shown = shownColumns.includes(column);
                  return (
                    <s-grid key={column} gridTemplateColumns="minmax(0, 1fr) auto" alignItems="center" gap="small">
                      <s-text color={shown ? 'base' : 'subdued'}>{label}</s-text>
                      <s-button
                        variant="tertiary"
                        icon={shown ? 'view' : 'hide'}
                        accessibilityLabel={t(shown ? 'orders:display.hideColumn' : 'orders:display.showColumn', {
                          column: label,
                        })}
                        disabled={busy}
                        onClick={() => onToggle(column)}
                      />
                    </s-grid>
                  );
                })}
              </s-stack>
            </s-stack>
          </s-box>
        </div>
      </s-popover>
    </>
  );
}
