import { adminRoute } from '../shared/admin-route';
import AdminSkeleton from './AdminSkeleton';

export default function AdminPageSkeleton({ pathname }: { pathname: string }) {
  const { heading, layout } = adminRoute(pathname);
  return (
    <section class="admin-page-placeholder" data-skeleton-layout={layout} aria-label={heading}>
      <s-box data-placeholder-heading background="subdued" borderRadius="base" inlineSize="220px" blockSize="28px" />
      <s-section data-skeleton-preview slot={layout === 'editor' ? 'aside' : undefined}>
        <AdminSkeleton label="Preview placeholder" rows={1} variant="preview" />
      </s-section>
      <s-section>
        <AdminSkeleton label="Page content" rows={5} variant={layout === 'editor' ? 'form' : layout} />
      </s-section>
    </section>
  );
}
