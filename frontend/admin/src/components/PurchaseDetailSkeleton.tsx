import { useAdminLocale } from '../shared/admin-i18n.js';
import AdminSkeletonBar from './AdminSkeletonBar';
import { SkeletonSection, SkeletonStack } from './AdminSkeletonLayout';
export function PurchaseDetailSkeleton() {
  const { t } = useAdminLocale();
  return (
    <div
      role="status"
      aria-label={t('admin-shell:purchaseDetailSkeleton.loadingOrderAndArtwork')}
      aria-busy="true"
      data-purchase-detail-skeleton
      data-admin-skeleton
    >
      <div aria-hidden="true">
        <SkeletonStack gap="base">
          <SkeletonStack direction="inline" gap="small" alignItems="center">
            <AdminSkeletonBar part="label" width="100px" height="24px" />
            <AdminSkeletonBar part="label" width="140px" height="20px" />
          </SkeletonStack>
          <AdminSkeletonBar part="label" width="180px" height="14px" />
          <SkeletonSection>
            <SkeletonStack gap="base">
              <AdminSkeletonBar part="label" width="80px" height="18px" />
              <AdminSkeletonBar part="leading" width="100%" height="80px" />
              <AdminSkeletonBar part="label" width="160px" height="32px" />
            </SkeletonStack>
          </SkeletonSection>
          <SkeletonSection>
            <SkeletonStack gap="base">
              {[0, 1, 2].map((row) => (
                <AdminSkeletonBar key={row} part="label" height="28px" />
              ))}
            </SkeletonStack>
          </SkeletonSection>
        </SkeletonStack>
      </div>
    </div>
  );
}

export function PurchaseDetailAsideSkeleton() {
  return (
    <div aria-hidden="true" data-purchase-detail-aside-skeleton data-admin-skeleton class="admin-order-aside-skeleton">
      <div data-skeleton-aside-group>
        <div class="admin-order-aside-heading">
          <AdminSkeletonBar width="28px" height="28px" />
          <AdminSkeletonBar width="120px" height="16px" />
          <AdminSkeletonBar width="48px" height="12px" />
        </div>
        <div class="admin-order-aside-content">
          <div class="admin-order-item-skeleton">
            <AdminSkeletonBar width="40px" height="40px" />
            <SkeletonStack gap="small">
              <AdminSkeletonBar width="100%" height="16px" />
              <AdminSkeletonBar width="80%" />
            </SkeletonStack>
          </div>
          <div class="admin-order-payment-skeleton">
            <AdminSkeletonBar width="100px" />
            <AdminSkeletonBar width="80px" />
          </div>
        </div>
      </div>
      <div data-skeleton-aside-group>
        <div class="admin-order-aside-heading">
          <AdminSkeletonBar width="28px" height="28px" />
          <AdminSkeletonBar width="140px" height="16px" />
        </div>
        <div class="admin-order-aside-content">
          <div class="admin-order-payment-skeleton">
            <AdminSkeletonBar width="100%" />
            <AdminSkeletonBar width="80px" />
          </div>
          <div class="admin-order-payment-skeleton">
            <AdminSkeletonBar width="100%" />
            <AdminSkeletonBar width="80px" height="32px" />
          </div>
        </div>
      </div>
    </div>
  );
}
