import { type AdminSkeletonVariant, adminSkeletonDimensions } from '../shared/admin-route';

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
      <s-box minBlockSize={variant === 'preview' ? '360px' : variant === 'inline' ? '0' : '260px'}>
        <div aria-hidden="true">
          <s-stack gap="base">
            {Array.from({ length: rows }, (_, index) => (
              <s-grid
                gridTemplateColumns={variant === 'table' ? '40px minmax(0, 1fr)' : 'minmax(0, 1fr)'}
                gap="base"
                alignItems="center"
                data-skeleton-row
                key={index}
              >
                <s-box
                  display={variant === 'table' || variant === 'preview' ? 'auto' : 'none'}
                  data-skeleton-part="leading"
                  background="subdued"
                  borderRadius="base"
                  {...dimensions.leading}
                />
                <s-box display={variant === 'preview' ? 'none' : 'auto'} data-skeleton-labels>
                  <s-stack gap="small">
                    <s-box data-skeleton-part="label" background="subdued" borderRadius="base" {...dimensions.label} />
                    <s-box data-skeleton-part="value" background="subdued" borderRadius="base" {...dimensions.value} />
                  </s-stack>
                </s-box>
              </s-grid>
            ))}
          </s-stack>
        </div>
      </s-box>
    </div>
  );
}
