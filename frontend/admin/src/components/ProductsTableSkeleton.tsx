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
import { SkeletonGrid, SkeletonStack } from './AdminSkeletonLayout';

/** Keep the initial Products placeholder aligned with the loaded five-column table. */
export default function ProductsTableSkeleton({ toolbar = false }: { toolbar?: boolean }) {
  const { t } = useAdminLocale();
  return (
    <div
      role="status"
      aria-label={t('admin-shell:productsTableSkeleton.loadingProducts')}
      aria-busy="true"
      data-products-skeleton
      data-admin-skeleton
    >
      <div aria-hidden="true" inert>
        <SkeletonStack gap="none">
          {toolbar && <AdminIndexToolbarSkeleton />}
          <AdminResourceTable label={t('admin-shell:productsTableSkeleton.products')} loading pinPrimaryColumn>
            <ResourceTableHead>
              <ResourceTableHeader label={t('admin-shell:productsTableSkeleton.product')}>
                <SkeletonGrid
                  data-skeleton-product-heading
                  gridTemplateColumns="20px minmax(0, 1fr)"
                  gap="small"
                  alignItems="center"
                >
                  <AdminSkeletonBar part="label" width="16px" height="16px" />
                  <span>{t('admin-shell:productsTableSkeleton.product')}</span>
                </SkeletonGrid>
              </ResourceTableHeader>
              <ResourceTableHeader>
                <span>{t('admin-shell:productsTableSkeleton.configuration')}</span>
              </ResourceTableHeader>
              <ResourceTableHeader>
                <span>{t('admin-shell:productsTableSkeleton.methods')}</span>
              </ResourceTableHeader>
              <ResourceTableHeader>
                <span>{t('admin-shell:productsTableSkeleton.printLocations')}</span>
              </ResourceTableHeader>
              <ResourceTableHeader format="numeric">
                <span>{t('admin-shell:productsTableSkeleton.variants')}</span>
              </ResourceTableHeader>
            </ResourceTableHead>
            <ResourceTableBody>
              {Array.from({ length: 5 }, (_, index) => (
                <ResourceTableRow key={index}>
                  <ResourceTableCell>
                    <div class="product-resource-identity">
                      <AdminSkeletonBar part="label" width="16px" height="16px" />
                      <div class="product-resource-thumbnail">
                        <AdminSkeletonBar part="leading" width="40px" height="40px" />
                      </div>
                      <AdminSkeletonBar part="label" width="90%" height="16px" />
                    </div>
                  </ResourceTableCell>
                  <ResourceTableCell>
                    <AdminSkeletonBar part="label" width="88px" height="16px" />
                  </ResourceTableCell>
                  <ResourceTableCell>
                    <SkeletonStack gap="small">
                      <AdminSkeletonBar part="label" width="104px" height="14px" />
                      <AdminSkeletonBar part="label" width="72px" height="14px" />
                    </SkeletonStack>
                  </ResourceTableCell>
                  <ResourceTableCell>
                    <AdminSkeletonBar part="label" width="120px" height="16px" />
                  </ResourceTableCell>
                  <ResourceTableCell column="variants" format="numeric">
                    <AdminSkeletonBar part="label" width="24px" height="16px" />
                  </ResourceTableCell>
                </ResourceTableRow>
              ))}
            </ResourceTableBody>
          </AdminResourceTable>
        </SkeletonStack>
      </div>
    </div>
  );
}
