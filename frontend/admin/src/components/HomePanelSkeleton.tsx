import AdminSkeletonBar from './AdminSkeletonBar.js';
import { SkeletonStack } from './AdminSkeletonLayout.tsx';

/** Reserve the known product and order row compositions while their data is pending. */
export default function HomePanelSkeleton({
  label,
  rows = 3,
  variant = 'products',
}: {
  label: string;
  rows?: number;
  variant?: 'products' | 'orders';
}) {
  return (
    <div
      class="merchant-home__skeleton"
      role="status"
      aria-label={label}
      aria-busy="true"
      data-home-skeleton
      data-admin-skeleton
    >
      <div
        aria-hidden="true"
        class={variant === 'orders' ? 'merchant-home__skeleton-orders' : 'merchant-home__skeleton-content'}
      >
        {Array.from({ length: rows }, (_, index) =>
          variant === 'products' ? (
            <div key={index} class="merchant-home__skeleton-row">
              <AdminSkeletonBar part="leading" width="40px" height="40px" />
              <SkeletonStack gap="small">
                <AdminSkeletonBar width="50%" />
                <AdminSkeletonBar width="75%" />
              </SkeletonStack>
            </div>
          ) : (
            <div key={index} class="merchant-home__skeleton-order-row">
              <div class="merchant-home__order">
                <div class="merchant-home__order-heading">
                  <div class="merchant-home__identity">
                    <div class="admin-skeleton-text-line">
                      <AdminSkeletonBar width="64px" height="16px" />
                    </div>
                  </div>
                  <div class="merchant-home__order-product">
                    <div class="admin-skeleton-text-line">
                      <AdminSkeletonBar width="75%" />
                    </div>
                  </div>
                </div>
                <div class="merchant-home__order-meta">
                  <div class="admin-skeleton-text-line">
                    <AdminSkeletonBar width="140px" />
                  </div>
                </div>
                <div class="merchant-home__order-status">
                  <AdminSkeletonBar width="100px" height="20px" />
                </div>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
