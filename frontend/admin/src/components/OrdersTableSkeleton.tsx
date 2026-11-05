import { useAdminLocale } from '../shared/admin-i18n.js';
import AdminIndexToolbarSkeleton from './AdminIndexToolbarSkeleton';
import AdminResourceTable, {
  ResourceTableBody,
  ResourceTableCell,
  ResourceTableHead,
  ResourceTableHeader,
  ResourceTableRow,
} from './AdminResourceTable';
import AdminSkeletonBar from './AdminSkeletonBar';
import { SkeletonStack } from './AdminSkeletonLayout';
import { type OrderColumn, orderColumnLabels, orderColumns } from './OrdersDisplayOptions';

/** Keep query-loading placeholders in the same column layout as loaded Orders. */
export default function OrdersTableSkeleton({
  toolbar = true,
  columns,
}: {
  toolbar?: boolean;
  columns?: OrderColumn[];
}) {
  const { t } = useAdminLocale();
  const labels = orderColumnLabels(t);
  const shown = (columns ?? orderColumns).map((key) => ({ key, label: labels[key] }));
  return (
    <div
      role="status"
      aria-label={t('admin-shell:ordersTableSkeleton.loadingOrders')}
      aria-busy="true"
      data-orders-skeleton
      data-admin-skeleton
    >
      <div aria-hidden="true" inert>
        <SkeletonStack gap="none">
          {toolbar && <AdminIndexToolbarSkeleton />}
          <AdminResourceTable label={t('admin-shell:ordersTableSkeleton.loadingOrders')} loading pinPrimaryColumn>
            <ResourceTableHead>
              <ResourceTableHeader>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '20px minmax(0, 1fr)',
                    gap: '12px',
                    alignItems: 'center',
                  }}
                >
                  <AdminSkeletonBar width="16px" height="16px" />
                  <span>{t('admin-shell:ordersTableSkeleton.order')}</span>
                </div>
              </ResourceTableHeader>
              {shown.map(({ key, label }) => (
                <ResourceTableHeader
                  key={key}
                  format={key === 'total' ? 'currency' : key === 'items' ? 'numeric' : 'base'}
                >
                  <span>{label}</span>
                </ResourceTableHeader>
              ))}
            </ResourceTableHead>
            <ResourceTableBody>
              {Array.from({ length: 5 }, (_, index) => (
                <ResourceTableRow key={index}>
                  <ResourceTableCell>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '20px minmax(0, 1fr)',
                        gap: '12px',
                        alignItems: 'center',
                        minHeight: '20px',
                      }}
                    >
                      <AdminSkeletonBar part="label" width="16px" height="16px" />
                      <div class="order-record-name">
                        <AdminSkeletonBar part="label" width="64px" height="16px" />
                      </div>
                    </div>
                  </ResourceTableCell>
                  {shown.map(({ key }) => (
                    <ResourceTableCell key={key} column={key}>
                      <AdminSkeletonBar part="label" width={key === 'items' ? '20px' : '100px'} height="16px" />
                    </ResourceTableCell>
                  ))}
                </ResourceTableRow>
              ))}
            </ResourceTableBody>
          </AdminResourceTable>
        </SkeletonStack>
      </div>
    </div>
  );
}
