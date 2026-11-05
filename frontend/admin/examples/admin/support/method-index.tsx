/** Selected Methods index using the same search, table and selection shell as Products. */
import { useMemo, useRef, useState } from 'preact/hooks';
import AdminActionChip from '../../../src/components/AdminActionChip.tsx';
import AdminIndexToolbar, { AdminFilterChip } from '../../../src/components/AdminIndexToolbar.tsx';
import AdminResourceName from '../../../src/components/AdminResourceName.tsx';
import AdminResourceTable, {
  ResourceTableBody,
  ResourceTableCell,
  ResourceTableHead,
  ResourceTableHeader,
  ResourceTableRow,
} from '../../../src/components/AdminResourceTable.tsx';
import { useAdminLocale } from '../../../src/shared/admin-i18n.js';
import {
  assignedProducts,
  type MethodConfiguration,
  type MethodProduct,
  productReadiness,
} from './method-configuration.mts';
import { downloadMethodSummary, methodPreviewLimit } from './method-management.mts';
import { formatPrice, parsePrice } from './method-workflow-prices.mts';

function pricingLabel(
  method: MethodConfiguration,
  t: ReturnType<typeof useAdminLocale>['t'],
  locale: string,
  currency = 'EUR',
): string {
  if (method.pricing !== 'fixed') return t('methods:index.price.productSpecific');
  const price = parsePrice(method.amount);
  return price.kind !== 'valid'
    ? t('methods:index.price.notSet')
    : price.minor === 0n
      ? t('methods:index.price.free')
      : formatPrice(price.minor, locale, currency);
}

function MethodPriceSummary({ method, currency = 'EUR' }: { method: MethodConfiguration; currency?: string }) {
  const { t, formatLocale } = useAdminLocale();
  return <s-text>{pricingLabel(method, t, formatLocale, currency)}</s-text>;
}

type Filters = { pricing: string; assignment: string; setup: string };
const emptyFilters: Filters = { pricing: 'all', assignment: 'all', setup: 'all' };
const perPage = 25;
export default function MethodIndex({
  methods,
  readOnly = false,
  currency = 'EUR',
  methodCurrencies = {},
  products,
  onCreate,
  onDuplicate,
  onDelete,
}: {
  methods: MethodConfiguration[];
  readOnly?: boolean;
  currency?: string;
  methodCurrencies?: Record<string, string>;
  products: MethodProduct[];
  onCreate(): void;
  onDuplicate(method: MethodConfiguration): void;
  onDelete(methods: MethodConfiguration[]): void;
}) {
  const { t, formatLocale } = useAdminLocale();
  const numberFormat = new Intl.NumberFormat(formatLocale);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(emptyFilters);
  const [sort, setSort] = useState('name-asc');
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState<{ ids: string[]; source: MethodConfiguration[] }>({
    ids: [],
    source: methods,
  });
  const selectedIds = selection.source === methods ? selection.ids : [];
  function setSelectedIds(ids: string[]) {
    setSelection({ ids, source: methods });
  }
  const selectAll = useRef<HTMLElementTagNameMap['s-checkbox']>(null);
  const bulkSelect = useRef<HTMLElementTagNameMap['s-checkbox']>(null);
  const summaries = useMemo(
    () =>
      methods.map((method) => {
        const eligible = assignedProducts(method, products);
        const using = products.filter((product) =>
          product.setup.some((setup) => setup.methodId === method.id && setup.locations > 0),
        );
        const scope = [...new Map([...eligible, ...using].map((product) => [product.id, product])).values()];
        return {
          method,
          count: scope.length,
          available: eligible.length,
          used: using.length,
          needs: scope.filter((product) => !productReadiness(method, product).ready).length,
        };
      }),
    [methods, products],
  );
  const matching = summaries
    .filter(({ method, count, needs }) => {
      const queryText = query.trim().toLocaleLowerCase(formatLocale);
      if (
        !`${method.name} ${method.explanation} ${method.assignment === 'tags' ? method.tags.join(' ') : ''}`
          .toLocaleLowerCase(formatLocale)
          .includes(queryText)
      )
        return false;
      return (
        (filters.pricing === 'all' || filters.pricing === method.pricing) &&
        (filters.assignment === 'all' || filters.assignment === method.assignment) &&
        (filters.setup === 'all' ||
          (filters.setup === 'needs' && needs > 0) ||
          (filters.setup === 'unassigned' && count === 0) ||
          (filters.setup === 'ready' && count > 0 && !needs))
      );
    })
    .sort((a, b) => {
      const name = a.method.name.localeCompare(b.method.name, formatLocale, { numeric: true, sensitivity: 'base' });
      if (sort.startsWith('price-')) {
        const aPrice = a.method.pricing === 'fixed' ? parsePrice(a.method.amount) : { kind: 'invalid' as const };
        const bPrice = b.method.pricing === 'fixed' ? parsePrice(b.method.amount) : { kind: 'invalid' as const };
        if (aPrice.kind === 'valid' && bPrice.kind === 'valid') {
          const direction = aPrice.minor < bPrice.minor ? -1 : aPrice.minor > bPrice.minor ? 1 : 0;
          return (sort === 'price-desc' ? -direction : direction) || name;
        }
        if (aPrice.kind === 'valid') return -1;
        if (bPrice.kind === 'valid') return 1;
      }
      return sort === 'products-desc' ? b.used - a.used || name : sort === 'name-desc' ? -name : name;
    });
  const pages = Math.max(1, Math.ceil(matching.length / perPage));
  const currentPage = Math.min(page, pages - 1);
  const visible = matching.slice(currentPage * perPage, (currentPage + 1) * perPage);
  const selected = visible.map((row) => row.method).filter((method) => selectedIds.includes(method.id));
  const allSelected = visible.length > 0 && selected.length === visible.length;
  const someSelected = selected.length > 0 && !allSelected;
  const filterCount = Object.values(filters).filter((value) => value !== 'all').length;
  function resetView() {
    setPage(0);
    setSelectedIds([]);
  }
  function changeFilters(change: Partial<Filters>) {
    setFilters((previous) => ({ ...previous, ...change }));
    resetView();
  }
  function changeSelection(ids: string[]) {
    const wasSelected = selected.length > 0;
    setSelectedIds(ids);
    requestAnimationFrame(() => {
      if (!wasSelected && ids.length) bulkSelect.current?.focus();
    });
  }
  function togglePage() {
    changeSelection(allSelected ? [] : visible.map((row) => row.method.id));
  }
  function clearSelection() {
    setSelectedIds([]);
    requestAnimationFrame(() => selectAll.current?.focus());
  }
  const selectionBar = (
    <div class="resource-selection-bar">
      <div class="resource-selection-summary">
        <s-checkbox
          ref={bulkSelect}
          accessibilityLabel={t('methods:index.actions.selectAllShown')}
          checked={allSelected}
          indeterminate={someSelected}
          onChange={togglePage}
        />
        <span class="resource-selection-count">
          {t('methods:index.counts.selected', {
            count: selected.length,
            formattedCount: numberFormat.format(selected.length),
          })}
        </span>
      </div>
      <div class="resource-selection-actions resource-selection-desktop">
        <AdminActionChip
          accessibilityLabel={t('methods:index.actions.exportSummary')}
          onClick={() => downloadMethodSummary(selected, products, currency, methodCurrencies)}
        >
          {t('methods:index.actions.exportSummary')}
        </AdminActionChip>
        <AdminActionChip
          accessibilityLabel={t('methods:index.actions.moreActions')}
          trailingIcon="chevron-down"
          commandFor="methods-bulk-actions"
        >
          {t('methods:index.actions.moreActions')}
        </AdminActionChip>
        <s-menu id="methods-bulk-actions" accessibilityLabel={t('methods:index.actions.selectedActions')}>
          <s-button tone="critical" disabled={readOnly} onClick={() => onDelete(selected)}>
            {t('methods:index.actions.deleteMethods')}
          </s-button>
        </s-menu>
      </div>
      <div class="resource-selection-actions resource-selection-mobile">
        <AdminActionChip
          accessibilityLabel={t('methods:index.actions.selectedActions')}
          icon="menu-horizontal"
          iconOnly
          commandFor="methods-mobile-actions"
        />
        <s-menu id="methods-mobile-actions" accessibilityLabel={t('methods:index.actions.selectedActions')}>
          <s-button onClick={() => downloadMethodSummary(selected, products, currency, methodCurrencies)}>
            {t('methods:index.actions.exportSummary')}
          </s-button>
          <s-button tone="critical" disabled={readOnly} onClick={() => onDelete(selected)}>
            {t('methods:index.actions.deleteMethods')}
          </s-button>
        </s-menu>
      </div>
      <div class="resource-selection-clear">
        <s-button
          icon="x"
          variant="tertiary"
          accessibilityLabel={t('methods:index.actions.clearSelection')}
          onClick={clearSelection}
        />
      </div>
    </div>
  );
  return (
    <div class="method-index-table">
      {methods.length >= methodPreviewLimit && (
        <s-banner tone="info">
          {t('methods:index.counts.limit', {
            formattedCount: numberFormat.format(methodPreviewLimit),
          })}
        </s-banner>
      )}
      <s-box padding="none" accessibilityRole="region" accessibilityLabel={t('methods:index.region')}>
        {methods.length ? (
          <>
            <s-box paddingBlock="small">
              <AdminIndexToolbar
                id="methods"
                label={t('methods:index.search')}
                value={query}
                maxLength={100}
                onInput={(value) => {
                  setQuery(value);
                  resetView();
                }}
                resultStatus={t('methods:index.counts.results', {
                  count: matching.length,
                  formattedCount: numberFormat.format(matching.length),
                })}
                filter={{
                  label: t('methods:index.filter'),
                  count: filterCount,
                  content: (
                    <>
                      <s-select
                        label={t('methods:index.filters.pricing')}
                        value={filters.pricing}
                        onChange={(event) => changeFilters({ pricing: event.currentTarget.value })}
                      >
                        <s-option value="all">{t('methods:index.filters.allPricing')}</s-option>
                        <s-option value="fixed">{t('methods:index.filters.fixedPrice')}</s-option>
                        <s-option value="product">{t('methods:index.filters.productSpecific')}</s-option>
                      </s-select>
                      <s-select
                        label={t('methods:index.filters.assignment')}
                        value={filters.assignment}
                        onChange={(event) => changeFilters({ assignment: event.currentTarget.value })}
                      >
                        <s-option value="all">{t('methods:index.filters.allAssignments')}</s-option>
                        <s-option value="manual">{t('methods:index.filters.manual')}</s-option>
                        <s-option value="tags">{t('methods:index.filters.byTag')}</s-option>
                      </s-select>
                      <s-select
                        label={t('methods:index.filters.setup')}
                        value={filters.setup}
                        onChange={(event) => changeFilters({ setup: event.currentTarget.value })}
                      >
                        <s-option value="all">{t('methods:index.filters.allMethods')}</s-option>
                        <s-option value="needs">{t('methods:index.filters.needsSetup')}</s-option>
                        <s-option value="unassigned">{t('methods:index.filters.noProductsAssigned')}</s-option>
                        <s-option value="ready">{t('methods:index.filters.configured')}</s-option>
                      </s-select>
                      {filterCount > 0 && (
                        <s-button
                          onClick={() => {
                            setFilters(emptyFilters);
                            resetView();
                          }}
                        >
                          {t('methods:index.filters.clear')}
                        </s-button>
                      )}
                    </>
                  ),
                }}
                appliedFilters={
                  filterCount > 0 ? (
                    <s-stack direction="inline" gap="small">
                      {filters.pricing !== 'all' && (
                        <AdminFilterChip
                          toolbarId="methods"
                          label={t('methods:index.filters.editPricing')}
                          onRemove={() => changeFilters({ pricing: 'all' })}
                        >
                          {filters.pricing === 'fixed'
                            ? t('methods:index.filters.fixedPrice')
                            : t('methods:index.filters.productSpecific')}
                        </AdminFilterChip>
                      )}
                      {filters.assignment !== 'all' && (
                        <AdminFilterChip
                          toolbarId="methods"
                          label={t('methods:index.filters.editAssignment')}
                          onRemove={() => changeFilters({ assignment: 'all' })}
                        >
                          {filters.assignment === 'manual'
                            ? t('methods:index.filters.manual')
                            : t('methods:index.filters.byTag')}
                        </AdminFilterChip>
                      )}
                      {filters.setup !== 'all' && (
                        <AdminFilterChip
                          toolbarId="methods"
                          label={t('methods:index.filters.editSetup')}
                          onRemove={() => changeFilters({ setup: 'all' })}
                        >
                          {filters.setup === 'needs'
                            ? t('methods:index.filters.needsSetup')
                            : filters.setup === 'unassigned'
                              ? t('methods:index.filters.noProductsAssigned')
                              : t('methods:index.filters.configured')}
                        </AdminFilterChip>
                      )}
                    </s-stack>
                  ) : undefined
                }
                actions={
                  <>
                    <s-button
                      variant="tertiary"
                      icon="info"
                      accessibilityLabel={t('methods:index.sorting.defaultPricingHelp')}
                      interestFor="methods-pricing-help"
                    />
                    <s-tooltip id="methods-pricing-help">{t('methods:index.sorting.fixedPriceHelp')}</s-tooltip>
                    <s-button
                      icon="sort"
                      variant="tertiary"
                      accessibilityLabel={t('methods:index.sorting.help')}
                      commandFor="methods-sort"
                      interestFor="methods-sort-help"
                    />
                    <s-tooltip id="methods-sort-help">{t('methods:index.sorting.help')}</s-tooltip>
                    <s-popover id="methods-sort" inlineSize="240px">
                      <s-box padding="base">
                        <s-choice-list
                          label={t('methods:index.sorting.help')}
                          values={[sort]}
                          onChange={(event) => {
                            setSort(event.currentTarget.values[0] ?? 'name-asc');
                            resetView();
                          }}
                        >
                          <s-choice value="name-asc">{t('methods:index.sorting.nameAscending')}</s-choice>
                          <s-choice value="name-desc">{t('methods:index.sorting.nameDescending')}</s-choice>
                          <s-choice value="products-desc">{t('methods:index.sorting.mostProducts')}</s-choice>
                          <s-choice value="price-asc">{t('methods:index.sorting.fixedPriceAscending')}</s-choice>
                          <s-choice value="price-desc">{t('methods:index.sorting.fixedPriceDescending')}</s-choice>
                        </s-choice-list>
                        {sort.startsWith('price-') && (
                          <s-paragraph color="subdued">{t('methods:index.sorting.productSpecificLast')}</s-paragraph>
                        )}
                      </s-box>
                    </s-popover>
                  </>
                }
              />
            </s-box>
            {matching.length ? (
              <>
                <AdminResourceTable
                  label={t('methods:index.region')}
                  selection={selectionBar}
                  selectionActive={selected.length > 0}
                  paginate={pages > 1}
                  hasNextPage={currentPage + 1 < pages}
                  hasPreviousPage={currentPage > 0}
                  onNextPage={() => {
                    setPage(currentPage + 1);
                    setSelectedIds([]);
                  }}
                  onPreviousPage={() => {
                    setPage(currentPage - 1);
                    setSelectedIds([]);
                  }}
                >
                  <ResourceTableHead>
                    <ResourceTableHeader label={t('methods:index.columns.method')}>
                      <s-grid gridTemplateColumns="20px minmax(0, 1fr)" gap="small" alignItems="center">
                        <s-checkbox
                          ref={selectAll}
                          accessibilityLabel={t('methods:index.actions.selectAllShown')}
                          checked={allSelected}
                          indeterminate={someSelected}
                          onChange={togglePage}
                        />
                        <s-text>{t('methods:index.columns.method')}</s-text>
                      </s-grid>
                    </ResourceTableHeader>
                    <ResourceTableHeader>{t('methods:index.columns.pricing')}</ResourceTableHeader>
                    <ResourceTableHeader>{t('methods:index.columns.productsUsing')}</ResourceTableHeader>
                    <ResourceTableHeader>{t('methods:index.columns.productSetup')}</ResourceTableHeader>
                    <ResourceTableHeader label={t('methods:index.columns.actions')}>
                      <s-text accessibilityVisibility="exclusive">{t('methods:index.columns.actions')}</s-text>
                    </ResourceTableHeader>
                  </ResourceTableHead>
                  <ResourceTableBody>
                    {visible.map(({ method, count, available, used, needs }) => (
                      <ResourceTableRow
                        key={method.id}
                        clickDelegate={`method-${method.id}`}
                        selected={selectedIds.includes(method.id)}
                      >
                        <ResourceTableCell>
                          <div class="method-index-identity">
                            <s-checkbox
                              accessibilityLabel={t('methods:index.actions.selectMethod', { methodName: method.name })}
                              checked={selectedIds.includes(method.id)}
                              onChange={(event) =>
                                changeSelection(
                                  event.currentTarget.checked
                                    ? [...selectedIds, method.id]
                                    : selectedIds.filter((id) => id !== method.id),
                                )
                              }
                            />
                            <div class="method-index-copy">
                              <AdminResourceName text={method.name}>
                                {({ textRef, interestFor, tooltip }) => (
                                  <>
                                    <s-link
                                      id={`method-${method.id}`}
                                      href={`/admin/methods/${method.id}`}
                                      tone="neutral"
                                      interestFor={interestFor}
                                    >
                                      <div class="method-index-name" ref={textRef}>
                                        <s-text type="strong">{method.name}</s-text>
                                      </div>
                                    </s-link>
                                    {tooltip}
                                  </>
                                )}
                              </AdminResourceName>
                              <dl class="method-index-mobile-details">
                                <dt>{t('methods:index.columns.pricing')}</dt>
                                <dd>
                                  <MethodPriceSummary
                                    method={method}
                                    currency={methodCurrencies[method.id] ?? currency}
                                  />
                                </dd>
                                <dt>{t('methods:index.columns.productsUsing')}</dt>
                                <dd>{numberFormat.format(used)}</dd>
                                <dt>{t('methods:summary.availableTo')}</dt>
                                <dd>
                                  {t('methods:index.counts.products', {
                                    count: available,
                                    formattedCount: numberFormat.format(available),
                                  })}
                                </dd>
                                <dt>{t('methods:index.columns.productSetup')}</dt>
                                <dd>
                                  {count > 0 ? (
                                    <s-badge tone={needs ? 'warning' : 'neutral'}>
                                      {needs
                                        ? t('methods:index.counts.needsSetup', {
                                            count: needs,
                                            formattedCount: numberFormat.format(needs),
                                          })
                                        : t('methods:index.filters.configured')}
                                    </s-badge>
                                  ) : method.assignment === 'tags' ? (
                                    t('methods:index.setup.noMatchingProducts')
                                  ) : (
                                    t('methods:index.setup.notAssigned')
                                  )}
                                </dd>
                              </dl>
                            </div>
                          </div>
                        </ResourceTableCell>
                        <ResourceTableCell column="method-pricing">
                          <MethodPriceSummary method={method} currency={methodCurrencies[method.id] ?? currency} />
                        </ResourceTableCell>
                        <ResourceTableCell column="method-scope">
                          <s-text type="strong">
                            {t('methods:index.counts.products', {
                              count: used,
                              formattedCount: numberFormat.format(used),
                            })}
                          </s-text>
                          <div class="method-index-assignment">
                            <s-text color="subdued">
                              {t('methods:index.counts.available', {
                                count: available,
                                formattedCount: numberFormat.format(available),
                              })}
                            </s-text>
                          </div>
                        </ResourceTableCell>
                        <ResourceTableCell>
                          {!count ? (
                            <s-text color="subdued">
                              {method.assignment === 'tags'
                                ? t('methods:index.setup.noMatchingProducts')
                                : t('methods:index.setup.notAssigned')}
                            </s-text>
                          ) : (
                            <s-badge tone={needs ? 'warning' : 'neutral'}>
                              {needs
                                ? t('methods:index.counts.needsSetup', {
                                    count: needs,
                                    formattedCount: numberFormat.format(needs),
                                  })
                                : t('methods:index.filters.configured')}
                            </s-badge>
                          )}
                        </ResourceTableCell>
                        <ResourceTableCell>
                          <div class="method-row-actions">
                            <s-button
                              icon="menu-horizontal"
                              variant="tertiary"
                              accessibilityLabel={t('methods:index.actions.actionsForMethod', {
                                methodName: method.name,
                              })}
                              commandFor={`method-actions-${method.id}`}
                            />
                            <s-menu
                              id={`method-actions-${method.id}`}
                              accessibilityLabel={t('methods:index.actions.actionsForMethod', {
                                methodName: method.name,
                              })}
                            >
                              <s-button
                                disabled={readOnly || methods.length >= methodPreviewLimit}
                                onClick={() => onDuplicate(method)}
                              >
                                {t('methods:index.actions.duplicate')}
                              </s-button>
                              <s-button
                                onClick={() => downloadMethodSummary([method], products, currency, methodCurrencies)}
                              >
                                {t('methods:index.actions.exportSummary')}
                              </s-button>
                              <s-button tone="critical" disabled={readOnly} onClick={() => onDelete([method])}>
                                {t('methods:index.actions.deleteMethod')}
                              </s-button>
                            </s-menu>
                          </div>
                        </ResourceTableCell>
                      </ResourceTableRow>
                    ))}
                  </ResourceTableBody>
                </AdminResourceTable>
                {pages > 1 && (
                  <s-box padding="small">
                    <s-text color="subdued">
                      {t('methods:index.counts.pageRange', {
                        first: numberFormat.format(currentPage * perPage + 1),
                        last: numberFormat.format(Math.min((currentPage + 1) * perPage, matching.length)),
                        formattedCount: numberFormat.format(matching.length),
                      })}
                    </s-text>
                  </s-box>
                )}
              </>
            ) : (
              <s-box padding="base">
                <s-stack gap="base">
                  <s-heading>{t('methods:index.empty.noMethodsFound')}</s-heading>
                  <s-button
                    onClick={() => {
                      setQuery('');
                      setFilters(emptyFilters);
                      resetView();
                    }}
                  >
                    {t('methods:index.empty.clearSearchAndFilters')}
                  </s-button>
                </s-stack>
              </s-box>
            )}
          </>
        ) : (
          <s-empty-state heading={t('methods:index.empty.firstTitle')}>
            <s-box slot="graphic" inlineSize="144px" maxInlineSize="144px" maxBlockSize="144px">
              <s-image
                src="/illustrations/shopify/empty-records.png"
                alt=""
                inlineSize="fill"
                aspectRatio="1"
                objectFit="contain"
              />
            </s-box>
            <s-text slot="subheading">{t('methods:index.empty.firstDescription')}</s-text>
            <s-button slot="primary-action" variant="primary" disabled={readOnly} onClick={onCreate}>
              {t('methods:index.actions.create')}
            </s-button>
          </s-empty-state>
        )}
      </s-box>
    </div>
  );
}
