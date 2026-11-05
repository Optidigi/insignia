import { useState } from 'preact/hooks';
import AdminPickerToolbar from '../../../src/components/AdminPickerToolbar.tsx';
import { useAdminLocale } from '../../../src/shared/admin-i18n.js';
import type { MethodProduct } from './method-configuration.mts';
import MethodDialog from './method-dialog.tsx';
import {
  filterMethodProducts,
  type MethodProductSearchBy,
  methodProductFilterOptions,
} from './method-product-filter.mts';

type BrowseView = 'products' | 'collections';
type FilterView = 'facets' | 'collection' | 'tag';

interface ProductCollection {
  id: string;
  title: string;
  products: MethodProduct[];
}

function productCollections(products: readonly MethodProduct[], formatLocale: string): ProductCollection[] {
  const options = methodProductFilterOptions(products, formatLocale).collections;
  return options.map((collection) => ({
    ...collection,
    products: filterMethodProducts(products, { collectionId: collection.id }, formatLocale),
  }));
}

export default function MethodProductPicker({
  products,
  selected,
  onApply,
  onClose,
  initialBrowse = 'products',
  suspended = false,
}: {
  products: MethodProduct[];
  selected: string[];
  onApply(ids: string[]): void;
  onClose(): void;
  initialBrowse?: BrowseView;
  suspended?: boolean;
}) {
  const { t, formatLocale } = useAdminLocale();
  const numberFormat = new Intl.NumberFormat(formatLocale);
  const [ids, setIds] = useState(selected);
  const browse = initialBrowse;
  const [query, setQuery] = useState('');
  const [collectionQuery, setCollectionQuery] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [searchBy, setSearchBy] = useState<MethodProductSearchBy>('all');
  const [collectionId, setCollectionId] = useState('');
  const [tag, setTag] = useState('');
  const [collectionFilterQuery, setCollectionFilterQuery] = useState('');
  const [tagFilterQuery, setTagFilterQuery] = useState('');
  const [filterView, setFilterView] = useState<FilterView>('facets');
  const [page, setPage] = useState(0);
  const [collectionPage, setCollectionPage] = useState(0);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);

  const options = methodProductFilterOptions(products, formatLocale);
  const collections = productCollections(products, formatLocale);
  const activeCollection = options.collections.find((item) => item.id === collectionId);
  const selectedIds = new Set(ids);
  const initialSelectedIds = new Set(selected);
  const availableProductIds = new Set(products.map((product) => product.id));
  const unavailableSelectedCount = ids.filter((id) => !availableProductIds.has(id)).length;
  const selectionChanged =
    ids.length !== selected.length ||
    ids.some((id) => !initialSelectedIds.has(id)) ||
    selected.some((id) => !selectedIds.has(id));
  const selectedCollectionSet = new Set(selectedCollectionIds);
  const filterCount = Number(!!collectionId) + Number(!!tag);
  const filteredProducts = filterMethodProducts(
    products,
    {
      query,
      searchBy,
      collectionId,
      tag,
      selectedOnly,
      selectedIds: ids,
    },
    formatLocale,
  );
  const productPages = Math.max(1, Math.ceil(filteredProducts.length / 25));
  const currentProductPage = Math.min(page, productPages - 1);
  const visibleProducts = filteredProducts.slice(currentProductPage * 25, (currentProductPage + 1) * 25);
  const allShown = visibleProducts.length > 0 && visibleProducts.every((product) => selectedIds.has(product.id));
  const someShown = !allShown && visibleProducts.some((product) => selectedIds.has(product.id));
  const productEmptyState = !products.length ? 'catalog' : selectedOnly ? 'selected' : 'filters';
  const productEmptyHeading =
    productEmptyState === 'catalog'
      ? t('methods:picker.empty.noProductsAvailable')
      : productEmptyState === 'selected'
        ? t('methods:picker.empty.noSelectedProductsMatch')
        : t('methods:picker.empty.noMatchingProducts');
  const productEmptyDescription =
    productEmptyState === 'catalog'
      ? unavailableSelectedCount
        ? t('methods:picker.empty.unavailableAssignments', {
            count: unavailableSelectedCount,
            formattedCount: numberFormat.format(unavailableSelectedCount),
          })
        : t('methods:picker.empty.catalogUnavailable')
      : productEmptyState === 'selected'
        ? t('methods:picker.empty.selectedSearchNoMatch')
        : t('methods:picker.empty.tryDifferentSearch');
  const filteredCollections = collections.filter((collection) =>
    collection.title.toLocaleLowerCase(formatLocale).includes(collectionQuery.trim().toLocaleLowerCase(formatLocale)),
  );
  const collectionPages = Math.max(1, Math.ceil(filteredCollections.length / 25));
  const currentCollectionPage = Math.min(collectionPage, collectionPages - 1);
  const visibleCollections = filteredCollections.slice(currentCollectionPage * 25, (currentCollectionPage + 1) * 25);
  const filteredCollectionOptions = options.collections.filter((collection) =>
    collection.title
      .toLocaleLowerCase(formatLocale)
      .includes(collectionFilterQuery.trim().toLocaleLowerCase(formatLocale)),
  );
  const filteredTagOptions = options.tags.filter((item) =>
    item.toLocaleLowerCase(formatLocale).includes(tagFilterQuery.trim().toLocaleLowerCase(formatLocale)),
  );

  const selectedCollectionProducts = new Map<string, MethodProduct>();
  for (const collection of collections) {
    if (!selectedCollectionSet.has(collection.id)) continue;
    for (const product of collection.products) selectedCollectionProducts.set(product.id, product);
  }
  const newCollectionProductCount = [...selectedCollectionProducts.keys()].filter((id) => !selectedIds.has(id)).length;

  function focusPickerQuery() {
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('#method-product-picker-query')?.focus({ preventScroll: true }),
    );
  }

  function focusFilterChoice() {
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('#method-product-picker-filter-content s-clickable')
        ?.focus({ preventScroll: true }),
    );
  }

  function showFacet(view: 'collection' | 'tag') {
    setFilterView(view);
    if (view === 'collection') setCollectionFilterQuery('');
    else setTagFilterQuery('');
    requestAnimationFrame(() =>
      document
        .getElementById(
          view === 'collection' ? 'method-product-collection-filter-query' : 'method-product-tag-filter-query',
        )
        ?.focus({ preventScroll: true }),
    );
  }

  function returnToFilterChoices() {
    setFilterView('facets');
    focusFilterChoice();
  }

  function clearCollectionFilter() {
    setCollectionId('');
    setPage(0);
  }

  function clearTagFilter() {
    setTag('');
    setPage(0);
  }

  function clearProductFilters() {
    setQuery('');
    setSelectedOnly(false);
    setSearchBy('all');
    setCollectionId('');
    setTag('');
    setPage(0);
  }

  function removeFacetFilter(facet: 'collection' | 'tag') {
    if (facet === 'collection') setCollectionId('');
    else setTag('');
    setPage(0);
    focusPickerQuery();
  }

  const collectionFilterPanel = (
    <div class="method-product-picker__filter-panel">
      <div class="method-product-picker__facet-header">
        <s-button
          variant="tertiary"
          icon="chevron-left"
          accessibilityLabel={t('methods:picker.backToFilters')}
          onClick={returnToFilterChoices}
        />
        <s-text type="strong">{t('methods:picker.collection')}</s-text>
        {collectionId && (
          <s-button variant="tertiary" onClick={clearCollectionFilter}>
            {t('methods:picker.clear')}
          </s-button>
        )}
      </div>
      <s-search-field
        id="method-product-collection-filter-query"
        name="method-product-collection-filter-query"
        label={t('methods:picker.searchCollections')}
        labelAccessibilityVisibility="exclusive"
        placeholder={t('methods:picker.searchCollections')}
        value={collectionFilterQuery}
        autocomplete="off"
        onInput={(event) => setCollectionFilterQuery(event.currentTarget.value)}
      />
      <div class="method-product-picker__filter-options">
        {filteredCollectionOptions.length ? (
          <fieldset class="method-product-picker__facet-radio-list" aria-label={t('methods:picker.collection')}>
            {filteredCollectionOptions.map((collection) => (
              <label class="method-product-picker__facet-radio" key={collection.id}>
                <input
                  type="radio"
                  name="product-collection-filter"
                  value={collection.id}
                  checked={collectionId === collection.id}
                  onChange={() => {
                    setCollectionId(collection.id);
                    setPage(0);
                  }}
                />
                <span class="method-product-picker__facet-value-label">{collection.title}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <s-paragraph>{t('methods:picker.noCollections')}</s-paragraph>
        )}
      </div>
    </div>
  );
  const tagFilterPanel = (
    <div class="method-product-picker__filter-panel">
      <div class="method-product-picker__facet-header">
        <s-button
          variant="tertiary"
          icon="chevron-left"
          accessibilityLabel={t('methods:picker.backToFilters')}
          onClick={returnToFilterChoices}
        />
        <s-text type="strong">{t('methods:picker.tags')}</s-text>
        {tag && (
          <s-button variant="tertiary" onClick={clearTagFilter}>
            {t('methods:picker.clear')}
          </s-button>
        )}
      </div>
      <s-search-field
        id="method-product-tag-filter-query"
        name="method-product-tag-filter-query"
        label={t('methods:picker.searchTags')}
        labelAccessibilityVisibility="exclusive"
        placeholder={t('methods:picker.searchTags')}
        value={tagFilterQuery}
        autocomplete="off"
        onInput={(event) => setTagFilterQuery(event.currentTarget.value)}
      />
      <div class="method-product-picker__filter-options">
        {filteredTagOptions.length ? (
          <fieldset class="method-product-picker__facet-radio-list" aria-label={t('methods:picker.tags')}>
            {filteredTagOptions.map((item) => (
              <label class="method-product-picker__facet-radio" key={item}>
                <input
                  type="radio"
                  name="product-tag-filter"
                  value={item}
                  checked={tag === item}
                  onChange={() => {
                    setTag(item);
                    setPage(0);
                  }}
                />
                <span class="method-product-picker__facet-value-label">{item}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <s-paragraph>{t('methods:picker.noTags')}</s-paragraph>
        )}
      </div>
    </div>
  );

  return (
    <MethodDialog
      heading={
        browse === 'products'
          ? t('methods:workflow.assignment.selectProducts')
          : t('methods:workflow.assignment.selectCollections')
      }
      size="base"
      padding="none"
      suspended={suspended}
      onClose={onClose}
      actions={
        browse === 'products' ? (
          <s-button slot="primary-action" variant="primary" disabled={!selectionChanged} onClick={() => onApply(ids)}>
            {t('methods:picker.select')}
          </s-button>
        ) : (
          <s-button
            slot="primary-action"
            variant="primary"
            disabled={!selectedCollectionIds.length || !newCollectionProductCount}
            onClick={() => onApply([...new Set([...ids, ...selectedCollectionProducts.keys()])])}
          >
            {t('methods:picker.addProducts')}
          </s-button>
        )
      }
    >
      <div class="method-product-picker">
        {browse === 'products' ? (
          <>
            <AdminPickerToolbar
              id="method-product-picker"
              searchLabel={t('methods:picker.searchProducts')}
              query={query}
              resultStatus={t('methods:picker.matchingProducts', {
                count: filteredProducts.length,
                formattedCount: numberFormat.format(filteredProducts.length),
              })}
              onQueryChange={(value) => {
                setQuery(value);
                setPage(0);
              }}
              searchBy={{
                value: searchBy,
                options: [
                  { value: 'all', label: t('methods:picker.searchBy.all') },
                  { value: 'title', label: t('methods:picker.searchBy.productTitle') },
                  { value: 'id', label: t('methods:picker.searchBy.productId') },
                ],
                onChange: (value) => {
                  setSearchBy(value === 'title' || value === 'id' ? value : 'all');
                  setPage(0);
                },
              }}
              filter={
                options.collections.length || options.tags.length
                  ? {
                      label: t('methods:picker.addFilter'),
                      inlineSize: filterView === 'facets' ? '100px' : '280px',
                      onOpen: () => {
                        setFilterView('facets');
                        focusFilterChoice();
                      },
                      content:
                        filterView === 'facets' ? (
                          <div id="method-product-picker-filter-content" class="method-product-picker__filter-menu">
                            {options.collections.length > 0 && (
                              <s-clickable
                                type="button"
                                inlineSize="100%"
                                padding="small-400"
                                borderRadius="base"
                                onClick={() => showFacet('collection')}
                              >
                                <span class="method-product-picker__filter-choice-label">
                                  {t('methods:picker.collection')}
                                </span>
                              </s-clickable>
                            )}
                            {options.tags.length > 0 && (
                              <s-clickable
                                type="button"
                                inlineSize="100%"
                                padding="small-400"
                                borderRadius="base"
                                onClick={() => showFacet('tag')}
                              >
                                <span class="method-product-picker__filter-choice-label">
                                  {t('methods:picker.tags')}
                                </span>
                              </s-clickable>
                            )}
                          </div>
                        ) : filterView === 'collection' ? (
                          <div id="method-product-picker-filter-content">{collectionFilterPanel}</div>
                        ) : (
                          <div id="method-product-picker-filter-content">{tagFilterPanel}</div>
                        ),
                    }
                  : undefined
              }
              appliedFilters={
                filterCount > 0 && (
                  <>
                    {activeCollection && (
                      <s-clickable-chip
                        key="collection-filter-chip"
                        removable
                        commandFor="method-product-picker-filters"
                        command="--show"
                        accessibilityLabel={t('methods:picker.editCollectionFilter')}
                        onClick={() => showFacet('collection')}
                        onRemove={() => removeFacetFilter('collection')}
                      >
                        <span class="method-product-picker__applied-chip-label">
                          {t('methods:picker.collectionFilter', { collectionName: activeCollection.title })}
                        </span>
                      </s-clickable-chip>
                    )}
                    {tag && (
                      <s-clickable-chip
                        key="tag-filter-chip"
                        removable
                        commandFor="method-product-picker-filters"
                        command="--show"
                        accessibilityLabel={t('methods:picker.editTagFilter')}
                        onClick={() => showFacet('tag')}
                        onRemove={() => removeFacetFilter('tag')}
                      >
                        <span class="method-product-picker__applied-chip-label">
                          {t('methods:picker.tagFilter', { tagName: tag })}
                        </span>
                      </s-clickable-chip>
                    )}
                  </>
                )
              }
            />
            <div class="method-product-picker__selection-tools">
              <s-button
                variant="tertiary"
                disabled={!ids.length || ids.length === unavailableSelectedCount}
                onClick={() => {
                  setSelectedOnly((value) => !value);
                  setPage(0);
                }}
              >
                {selectedOnly ? t('methods:picker.showAllResults') : t('methods:picker.showSelected')}
              </s-button>
              <s-button variant="tertiary" disabled={!ids.length} onClick={() => setIds([])}>
                {t('methods:picker.clearSelection')}
              </s-button>
            </div>
            {visibleProducts.length > 0 && (
              <div class="method-product-picker__page-selection">
                <s-checkbox
                  label={t('methods:picker.selectAllProducts')}
                  checked={allShown}
                  indeterminate={someShown}
                  onChange={() =>
                    setIds((current) =>
                      allShown
                        ? current.filter((id) => !visibleProducts.some((product) => product.id === id))
                        : [...new Set([...current, ...visibleProducts.map((product) => product.id)])],
                    )
                  }
                />
              </div>
            )}
            <div
              class={`method-product-picker__list${visibleProducts.length ? '' : ' method-product-picker__list--empty'}`}
            >
              {visibleProducts.length ? (
                visibleProducts.map((product) => {
                  return (
                    // The checkbox is the keyboard target; this only extends its pointer target to the visible row.
                    // biome-ignore lint/a11y/noStaticElementInteractions: The nested Polaris checkbox remains keyboard-operable.
                    // biome-ignore lint/a11y/useKeyWithClickEvents: Keyboard activation stays on the nested Polaris checkbox.
                    <div
                      key={product.id}
                      class="method-product-picker__product-row"
                      onClick={(event) => {
                        if (
                          event.composedPath().some((node) => node instanceof Element && node.tagName === 'S-CHECKBOX')
                        )
                          return;
                        setIds((current) =>
                          current.includes(product.id)
                            ? current.filter((id) => id !== product.id)
                            : [...current, product.id],
                        );
                      }}
                    >
                      <s-checkbox
                        id={`picker-product-${product.id}`}
                        label={product.title}
                        labelAccessibilityVisibility="exclusive"
                        checked={selectedIds.has(product.id)}
                        onChange={(event) =>
                          setIds((current) =>
                            event.currentTarget.checked
                              ? [...new Set([...current, product.id])]
                              : current.filter((id) => id !== product.id),
                          )
                        }
                      />
                      <s-thumbnail src={product.image} alt="" size="small" />
                      <s-text>{product.title}</s-text>
                    </div>
                  );
                })
              ) : (
                <div class="method-product-picker__empty-state">
                  <s-empty-state heading={productEmptyHeading}>
                    {productEmptyState === 'catalog' && <s-icon slot="graphic" type="product" />}
                    <s-text slot="subheading">{productEmptyDescription}</s-text>
                    {productEmptyState !== 'catalog' && (
                      <s-button
                        slot="secondary-actions"
                        variant="secondary"
                        onClick={() => {
                          clearProductFilters();
                          focusPickerQuery();
                        }}
                      >
                        {t('methods:picker.showAllProducts')}
                      </s-button>
                    )}
                  </s-empty-state>
                </div>
              )}
            </div>
            <div class="method-product-picker__footer">
              <div role="status" aria-atomic="true">
                <s-text>
                  {unavailableSelectedCount
                    ? t('methods:picker.selectedWithUnavailable', {
                        count: unavailableSelectedCount,
                        formattedSelectedCount: numberFormat.format(ids.length),
                        formattedUnavailableCount: numberFormat.format(unavailableSelectedCount),
                      })
                    : t('methods:picker.selected', {
                        count: ids.length,
                        formattedCount: numberFormat.format(ids.length),
                      })}
                </s-text>
              </div>
              {productPages > 1 && (
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-button
                    icon="chevron-left"
                    accessibilityLabel={t('methods:picker.previousProducts')}
                    disabled={!currentProductPage}
                    onClick={() => setPage(currentProductPage - 1)}
                  />
                  <s-text>
                    {t('methods:picker.pageRange', {
                      first: numberFormat.format(currentProductPage * 25 + 1),
                      last: numberFormat.format(Math.min((currentProductPage + 1) * 25, filteredProducts.length)),
                      formattedCount: numberFormat.format(filteredProducts.length),
                    })}
                  </s-text>
                  <s-button
                    icon="chevron-right"
                    accessibilityLabel={t('methods:picker.nextProducts')}
                    disabled={currentProductPage + 1 >= productPages}
                    onClick={() => setPage(currentProductPage + 1)}
                  />
                </s-stack>
              )}
            </div>
          </>
        ) : (
          <>
            <div class="method-product-picker__collection-toolbar">
              <s-search-field
                id="method-product-picker-query"
                name="method-product-picker-query"
                label={t('methods:picker.searchCollections')}
                labelAccessibilityVisibility="exclusive"
                placeholder={t('methods:picker.searchCollections')}
                details={t('methods:picker.collectionsDetail')}
                value={collectionQuery}
                maxLength={100}
                autocomplete="off"
                onInput={(event) => {
                  setCollectionQuery(event.currentTarget.value);
                  setCollectionPage(0);
                }}
              />
            </div>
            <div class="method-product-picker__collection-table">
              <table aria-label={t('methods:picker.collections')}>
                <colgroup>
                  <col class="method-product-picker__collection-checkbox-col" />
                  <col class="method-product-picker__collection-image-col" />
                  <col />
                  <col class="method-product-picker__collection-count-col" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col" colSpan={3}>
                      {t('methods:picker.collection')}
                    </th>
                    <th scope="col">{t('methods:picker.products')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCollections.length ? (
                    visibleCollections.map((collection) => {
                      const isSelected = selectedCollectionSet.has(collection.id);
                      return (
                        <tr
                          key={collection.id}
                          aria-selected={isSelected}
                          onClick={(event) => {
                            if (
                              event
                                .composedPath()
                                .some((node) => node instanceof Element && node.tagName === 'S-CHECKBOX')
                            )
                              return;
                            setSelectedCollectionIds((current) =>
                              current.includes(collection.id)
                                ? current.filter((id) => id !== collection.id)
                                : [...current, collection.id],
                            );
                          }}
                        >
                          <td class="method-product-picker__collection-checkbox">
                            <s-checkbox
                              label={collection.title}
                              labelAccessibilityVisibility="exclusive"
                              checked={isSelected}
                              onChange={(event) =>
                                setSelectedCollectionIds((current) =>
                                  event.currentTarget.checked
                                    ? [...new Set([...current, collection.id])]
                                    : current.filter((id) => id !== collection.id),
                                )
                              }
                            />
                          </td>
                          <td class="method-product-picker__collection-image">
                            <s-thumbnail src={collection.products[0]?.image ?? ''} alt="" size="small" />
                          </td>
                          <th scope="row" class="method-product-picker__collection-title">
                            <s-text>{collection.title}</s-text>
                            <span class="method-product-picker__collection-mobile-count">
                              <s-text>
                                {t('methods:index.counts.products', {
                                  count: collection.products.length,
                                  formattedCount: numberFormat.format(collection.products.length),
                                })}
                              </s-text>
                            </span>
                          </th>
                          <td class="method-product-picker__collection-count">
                            <s-text>{numberFormat.format(collection.products.length)}</s-text>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={4} class="method-product-picker__empty">
                        <s-paragraph>
                          {collectionQuery
                            ? t('methods:picker.noCollections')
                            : t('methods:picker.noCollectionsWithProducts')}
                        </s-paragraph>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {(selectedCollectionIds.length > 0 || collectionPages > 1) && (
              <div class="method-product-picker__footer method-product-picker__collection-footer">
                {selectedCollectionIds.length > 0 && (
                  <div class="method-product-picker__collection-status" role="status" aria-atomic="true">
                    {newCollectionProductCount
                      ? t('methods:picker.collectionsSelectedAdding', {
                          count: selectedCollectionIds.length,
                          formattedCollectionCount: numberFormat.format(selectedCollectionIds.length),
                          formattedNewProductCount: numberFormat.format(newCollectionProductCount),
                        })
                      : t('methods:picker.collectionsSelectedAllAlready', {
                          count: selectedCollectionIds.length,
                          formattedCollectionCount: numberFormat.format(selectedCollectionIds.length),
                        })}
                  </div>
                )}
                <div class="method-product-picker__collection-footer-actions">
                  {selectedCollectionIds.length > 0 && (
                    <s-button variant="tertiary" onClick={() => setSelectedCollectionIds([])}>
                      {t('methods:picker.clearSelection')}
                    </s-button>
                  )}
                  {collectionPages > 1 && (
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-button
                        icon="chevron-left"
                        accessibilityLabel={t('methods:picker.previousCollections')}
                        disabled={!currentCollectionPage}
                        onClick={() => setCollectionPage(currentCollectionPage - 1)}
                      />
                      <s-text>
                        {t('methods:picker.pageRange', {
                          first: numberFormat.format(currentCollectionPage * 25 + 1),
                          last: numberFormat.format(
                            Math.min((currentCollectionPage + 1) * 25, filteredCollections.length),
                          ),
                          formattedCount: numberFormat.format(filteredCollections.length),
                        })}
                      </s-text>
                      <s-button
                        icon="chevron-right"
                        accessibilityLabel={t('methods:picker.nextCollections')}
                        disabled={currentCollectionPage + 1 >= collectionPages}
                        onClick={() => setCollectionPage(currentCollectionPage + 1)}
                      />
                    </s-stack>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </MethodDialog>
  );
}
