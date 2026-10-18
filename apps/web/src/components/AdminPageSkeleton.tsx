import { adminRoute } from '../shared/admin-route';
import AdminSkeleton from './AdminSkeleton';

/** Match the pinned Page composition with Polaris primitives; only the live view owns s-page. */
export default function AdminPageSkeleton({ pathname }: { pathname: string }) {
  const { heading, layout, inlineSize } = adminRoute(pathname);
  return (
    <div data-skeleton-container>
      <s-grid justifyItems="center">
        <s-box
          data-skeleton-layout={layout}
          data-skeleton-width={inlineSize}
          aria-label={heading}
          maxInlineSize={inlineSize === 'small' ? '662px' : '998px'}
          inlineSize="100%"
          padding="base"
        >
          <s-grid
            data-skeleton-grid
            gridTemplateColumns={
              layout === 'editor'
                ? '@container admin-page-skeleton (inline-size >= 784px) minmax(0, 1fr) 312px, minmax(0, 1fr)'
                : 'minmax(0, 1fr)'
            }
            gap="base"
            alignItems="start"
          >
            <s-stack gap="base">
              <s-box data-skeleton-extra="editor" display={layout === 'editor' ? 'auto' : 'none'}>
                <s-section>
                  <AdminSkeleton label="Setup navigation placeholder" rows={2} variant="inline" />
                </s-section>
              </s-box>
              <s-box data-skeleton-extra="plan" display={pathname.includes('/billing') ? 'auto' : 'none'}>
                <s-section>
                  <AdminSkeleton label="Plan placeholder" rows={2} variant="inline" />
                </s-section>
              </s-box>
              <s-section>
                <AdminSkeleton
                  label="Page content"
                  rows={layout === 'editor' ? 4 : 5}
                  variant={layout === 'editor' ? 'form' : layout}
                />
              </s-section>
              <s-box data-skeleton-extra="settings" display={layout === 'settings' ? 'auto' : 'none'}>
                <s-section>
                  <AdminSkeleton label="Account settings placeholder" rows={2} variant="inline" />
                </s-section>
              </s-box>
              <s-box data-skeleton-extra="theme" display={pathname.includes('/storefront') ? 'auto' : 'none'}>
                <s-section>
                  <AdminSkeleton label="Theme setup placeholder" rows={3} variant="form" />
                </s-section>
              </s-box>
            </s-stack>
            <s-box data-skeleton-preview display={layout === 'editor' ? 'auto' : 'none'}>
              <s-section>
                <AdminSkeleton label="Preview placeholder" rows={1} variant="preview" />
              </s-section>
            </s-box>
          </s-grid>
        </s-box>
      </s-grid>
    </div>
  );
}
