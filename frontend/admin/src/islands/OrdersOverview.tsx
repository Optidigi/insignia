import { PurchaseViewSchema } from '@insignia/contracts';
import { formatExactCount } from '@insignia/ui-localization/core';
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'preact/hooks';
import AdminActionChip from '../components/AdminActionChip';
import AdminIndexToolbar, { AdminFilterChip } from '../components/AdminIndexToolbar';
import AdminResourceName from '../components/AdminResourceName';
import AdminResourceTable, {
  ResourceTableBody,
  ResourceTableCell,
  ResourceTableHead,
  ResourceTableHeader,
  ResourceTableRow,
} from '../components/AdminResourceTable';
import AdminValueSummary from '../components/AdminValueSummary';
import ArtworkArchiveDownload from '../components/ArtworkArchiveDownload';
import BatchProductionSheets from '../components/BatchProductionSheets';
import OrdersDateFilter, { type OrderDateRange } from '../components/OrdersDateFilter';
import OrdersDisplayOptions, {
  type OrderColumn,
  orderColumnLabels,
  orderColumns,
} from '../components/OrdersDisplayOptions';
import OrdersTableSkeleton from '../components/OrdersTableSkeleton';
import { useAdminLocale, withAdminLocale } from '../shared/admin-i18n.js';
import { useAdminPageReady } from '../shared/admin-page-ready';
import { authenticatedJson } from '../shared/admin-request';
import { type ArtworkFilter, artworkStatus, orderMethods, parseArtworkFilter } from '../shared/artwork-status';
import { isOrderCursorStack, orderCursorTrail, orderDetailHref } from '../shared/orders-return-path';
import { PurchaseListViewSchema } from '../shared/purchase-presentation.ts';
import { localizedPurchaseMoney } from '../shared/purchase-view.js';

import { initialOrdersState, ordersReducer, type ServerQuery } from './orders-overview-state';

function isArtworkFilter(value: string): value is ArtworkFilter {
  return value === 'all' || value === 'needed' || value === 'complete';
}
function formatOrderItemCount(quantity: bigint, locale: string, t: ReturnType<typeof useAdminLocale>['t']): string {
  const exact = formatExactCount(quantity, locale);
  return exact.kind === 'plural'
    ? t('orders:counts.items', { count: exact.count, formattedCount: exact.formatted })
    : t('orders:counts.itemsExact', { formattedCount: exact.formatted });
}
function hidePopover(id: string) {
  document.getElementById(id)?.dispatchEvent(Object.assign(new Event('command'), { command: '--hide' }));
}
function paymentStatusLabel(status: string, t: ReturnType<typeof useAdminLocale>['t']): string {
  switch (status) {
    case 'PAID':
      return t('orders:payment.paid');
    case 'REFUNDED':
      return t('orders:payment.refunded');
    case 'PARTIALLY_REFUNDED':
      return t('orders:payment.partiallyRefunded');
    case 'PARTIALLY_PAID':
      return t('orders:payment.partiallyPaid');
    case 'AUTHORIZED':
      return t('orders:payment.authorized');
    case 'VOIDED':
      return t('orders:payment.voided');
    case 'PENDING':
      return t('orders:payment.pending');
    case 'EXPIRED':
      return t('orders:payment.expired');
    default:
      return t('orders:payment.unknown');
  }
}

function artworkStatusLabel(status: ArtworkFilter, t: ReturnType<typeof useAdminLocale>['t']): string {
  if (status === 'all') return t('orders:artwork.all');
  return status === 'needed' ? t('orders:artwork.needed') : t('orders:artwork.complete');
}

function orderReference(
  orderName: string | null | undefined,
  orderId: string,
  t: ReturnType<typeof useAdminLocale>['t'],
): string {
  return orderName ?? t('orders:order.reference', { orderNumber: orderId.slice(orderId.lastIndexOf('/') + 1) });
}

function restoreQuery(supportsServerQueries: boolean) {
  const query = new URLSearchParams(location.search);
  const parsed = PurchaseViewSchema.shape.purchaseId.safeParse(query.get('before'));
  const before = parsed.success ? parsed.data : undefined;
  const stored: unknown = history.state;
  const storedStack =
    stored && typeof stored === 'object' && 'insigniaOrderCursors' in stored ? stored.insigniaOrderCursors : null;
  const stack =
    isOrderCursorStack(storedStack) && storedStack.at(-1) === before
      ? storedStack
      : orderCursorTrail(query.get('trail'), before);
  const validStack = isOrderCursorStack(stack);
  const cursors: (string | undefined)[] = before
    ? validStack && stack[stack.length - 1] === before
      ? [undefined, ...stack]
      : [before]
    : [undefined];
  return {
    cursors,
    artwork: parseArtworkFilter(query.get('artwork')),
    search: (query.get('q') ?? '').slice(0, 128),
    server: {
      sort: supportsServerQueries && query.get('sort') === 'date-asc' ? ('date-asc' as const) : ('date-desc' as const),
      ...(supportsServerQueries ? (['createdFrom', 'createdBefore'] as const) : []).reduce<OrderDateRange>(
        (range, key) => {
          const parsed = PurchaseViewSchema.shape.orderCreatedAt.safeParse(query.get(key));
          if (parsed.success) range[key] = parsed.data;
          return range;
        },
        {},
      ),
    },
  };
}

function rememberQuery(cursors: (string | undefined)[], artwork: string, search = '', server?: ServerQuery) {
  const url = new URL(location.href);
  url.searchParams.delete('trail');
  const before = cursors[cursors.length - 1];
  if (before) url.searchParams.set('before', before);
  else url.searchParams.delete('before');
  if (artwork !== 'all') url.searchParams.set('artwork', artwork);
  else url.searchParams.delete('artwork');
  if (search) url.searchParams.set('q', search);
  else url.searchParams.delete('q');
  if (server) {
    if (server.sort !== 'date-desc') url.searchParams.set('sort', server.sort);
    else url.searchParams.delete('sort');
    for (const key of ['createdFrom', 'createdBefore'] as const) {
      if (server[key]) url.searchParams.set(key, server[key]);
      else url.searchParams.delete(key);
    }
  }
  const stored: unknown = history.state;
  const state = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  history.replaceState({ ...state, insigniaOrderCursors: cursors[0] === undefined ? cursors.slice(1) : null }, '', url);
}

function OrdersOverview({ supportsServerQueries = true }: { supportsServerQueries?: boolean }) {
  // Production queries cover the whole retained matching dataset; local examples remain isolated.
  const serverQueries =
    supportsServerQueries ||
    (typeof document !== 'undefined' && document.documentElement.dataset.previewOrderQueries === 'true');
  const { t, formatLocale } = useAdminLocale();
  const selectionControl = useRef<HTMLElementTagNameMap['s-checkbox']>(null);
  const selectionToolbar = useRef<HTMLDivElement>(null);
  const productionAction = useRef<HTMLDivElement>(null);
  const archiveAction = useRef<HTMLDivElement>(null);
  const mobileSelectionControl = useRef<HTMLElementTagNameMap['s-checkbox']>(null);
  const restoreSelectionFocus = useRef(false);
  const [flow, dispatch] = useReducer(ordersReducer, undefined, initialOrdersState);
  const { selectedIds, artworkFilter, search, serverQuery } = flow;
  const page = flow.read.value;
  const hasLoaded = flow.read.hasLoaded;
  const status = flow.read.phase === 'failed' || flow.read.phase === 'missing' ? 'error' : flow.read.phase;
  const [now, setNow] = useState(() => new Date());
  const searchValue = useRef('');
  const columnOrder: OrderColumn[] = [...orderColumns];
  const [shownColumns, setShownColumns] = useState<OrderColumn[]>([...orderColumns]);
  const queryRef = useRef<ServerQuery>({ sort: 'date-desc' });
  const generation = useRef(0);
  const pending = useRef(false);
  const activeRead = useRef<AbortController | null>(null);
  const requestedCursors = useRef<(string | undefined)[]>([undefined]);
  const filter = useRef<ArtworkFilter>('all');
  const locale = formatLocale;
  const artworkLabels = {
    needed: artworkStatusLabel('needed', t),
    complete: artworkStatusLabel('complete', t),
  };
  const orderLabels = orderColumnLabels(t);
  const timeZone = page?.timeZone ?? 'UTC';
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useAdminPageReady(status !== 'loading' || page !== null);

  async function load(cursors: (string | undefined)[] = [undefined]) {
    activeRead.current?.abort();
    const controller = new AbortController();
    activeRead.current = controller;
    pending.current = true;
    clearSelection();
    requestedCursors.current = cursors;
    const request = ++generation.current;
    dispatch({ type: 'read-started', request });
    try {
      const before = cursors[cursors.length - 1];
      const query = new URLSearchParams({ limit: '20' });
      if (serverQueries) {
        query.set('sort', queryRef.current.sort);
        if (searchValue.current.trim()) query.set('q', searchValue.current.trim());
        if (filter.current !== 'all') query.set('artwork', filter.current);
      }
      for (const key of serverQueries ? (['createdFrom', 'createdBefore'] as const) : []) {
        const value = queryRef.current[key];
        if (value) query.set(key, value);
      }
      if (before) query.set('before', before);
      const result = PurchaseListViewSchema.parse(await authenticatedJson(`/api/purchases/v1?${query}`, { signal: controller.signal }));
      if (generation.current !== request) return;
      dispatch({ type: 'read-succeeded', request, page: { ...result, cursors } });
      rememberQuery(cursors, filter.current, searchValue.current, queryRef.current);
    } catch (error) {
      if (generation.current !== request) return;
      const denied = error instanceof Error && 'status' in error && [401, 403].includes(Number(error.status));
      dispatch({ type: 'read-failed', request, denied });
    } finally {
      if (generation.current === request) pending.current = false;
    }
  }
  useEffect(() => {
    const query = restoreQuery(serverQueries);
    queryRef.current = query.server;
    dispatch({ type: 'query-restored', server: query.server, artwork: query.artwork, search: query.search });
    filter.current = query.artwork;
    searchValue.current = query.search;
    void load(query.cursors);
    return () => {
      activeRead.current?.abort();
      generation.current++;
      pending.current = false;
    };
  }, []);

  function clearSelection() {
    if (selectionToolbar.current?.contains(document.activeElement)) restoreSelectionFocus.current = true;
    dispatch({ type: 'selection-cleared' });
  }
  function togglePageSelection() {
    restoreSelectionFocus.current =
      document.activeElement === selectionControl.current || document.activeElement === mobileSelectionControl.current;
    dispatch({ type: 'page-selection-changed', ids: allSelected ? [] : visible.map((item) => item.purchaseId) });
  }
  function denyBulk(error: unknown) {
    if (error instanceof Error && 'status' in error && [401, 403].includes(Number(error.status))) {
      generation.current++;
      pending.current = false;
      clearSelection();
      dispatch({ type: 'access-revoked', request: generation.current });
    }
  }
  function changeFilter(value: ArtworkFilter) {
    clearSelection();
    filter.current = value;
    dispatch({ type: 'filter-changed', value });
    rememberQuery(serverQueries ? [undefined] : page?.cursors ?? requestedCursors.current, value, searchValue.current, queryRef.current);
    if (serverQueries) void load();
  }

  function changeSearch(value: string) {
    clearSelection();
    searchValue.current = value;
    dispatch({ type: 'search-changed', value });
    rememberQuery(serverQueries ? [undefined] : page?.cursors ?? requestedCursors.current, filter.current, value, queryRef.current);
    if (serverQueries) void load();
  }
  function changeServerQuery(value: ServerQuery) {
    if (!serverQueries) return;
    if (pending.current) return;
    queryRef.current = value;
    dispatch({ type: 'server-query-changed', value, request: generation.current });
    rememberQuery([undefined], filter.current, searchValue.current, value);
    hidePopover('orders-display');
    hidePopover('orders-index-filters');
    void load();
  }
  const visibleColumns = columnOrder.filter((key) => shownColumns.includes(key));
  const dateFiltered = Boolean(serverQuery.createdFrom || serverQuery.createdBefore);
  const visible =
    page?.items.filter(
      (item) =>
        (artworkFilter === 'all' || artworkStatus(item) === artworkFilter) &&
        `${item.orderName ?? ''} ${item.orderId}`
          .toLocaleLowerCase(formatLocale)
          .includes(search.trim().toLocaleLowerCase(formatLocale)),
    ) ?? [];
  const selected = visible.filter((item) => selectedIds.includes(item.purchaseId));
  const allSelected = visible.length > 0 && selected.length === visible.length;
  const someSelected = selected.length > 0 && !allSelected;
  const selectionActive = selected.length > 0;
  useLayoutEffect(() => {
    if (restoreSelectionFocus.current) {
      // Focus the visible header control after the selection layer changes.
      const target = selectionActive ? mobileSelectionControl.current : selectionControl.current;
      target?.focus({ preventScroll: true });
      restoreSelectionFocus.current = false;
    }
  }, [selectionActive]);
  const busy = status === 'loading';
  useEffect(() => {
    const bridge = (window as unknown as { shopify?: { loading?: (active: boolean) => void } }).shopify;
    try {
      bridge?.loading?.(busy);
    } catch {
      /* Host feedback cannot block a read. */
    }
    return () => {
      try {
        bridge?.loading?.(false);
      } catch {
        /* Host may be gone during navigation. */
      }
    };
  }, [busy]);
  const selectionBar = (
    <div class="resource-selection-bar orders-selection-toolbar" ref={selectionToolbar}>
      <div class="resource-selection-summary">
        <div class="orders-mobile-selection">
          <s-checkbox
            ref={mobileSelectionControl}
            accessibilityLabel={t('orders:actions.selectAllShown')}
            checked={allSelected}
            indeterminate={someSelected}
            disabled={busy}
            onChange={togglePageSelection}
          />
        </div>
        <div class="orders-desktop-selection-count">
          <span class="resource-selection-count">
            {t('orders:actions.selectedOnPage', {
              count: selected.length,
              formattedCount: new Intl.NumberFormat(locale).format(selected.length),
            })}
          </span>
        </div>
        <div class="orders-mobile-selection-count">
          <span class="resource-selection-count">
            {t('orders:actions.selected', {
              count: selected.length,
              formattedCount: new Intl.NumberFormat(locale).format(selected.length),
            })}
          </span>
        </div>
      </div>
      <div class="resource-selection-actions orders-selection-actions">
        <div class="orders-export-action" ref={productionAction}>
          <BatchProductionSheets purchases={selected} disabled={busy || status !== 'ready'} deny={denyBulk} compact />
        </div>
        <div class="orders-export-action" ref={archiveAction}>
          <ArtworkArchiveDownload purchases={selected} disabled={busy || status !== 'ready'} deny={denyBulk} compact />
        </div>
        <div class="orders-mobile-selection-actions">
          <AdminActionChip
            accessibilityLabel={t('orders:actions.selectionActions')}
            icon="menu-horizontal"
            iconOnly
            commandFor="orders-mobile-selection-actions"
            disabled={busy}
          />
          <s-menu id="orders-mobile-selection-actions" accessibilityLabel={t('orders:actions.selectionActions')}>
            <s-button
              disabled={busy || status !== 'ready'}
              onClick={() =>
                productionAction.current
                  ?.querySelector<HTMLElement>(
                    ':scope > button.admin-action-chip, :scope > s-clickable-chip, :scope > s-button',
                  )
                  ?.click()
              }
            >
              {t('orders:actions.productionSheets')}
            </s-button>
            <s-button
              disabled={busy || status !== 'ready'}
              onClick={() =>
                archiveAction.current
                  ?.querySelector<HTMLElement>(
                    ':scope > button.admin-action-chip, :scope > s-clickable-chip, :scope > s-button',
                  )
                  ?.click()
              }
            >
              {t('orders:actions.downloadArtwork')}
            </s-button>
            <s-button disabled={busy} onClick={clearSelection}>
              {t('orders:actions.clearSelection')}
            </s-button>
          </s-menu>
        </div>
      </div>
      <div class="resource-selection-clear orders-selection-clear">
        <s-button
          icon="x"
          variant="tertiary"
          accessibilityLabel={t('orders:actions.clearSelection')}
          disabled={busy}
          onClick={clearSelection}
        />
      </div>
    </div>
  );
  return (
    <s-page heading={t('orders:pageTitle')} inlineSize="large">
      {status === 'denied' && (
        <s-banner heading={t('orders:errors.accessHeading')} tone="critical">
          {t('orders:errors.accessDescription')}
        </s-banner>
      )}
      {status === 'error' && (
        <s-banner heading={t('orders:errors.loadHeading')} tone="critical">
          <s-paragraph>{page ? t('orders:errors.staleResults') : t('orders:errors.initialLoad')}</s-paragraph>
          <s-button slot="secondary-actions" onClick={() => void load(requestedCursors.current)}>
            {t('common:actions.retry')}
          </s-button>
          {dateFiltered && (
            <s-button slot="secondary-actions" onClick={() => changeServerQuery({ sort: queryRef.current.sort })}>
              {t('orders:actions.clearFilters')}
            </s-button>
          )}
        </s-banner>
      )}
      {!hasLoaded && busy && <OrdersTableSkeleton />}
      {page &&
        page.items.length === 0 &&
        page.cursors.length === 1 &&
        page.cursors[0] === undefined &&
        !dateFiltered && (
          <s-section accessibilityLabel={t('orders:pageTitle')}>
            <s-empty-state heading={t('orders:empty.noCustomizedOrders')}>
              <s-text slot="subheading">{t('orders:empty.noCustomizedOrdersDescription')}</s-text>
              <s-button slot="primary-action" variant="primary" href="/admin/products">
                {t('orders:actions.viewProducts')}
              </s-button>
            </s-empty-state>
          </s-section>
        )}
      {hasLoaded &&
        status !== 'denied' &&
        (!page ||
          page.items.length > 0 ||
          page.cursors.length > 1 ||
          page.cursors[0] !== undefined ||
          dateFiltered) && (
          <s-box padding="none" accessibilityRole="region" accessibilityLabel={t('orders:pageTitle')}>
            <s-stack gap="none">
              <s-box paddingBlock="small" background="base">
                <AdminIndexToolbar
                  id="orders-index"
                  label={t('orders:search.label')}
                  placeholder={t('orders:search.placeholder')}
                  value={search}
                  maxLength={128}
                  loading={busy}
                  onInput={changeSearch}
                  resultStatus={
                    page
                      ? t('orders:search.results', {
                          count: visible.length,
                          formattedCount: new Intl.NumberFormat(locale).format(visible.length),
                        })
                      : undefined
                  }
                  filter={{
                    label: t('orders:filters.filterOrders'),
                    inlineSize: '360px',
                    count: (artworkFilter !== 'all' ? 1 : 0) + (dateFiltered ? 1 : 0),
                    content: (
                      <>
                        <s-choice-list
                          label={t('orders:filters.artworkStatus')}
                          name="orders-artwork-status"
                          disabled={busy}
                          onChange={(event) => {
                            const value = event.currentTarget.values[0];
                            if (!busy && value && isArtworkFilter(value)) {
                              changeFilter(value);
                              hidePopover('orders-index-filters');
                            }
                          }}
                        >
                          <s-choice value="all" selected={artworkFilter === 'all'}>
                            {t('orders:artwork.all')}
                          </s-choice>
                          {Object.entries(artworkLabels).map(([value, label]) => (
                            <s-choice key={value} value={value} selected={artworkFilter === value}>
                              {label}
                            </s-choice>
                          ))}
                        </s-choice-list>
                        {serverQueries && (
                          <OrdersDateFilter
                            timeZone={timeZone}
                            busy={busy}
                            {...serverQuery}
                            onApply={(range) => changeServerQuery({ sort: queryRef.current.sort, ...range })}
                          />
                        )}
                      </>
                    ),
                  }}
                  actions={
                    <OrdersDisplayOptions
                      canSort={serverQueries}
                      columnOrder={columnOrder}
                      shownColumns={shownColumns}
                      sort={serverQuery.sort}
                      busy={busy}
                      onToggle={(key) =>
                        setShownColumns((current) =>
                          current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
                        )
                      }
                      onSort={(sort) => changeServerQuery({ ...queryRef.current, sort })}
                    />
                  }
                  appliedFilters={
                    (artworkFilter !== 'all' || dateFiltered) && (
                      <s-stack direction="inline" gap="small" alignItems="center">
                        {artworkFilter !== 'all' && (
                          <AdminFilterChip
                            toolbarId="orders-index"
                            label={t('orders:filters.editArtworkStatus')}
                            onRemove={() => changeFilter('all')}
                          >
                            {artworkLabels[artworkFilter]}
                          </AdminFilterChip>
                        )}
                        {dateFiltered && (
                          <AdminFilterChip
                            toolbarId="orders-index"
                            label={t('orders:filters.editOrderDate')}
                            disabled={busy}
                            onRemove={() => changeServerQuery({ sort: queryRef.current.sort })}
                          >
                            {t('orders:filters.orderDateRange', {
                              from: serverQuery.createdFrom
                                ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(
                                    new Date(serverQuery.createdFrom),
                                  )
                                : t('orders:date.any'),
                              to: serverQuery.createdBefore
                                ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(
                                    new Date(Date.parse(serverQuery.createdBefore) - 1),
                                  )
                                : t('orders:date.any'),
                            })}
                          </AdminFilterChip>
                        )}
                      </s-stack>
                    )
                  }
                />
              </s-box>
              {!page && busy && <OrdersTableSkeleton toolbar={false} columns={visibleColumns} />}
              {page && (
                <>
                  <AdminResourceTable
                    pinPrimaryColumn
                    label={t('orders:pageTitle')}
                    selection={selectionBar}
                    selectionActive={selectionActive}
                    loading={busy}
                    paginate={page.nextCursor !== null || page.cursors.length > 1}
                    hasNextPage={page.nextCursor !== null}
                    hasPreviousPage={page.cursors.length > 1}
                    onNextPage={() => {
                      if (page.nextCursor) void load([...page.cursors, page.nextCursor]);
                    }}
                    onPreviousPage={() => {
                      if (page.cursors.length > 1) void load(page.cursors.slice(0, -1));
                    }}
                  >
                    <ResourceTableHead>
                      <ResourceTableHeader label={t('orders:table.columns.order')}>
                        <s-grid
                          gridTemplateColumns="20px minmax(0, 1fr)"
                          minInlineSize="100px"
                          gap="small"
                          alignItems="center"
                        >
                          <s-checkbox
                            ref={selectionControl}
                            accessibilityLabel={t('orders:actions.selectAllShown')}
                            checked={allSelected}
                            indeterminate={someSelected}
                            disabled={busy || status !== 'ready' || !visible.length}
                            onChange={togglePageSelection}
                          />
                          <s-text>{t('orders:table.columns.order')}</s-text>
                        </s-grid>
                      </ResourceTableHeader>
                      {visibleColumns.map((key) => (
                        <ResourceTableHeader
                          key={key}
                          format={key === 'total' ? 'currency' : key === 'items' ? 'numeric' : 'base'}
                        >
                          {orderLabels[key]}
                        </ResourceTableHeader>
                      ))}
                    </ResourceTableHead>
                    <ResourceTableBody>
                      {visible.map((item) => (
                        <ResourceTableRow
                          key={item.purchaseId}
                          clickDelegate={`order-${item.purchaseId}`}
                          selected={selectedIds.includes(item.purchaseId)}
                        >
                          <ResourceTableCell>
                            <div class="admin-record-id">
                              <s-grid
                                gridTemplateColumns="20px minmax(0, 1fr)"
                                minInlineSize="100px"
                                gap="small"
                                alignItems="center"
                              >
                                <s-checkbox
                                  id={`select-order-${item.purchaseId}`}
                                  accessibilityLabel={t('orders:actions.selectOrder', {
                                    orderLabel: orderReference(item.orderName, item.orderId, t),
                                  })}
                                  checked={selectedIds.includes(item.purchaseId)}
                                  disabled={busy || status !== 'ready'}
                                  onChange={(event) => {
                                    const checked = event.currentTarget.checked;
                                    dispatch({ type: 'row-selection-changed', id: item.purchaseId, checked });
                                  }}
                                />
                                <s-stack direction="inline" gap="small" alignItems="center">
                                  <AdminResourceName text={orderReference(item.orderName, item.orderId, t)}>
                                    {({ textRef, interestFor, tooltip }) => (
                                      <>
                                        <s-link
                                          id={`order-${item.purchaseId}`}
                                          href={orderDetailHref(item.purchaseId)}
                                          interestFor={interestFor}
                                        >
                                          <div class="order-record-name" ref={textRef}>
                                            <s-text fontWeight="medium">
                                              {orderReference(item.orderName, item.orderId, t)}
                                            </s-text>
                                          </div>
                                        </s-link>
                                        {tooltip}
                                      </>
                                    )}
                                  </AdminResourceName>
                                  {item.isTest === true && <s-badge>{t('orders:badges.test')}</s-badge>}
                                  {item.cancelledAt && <s-badge>{t('orders:badges.cancelled')}</s-badge>}
                                  {item.exceptions.length > 0 && (
                                    <s-badge tone="warning">{t('orders:badges.needsReview')}</s-badge>
                                  )}
                                </s-stack>
                              </s-grid>
                            </div>
                          </ResourceTableCell>
                          {visibleColumns.map((key) => {
                            if (key === 'date')
                              return (
                                <ResourceTableCell column={key} key={key}>
                                  <s-text interestFor={`order-date-${item.purchaseId}`}>
                                    {new Intl.DateTimeFormat(locale, {
                                      dateStyle: 'medium',
                                      timeStyle: 'short',
                                      timeZone,
                                    }).format(new Date(item.orderCreatedAt))}
                                    {page.timeZone ? '' : ` ${t('orders:date.utc')}`}
                                  </s-text>
                                  <s-tooltip id={`order-date-${item.purchaseId}`}>
                                    {new Intl.DateTimeFormat(locale, {
                                      dateStyle: 'full',
                                      timeStyle: 'long',
                                      timeZone,
                                    }).format(new Date(item.orderCreatedAt))}{' '}
                                    ({timeZone})
                                  </s-tooltip>
                                </ResourceTableCell>
                              );
                            if (key === 'total')
                              return (
                                <ResourceTableCell column={key} key={key} format="currency">
                                  {localizedPurchaseMoney(
                                    item.originalTotalMinor,
                                    item.exponent,
                                    item.currency,
                                    locale,
                                  )}
                                </ResourceTableCell>
                              );
                            if (key === 'payment')
                              return (
                                <ResourceTableCell column={key} key={key}>
                                  <s-badge
                                    icon={
                                      ['PAID', 'REFUNDED', 'VOIDED'].includes(item.financialStatus)
                                        ? 'enabled'
                                        : 'incomplete'
                                    }
                                    tone={item.financialStatus === 'PENDING' ? 'caution' : 'neutral'}
                                  >
                                    {paymentStatusLabel(item.financialStatus, t)}
                                  </s-badge>
                                </ResourceTableCell>
                              );
                            if (key === 'artwork')
                              return (
                                <ResourceTableCell column={key} key={key}>
                                  <s-badge
                                    icon={artworkStatus(item) === 'needed' ? 'incomplete' : 'enabled'}
                                    tone={artworkStatus(item) === 'needed' ? 'caution' : 'neutral'}
                                  >
                                    {artworkStatusLabel(artworkStatus(item), t)}
                                  </s-badge>
                                </ResourceTableCell>
                              );
                            if (key === 'methods')
                              return (
                                <ResourceTableCell column={key} key={key}>
                                  <AdminValueSummary
                                    id={`order-methods-${item.purchaseId}`}
                                    values={orderMethods(item, now.getTime(), t('orders:summary.methodUnavailable'))}
                                    label={t('orders:summary.methods')}
                                    viewAllLabel={t('orders:summary.viewAllMethods', {
                                      orderLabel: orderReference(item.orderName, item.orderId, t),
                                    })}
                                    resourceName={orderReference(item.orderName, item.orderId, t)}
                                    emptyLabel={t('orders:summary.noMethods')}
                                  />
                                </ResourceTableCell>
                              );
                            if (key === 'items')
                              return (
                                <ResourceTableCell column={key} key={key} format="numeric">
                                  {item.lines.length
                                    ? formatOrderItemCount(
                                        item.lines.reduce((sum, line) => sum + BigInt(line.quantity), 0n),
                                        locale,
                                        t,
                                      )
                                    : t('common:summary.unavailable')}
                                </ResourceTableCell>
                              );
                            return null;
                          })}
                        </ResourceTableRow>
                      ))}
                    </ResourceTableBody>
                  </AdminResourceTable>
                  {status === 'ready' && visible.length === 0 && (
                    <s-box padding="large">
                      <s-stack gap="small" alignItems="center">
                        <s-heading>
                          {page.items.length === 0 && dateFiltered
                            ? t('orders:empty.noOrders')
                            : t('orders:empty.noOrdersOnPage')}
                        </s-heading>
                        <s-paragraph>
                          {page.items.length === 0 && dateFiltered
                            ? t('orders:empty.tryAnotherDateRange')
                            : t('orders:empty.changeSearchFilterPage')}
                        </s-paragraph>
                        {(artworkFilter !== 'all' || search || dateFiltered) && (
                          <s-button
                            onClick={() => {
                              changeFilter('all');
                              changeSearch('');
                              if (dateFiltered) changeServerQuery({ sort: queryRef.current.sort });
                            }}
                          >
                            {t('orders:actions.clearFilters')}
                          </s-button>
                        )}
                      </s-stack>
                    </s-box>
                  )}
                </>
              )}
            </s-stack>
          </s-box>
        )}
      {page && page.cursors[0] !== undefined && (
        <s-button disabled={busy} onClick={() => void load()}>
          {t('orders:actions.firstPage')}
        </s-button>
      )}
    </s-page>
  );
}

export default withAdminLocale(OrdersOverview);
