import { useAdminLocale, withAdminLocale } from '../shared/admin-i18n.js';
import { adminRoute, adminSkeletonInlineSize } from '../shared/admin-route';
import AdminSkeleton from './AdminSkeleton';
import SkeletonBar from './AdminSkeletonBar';
import { SkeletonBox, SkeletonGrid, SkeletonSection, SkeletonStack } from './AdminSkeletonLayout';
import '../styles/home-activity.css';
import '../styles/merchant-home.css';
import HomePanelSkeleton from './HomePanelSkeleton';
import OrdersTableSkeleton from './OrdersTableSkeleton';
import ProductsTableSkeleton from './ProductsTableSkeleton';
import { PurchaseDetailAsideSkeleton, PurchaseDetailSkeleton } from './PurchaseDetailSkeleton';

function SkeletonRow({ trailing, task = false }: { trailing?: 'chevron' | 'badge' | 'action'; task?: boolean }) {
  return (
    <div class="admin-skeleton-content-row" data-skeleton-task={task || undefined} data-skeleton-row>
      <div class="admin-skeleton-copy">
        <SkeletonBar width="38%" height="16px" />
        <SkeletonBar width="86%" />
      </div>
      {trailing && (
        <SkeletonBar
          width={trailing === 'chevron' ? '16px' : trailing === 'badge' ? '64px' : '130px'}
          height={trailing === 'action' ? '28px' : '16px'}
        />
      )}
    </div>
  );
}

/** Shared by the route shell and an in-place billing retry. */
export function BillingContentSkeleton({ label }: { label?: string }) {
  const { t } = useAdminLocale();
  label ??= t('admin-shell:loading.billingDetails');
  return (
    <div role="status" aria-label={label} aria-busy="true" data-admin-skeleton>
      <div class="admin-skeleton-billing-content" aria-hidden="true">
        <div class="admin-skeleton-billing-price" data-skeleton-row>
          <SkeletonBar width="100px" />
          <SkeletonBar width="190px" height="28px" />
        </div>
        <SkeletonRow />
        <div class="admin-skeleton-billing-action" data-skeleton-row>
          <SkeletonBar width="150px" height="28px" />
          <SkeletonBar width="90%" />
        </div>
      </div>
    </div>
  );
}

function SectionHeadingSkeleton({
  width,
  subheading = false,
  supplemental = false,
}: {
  width: `${number}px`;
  subheading?: boolean;
  supplemental?: boolean;
}) {
  return (
    <div
      data-admin-skeleton
      aria-hidden="true"
      class={`admin-skeleton-section-heading${subheading ? ' admin-skeleton-section-heading-with-subheading' : ''}`}
    >
      <div class="admin-skeleton-heading">
        <SkeletonBar width={width} height="16px" />
        {supplemental && <SkeletonBar width="64px" height="16px" />}
      </div>
      {subheading && (
        <div class="admin-skeleton-permissions-subheading">
          <SkeletonBar width="75%" />
        </div>
      )}
    </div>
  );
}

function PermissionCheckSkeleton({ row }: { row: number }) {
  return (
    <div class="admin-skeleton-permission-row" data-skeleton-row>
      <div class="admin-skeleton-permission-heading">
        <div class={`admin-skeleton-permission-title${row === 1 ? ' admin-skeleton-permission-title-long' : ''}`}>
          <SkeletonBar width="140px" height="16px" />
        </div>
        <SkeletonBar width="82px" height="20px" />
      </div>
      <div
        class={`admin-skeleton-permission-description${row === 2 ? ' admin-skeleton-permission-description-short' : ''}`}
      >
        <SkeletonBar width="100%" />
        <SkeletonBar width="90%" />
        <SkeletonBar width="65%" />
      </div>
    </div>
  );
}

function SettingsDestinationSkeleton() {
  return (
    <div class="admin-skeleton-settings-card">
      {[0, 1, 2, 3].map((row) => (
        <div class="admin-skeleton-settings-row" data-skeleton-row key={row}>
          <div class="admin-skeleton-settings-copy">
            <div class="admin-skeleton-text-line">
              <SkeletonBar width="38%" height="16px" />
            </div>
            <div class="admin-skeleton-settings-description">
              <SkeletonBar width="86%" />
              <SkeletonBar width="65%" />
            </div>
          </div>
          <SkeletonBar width="16px" height="16px" />
        </div>
      ))}
    </div>
  );
}

function LanguagePreferenceSkeleton() {
  return (
    <div class="admin-skeleton-language-preference" data-skeleton-row data-skeleton-settings-language>
      <SkeletonBar width="104px" height="16px" part="label" />
      <SkeletonBar width="100%" height="32px" part="value" />
      <div class="admin-skeleton-language-help">
        <SkeletonBar width="72%" height="12px" />
        <SkeletonBar width="48%" height="12px" />
      </div>
    </div>
  );
}

/** Mirrors the language overview or compact editor without adding fake controls. */
export function TranslationsContentSkeleton({ label, editor = false }: { label?: string; editor?: boolean } = {}) {
  return (
    <div
      {...(label ? { role: 'status', 'aria-label': label, 'aria-busy': true } : { 'aria-hidden': 'true' as const })}
      class={`admin-skeleton-translations${editor ? ' admin-skeleton-translations-editor' : ''}`}
      data-admin-skeleton
      data-translations-skeleton
    >
      {editor ? (
        <div class="admin-skeleton-translations-editor-shell">
          <div class="admin-skeleton-translations-nav" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((item) => (
              <div class="admin-skeleton-translations-nav-row" key={item}>
                <SkeletonBar width={item === 0 ? '74%' : item === 2 ? '58%' : '66%'} height="16px" />
              </div>
            ))}
          </div>
          <div class="admin-skeleton-translations-editor-main">
            <div class="admin-skeleton-translations-section-select">
              <SkeletonBar width="100%" height="36px" />
            </div>
            <SkeletonBar width="180px" height="20px" />
            <div class="admin-skeleton-translations-search">
              <SkeletonBar width="100%" height="36px" />
            </div>
            <SkeletonSection padding="none">
              <div class="admin-skeleton-translations-comparison-head">
                {[0, 1, 2].map((column) => (
                  <div key={column}>
                    <SkeletonBar width={column === 0 ? '52px' : column === 1 ? '70px' : '92px'} height="16px" />
                  </div>
                ))}
              </div>
              {Array.from({ length: 8 }, (_, row) => (
                <div class="admin-skeleton-translations-comparison-row" data-skeleton-row key={row}>
                  <div class="admin-skeleton-translations-field-label">
                    <SkeletonBar width={row % 3 === 0 ? '84%' : row % 2 === 0 ? '58%' : '72%'} height="16px" />
                  </div>
                  <div class="admin-skeleton-translations-reference">
                    <div class="admin-skeleton-translations-mobile-label">
                      <SkeletonBar width="72px" height="12px" />
                    </div>
                    <SkeletonBar width={row % 2 === 0 ? '92%' : '70%'} height="20px" />
                  </div>
                  <div class="admin-skeleton-translations-target">
                    <div class="admin-skeleton-translations-mobile-label">
                      <SkeletonBar width="84px" height="12px" />
                    </div>
                    <div class="admin-skeleton-translations-target-controls">
                      <SkeletonBar width="100%" height="32px" />
                      <SkeletonBar width="24px" height="24px" />
                    </div>
                  </div>
                </div>
              ))}
            </SkeletonSection>
          </div>
        </div>
      ) : (
        <div class="admin-skeleton-translations-overview-layout">
          <main class="admin-skeleton-translations-overview-main">
            <div class="admin-skeleton-translations-overview-mobile-controls">
              <SkeletonBar width="100%" height="32px" />
              <SkeletonBar width="104px" height="32px" />
            </div>
            <div class="admin-skeleton-translations-overview-heading">
              <SkeletonBar width="136px" height="16px" />
              <SkeletonBar width="94px" height="20px" />
              <SkeletonBar width="54px" height="20px" />
            </div>
            <SkeletonSection padding="none">
              <div class="admin-skeleton-translations-groups">
                {[0, 1].map((group) => (
                  <div class="admin-skeleton-translations-category" key={group}>
                    <div class="admin-skeleton-translations-category-heading">
                      <SkeletonBar width={group === 0 ? '128px' : '100px'} height="16px" />
                    </div>
                    {[0, 1, 2, 3].map((row) => (
                      <div class="admin-skeleton-translations-overview-row" data-skeleton-row key={row}>
                        <SkeletonBar
                          width={row === 0 ? '66%' : row === 1 ? '48%' : row === 2 ? '58%' : '42%'}
                          height="16px"
                        />
                        <SkeletonBar width="16px" height="16px" />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </SkeletonSection>
          </main>
          <aside class="admin-skeleton-translations-languages">
            <div class="admin-skeleton-translations-languages-heading">
              <SkeletonBar width="82px" height="16px" />
              <SkeletonBar width="80px" height="28px" />
            </div>
            {[0, 1, 2].map((row) => (
              <div class="admin-skeleton-translations-language-row" data-skeleton-row key={row}>
                <SkeletonBar width={row === 0 ? '64%' : row === 1 ? '50%' : '58%'} height="16px" />
                <SkeletonBar width="16px" height="16px" />
              </div>
            ))}
          </aside>
        </div>
      )}
    </div>
  );
}

function StorefrontTaskSkeleton({ first = false }: { first?: boolean }) {
  return (
    <div class="admin-skeleton-content-row admin-skeleton-storefront-task" data-skeleton-task data-skeleton-row>
      <div class="admin-skeleton-storefront-copy">
        <div class="admin-skeleton-storefront-task-heading">
          <SkeletonBar width={first ? '130px' : '80px'} height="16px" />
          <SkeletonBar width="64px" height="20px" />
        </div>
        <div
          class={`admin-skeleton-storefront-description${first ? ' admin-skeleton-storefront-description-long' : ''}`}
        >
          <SkeletonBar width="100%" />
          <SkeletonBar width="90%" />
          <SkeletonBar width="65%" />
        </div>
      </div>
      <SkeletonBar width="130px" height="28px" />
    </div>
  );
}

function DestinationSkeleton({
  layout,
  translationsEditor = false,
}: {
  layout: ReturnType<typeof adminRoute>['layout'];
  translationsEditor?: boolean;
}) {
  const { t } = useAdminLocale();
  if (layout === 'billing')
    return (
      <div class="admin-skeleton-section">
        <SectionHeadingSkeleton width="160px" supplemental />
        <SkeletonSection padding="none">
          <div class="admin-skeleton-card-content">
            <BillingContentSkeleton />
          </div>
        </SkeletonSection>
      </div>
    );
  if (layout === 'storefront')
    return (
      <>
        <div class="admin-skeleton-section">
          <SectionHeadingSkeleton width="150px" />
          <SkeletonSection padding="none">
            <div class="admin-skeleton-storefront-theme-content">
              <div class="admin-skeleton-text-line">
                <SkeletonBar width="220px" />
              </div>
              <div class="admin-skeleton-storefront-tasks">
                <StorefrontTaskSkeleton first />
                <StorefrontTaskSkeleton />
              </div>
              <div class="admin-skeleton-text-line">
                <SkeletonBar width="100%" height="20px" />
              </div>
            </div>
          </SkeletonSection>
        </div>
        <div class="admin-skeleton-section">
          <SectionHeadingSkeleton width="160px" />
          <SkeletonSection padding="none">
            <div class="admin-skeleton-storefront-test" data-skeleton-row>
              <div class="admin-skeleton-storefront-test-copy">
                <SkeletonBar width="100%" />
              </div>
              <SkeletonBar width="150px" height="28px" />
            </div>
          </SkeletonSection>
        </div>
      </>
    );
  if (layout === 'permissions')
    return (
      <div class="admin-skeleton-section">
        <SectionHeadingSkeleton width="140px" subheading />
        <SkeletonSection padding="none">
          <div class="admin-skeleton-permissions-card">
            {[0, 1, 2].map((row) => (
              <PermissionCheckSkeleton row={row} key={row} />
            ))}
            <SkeletonBar width="100px" height="28px" />
          </div>
        </SkeletonSection>
      </div>
    );
  if (layout === 'translations') return <TranslationsContentSkeleton editor={translationsEditor} />;
  if (layout === 'methods')
    return (
      <SkeletonSection padding="none">
        <div class="admin-skeleton-card-heading">
          <SkeletonBar width="100%" height="32px" />
        </div>
        <div class="admin-skeleton-method-heading">
          <span>{t('admin-shell:adminPageSkeleton.method')}</span>
          <span>{t('admin-shell:adminPageSkeleton.actions')}</span>
        </div>
        {[0, 1, 2].map((row) => (
          <div class="admin-skeleton-content-row" data-skeleton-row key={row}>
            <SkeletonBar width="160px" height="16px" />
            <SkeletonBar width="16px" height="16px" />
          </div>
        ))}
      </SkeletonSection>
    );
  if (layout === 'editor')
    return (
      <SkeletonSection>
        <AdminSkeleton label={t('admin-shell:adminPageSkeleton.loadingProductConfiguration')} rows={4} variant="form" />
      </SkeletonSection>
    );
  if (layout === 'settings')
    return (
      <>
        <div class="admin-skeleton-section">
          <SkeletonSection>
            <div class="admin-skeleton-language-section">
              <SkeletonBar width="100px" height="20px" />
              <LanguagePreferenceSkeleton />
            </div>
          </SkeletonSection>
        </div>
        <SkeletonSection padding="none">
          <SettingsDestinationSkeleton />
        </SkeletonSection>
      </>
    );
  return (
    <SkeletonSection padding="none">
      <SettingsDestinationSkeleton />
    </SkeletonSection>
  );
}

/** Reserve the pinned Page composition without upgrading decorative loading markup. */
function AdminPageSkeleton({ pathname, search = '' }: { pathname: string; search?: string }) {
  const { t } = useAdminLocale();
  const { heading, layout, inlineSize } = adminRoute(pathname, t);
  const route = pathname.replace(/\/$/, '');
  const translationsEditor = route === '/admin/settings/translations' && new URLSearchParams(search).has('section');
  if (route === '/admin/home')
    return (
      <div data-skeleton-container>
        <SkeletonGrid justifyItems="center">
          <SkeletonBox
            data-skeleton-layout="home"
            data-skeleton-width="base"
            maxInlineSize={adminSkeletonInlineSize('base')}
            inlineSize="100%"
            paddingBlock="base"
            paddingInline="large-300"
            aria-label="Insignia"
          >
            <SkeletonStack gap="base">
              <div
                class="home-activity"
                data-admin-skeleton
                role="status"
                aria-label={t('admin-shell:adminPageSkeleton.loadingCustomizationActivity')}
                aria-busy="true"
              >
                <div class="home-activity__band">
                  <div class="home-activity__period">
                    <SkeletonBar width="100px" />
                  </div>
                  {[0, 1].map((index) => (
                    <div class="home-activity__cell" key={index}>
                      <SkeletonStack gap="small">
                        <SkeletonBar width="120px" />
                        <SkeletonBar width="36px" height="20px" />
                      </SkeletonStack>
                    </div>
                  ))}
                </div>
              </div>
              <SkeletonSection>
                <HomePanelSkeleton label={t('admin-shell:adminPageSkeleton.loadingProducts')} rows={2} />
              </SkeletonSection>
              <div class="admin-skeleton-section">
                <SectionHeadingSkeleton width="190px" />
                <SkeletonSection padding="none">
                  <HomePanelSkeleton
                    label={t('admin-shell:adminPageSkeleton.loadingCustomizedOrders')}
                    rows={3}
                    variant="orders"
                  />
                </SkeletonSection>
              </div>
            </SkeletonStack>
          </SkeletonBox>
        </SkeletonGrid>
      </div>
    );
  if (route === '/admin/products')
    return (
      <div data-skeleton-container>
        <SkeletonBox
          data-skeleton-layout={layout}
          data-skeleton-width={inlineSize}
          aria-label={heading}
          inlineSize="100%"
          padding="base"
        >
          <ProductsTableSkeleton toolbar />
        </SkeletonBox>
      </div>
    );
  if (pathname.replace(/\/$/, '') === '/admin/orders')
    return (
      <div data-skeleton-container>
        <SkeletonBox
          data-skeleton-layout={layout}
          data-skeleton-width={inlineSize}
          aria-label={heading}
          inlineSize="100%"
          padding="base"
        >
          <OrdersTableSkeleton />
        </SkeletonBox>
      </div>
    );
  if (/^\/admin\/orders\/[^/]+$/.test(route))
    return (
      <div data-skeleton-container>
        <div class="admin-order-skeleton-shell" data-skeleton-layout={layout} data-skeleton-width={inlineSize}>
          <div class="admin-detail-skeleton-layout" data-admin-detail-skeleton-layout>
            <PurchaseDetailSkeleton />
            <PurchaseDetailAsideSkeleton />
          </div>
        </div>
      </div>
    );
  const labels = {
    settings: t('admin-shell:loading.settings'),
    permissions: t('admin-shell:loading.permissions'),
    methods: t('admin-shell:loading.methods'),
    storefront: t('admin-shell:loading.storefront'),
    translations: t('admin-shell:loading.translations'),
    billing: t('admin-shell:loading.billing'),
    detail: t('admin-shell:loading.detail'),
    table: t('admin-shell:loading.settings'),
  };
  const label = layout === 'editor' ? undefined : labels[layout];
  return (
    <div data-skeleton-container>
      <SkeletonGrid justifyItems="center">
        <SkeletonBox
          data-skeleton-layout={layout}
          data-skeleton-width={inlineSize}
          aria-label={heading}
          maxInlineSize={adminSkeletonInlineSize(inlineSize)}
          inlineSize="100%"
          paddingBlock="base"
          paddingInline={inlineSize === 'large' ? 'base' : 'large-300'}
        >
          <div {...(label ? { role: 'status', 'aria-label': label, 'aria-busy': true } : {})} data-admin-skeleton>
            <div class="admin-skeleton-destination" aria-hidden={label ? 'true' : undefined}>
              <DestinationSkeleton layout={layout} translationsEditor={translationsEditor} />
            </div>
          </div>
        </SkeletonBox>
      </SkeletonGrid>
    </div>
  );
}

export default withAdminLocale(AdminPageSkeleton, { neutralWithoutLocale: true });
