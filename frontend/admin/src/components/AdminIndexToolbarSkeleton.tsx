import AdminSkeletonBar from './AdminSkeletonBar';
import { SkeletonGrid } from './AdminSkeletonLayout';

/** Match the native index toolbar's owner insets and responsive search height. */
export default function AdminIndexToolbarSkeleton() {
  return (
    <div class="admin-index-toolbar admin-skeleton-index-toolbar-owner">
      <div class="admin-index-search admin-skeleton-index-toolbar" data-skeleton-index-toolbar>
        <SkeletonGrid
          data-skeleton-toolbar
          gridTemplateColumns="64px minmax(0, 1fr) 24px"
          gap="base"
          alignItems="center"
        >
          <AdminSkeletonBar part="label" width="48px" height="24px" />
          <AdminSkeletonBar part="label" width="120px" height="12px" />
          <AdminSkeletonBar part="label" width="20px" height="20px" />
        </SkeletonGrid>
      </div>
    </div>
  );
}
