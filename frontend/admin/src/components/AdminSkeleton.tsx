import { type AdminSkeletonVariant, adminSkeletonDimensions } from '../shared/admin-route';
import AdminSkeletonBar from './AdminSkeletonBar';
import { SkeletonBox, SkeletonGrid, SkeletonStack } from './AdminSkeletonLayout';

/** Reserve real content space without showing invented merchant data. */
export default function AdminSkeleton({
  label,
  rows = 3,
  variant = 'table',
}: {
  label: string;
  rows?: number;
  variant?: AdminSkeletonVariant;
}) {
  const dimensions = adminSkeletonDimensions(variant);
  return (
    <div role="status" aria-label={label} aria-busy="true" data-admin-skeleton data-skeleton-variant={variant}>
      <SkeletonBox minBlockSize={variant === 'preview' ? '360px' : variant === 'inline' ? '0' : '260px'}>
        <div aria-hidden="true">
          <SkeletonStack gap="base">
            {Array.from({ length: rows }, (_, index) => (
              <SkeletonGrid
                gridTemplateColumns={variant === 'table' ? '40px minmax(0, 1fr)' : 'minmax(0, 1fr)'}
                gap="base"
                alignItems="center"
                data-skeleton-row
                key={index}
              >
                <AdminSkeletonBar
                  hidden={variant !== 'table' && variant !== 'preview'}
                  part="leading"
                  width={dimensions.leading.inlineSize}
                  height={dimensions.leading.blockSize}
                />
                <SkeletonBox display={variant === 'preview' ? 'none' : 'auto'} data-skeleton-labels>
                  <SkeletonStack gap="small">
                    <AdminSkeletonBar
                      part="label"
                      width={dimensions.label.inlineSize}
                      height={dimensions.label.blockSize}
                    />
                    <AdminSkeletonBar
                      part="value"
                      width={dimensions.value.inlineSize}
                      height={dimensions.value.blockSize}
                    />
                  </SkeletonStack>
                </SkeletonBox>
              </SkeletonGrid>
            ))}
          </SkeletonStack>
        </div>
      </SkeletonBox>
    </div>
  );
}
