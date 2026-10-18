/** Reserve real content space without showing invented merchant data. */
export default function AdminSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" class="admin-skeleton">
      <div aria-hidden="true">
        <s-stack gap="base">
          {Array.from({ length: rows }, (_, index) => (
            <div class="admin-skeleton-row" key={index}>
              <s-box background="subdued" borderRadius="base" inlineSize="72px" blockSize="56px" />
              <s-stack gap="small">
                <s-box background="subdued" borderRadius="base" inlineSize="65%" blockSize="16px" />
                <s-box background="subdued" borderRadius="base" inlineSize="90%" blockSize="12px" />
              </s-stack>
            </div>
          ))}
        </s-stack>
      </div>
    </div>
  );
}
