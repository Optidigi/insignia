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
    <div role="status" aria-label={label} aria-busy="true" class={`admin-skeleton admin-skeleton-${variant}`}>
      <div aria-hidden="true">
        <s-stack gap="base">
          {Array.from({ length: rows }, (_, index) => (
            <div class="admin-skeleton-row" key={index}>
              <s-box data-skeleton-part="leading" background="subdued" borderRadius="base" {...dimensions.leading} />
              <s-stack gap="small">
                <s-box data-skeleton-part="label" background="subdued" borderRadius="base" {...dimensions.label} />
                <s-box data-skeleton-part="value" background="subdued" borderRadius="base" {...dimensions.value} />
              </s-stack>
            </div>
          ))}
        </s-stack>
      </div>
    </div>
  );
}
