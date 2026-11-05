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
import ProductsTableSkeleton from '../components/ProductsTableSkeleton';
import { useAdminLocale, withAdminLocale } from '../shared/admin-i18n';
import { useAdminPageReady } from '../shared/admin-page-ready';
import { authenticatedJson } from '../shared/admin-request';
import type { CatalogProduct } from '../shared/admin-view';
import { installSelectedProductActions } from './selected-product-actions';
import { productConfigurationCsv } from '../shared/product-configuration-export';
import { isProductCursorStack, productConfigHref, productCursorTrail } from '../shared/products-return-path';

import {
  type ConfigurationFilter,
  initialProductsState,
  type ProductPage,
  productsReducer,
} from './products-overview-state';

type ConfigurationState = 'not_configured' | 'draft' | 'published' | 'unavailable';
function configurationState(product: CatalogProduct): ConfigurationState {
  const state: unknown = product.configurationSummary?.state;
  return state === 'not_configured' || state === 'draft' || state === 'published' ? state : 'unavailable';
}
function isConfigurationFilter(value: string): value is ConfigurationFilter {
  return (
    value === 'all' ||
    value === 'not_configured' ||
    value === 'draft' ||
    value === 'published' ||
    value === 'unavailable'
  );
}
const productNumber = (id: string) => /^gid:\/\/shopify\/Product\/([1-9][0-9]*)$/.exec(id)?.[1];

function ProductsOverview() {
  const { t, formatLocale } = useAdminLocale();
  const [flow, dispatch] = useReducer(productsReducer, undefined, initialProductsState);
  const { catalog: state, configurationFilter, search, appliedSearch, cursors, selectedIds, selectionNotice } = flow;
  const numberFormat = new Intl.NumberFormat(formatLocale);
  const configurationLabels = {
    not_configured: t('products:configuration.notConfigured'),
    draft: t('products:configuration.draft'),
    published: t('products:configuration.published'),
    unavailable: t('products:configuration.unavailable'),
  };
  const configurationRef = useRef<ConfigurationFilter>('all');
  const [setupCopyAvailable, setSetupCopyAvailable] = useState(false);
  useEffect(() => {
    let disposeActions: (() => void) | undefined;
    if (document.documentElement.dataset.previewSetupCopy === 'true') setSetupCopyAvailable(true);
    else {
      try { disposeActions = installSelectedProductActions(); setSetupCopyAvailable(true); }
      catch { setSetupCopyAvailable(false); }
    }
    const previewError = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (detail && typeof detail === 'object' && 'reason' in detail && detail.reason === 'preview-failed') {
        dispatch({ type: 'selection-notice', reason: 'preview-failed' });
      }
    };
    document.addEventListener('insignia:customer-preview-error', previewError);
    return () => { document.removeEventListener('insignia:customer-preview-error', previewError); disposeActions?.(); };
  }, []);
  const selectionControl = useRef<HTMLElementTagNameMap['s-checkbox']>(null);
  const bulkSelectionControl = useRef<HTMLElementTagNameMap['s-checkbox']>(null);
  const focusSelection = useRef(false);
  const sequence = useRef(0);
  function clearSelection() {
    dispatch({ type: 'selection-cleared' });
  }
  function changeSelection(ids: string[]) {
    dispatch({ type: 'selection-changed', ids });
  }
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeRequest = useRef<AbortController | null>(null);
  function cancelSearch() {
    clearTimeout(searchTimer.current);
    activeRequest.current?.abort();
    sequence.current++;
  }
  function changeSearch(value: string) {
    cancelSearch();
    dispatch({ type: 'search-typed', value, request: sequence.current });
    searchTimer.current = setTimeout(() => void load(value.trim(), [null]), 300);
  }
  function submitSearch(value: string) {
    cancelSearch();
    void load(value.trim(), [null]);
  }
  useAdminPageReady(state.kind !== 'loading');
  function changeConfigurationFilter(value: ConfigurationFilter, refresh = true) {
    configurationRef.current = value;
    clearSelection();
    dispatch({ type: 'filter-changed', value });
    document
      .getElementById('products-index-filters')
      ?.dispatchEvent(Object.assign(new Event('command'), { command: '--hide' }));
    const url = new URL(location.href);
    if (value === 'all') url.searchParams.delete('configuration');
    else url.searchParams.set('configuration', value);
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    if (refresh) void load(search.trim(), [null]);
  }
  async function load(query: string, pages: (string | null)[], fresh = false) {
    clearTimeout(searchTimer.current);
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    clearSelection();
    const request = ++sequence.current;
    dispatch({ type: 'read-started', query, cursors: pages, request });
    const url = new URL(location.href);
    url.searchParams.delete('id_token');
    url.searchParams.delete('trail');
    if (query) url.searchParams.set('q', query);
    else url.searchParams.delete('q');
    const activeCursor = pages[pages.length - 1];
    if (activeCursor) url.searchParams.set('cursor', activeCursor);
    else url.searchParams.delete('cursor');
    history.replaceState({ ...history.state, insigniaProductCursors: pages }, '', url.pathname + url.search + url.hash);
    const params = new URLSearchParams({ q: query });
    if (configurationRef.current !== 'all') params.set('configuration', configurationRef.current);
    const cursor = pages[pages.length - 1];
    if (cursor) params.set('cursor', cursor);
    try {
      const page = await authenticatedJson<ProductPage>(
        `/api/admin/products?${params}`,
        { signal: controller.signal },
        fresh,
      );
      if (page.products.some((product) => !productNumber(product.id))) throw new Error('Invalid product response');
      if (request === sequence.current) dispatch({ type: 'read-succeeded', page, request });
    } catch (error) {
      if (request !== sequence.current || controller.signal.aborted) return;
      const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : null;
      dispatch({ type: 'read-failed', denied: status === 401 || status === 403, request });
    }
  }
  useEffect(() => {
    const restore = (): void => {
      const url = new URL(location.href);
      const query = (url.searchParams.get('q') ?? '').slice(0, 100).trim();
      const filter = url.searchParams.get('configuration') ?? 'all';
      changeConfigurationFilter(isConfigurationFilter(filter) ? filter : 'all', false);
      const cursor = url.searchParams.get('cursor');
      const stored: unknown = history.state;
      const stack =
        stored && typeof stored === 'object' && 'insigniaProductCursors' in stored
          ? stored.insigniaProductCursors
          : null;
      const restored = isProductCursorStack(stack) && stack.at(-1) === cursor ? stack : null;
      const trail = productCursorTrail(url.searchParams.getAll('trail'), cursor);
      const pages =
        cursor && cursor.length <= 512 ? (restored ? restored : trail ? [null, ...trail] : [cursor]) : [null];
      void load(query, pages);
    };
    restore();
    const clear = () => {
      cancelSearch();
      clearSelection();
      dispatch({ type: 'page-hidden', request: sequence.current });
    };
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) restore();
    };
    window.addEventListener('pagehide', clear);
    window.addEventListener('pageshow', show);
    return () => {
      cancelSearch();
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('pageshow', show);
    };
  }, []);
  const loading = state.kind === 'loading';
  const page = state.kind === 'ready' || state.kind === 'loading' ? state.page : null;
  const hasCursor = cursors[cursors.length - 1] !== null;
  const hasUnknownPreviousPages = cursors[0] !== null;
  const visible =
    page?.products.filter(
      (product) => configurationFilter === 'all' || configurationState(product) === configurationFilter,
    ) ?? [];
  const selected = visible.filter((product) => selectedIds.includes(product.id));
  const allSelected = visible.length > 0 && selected.length === visible.length;
  const someSelected = selected.length > 0 && !allSelected;
  useLayoutEffect(() => {
    if (!focusSelection.current) return;
    focusSelection.current = false;
    (selected.length > 0 ? bulkSelectionControl.current : selectionControl.current)?.focus();
  }, [selected.length]);
  function clearSelectionAndFocus() {
    focusSelection.current = true;
    clearSelection();
  }
  function togglePageSelection() {
    focusSelection.current = true;
    changeSelection(allSelected ? [] : visible.map((product) => product.id));
  }
  function previewSelectedProduct() {
    const product = selected.length === 1 ? selected[0] : undefined;
    if (!setupCopyAvailable || !product) return;
    document.dispatchEvent(new CustomEvent('insignia:preview-product', { detail: { productId: product.id } }));
  }
  function downloadSummary() {
    if (!selected.length) return;
    dispatch({ type: 'selection-notice', reason: null });
    try {
      const url = URL.createObjectURL(
        new Blob([productConfigurationCsv(selected)], { type: 'text/csv;charset=utf-8' }),
      );
      const link = document.createElement('a');
      try {
        link.href = url;
        link.download = `products-configuration-${new Date().toISOString().replaceAll(':', '-')}.csv`;
        document.body.append(link);
        link.click();
        link.remove();
      } finally {
        // Allow the browser to consume the object URL before releasing it.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      dispatch({ type: 'selection-notice', reason: 'summary-download-failed' });
    }
  }
  function copySetupFromProduct() {
    if (!setupCopyAvailable || !selected.length) return;
    document.dispatchEvent(
      new CustomEvent('insignia:copy-product-setup', {
        detail: { targetIds: selected.map((product) => product.id) },
      }),
    );
  }
  useEffect(() => {
    const refreshed = (): void => void load(appliedSearch, cursors);
    document.addEventListener('insignia:product-setups-copied', refreshed);
    return () => document.removeEventListener('insignia:product-setups-copied', refreshed);
  }, [appliedSearch, cursors]);
  const selectionBar = (
    <div class="resource-selection-bar">
      <div class="resource-selection-summary">
        <s-checkbox
          ref={bulkSelectionControl}
          accessibilityLabel={t('products:actions.selectAllShown')}
          checked={allSelected}
          indeterminate={someSelected}
          onChange={togglePageSelection}
        />
        <span class="resource-selection-count">
          {t('products:selection.selected', {
            count: selected.length,
            formattedCount: numberFormat.format(selected.length),
          })}
        </span>
      </div>
      <div class="resource-selection-actions resource-selection-desktop">
        {setupCopyAvailable && (
          <AdminActionChip
            accessibilityLabel={t('products:actions.copySetupAccessible')}
            onClick={copySetupFromProduct}
          >
            {t('products:actions.copySetup')}
          </AdminActionChip>
        )}
        <AdminActionChip accessibilityLabel={t('products:actions.downloadSummary')} onClick={downloadSummary}>
          {t('products:actions.downloadSummary')}
        </AdminActionChip>
        {setupCopyAvailable && selected.length === 1 && (
          <AdminActionChip
            accessibilityLabel={t('products:actions.previewCustomization')}
            onClick={previewSelectedProduct}
          >
            {t('products:actions.previewCustomization')}
          </AdminActionChip>
        )}
      </div>
      <div class="resource-selection-actions resource-selection-mobile">
        <AdminActionChip
          accessibilityLabel={t('products:actions.selectionActions')}
          icon="menu-horizontal"
          iconOnly
          commandFor="products-mobile-selection-actions"
        />
        <s-menu id="products-mobile-selection-actions" accessibilityLabel={t('products:actions.selectionActions')}>
          {setupCopyAvailable && (
            <s-button onClick={copySetupFromProduct}>{t('products:actions.copySetupAccessible')}</s-button>
          )}
          <s-button onClick={downloadSummary}>{t('products:actions.downloadSummary')}</s-button>
          {setupCopyAvailable && selected.length === 1 && (
            <s-button onClick={previewSelectedProduct}>{t('products:actions.previewCustomization')}</s-button>
          )}
        </s-menu>
      </div>
      <div class="resource-selection-clear">
        <s-button
          icon="x"
          variant="tertiary"
          accessibilityLabel={t('products:actions.clearSelection')}
          onClick={clearSelectionAndFocus}
        />
      </div>
    </div>
  );
  return (
    <s-page heading={t('products:pageTitle')} inlineSize="large">
      <s-button slot="secondary-actions" href="shopify://admin/products" target="_top">
        {t('products:actions.viewInShopify')}
      </s-button>
      <s-box padding="none" accessibilityRole="region" accessibilityLabel={t('products:table.region')}>
        <s-box paddingBlock="small">
          <AdminIndexToolbar
            id="products-index"
            label={t('products:search')}
            value={search}
            maxLength={100}
            onInput={changeSearch}
            onSubmit={submitSearch}
            loading={loading}
            resultStatus={
              page
                ? t('products:results.shown', {
                    count: visible.length,
                    formattedCount: numberFormat.format(visible.length),
                  })
                : undefined
            }
            filter={{
              label: t('products:filter.products'),
              count: configurationFilter === 'all' ? 0 : 1,
              content: (
                <s-choice-list
                  label={t('products:filter.configurationOnPage')}
                  name="products-configuration"
                  onChange={(event) => {
                    const value = event.currentTarget.values[0];
                    if (value && isConfigurationFilter(value)) changeConfigurationFilter(value);
                  }}
                >
                  <s-choice value="all" selected={configurationFilter === 'all'}>
                    {t('products:configuration.all')}
                  </s-choice>
                  {Object.entries(configurationLabels).map(([value, label]) => (
                    <s-choice key={value} value={value} selected={configurationFilter === value}>
                      {label}
                    </s-choice>
                  ))}
                </s-choice-list>
              ),
            }}
            appliedFilters={
              configurationFilter !== 'all' && (
                <AdminFilterChip
                  toolbarId="products-index"
                  label={t('products:filter.editConfiguration')}
                  onRemove={() => changeConfigurationFilter('all')}
                >
                  {t('products:filter.onThisPage', { configuration: configurationLabels[configurationFilter] })}
                </AdminFilterChip>
              )
            }
          />
          {selectionNotice && (
            <div role="status">
              <s-text>
                {selectionNotice === 'preview-failed'
                  ? t('products:errors.previewFailed')
                  : t('products:errors.summaryDownloadFailed')}
              </s-text>
            </div>
          )}
        </s-box>
        {loading && !page && (
          <s-box padding="base">
            <ProductsTableSkeleton />
          </s-box>
        )}
        {state.kind === 'error' && (
          <s-box padding="base">
            <s-banner tone="critical" heading={t('products:errors.loadHeading')}>
              <s-stack gap="base">
                <s-paragraph>
                  {state.denied ? t('products:errors.access') : t('products:errors.unavailable')}
                </s-paragraph>
                <s-button onClick={() => void load(appliedSearch, cursors, true)}>{t('common:actions.retry')}</s-button>
              </s-stack>
            </s-banner>
          </s-box>
        )}
        {page && (page.products.length > 0 || cursors.length > 1 || !!page.nextCursor) && (
          <AdminResourceTable
            pinPrimaryColumn
            label={t('products:table.columns')}
            selection={selectionBar}
            selectionActive={selected.length > 0}
            loading={loading}
            paginate={cursors.length > 1 || !!page.nextCursor}
            hasPreviousPage={cursors.length > 1}
            hasNextPage={!!page.nextCursor}
            onPreviousPage={(): void => void load(appliedSearch, cursors.slice(0, -1))}
            onNextPage={(): void => {
              if (page.nextCursor) void load(appliedSearch, [...cursors, page.nextCursor]);
            }}
          >
            <ResourceTableHead>
              <ResourceTableHeader label={t('products:table.product')}>
                <s-grid gridTemplateColumns="20px minmax(0, 1fr)" gap="small" alignItems="center">
                  <s-checkbox
                    ref={selectionControl}
                    accessibilityLabel={t('products:actions.selectAllShown')}
                    checked={allSelected}
                    indeterminate={someSelected}
                    disabled={loading || !visible.length}
                    onChange={togglePageSelection}
                  />
                  <s-text>{t('products:table.product')}</s-text>
                </s-grid>
              </ResourceTableHeader>
              <ResourceTableHeader>{t('products:table.configuration')}</ResourceTableHeader>
              <ResourceTableHeader>{t('products:table.methods')}</ResourceTableHeader>
              <ResourceTableHeader>{t('products:table.printLocations')}</ResourceTableHeader>
              <ResourceTableHeader format="numeric">{t('products:table.variants')}</ResourceTableHeader>
            </ResourceTableHead>
            <ResourceTableBody>
              {visible.map((product) => {
                const id = productNumber(product.id);
                if (!id) return null;
                return (
                  <ResourceTableRow
                    key={product.id}
                    clickDelegate={`product-${id}`}
                    selected={selectedIds.includes(product.id)}
                  >
                    <ResourceTableCell>
                      <AdminResourceName text={product.title}>
                        {({ textRef, interestFor, tooltip }) => (
                          <>
                            <div class="product-resource-identity">
                              <s-checkbox
                                accessibilityLabel={t('products:actions.selectProduct', { productName: product.title })}
                                checked={selectedIds.includes(product.id)}
                                onChange={(event) => {
                                  event.stopPropagation();
                                  changeSelection(
                                    event.currentTarget.checked
                                      ? [...selectedIds, product.id]
                                      : selectedIds.filter((selectedId) => selectedId !== product.id),
                                  );
                                }}
                              />
                              <div class="product-resource-thumbnail">
                                {product.imageUrl ? (
                                  <s-thumbnail src={product.imageUrl} size="small" alt="" />
                                ) : (
                                  <s-box
                                    inlineSize="40px"
                                    blockSize="40px"
                                    background="subdued"
                                    border="base"
                                    borderRadius="base"
                                  >
                                    <s-stack alignItems="center" justifyContent="center" blockSize="100%">
                                      <s-icon type="product" color="subdued" />
                                    </s-stack>
                                  </s-box>
                                )}
                              </div>
                              <s-link
                                id={`product-${id}`}
                                href={productConfigHref(id)}
                                tone="auto"
                                interestFor={interestFor}
                              >
                                <div class="catalog-product-name" ref={textRef}>
                                  <s-text fontWeight="medium">{product.title}</s-text>
                                </div>
                              </s-link>
                            </div>
                            {tooltip}
                          </>
                        )}
                      </AdminResourceName>
                    </ResourceTableCell>
                    <ResourceTableCell>
                      {configurationState(product) === 'unavailable' ? (
                        <s-text color="subdued">{configurationLabels.unavailable}</s-text>
                      ) : (
                        <s-badge tone={configurationState(product) === 'published' ? 'success' : 'neutral'}>
                          {configurationLabels[configurationState(product)]}
                        </s-badge>
                      )}
                    </ResourceTableCell>
                    <ResourceTableCell>
                      <AdminValueSummary
                        id={`product-methods-${id}`}
                        label={t('products:summary.methods')}
                        viewAllLabel={t('products:summary.viewAllMethods')}
                        resourceName={product.title}
                        values={product.configurationSummary?.methods ?? null}
                        emptyLabel={t('products:summary.noneConfigured')}
                      />
                    </ResourceTableCell>
                    <ResourceTableCell>
                      <AdminValueSummary
                        id={`product-locations-${id}`}
                        label={t('products:summary.printLocations')}
                        viewAllLabel={t('products:summary.viewAllPrintLocations')}
                        resourceName={product.title}
                        values={product.configurationSummary?.locations ?? null}
                        emptyLabel={t('products:summary.noneConfigured')}
                      />
                    </ResourceTableCell>
                    <ResourceTableCell format="numeric">
                      <s-number>
                        {product.variantsTruncated ? '>' : ''}
                        {numberFormat.format(product.variants.length)}
                      </s-number>
                    </ResourceTableCell>
                  </ResourceTableRow>
                );
              })}
            </ResourceTableBody>
          </AdminResourceTable>
        )}
        {page && page.products.length > 0 && hasUnknownPreviousPages && (
          <s-box padding="base">
            <s-button variant="tertiary" disabled={loading} onClick={() => void load(appliedSearch, [null])}>
              {t('products:actions.firstPage')}
            </s-button>
          </s-box>
        )}
        {state.kind === 'ready' && page && page.products.length > 0 && visible.length === 0 && (
          <s-empty-state heading={t('products:empty.noneOnPage')}>
            <s-paragraph slot="subheading">{t('products:empty.changeFilterOrPage')}</s-paragraph>
            <s-button slot="primary-action" variant="primary" onClick={() => changeConfigurationFilter('all')}>
              {t('products:actions.clearFilter')}
            </s-button>
          </s-empty-state>
        )}
        {state.kind === 'ready' && page && page.products.length === 0 && (
          <s-empty-state
            heading={
              hasCursor
                ? t('products:empty.noneOnPage')
                : appliedSearch
                  ? t('products:empty.noProductsFound')
                  : t('products:empty.noProductsYet')
            }
          >
            <s-paragraph slot="subheading">
              {hasCursor
                ? t('products:empty.returnFirstOrSearch')
                : appliedSearch
                  ? t('products:empty.changeProductSearch')
                  : t('products:empty.addInShopify')}
            </s-paragraph>
            {hasCursor ? (
              <s-button
                slot="primary-action"
                variant="primary"
                disabled={loading}
                onClick={() => void load(appliedSearch, [null])}
              >
                {t('products:actions.firstPage')}
              </s-button>
            ) : (
              appliedSearch && (
                <s-button
                  slot="primary-action"
                  variant="primary"
                  disabled={loading}
                  onClick={() => {
                    void load('', [null]);
                  }}
                >
                  {t('products:actions.showAll')}
                </s-button>
              )
            )}
          </s-empty-state>
        )}
      </s-box>
    </s-page>
  );
}

export default withAdminLocale(ProductsOverview);
