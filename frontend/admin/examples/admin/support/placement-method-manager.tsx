import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { useAdminLocale } from '../../../src/shared/admin-i18n.js';
import Dialog from './method-dialog.tsx';
import { DecimalField } from '../../../src/components/DecimalField.tsx';
import { currencyPrefix, formatPrice, parsePrice } from './method-workflow-prices.mts';
import { availablePlacementMethods, type PlacementMethodCatalog } from '../../../src/islands/selected-method-choices.ts';
import {
  createPlacementMethodManagerState,
  type PlacementMethodManagerError,
  type PlacementMethodManagerEvent,
  type PlacementMethodNameError,
  placementMethodManagerReducer,
} from './placement-method-manager-state.mts';
import type { EditorMethod, EditorPlacement, PlacementProduct } from './placement-workflow-model.mts';

type MethodChanges = Pick<EditorPlacement, 'methodIds' | 'sizes'>;

function priceLabel(value: string, t: ReturnType<typeof useAdminLocale>['t'], locale: string, currency = 'EUR'): string {
  const result = parsePrice(value);
  if (result.kind === 'invalid') return t('editor:placementMethodManager.priceUnavailable');
  return result.minor === 0n ? t('editor:placementMethodManager.free') : formatPrice(result.minor, locale, currency);
}

function sizeCoverage(
  methodId: string,
  sizes: MethodChanges['sizes'],
  t: ReturnType<typeof useAdminLocale>['t'],
  locale: string,
): string {
  const priced = sizes.filter((size) => parsePrice(size.prices[methodId] ?? '').kind === 'valid').length;
  return t('editor:placementMethodManager.sizeCoverage', {
    count: sizes.length,
    priced: new Intl.NumberFormat(locale).format(priced),
    total: new Intl.NumberFormat(locale).format(sizes.length),
  });
}

function priceState(value: string): 'not-offered' | 'price-invalid' | 'free' | null {
  if (!value.trim()) return 'not-offered';
  const result = parsePrice(value);
  if (result.kind === 'invalid') return 'price-invalid';
  return result.minor === 0n ? 'free' : null;
}

function nameErrorMessage(reason: PlacementMethodNameError | null, t: ReturnType<typeof useAdminLocale>['t']): string {
  if (reason === 'name-invalid') return t('editor:placementMethodManager.nameInvalid');
  if (reason === 'name-duplicate') return t('editor:placementMethodManager.nameDuplicate');
  if (reason === 'method-add-failed') return t('editor:placementMethodManager.methodAddFailed');
  return '';
}

function managerErrorMessage(
  reason: PlacementMethodManagerError | null,
  t: ReturnType<typeof useAdminLocale>['t'],
): string {
  return reason === 'price-invalid'
    ? t('editor:placementMethodManager.priceInvalid')
    : reason === 'methods-unavailable'
      ? t('editor:placementMethodManager.methodsUnavailable')
      : '';
}

function priceStateMessage(reason: ReturnType<typeof priceState>, t: ReturnType<typeof useAdminLocale>['t']): string {
  if (reason === 'not-offered') return t('editor:placementMethodManager.priceStates.not-offered');
  if (reason === 'price-invalid') return t('editor:placementMethodManager.priceStates.price-invalid');
  return reason === 'free' ? t('editor:placementMethodManager.priceStates.free') : '';
}

export default function PlacementMethodManager({
  methods: initialMethods,
  product,
  onOpenLibrary,
  placement,
  initialMethodId,
  sessionId,
  targetRevision,
  onClose,
  onApply,
  loadCatalog,
  currency = 'EUR',
}: {
  currency?: string;
  loadCatalog: (signal: AbortSignal) => Promise<PlacementMethodCatalog>;
  methods: EditorMethod[];
  product?: PlacementProduct;
  onOpenLibrary?(): void;
  placement: EditorPlacement;
  initialMethodId?: string;
  sessionId: string;
  targetRevision: number;
  onClose(): void;
  onApply(change: MethodChanges, choices: EditorMethod[], editedIds: string[], editedCells: { sizeId: string; methodId: string }[]): void;
}) {
  const { t: translateUi, formatLocale } = useAdminLocale();
  const initialState = useMemo(
    () =>
      createPlacementMethodManagerState({
        sessionId,
        productId: product?.id ?? '',
        placement,
        targetRevision,
        methods: initialMethods,
        catalogLoaded: !product,
        ...(initialMethodId ? { initialMethodId } : {}),
      }),
    [initialMethodId, initialMethods, placement, product, sessionId, targetRevision],
  );
  const [state, dispatch] = useReducer(placementMethodManagerReducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const nextCatalogRequestId = useRef(0);
  const claimedCommit = useRef(false);
  function send(event: PlacementMethodManagerEvent) {
    const next = placementMethodManagerReducer(stateRef.current, event);
    stateRef.current = next;
    dispatch(event);
    return next;
  }
  const methods = state.methods;
  const draft = state.draft;
  const library = state.catalog.kind;
  const newName = state.createName;
  const nameError = state.nameError;
  const screen = state.screen;
  const errors = state.errors;
  const unavailableError = state.unavailableError;
  const hasInitialPriceMethod = initialState.screen.kind === 'prices';
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'enabled'>('all');
  const unavailableIds = draft.methodIds.filter((id) => !methods.some((method) => method.id === id));
  const list = useRef<HTMLDivElement>(null);
  // Enter in the name field adds the method, like the primary action. Polaris types carry no key handler.
  const nameField = useRef<HTMLElementTagNameMap['s-text-field']>(null);
  const addByEnter = useRef(() => {});
  useEffect(() => {
    const field = nameField.current;
    if (!field) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      addByEnter.current();
    };
    field.addEventListener('keydown', onKeyDown);
    return () => field.removeEventListener('keydown', onKeyDown);
  }, [screen.kind]);
  const savedScrollTop = useRef(0);
  const returnFocusMethodId = useRef<string | null>(null);
  const restoreList = useRef(false);
  const focusPriceInput = useRef<'first' | 'invalid' | null>(screen.kind === 'prices' ? 'first' : null);

  const visibleMethods = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(formatLocale);
    return methods.filter(
      (method) =>
        (filter === 'all' || draft.methodIds.includes(method.id)) &&
        method.name.toLocaleLowerCase(formatLocale).includes(normalizedQuery),
    );
  }, [draft.methodIds, filter, methods, query]);
  const activeMethod = screen.kind === 'prices' ? methods.find((method) => method.id === screen.methodId) : undefined;
  const simpleForm = screen.kind === 'create' || (screen.kind === 'prices' && activeMethod?.pricing === 'fixed');
  const enabledCount = draft.methodIds.length;
  const emptyLibrary = library === 'ready' && methods.length === 0 && placement.methodIds.length === 0;
  const heading =
    screen.kind === 'create'
      ? translateUi('editor:placementMethodManager.addMethod')
      : screen.kind === 'prices'
        ? activeMethod?.pricing === 'fixed'
          ? translateUi('editor:placementMethodManager.fixedPriceHeading', {
              methodName: activeMethod?.name ?? translateUi('editor:placementMethodManager.methodFallback'),
            })
          : translateUi('editor:placementMethodManager.variablePriceHeading', {
              methodName: activeMethod?.name ?? translateUi('editor:placementMethodManager.methodFallback'),
            })
        : emptyLibrary
          ? translateUi('editor:placementMethodManager.noMethodsAvailable')
          : translateUi('editor:placementMethodManager.selectDecorationMethods');

  const catalogRequestId = state.catalog.kind === 'loading' ? state.catalog.requestId : null;
  useEffect(() => {
    if (!product || catalogRequestId === null) return;
    const controller = new AbortController();
    void loadCatalog(AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]))
      .then((catalog) => {
        if (controller.signal.aborted) return;
        send({
          type: 'catalog-loaded',
          sessionId,
          requestId: catalogRequestId,
          methods: availablePlacementMethods(product, catalog),
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) send({ type: 'catalog-failed', sessionId, requestId: catalogRequestId });
      });
    return () => controller.abort();
  }, [sessionId, product?.id, catalogRequestId]);

  useLayoutEffect(() => {
    if (screen.kind === 'create') {
      const frame = requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[data-new-product-method]')?.focus(),
      );
      return () => cancelAnimationFrame(frame);
    }
    if (screen.kind === 'methods' && restoreList.current) {
      restoreList.current = false;
      const results = list.current;
      if (!results) return;
      results.scrollTop = savedScrollTop.current;
      const trigger = Array.from(results.querySelectorAll<HTMLElement>('[data-method-price-trigger]')).find(
        (element) => element.dataset.methodPriceTrigger === returnFocusMethodId.current,
      );
      (trigger ?? results.querySelector<HTMLElement>('s-checkbox'))?.focus({ preventScroll: true });
      return;
    }

    if (screen.kind !== 'prices' || !focusPriceInput.current) return;
    const focusTarget = focusPriceInput.current;
    focusPriceInput.current = null;
    const firstFrame = requestAnimationFrame(() => {
      const field =
        focusTarget === 'invalid'
          ? document.querySelector<HTMLElement>('[data-method-price-invalid="true"]')
          : document.querySelector<HTMLElement>('[data-method-price-field]');
      field?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(firstFrame);
  }, [errors, screen]);

  function createProductMethod() {
    const current = stateRef.current;
    if (current.screen.kind !== 'create' || current.status !== 'open') return;
    const method: EditorMethod = {
      id: crypto.randomUUID(),
      name: current.createName.trim(),
      pricing: 'product',
      amount: '',
    };
    const next = send({
      type: 'product-method-created',
      sessionId,
      name: current.createName,
      method,
    });
    if (next.nameError) return;
    setQuery('');
    setFilter('all');
    focusPriceInput.current = 'first';
  }

  addByEnter.current = createProductMethod;

  function openPrices(methodId: string) {
    if (!stateRef.current.draft.methodIds.includes(methodId)) return;
    savedScrollTop.current = list.current?.scrollTop ?? 0;
    returnFocusMethodId.current = methodId;
    focusPriceInput.current = 'first';
    send({ type: 'prices-screen-opened', sessionId, methodId });
  }

  function backToMethods() {
    restoreList.current = true;
    send({ type: 'methods-screen-selected', sessionId });
  }

  function toggleMethod(methodId: string, checked: boolean) {
    send({ type: 'method-toggled', sessionId, methodId, checked });
  }

  function updatePrice(sizeId: string, methodId: string, value: string) {
    send({ type: 'size-price-edited', sessionId, sizeId, methodId, value });
  }

  function apply() {
    const current = stateRef.current;
    if (current.status !== 'open' || claimedCommit.current) return;
    const next = send({ type: 'apply-requested', sessionId });
    if (next.status !== 'applied' || !next.applied) {
      const invalidMethodId = next.screen.kind === 'prices' ? next.screen.methodId : undefined;
      if (invalidMethodId) {
        setQuery('');
        setFilter('all');
        savedScrollTop.current = 0;
        returnFocusMethodId.current = invalidMethodId;
        focusPriceInput.current = 'invalid';
      }
      return;
    }
    claimedCommit.current = true;
    onApply(structuredClone(next.applied.change), next.applied.choices, next.applied.editedIds, next.applied.editedCells);
    onClose();
  }

  return (
    <Dialog
      heading={heading}
      padding={simpleForm ? 'base' : 'none'}
      size={
        screen.kind === 'create'
          ? 'small-100'
          : screen.kind === 'prices'
            ? activeMethod?.pricing !== 'fixed' && draft.sizes.length > 6
              ? 'base'
              : 'small-100'
            : methods.length > 6
              ? 'large'
              : 'small-100'
      }
      onClose={onClose}
      onBack={screen.kind !== 'methods' && !hasInitialPriceMethod ? backToMethods : undefined}
      actions={
        screen.kind === 'create' ? (
          <s-button slot="primary-action" variant="primary" disabled={!newName.trim()} onClick={createProductMethod}>
            {translateUi('editor:placementMethodManager.addMethod')}
          </s-button>
        ) : emptyLibrary ? (
          <s-button
            slot="primary-action"
            variant="primary"
            onClick={() => send({ type: 'create-screen-opened', sessionId })}
          >
            {translateUi('editor:placementMethodManager.addMethod')}
          </s-button>
        ) : (
          (methods.length > 0 || placement.methodIds.length > 0) && (
            <s-button slot="primary-action" variant="primary" disabled={library === 'loading'} onClick={apply}>
              {translateUi('editor:placementMethodManager.done')}
            </s-button>
          )
        )
      }
    >
      <div
        class={`pm-manager${simpleForm || (screen.kind === 'methods' && methods.length <= 6) || (screen.kind === 'prices' && draft.sizes.length <= 6) ? ' is-compact' : ''}${simpleForm ? ' is-form' : ''}`}
      >
        {screen.kind === 'create' ? (
          <div class="pm-manager__name-form">
            <s-text-field
              data-new-product-method
              label={translateUi('editor:placementMethodManager.methodName')}
              labelAccessibilityVisibility="exclusive"
              placeholder={translateUi('editor:placementMethodManager.methodName')}
              value={newName}
              maxLength={80}
              error={nameErrorMessage(nameError, translateUi)}
              onInput={(event) => send({ type: 'create-name-edited', sessionId, value: event.currentTarget.value })}
              ref={nameField}
              details={translateUi('editor:placementMethodManager.methodNameDetails')}
            />
          </div>
        ) : screen.kind === 'methods' ? (
          <>
            {(methods.length > 0 || unavailableIds.length > 0) && (
              <div class="pm-manager__context">
                <s-text color="subdued">
                  {translateUi('editor:placementMethodManager.forPlacement', {
                    placementName: placement.name || translateUi('editor:placementMethodManager.thisPlacement'),
                  })}
                </s-text>
                <div class="pm-manager__summary" role="status">
                  <s-text>
                    {translateUi('editor:placementMethodManager.enabledMethods', {
                      count: enabledCount,
                      formattedCount: new Intl.NumberFormat(formatLocale).format(enabledCount),
                    })}
                  </s-text>
                </div>
              </div>
            )}
            {methods.length > 6 && (
              <div class="pm-manager__controls">
                <s-search-field
                  label={translateUi('editor:placementMethodManager.searchDecorationMethods')}
                  labelAccessibilityVisibility="exclusive"
                  placeholder={translateUi('editor:placementMethodManager.searchMethods')}
                  value={query}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                />
                <s-select
                  label={translateUi('editor:placementMethodManager.showMethods')}
                  labelAccessibilityVisibility="exclusive"
                  name="placement-method-filter"
                  value={filter}
                  onChange={(event) => setFilter(event.currentTarget.value as 'all' | 'enabled')}
                >
                  <s-option value="all">{translateUi('editor:placementMethodManager.allMethods')}</s-option>
                  <s-option value="enabled">
                    {translateUi('editor:placementMethodManager.enabledMethodsFilter')}
                  </s-option>
                </s-select>
              </div>
            )}
            {!emptyLibrary && library === 'ready' && (
              <div class="pm-manager__create-action">
                <s-button
                  variant="tertiary"
                  icon="plus"
                  onClick={() => send({ type: 'create-screen-opened', sessionId })}
                >
                  {translateUi('editor:placementMethodManager.addMethod')}
                </s-button>
              </div>
            )}
            <div class="pm-manager__results" ref={list} aria-busy={library === 'loading'}>
              {library === 'loading' && !methods.length && (
                <div class="pm-manager__empty">
                  <s-spinner accessibilityLabel={translateUi('editor:placementMethodManager.loadingMethodLibrary')} />
                </div>
              )}
              {library === 'error' && (
                <div class="pm-manager__empty">
                  <s-banner tone="critical">
                    {translateUi(
                      'editor:placementMethodManager.theMethodLibraryCouldNotBeLoadedYourPlacementIsUnchanged',
                    )}
                  </s-banner>
                  <s-button
                    variant="secondary"
                    onClick={() => {
                      const requestId = ++nextCatalogRequestId.current;
                      send({ type: 'catalog-retry-requested', sessionId, requestId });
                    }}
                  >
                    {translateUi('editor:placementMethodManager.tryAgain')}
                  </s-button>
                </div>
              )}
              <div class="pm-manager__method-list">
                {unavailableError && (
                  <s-banner tone="critical">{managerErrorMessage(unavailableError, translateUi)}</s-banner>
                )}
                {library !== 'loading' &&
                  unavailableIds.map((id, index) => (
                    <fieldset class="pm-manager__method" key={id}>
                      <s-checkbox
                        label={translateUi('editor:placementMethodManager.unavailableMethod', {
                          count: unavailableIds.length,
                          number: new Intl.NumberFormat(formatLocale).format(index + 1),
                        })}
                        checked
                        onChange={(event) => toggleMethod(id, event.currentTarget.checked)}
                      />
                      <s-text color="subdued">
                        {translateUi('editor:placementMethodManager.uncheckToRemoveThisMissingMethod')}
                      </s-text>
                    </fieldset>
                  ))}
                {visibleMethods.map((method) => {
                  const enabled = draft.methodIds.includes(method.id);
                  const fixed = method.pricing === 'fixed';
                  return (
                    <fieldset
                      class={`pm-manager__method ${fixed ? 'is-fixed-method' : 'is-product-method'} ${enabled ? 'is-enabled' : ''}`}
                      key={method.id}
                      aria-label={method.name}
                    >
                      <div class="pm-manager__choice">
                        <s-checkbox
                          label={method.name}
                          checked={enabled}
                          onChange={(event) => toggleMethod(method.id, event.currentTarget.checked)}
                        />
                      </div>
                      {fixed ? (
                        <div class="pm-manager__method-facts">
                          <s-text type="strong">{priceLabel(method.amount, translateUi, formatLocale, currency)}</s-text>
                          {enabled && (
                            <s-button
                              variant="tertiary"
                              data-method-price-trigger={method.id}
                              accessibilityLabel={translateUi('editor:placementMethodManager.editMethodPrice', {
                                methodName: method.name,
                              })}
                              onClick={() => openPrices(method.id)}
                            >
                              {translateUi('editor:placementMethodManager.editPrice')}
                            </s-button>
                          )}
                        </div>
                      ) : enabled ? (
                        <div class="pm-manager__product-price">
                          <div class="pm-manager__coverage">
                            <s-text color="subdued">
                              {sizeCoverage(method.id, draft.sizes, translateUi, formatLocale)}
                            </s-text>
                          </div>
                          <div class="pm-manager__price-action">
                            <s-button
                              variant="tertiary"
                              data-method-price-trigger={method.id}
                              onClick={() => openPrices(method.id)}
                            >
                              {translateUi('editor:placementMethodManager.editPrices')}
                            </s-button>
                          </div>
                        </div>
                      ) : (
                        <div class="pm-manager__method-type">
                          <s-text color="subdued">{translateUi('editor:placementMethodManager.perSize')}</s-text>
                        </div>
                      )}
                    </fieldset>
                  );
                })}
                {visibleMethods.length === 0 &&
                  (methods.length > 0 || library === 'ready') &&
                  (methods.length === 0 ? (
                    <div class="pm-manager__empty">
                      <s-paragraph>
                        {translateUi(
                          'editor:placementMethodManager.addAMethodForThisProductOrCreateAReusableMethodInYourLibrary',
                        )}
                      </s-paragraph>
                      {onOpenLibrary && (
                        <s-button variant="secondary" onClick={onOpenLibrary}>
                          {translateUi('editor:placementMethodManager.saveDraftAndOpenLibrary')}
                        </s-button>
                      )}
                    </div>
                  ) : (
                    <div class="pm-manager__empty">
                      <s-paragraph>
                        {translateUi('editor:placementMethodManager.noMethodsMatchTheseFilters')}
                      </s-paragraph>
                      <s-button
                        variant="tertiary"
                        onClick={() => {
                          setQuery('');
                          setFilter('all');
                        }}
                      >
                        {translateUi('editor:placementMethodManager.showAllMethods')}
                      </s-button>
                    </div>
                  ))}
              </div>
            </div>
          </>
        ) : (
          <section
            class="pm-manager__price-screen"
            aria-label={translateUi('editor:placementMethodManager.pricesForMethod', {
              methodName: activeMethod?.name ?? translateUi('editor:placementMethodManager.methodFallback'),
            })}
          >
            {activeMethod?.pricing !== 'fixed' && (
              <div class="pm-manager__price-heading">
                <s-text color="subdued">{sizeCoverage(screen.methodId, draft.sizes, translateUi, formatLocale)}</s-text>
              </div>
            )}
            <div class={activeMethod?.pricing === 'fixed' ? 'pm-manager__price-form' : 'pm-manager__price-list'}>
              {activeMethod?.pricing === 'fixed' ? (
                <s-stack gap="base">
                  <s-paragraph>
                    {translateUi('editor:placementMethodManager.fixedPriceDetails', { methodName: activeMethod.name })}
                  </s-paragraph>
                  <DecimalField
                    kind="price"
                    label={translateUi('editor:placementMethodManager.pricePerPlacementPerGarment')}
                    prefix={currencyPrefix(currency)}
                    value={activeMethod.amount}
                    error={managerErrorMessage(errors[activeMethod.id] ?? null, translateUi)}
                    details={translateUi('editor:placementMethodManager.freePriceDetails')}
                    data-method-price-field
                    data-method-price-invalid={!!errors[activeMethod.id]}
                    onValue={(amount) => {
                      send({
                        type: 'fixed-price-edited',
                        sessionId,
                        methodId: activeMethod.id,
                        amount,
                      });
                    }}
                  />
                </s-stack>
              ) : draft.sizes.length ? (
                draft.sizes.map((size) => {
                  const value = size.prices[screen.methodId] ?? '';
                  const key = `${size.id}:${screen.methodId}`;
                  const error = managerErrorMessage(errors[key] ?? null, translateUi);
                  const stateReason = priceState(value);
                  return (
                    <div class="pm-manager__price-row" key={size.id}>
                      <div class="pm-manager__size-label">
                        <s-text type="strong">
                          {size.name || translateUi('editor:placementMethodManager.unnamedSize')}
                        </s-text>
                        {stateReason && <s-text color="subdued">{priceStateMessage(stateReason, translateUi)}</s-text>}
                      </div>
                      <DecimalField
                        kind="price"
                        label={translateUi('editor:placementMethodManager.priceForSize', {
                          sizeName: size.name || translateUi('editor:placementMethodManager.sizeFallback'),
                        })}
                        labelAccessibilityVisibility="exclusive"
                        prefix={currencyPrefix(currency)}
                        value={value}
                        placeholder={translateUi('editor:placementMethodManager.notOffered')}
                        error={error}
                        data-method-price-field
                        data-method-price-invalid={!!error}
                        onValue={(text) => updatePrice(size.id, screen.methodId, text)}
                      />
                    </div>
                  );
                })
              ) : (
                <s-paragraph>
                  {translateUi('editor:placementMethodManager.noDecorationSizesAreAvailableForThisPlacement')}
                </s-paragraph>
              )}
              {activeMethod?.pricing !== 'fixed' && (
                <s-text color="subdued">
                  {translateUi(
                    'editor:placementMethodManager.leaveAPriceBlankToMarkTheSizeNotOfferedEnter0ToMakeItFree',
                  )}
                </s-text>
              )}
            </div>
          </section>
        )}
      </div>
    </Dialog>
  );
}
