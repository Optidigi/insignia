import { formatExactCount } from '@insignia/ui-localization/core';
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from 'preact/hooks';
import AdminResourceName from '../components/AdminResourceName.js';
import HomeActivity from '../components/HomeActivity.js';
import HomeGettingStarted from '../components/HomeGettingStarted.js';
import HomeSkeleton from '../components/HomePanelSkeleton.js';
import { useAdminLocale } from '../shared/admin-i18n.js';
import { useAdminPageReady } from '../shared/admin-page-ready.js';
import { safePluralCount } from '../shared/home-activity-period.js';
import { homeActionReducer, initialHomeActionState } from '../shared/home-workflow-state.js';
import type {
  HomeGuidanceStepId,
  HomeOrder,
  HomeOrdersPanel,
  HomePanel,
  HomeProductsPanel,
  HomeSetup,
  MerchantHomeModel,
} from '../shared/merchant-home.js';
import '../styles/merchant-home.css';

export interface MerchantHomeProps {
  model: MerchantHomeModel;
  onRetry?: (panel: HomePanel) => void | Promise<void>;
  onCreateProduct?: () => void | Promise<void>;
  onDismissGuidance?: () => void;
  onRestoreGuidance?: () => void;
  onCompleteGuidanceStep?: (step: HomeGuidanceStepId, complete: boolean) => void;
}

function ResourceName({ text, href, linked = true }: { text: string; href: string; linked?: boolean }) {
  return (
    <AdminResourceName text={text}>
      {({ textRef, interestFor, tooltip }) => (
        <>
          {linked ? (
            <s-link href={href} interestFor={interestFor}>
              <div ref={textRef} class="merchant-home__resource-name">
                <s-text fontWeight="medium">{text}</s-text>
              </div>
            </s-link>
          ) : (
            <div ref={textRef} class="merchant-home__resource-name">
              <s-text fontWeight="medium" interestFor={interestFor}>
                {text}
              </s-text>
            </div>
          )}
          {tooltip}
        </>
      )}
    </AdminResourceName>
  );
}

function DividedListItem({
  index,
  className,
  children,
}: {
  index: number;
  className: string;
  children: ComponentChildren;
}) {
  return (
    <li>
      {index > 0 && (
        <div class="merchant-home__separator">
          <s-divider />
        </div>
      )}
      <div class={className}>{children}</div>
    </li>
  );
}

/** Keep long translated section headings and their actions in normal wrapping layout. */
function HomeSection({
  heading,
  accessibilityLabel,
  area,
  action,
  accessory,
  padding,
  children,
}: {
  heading?: string;
  accessibilityLabel?: string;
  area: 'drafts' | 'orders' | 'tasks';
  action?: ComponentChildren;
  accessory?: ComponentChildren;
  padding?: 'none';
  children: ComponentChildren;
}) {
  return (
    <div class="merchant-home__section" data-home-section={area}>
      {heading && (
        <div class="merchant-home__section-header">
          <div class="merchant-home__section-title">
            <s-heading>{heading}</s-heading>
            {accessory}
          </div>
          {action && <div class="merchant-home__section-action">{action}</div>}
        </div>
      )}
      <s-section accessibilityLabel={accessibilityLabel ?? heading} padding={padding}>
        {children}
      </s-section>
    </div>
  );
}

function ResourceDescription({ text }: { text: string }) {
  return (
    <AdminResourceName text={text}>
      {({ textRef, interestFor, tooltip }) => (
        <>
          <div ref={textRef} class="merchant-home__order-product">
            <s-text interestFor={interestFor}>{text}</s-text>
          </div>
          {tooltip}
        </>
      )}
    </AdminResourceName>
  );
}

function EmptyState({
  icon,
  heading,
  children,
  action,
  graphic,
}: {
  graphic?: ComponentChildren;
  icon?: 'product' | 'store';
  heading: string;
  children: ComponentChildren;
  action?: ComponentChildren;
}) {
  const copy = (
    <div class="merchant-home__empty-copy">
      <h2 class="merchant-home__empty-heading">
        <s-text fontWeight="medium">{heading}</s-text>
      </h2>
      <p class="merchant-home__empty-description">
        <s-text color="subdued">{children}</s-text>
      </p>
    </div>
  );
  return (
    <div class="merchant-home__empty">
      {graphic ? (
        <div class="merchant-home__illustrated-empty">
          {graphic}
          {copy}
        </div>
      ) : (
        <>
          {icon && (
            <s-box padding="small" background="subdued" borderRadius="base">
              <s-icon type={icon} />
            </s-box>
          )}
          {copy}
        </>
      )}
      {action && <div class="merchant-home__empty-action">{action}</div>}
    </div>
  );
}

function SetupGuide({ setup, compact = false }: { setup: HomeSetup; compact?: boolean }) {
  const { t } = useAdminLocale();
  const [collapsed, setCollapsed] = useState(setup.initiallyCollapsed ?? false);
  const contentId = `home-setup-${useId()}`;
  const trigger = useRef<HTMLElementTagNameMap['s-button']>(null);
  useEffect(() => {
    if (!setup.preferenceKey) {
      setCollapsed(setup.initiallyCollapsed ?? false);
      return;
    }
    try {
      const preference = sessionStorage.getItem(`insignia:home-guide:${setup.preferenceKey}`);
      setCollapsed(preference === null ? (setup.initiallyCollapsed ?? false) : preference === 'collapsed');
    } catch {
      setCollapsed(setup.initiallyCollapsed ?? false);
    }
  }, [setup.preferenceKey, setup.initiallyCollapsed]);
  useLayoutEffect(() => {
    trigger.current?.setAttribute('aria-expanded', String(!collapsed));
    trigger.current?.setAttribute('aria-controls', contentId);
  }, [collapsed, contentId]);
  if (setup.tasks.length === 0) return null;
  const nextTask = setup.tasks.find(
    (task) =>
      (task.state === 'pending' || task.state === 'unknown') &&
      (!compact || !['test', 'customer-test'].includes(task.id)),
  );
  if (compact)
    return nextTask ? (
      <s-section accessibilityLabel={t('home:sections.storefrontSetup')} data-home-section="setup">
        <div class="merchant-home__task">
          <s-text fontWeight="medium">{t(`home:setup.tasks.${nextTask.kind}.title`)}</s-text>
          {nextTask.action && (
            <div class="merchant-home__task-action">
              <s-button href={nextTask.action.href}>{t(`home:setup.tasks.${nextTask.kind}.action`)}</s-button>
            </div>
          )}
        </div>
      </s-section>
    ) : null;
  return (
    <s-section heading={t('home:sections.storefrontSetup')} data-home-section="setup">
      <s-button
        ref={trigger}
        slot="secondary-actions"
        variant="tertiary"
        icon={collapsed ? 'chevron-down' : 'chevron-up'}
        accessibilityLabel={collapsed ? t('home:setup.toggleShow') : t('home:setup.toggleHide')}
        onClick={() => {
          const next = !collapsed;
          setCollapsed(next);
          if (setup.preferenceKey) {
            try {
              sessionStorage.setItem(`insignia:home-guide:${setup.preferenceKey}`, next ? 'collapsed' : 'expanded');
            } catch {
              // Guidance remains usable when browser storage is unavailable.
            }
          }
        }}
      >
        {collapsed ? t('home:guidance.showAction') : t('home:guidance.hideAction')}
      </s-button>
      {collapsed && (
        <s-paragraph color="subdued">
          {nextTask
            ? nextTask.kind === 'storefront' && nextTask.reason
              ? t(`home:setup.tasks.storefront.${nextTask.reason}`)
              : t(`home:setup.tasks.${nextTask.kind}.description`)
            : t('home:setup.reviewChecks')}
        </s-paragraph>
      )}
      <div id={contentId} hidden={collapsed}>
        <ul class="merchant-home__list merchant-home__setup-list">
          {setup.tasks.map((task, index) => (
            <DividedListItem index={index} className="merchant-home__task" key={task.id}>
              <div class="merchant-home__task-copy">
                <div class="merchant-home__identity">
                  <s-text fontWeight="medium">{t(`home:setup.tasks.${task.kind}.title`)}</s-text>
                  {task.state === 'complete' ? (
                    <s-badge tone="success" icon="check">
                      {t('home:setup.complete')}
                    </s-badge>
                  ) : task.state === 'acknowledged' ? (
                    <s-badge>{t('home:setup.confirmed')}</s-badge>
                  ) : task.state === 'unknown' ? (
                    <s-badge>{t('home:setup.unverified')}</s-badge>
                  ) : null}
                </div>
                <s-paragraph color="subdued">
                  {task.kind === 'storefront' && task.reason
                    ? t(`home:setup.tasks.storefront.${task.reason}`)
                    : t(`home:setup.tasks.${task.kind}.description`)}
                </s-paragraph>
              </div>
              {task.action && (
                <div class="merchant-home__task-action">
                  <s-button href={task.action.href}>{t(`home:setup.tasks.${task.kind}.action`)}</s-button>
                </div>
              )}
            </DividedListItem>
          ))}
        </ul>
      </div>
    </s-section>
  );
}

function OrderBadge({ status }: { status: HomeOrder['status'] }) {
  const { t } = useAdminLocale();
  return (
    <s-badge tone={status === 'artwork-ready' ? 'success' : status === 'artwork-needed' ? 'caution' : 'auto'}>
      {t(`home:orders.statuses.${status}`)}
    </s-badge>
  );
}

export default function MerchantHome({
  model,
  onRetry,
  onCreateProduct,
  onDismissGuidance,
  onRestoreGuidance,
  onCompleteGuidanceStep,
}: MerchantHomeProps) {
  const { t, formatLocale } = useAdminLocale();
  useAdminPageReady(true);
  const [actions, dispatchAction] = useReducer(homeActionReducer, undefined, initialHomeActionState);
  const retrying = actions.retrying;
  const creatingProduct = actions.creation === 'pending';
  const createProductFailed = actions.creation === 'failed';
  const retryClaim = useRef<HomePanel | null>(null);
  const createClaim = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [restoredGuide, setRestoredGuide] = useState(false);
  const productRegion = useRef<HTMLElement>(null);
  const orderRegion = useRef<HTMLElement>(null);
  const homeRegion = useRef<HTMLElement>(null);
  const pendingFocus = useRef<HomePanel | null>(null);
  const guideToggle = useRef<HTMLElementTagNameMap['s-button']>(null);
  const guidanceFocus = useRef<'guide' | 'content' | null>(null);
  useLayoutEffect(() => {
    if (model.state !== 'ready' || !guidanceFocus.current) return;
    const focus = () => {
      const target = guidanceFocus.current === 'content' ? homeRegion.current : guideToggle.current;
      if (!target) return;
      target.focus();
      guidanceFocus.current = null;
    };
    if (guidanceFocus.current === 'content') {
      focus();
      return;
    }
    // Let a native page-actions menu finish closing before entering the restored guide.
    let secondFrame = 0;
    const frame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(focus);
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(secondFrame);
    };
  });
  const dismissGuidance = onDismissGuidance
    ? () => {
        guidanceFocus.current = 'content';
        setRestoredGuide(false);
        onDismissGuidance();
      }
    : undefined;
  const restoreGuidance = onRestoreGuidance
    ? () => {
        guidanceFocus.current = 'guide';
        setRestoredGuide(true);
        onRestoreGuidance();
      }
    : undefined;
  useLayoutEffect(() => {
    const panel = pendingFocus.current;
    if (panel === null || retrying !== null || model.state === 'loading') return;
    if (model.state === 'ready' && model[panel].state === 'loading') return;
    const preferred = panel === 'products' ? productRegion.current : orderRegion.current;
    const fallback = panel === 'products' ? orderRegion.current : productRegion.current;
    const destination = [preferred, fallback, homeRegion.current].find(
      (region) => region !== null && region.getClientRects().length > 0,
    );
    pendingFocus.current = null;
    destination?.focus();
  });
  const retry = async (panel: HomePanel) => {
    if (!onRetry || retryClaim.current !== null) return;
    retryClaim.current = panel;
    dispatchAction({ type: 'panel-retry-requested', panel });
    try {
      await onRetry(panel);
    } catch {
      // The adapter owns the failed-read state and safe recovery copy.
    } finally {
      retryClaim.current = null;
      if (mounted.current) {
        pendingFocus.current = panel;
        dispatchAction({ type: 'panel-retry-finished', panel });
      }
    }
  };

  const createProduct = async () => {
    if (!onCreateProduct || createClaim.current) return;
    createClaim.current = true;
    dispatchAction({ type: 'product-creation-requested' });
    try {
      await onCreateProduct();
      if (mounted.current) dispatchAction({ type: 'product-created' });
    } catch {
      if (mounted.current) dispatchAction({ type: 'product-creation-failed' });
    } finally {
      createClaim.current = false;
    }
  };

  const failure = (panel: HomePanel, reason?: 'busy') => (
    <div class="merchant-home__recovery">
      <div class="merchant-home__task-copy">
        <s-text fontWeight="medium">
          {t(panel === 'products' ? 'home:failure.productsHeading' : 'home:failure.ordersHeading')}
        </s-text>
        <s-paragraph color="subdued">
          {t(
            reason === 'busy'
              ? 'admin-shell:errors.shopifyBusy'
              : panel === 'products'
                ? 'home:failure.productsBody'
                : 'home:failure.ordersBody',
          )}
        </s-paragraph>
      </div>
      <div class="merchant-home__actions">
        {onRetry && (
          <s-button loading={retrying === panel} disabled={retrying !== null} onClick={() => void retry(panel)}>
            {t('home:failure.retry')}
          </s-button>
        )}
        <s-link href={`/admin/${panel}`}>
          {t(panel === 'products' ? 'home:failure.viewProducts' : 'home:failure.viewOrders')}
        </s-link>
      </div>
    </div>
  );

  const createProductAction = (
    panel: Extract<HomeProductsPanel, { state: 'ready' }>,
    align: 'start' | 'center' = 'center',
  ) => (
    <s-stack gap="base" alignItems={align}>
      {onCreateProduct ? (
        <s-button
          variant="primary"
          loading={creatingProduct}
          disabled={creatingProduct}
          onClick={() => void createProduct()}
        >
          {t('home:products.add')}
        </s-button>
      ) : panel.createProductHref ? (
        <s-button
          variant="primary"
          href={panel.createProductHref}
          target={panel.createProductHref.startsWith('shopify:') ? '_top' : 'auto'}
        >
          {t('home:products.add')}
        </s-button>
      ) : (
        <s-button variant="primary" href="shopify://admin/products" target="_top">
          {t('home:products.openShopify')}
        </s-button>
      )}
      {createProductFailed && (
        <div class="merchant-home__create-recovery" role="alert">
          <p class="merchant-home__empty-description">
            <s-text tone="critical">{t('home:products.creationFailed')}</s-text>
          </p>
          <s-link href="shopify://admin/products" target="_top">
            {t('home:products.openShopify')}
          </s-link>
        </div>
      )}
    </s-stack>
  );

  const products = (panel: HomeProductsPanel) => {
    if (panel.state === 'loading')
      return (
        <s-section accessibilityLabel={t('home:sections.products')}>
          <HomeSkeleton label={t('home:loading.products')} rows={2} />
        </s-section>
      );
    if (panel.state === 'failed')
      return <s-section heading={t('home:sections.products')}>{failure('products', panel.reason)}</s-section>;
    if (panel.state === 'restricted') {
      return (
        <s-section heading={t('home:sections.products')}>
          <s-stack gap="base">
            <s-paragraph>{t('home:permissions.products')}</s-paragraph>
            <s-link href="/admin/settings/permissions">{t('home:permissions.review')}</s-link>
          </s-stack>
        </s-section>
      );
    }
    if (panel.catalog === 'no-products' || panel.catalog === 'unconfigured') {
      const needsProduct = panel.catalog === 'no-products';
      return (
        <s-section accessibilityLabel={t('home:sections.productSetup')} data-home-section="first-product">
          <EmptyState
            heading={t(needsProduct ? 'home:products.addHeading' : 'home:products.customizeHeading')}
            graphic={
              <div class="merchant-home__product-illustration" aria-hidden="true">
                <div class="merchant-home__product-artwork">
                  <s-image
                    src="/illustrations/shopify/empty-product.png"
                    alt=""
                    aspectRatio="156/155"
                    objectFit="contain"
                  />
                </div>
              </div>
            }
            action={
              needsProduct ? (
                createProductAction(panel)
              ) : (
                <s-button variant={panel.canConfigure ? 'primary' : 'auto'} href="/admin/products">
                  {t(panel.canConfigure ? 'home:products.configure' : 'home:products.view')}
                </s-button>
              )
            }
          >
            {t(needsProduct ? 'home:products.addBody' : 'home:products.customizeBody')}
          </EmptyState>
        </s-section>
      );
    }
    // The header already owns the Products shortcut. A partial catalog read must
    // neither invent first use nor add a second navigation-only card.
    if (panel.drafts.length === 0) return null;

    return (
      <HomeSection
        heading={t('home:sections.drafts')}
        area="drafts"
        action={
          <s-button variant="tertiary" href="/admin/products">
            {t('home:products.view')}
          </s-button>
        }
      >
        <ul class="merchant-home__list">
          {panel.drafts.slice(0, 3).map((product, index) => (
            <DividedListItem index={index} className="merchant-home__draft" key={product.id}>
              {product.thumbnail && <s-thumbnail src={product.thumbnail} alt="" size="small" />}
              <div class="merchant-home__draft-copy">
                <ResourceName text={product.title} href={product.href} />
                <s-text color="subdued">
                  {t(product.published ? 'home:products.draftPublished' : 'home:products.draftUnpublished')}
                </s-text>
              </div>
              <div class="merchant-home__draft-action">
                <s-button href={product.href}>{t('home:products.continue')}</s-button>
              </div>
            </DividedListItem>
          ))}
        </ul>
      </HomeSection>
    );
  };

  const orders = (panel: HomeOrdersPanel, hideEmpty: boolean, nextAction?: ComponentChildren) => {
    if (panel.state === 'loading')
      return (
        <s-section heading={t('home:sections.recentOrders')} padding="none">
          <HomeSkeleton label={t('home:loading.orders')} variant="orders" />
        </s-section>
      );
    if (panel.state === 'failed')
      return <s-section heading={t('home:sections.recentOrders')}>{failure('orders', panel.reason)}</s-section>;
    if (panel.state === 'restricted') {
      return (
        <s-section heading={t('home:sections.orders')}>
          <div class="merchant-home__recovery">
            <s-paragraph color="subdued">{t('home:permissions.orders')}</s-paragraph>
            <s-link href="/admin/settings/permissions">{t('home:permissions.review')}</s-link>
          </div>
        </s-section>
      );
    }
    if (hideEmpty && panel.items.length === 0) return null;
    let dateFormatter: Intl.DateTimeFormat;
    try {
      dateFormatter = new Intl.DateTimeFormat(formatLocale, {
        timeZone: panel.timeZone,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      dateFormatter = new Intl.DateTimeFormat(formatLocale, {
        timeZone: 'UTC',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
    const listFormatter = new Intl.ListFormat(formatLocale, { style: 'long', type: 'conjunction' });
    const orderName = (name: string | undefined, number: string) =>
      name && name.trim() ? name : t('home:orders.reference', { number });
    return (
      <HomeSection
        heading={panel.items.length > 0 ? t('home:sections.recentOrders') : undefined}
        accessibilityLabel={panel.items.length === 0 ? t('home:sections.customizedOrders') : undefined}
        area="orders"
        padding={panel.items.length > 0 ? 'none' : undefined}
        action={
          panel.items.length > 0 ? (
            <s-button variant="tertiary" href="/admin/orders">
              {t('home:orders.viewAll')}
            </s-button>
          ) : undefined
        }
      >
        {panel.items.length === 0 ? (
          <EmptyState
            heading={t('home:orders.emptyHeading')}
            graphic={
              <div class="merchant-home__orders-illustration" aria-hidden="true">
                <s-image
                  src="https://shopify-assets.shopifycdn.com/shopifycloud/web/assets/v1/vite/client/en/assets/empty-state-orders-e08317223bd1.svg"
                  alt=""
                  aspectRatio="1/1"
                  objectFit="contain"
                  loading="lazy"
                />
              </div>
            }
            action={nextAction}
          >
            {t('home:orders.emptyBody')}
          </EmptyState>
        ) : (
          <ul class="merchant-home__list">
            {panel.items.slice(0, 5).map((order, index) => {
              const reference = orderName(order.orderName, order.orderNumber);
              const productNames = order.productTitles.map((title) => title ?? t('home:orders.customizedProduct'));
              const products =
                productNames.length > 0 ? listFormatter.format(productNames) : t('home:orders.customizedProduct');
              const exactCount = formatExactCount(order.itemCount, formatLocale);
              const pluralCount = safePluralCount(order.itemCount);
              const itemCount =
                pluralCount === undefined
                  ? t('home:orders.itemCountExact', { formattedCount: exactCount.formatted })
                  : t('home:orders.itemCount', { count: pluralCount, formattedCount: exactCount.formatted });
              const createdAt = dateFormatter.format(new Date(order.orderCreatedAt));
              return (
                <li key={order.id}>
                  <s-clickable
                    href={order.href}
                    accessibilityLabel={t('home:orders.orderLink', { orderName: reference, products })}
                    paddingInline="base"
                    paddingBlock="small"
                    border={index > 0 ? 'base' : 'none'}
                    borderStyle="solid none none none"
                  >
                    <div class="merchant-home__order">
                      <div class="merchant-home__order-heading">
                        <div class="merchant-home__identity">
                          <ResourceName text={reference} href={order.href} linked={false} />
                          {order.test && <s-badge>{t('home:orders.testBadge')}</s-badge>}
                        </div>
                        <ResourceDescription text={products} />
                      </div>
                      <div class="merchant-home__order-meta">
                        <s-text color="subdued">
                          {t('home:orders.itemMeta', { formattedItemCount: itemCount, date: createdAt })}
                        </s-text>
                      </div>
                      <div class="merchant-home__order-status">
                        <OrderBadge status={order.status} />
                      </div>
                    </div>
                  </s-clickable>
                </li>
              );
            })}
          </ul>
        )}
      </HomeSection>
    );
  };

  if (model.state === 'loading') {
    return (
      <s-page heading="Insignia" inlineSize="base">
        <div class="merchant-home">
          <HomeActivity statistics={{ state: 'loading' }} />
          <s-section accessibilityLabel={t('home:sections.home')}>
            <HomeSkeleton label={t('home:loading.home')} />
          </s-section>
          <s-section accessibilityLabel={t('home:sections.productSetup')}>
            <HomeSkeleton label={t('home:loading.productSetup')} rows={2} />
          </s-section>
        </div>
      </s-page>
    );
  }
  if (model.state === 'unavailable') {
    return (
      <s-page heading="Insignia" inlineSize="base">
        <section ref={homeRegion} tabIndex={-1} aria-label={t('home:sections.home')}>
          <s-section accessibilityLabel={t('home:unavailable.heading')}>
            <EmptyState
              icon="store"
              heading={t('home:unavailable.heading')}
              action={
                model.reopenHref ? (
                  <s-button variant="primary" href={model.reopenHref}>
                    {t('home:unavailable.action')}
                  </s-button>
                ) : undefined
              }
            >
              {t(
                model.reason === 'session-lost'
                  ? 'home:unavailable.sessionLost'
                  : model.reason === 'busy'
                    ? 'admin-shell:errors.shopifyBusy'
                    : 'home:unavailable.body',
              )}
            </EmptyState>
          </s-section>
        </section>
      </s-page>
    );
  }
  const hasOrders = model.orders.state === 'ready' && model.orders.items.length > 0;
  const knownNoOrders = model.orders.state === 'ready' && model.orders.items.length === 0 && !model.orders.hasMore;
  const productSetupMissing =
    model.products.state === 'ready' &&
    (model.products.catalog === 'no-products' || model.products.catalog === 'unconfigured');
  const firstUse = productSetupMissing && knownNoOrders;
  const guideVisible = model.products.state === 'ready' && Boolean(model.guidance && !model.guidance.dismissed);
  const guideIncomplete = (model.guidance?.completedSteps?.length ?? 0) < 3;
  const draft = model.products.state === 'ready' ? model.products.drafts[0] : undefined;
  const initialGuide = knownNoOrders && guideVisible;
  const hideInitialProductPanel =
    guideVisible &&
    guideIncomplete &&
    ((productSetupMissing && !hasOrders) ||
      (knownNoOrders && model.products.state === 'ready' && model.products.drafts.length === 1));
  const preferredGuideStep: HomeGuidanceStepId | undefined = initialGuide
    ? firstUse || draft || (model.products.state === 'ready' && model.products.hasPublishedProduct !== true)
      ? 'product'
      : model.setup?.tasks.some((task) => task.kind === 'storefront')
        ? 'storefront'
        : 'test'
    : undefined;
  const guideProductStep =
    model.products.state === 'ready'
      ? model.products.catalog === 'no-products'
        ? {
            title: t('home:guidance.product.addTitle'),
            description: t('home:guidance.product.addDescription'),
            content: createProductAction(model.products, 'start'),
          }
        : draft
          ? {
              title: t('home:guidance.product.finishTitle'),
              description: t('home:guidance.product.finishDescription'),
              context: draft.title,
              action: t(model.products.canConfigure ? 'home:guidance.product.continue' : 'home:guidance.product.view'),
              href: model.products.canConfigure ? draft.href : '/admin/products',
            }
          : {
              action: t(model.products.canConfigure ? 'home:guidance.product.configure' : 'home:guidance.product.view'),
            }
      : undefined;

  const tasks = model.orders.state === 'ready' ? model.orders.tasks.slice(0, 3) : [];
  const showConfigure =
    model.products.state === 'ready' &&
    model.products.canConfigure &&
    !productSetupMissing &&
    !knownNoOrders &&
    tasks.length === 0;
  const canTestProduct =
    model.products.state === 'ready' &&
    model.products.hasPublishedProduct === true &&
    !model.setup?.tasks.some(
      (task) => !['test', 'customer-test'].includes(task.id) && (task.state === 'pending' || task.state === 'unknown'),
    );
  const emptyOrderAction =
    canTestProduct && !draft ? (
      <s-button
        variant={model.products.state === 'ready' && model.products.canConfigure ? 'primary' : 'auto'}
        href="/admin/products"
      >
        {t(
          model.products.state === 'ready' && model.products.canConfigure
            ? 'home:products.configure'
            : 'home:products.view',
        )}
      </s-button>
    ) : undefined;
  const orderPanel = (
    <section
      ref={orderRegion}
      tabIndex={-1}
      class="merchant-home__region"
      aria-label={t('home:sections.customizedOrders')}
    >
      {orders(model.orders, firstUse || (initialGuide && guideIncomplete), emptyOrderAction)}
    </section>
  );
  const productPanel = (
    <section
      ref={productRegion}
      tabIndex={-1}
      class="merchant-home__region"
      aria-label={t('home:sections.productSetup')}
    >
      {!hideInitialProductPanel && products(model.products)}
    </section>
  );
  const gettingStarted =
    model.products.state === 'ready' && model.guidance && !model.guidance.dismissed ? (
      <HomeGettingStarted
        key="getting-started"
        guidance={
          restoredGuide
            ? { ...model.guidance, initiallyExpanded: true }
            : {
                ...model.guidance,
                initiallyExpanded: tasks.length > 0 ? false : (model.guidance.initiallyExpanded ?? !hasOrders),
              }
        }
        testReady={canTestProduct}
        preferredStep={preferredGuideStep}
        productStep={guideProductStep}
        toggleRef={guideToggle}
        onDismiss={dismissGuidance}
        onCompleteStep={onCompleteGuidanceStep}
      />
    ) : null;
  return (
    <s-page heading="Insignia" inlineSize="base">
      {model.products.state === 'ready' && model.guidance?.dismissed && restoreGuidance && (
        <s-button slot="secondary-actions" onClick={restoreGuidance}>
          {t('home:guidance.dismissGuide')}
        </s-button>
      )}
      {showConfigure && (
        <s-button slot="primary-action" variant="primary" href="/admin/products">
          {t('home:products.configure')}
        </s-button>
      )}
      <section
        ref={homeRegion}
        tabIndex={-1}
        class="merchant-home"
        aria-label={t('home:sections.home')}
        data-home-state="ready"
      >
        {model.notice && (
          <s-banner heading={t('home:notice.planRestriction.heading')} tone="warning">
            <s-stack gap="base">
              <s-paragraph>{t('home:notice.planRestriction.description')}</s-paragraph>
              <s-link href="/admin/settings/billing">{t('home:notice.planRestriction.action')}</s-link>
            </s-stack>
          </s-banner>
        )}
        {firstUse && knownNoOrders && (
          <div class="merchant-home__welcome" data-home-section="welcome">
            <s-heading fontSize="large">{t('home:welcome.heading')}</s-heading>
            <s-paragraph color="subdued">{t('home:welcome.body')}</s-paragraph>
          </div>
        )}
        {!firstUse && !knownNoOrders && model.statistics && <HomeActivity statistics={model.statistics} />}
        {tasks.length > 0 && (
          <HomeSection
            heading={t('home:sections.tasks')}
            area="tasks"
            accessory={
              model.orders.state === 'ready' && model.orders.tasksTotal !== undefined ? (
                <s-badge>{formatExactCount(BigInt(model.orders.tasksTotal), formatLocale).formatted}</s-badge>
              ) : undefined
            }
            action={
              <s-button variant="tertiary" href="/admin/orders">
                {t('home:orders.viewAll')}
              </s-button>
            }
          >
            <ul class="merchant-home__list">
              {tasks.map((task, index) => (
                <DividedListItem index={index} className="merchant-home__task" key={task.id}>
                  <div class="merchant-home__task-copy">
                    <div class="merchant-home__identity">
                      <ResourceName
                        text={
                          task.orderName?.trim()
                            ? task.orderName
                            : t('home:orders.reference', { number: task.orderNumber })
                        }
                        href={task.href}
                      />
                    </div>
                    <ResourceDescription text={task.productTitle ?? t('home:orders.customizedProduct')} />
                    <s-paragraph color="subdued">{t(`home:orders.tasks.${task.reason}`)}</s-paragraph>
                  </div>
                  <s-button href={task.href}>{t('home:orders.tasks.action')}</s-button>
                </DividedListItem>
              ))}
            </ul>
          </HomeSection>
        )}
        {gettingStarted}
        {hasOrders ? (
          <>
            {orderPanel}
            {productPanel}
          </>
        ) : (
          <>
            {productPanel}
            {orderPanel}
          </>
        )}
        {model.setup &&
          (!model.guidance || model.guidance.dismissed || model.guidance.completedSteps?.includes('storefront')) && (
            <SetupGuide setup={model.setup} compact={Boolean(model.guidance)} />
          )}
      </section>
    </s-page>
  );
}
