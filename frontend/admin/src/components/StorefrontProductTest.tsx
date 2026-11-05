import { useEffect, useRef, useState } from 'preact/hooks';
import { useAdminLocale } from '../shared/admin-i18n.js';
import { authenticatedJson } from '../shared/admin-request';
import { useTextOverflow } from '../shared/admin-text-overflow';
import {
  parseStorefrontTestSelection,
  requestedStorefrontTestProductId,
  type StorefrontTestProduct,
  storefrontProductTestEligibility,
  storefrontProductTestHref,
  storefrontProductTestSetupHref,
} from '../shared/storefront-product-test';

type TestState =
  | { kind: 'idle' }
  | { kind: 'checking' | 'published' | 'unpublished'; product: StorefrontTestProduct }
  | {
      kind: 'error';
      product?: StorefrontTestProduct;
      reason: 'product-unavailable' | 'access-denied' | 'check-failed' | 'selection-failed';
    };
type Picker = (options: {
  type: 'product';
  action: 'select';
  multiple: false;
  filter: { variants: false; hidden: false; draft: false; archived: false };
  selectionIds: { id: string }[];
}) => Promise<unknown>;

export default function StorefrontProductTest({ editor }: { editor: string | null }) {
  const { t } = useAdminLocale();
  const [state, setState] = useState<TestState>({ kind: 'idle' });
  const [pickerAvailable, setPickerAvailable] = useState(false);
  const [picking, setPicking] = useState(false);
  const activePicker = useRef(false);
  const selected = useRef<StorefrontTestProduct | null>(null);
  const requestedProductId = useRef(
    typeof window === 'undefined' ? null : requestedStorefrontTestProductId(window.location.search),
  );
  const sequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const region = useRef<HTMLElement>(null);
  const retryFocus = useRef(false);
  const verifyRef = useRef<(product: StorefrontTestProduct) => void>(() => {});
  const storageKey = editor ? `insignia-storefront-test-v1:${new URL(editor).hostname}` : null;

  function remember(product: StorefrontTestProduct | null) {
    if (!storageKey) return;
    try {
      if (product) sessionStorage.setItem(storageKey, JSON.stringify(product));
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* Storage is optional; verification still uses the current authenticated read. */
    }
  }
  async function verify(product: StorefrontTestProduct) {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const request = ++sequence.current;
    selected.current = product;
    setState({ kind: 'checking', product });
    const id = product.id.slice('gid://shopify/Product/'.length);
    try {
      const value = await authenticatedJson<unknown>(`/api/admin/products/${id}/config`, { signal: controller.signal });
      if (request !== sequence.current) return;
      const eligibility = storefrontProductTestEligibility(value, product.id);
      setState(
        eligibility === 'invalid' ? { kind: 'error', product, reason: 'check-failed' } : { kind: eligibility, product },
      );
    } catch (error) {
      if (controller.signal.aborted || request !== sequence.current) return;
      const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
      if (status === 401 || status === 403 || status === 404) {
        selected.current = null;
        remember(null);
        setState({
          kind: 'error',
          reason: status === 404 ? 'product-unavailable' : 'access-denied',
        });
      } else {
        setState({
          kind: 'error',
          product,
          reason: 'check-failed',
        });
      }
    }
  }
  verifyRef.current = (product) => {
    void verify(product);
  };

  useEffect(() => {
    const picker = (window as unknown as { shopify?: { resourcePicker?: Picker } }).shopify?.resourcePicker;
    setPickerAvailable(typeof picker === 'function');
    if (!storageKey) return;
    // An editor handoff must not revive an unrelated cached product or its verified link.
    if (!requestedProductId.current) {
      try {
        const cached: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
        const result = parseStorefrontTestSelection([cached]);
        if (result.kind === 'selected') verifyRef.current(result.product);
      } catch {
        /* A stale cached choice cannot establish eligibility. */
      }
    }
    const returned = () => {
      if (!activePicker.current && selected.current && document.visibilityState !== 'hidden')
        verifyRef.current(selected.current);
    };
    window.addEventListener('focus', returned);
    return () => {
      sequence.current++;
      activeRequest.current?.abort();
      window.removeEventListener('focus', returned);
    };
  }, [storageKey]);

  useEffect(() => {
    if (state.kind !== 'checking' && retryFocus.current) {
      retryFocus.current = false;
      region.current?.focus();
    }
  }, [state]);

  useEffect(() => {
    let frame = 0;
    let secondFrame = 0;
    const revealTest = () => {
      if (window.location.hash !== '#test-product' || document.documentElement.dataset.adminContentReady !== 'true')
        return;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(secondFrame);
      frame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          region.current?.scrollIntoView({ block: 'start' });
          region.current?.focus({ preventScroll: true });
        });
      });
    };
    document.addEventListener('insignia:admin-ready', revealTest);
    window.addEventListener('hashchange', revealTest);
    revealTest();
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(secondFrame);
      document.removeEventListener('insignia:admin-ready', revealTest);
      window.removeEventListener('hashchange', revealTest);
    };
  }, []);

  async function choose() {
    const bridge = (window as unknown as { shopify?: { resourcePicker?: Picker } }).shopify;
    if (!bridge?.resourcePicker || activePicker.current) return;
    activePicker.current = true;
    const request = sequence.current;
    setPicking(true);
    try {
      const result = parseStorefrontTestSelection(
        await bridge.resourcePicker({
          type: 'product',
          action: 'select',
          multiple: false,
          filter: { variants: false, hidden: false, draft: false, archived: false },
          selectionIds: selected.current
            ? [{ id: selected.current.id }]
            : requestedProductId.current
              ? [{ id: requestedProductId.current }]
              : [],
        }),
      );
      if (request !== sequence.current) return;
      if (result.kind === 'cancelled') return;
      if (result.kind === 'invalid') {
        setState({ kind: 'error', reason: 'selection-failed' });
        return;
      }
      requestedProductId.current = null;
      if (new URLSearchParams(window.location.search).has('testProduct')) {
        const url = new URL(window.location.href);
        url.searchParams.delete('testProduct');
        window.history.replaceState(window.history.state, '', url);
      }
      remember(result.product);
      void verify(result.product);
    } catch {
      if (request !== sequence.current) return;
      selected.current = null;
      remember(null);
      setState({ kind: 'error', reason: 'selection-failed' });
    } finally {
      activePicker.current = false;
      setPicking(false);
    }
  }

  const product = 'product' in state ? state.product : undefined;
  const titleRef = useRef<HTMLDivElement>(null);
  const titleClipped = useTextOverflow(titleRef, product?.title ?? '');
  const previewHref = state.kind === 'published' ? storefrontProductTestHref(editor, state.product) : null;
  const setupHref = product
    ? `/admin/products/${product.id.slice('gid://shopify/Product/'.length)}/config?${new URLSearchParams({
        returnTo: storefrontProductTestSetupHref(product.id) ?? '/admin/settings/storefront',
      })}`
    : undefined;
  const checking = state.kind === 'checking';
  const errorMessage =
    state.kind === 'error'
      ? state.reason === 'product-unavailable'
        ? t('settings:storefrontTest.errors.productUnavailable')
        : state.reason === 'access-denied'
          ? t('settings:storefrontTest.errors.accessDenied')
          : state.reason === 'selection-failed'
            ? t('settings:storefrontTest.errors.selectionFailed')
            : t('settings:storefrontTest.errors.checkFailed')
      : '';
  return (
    <section
      id="test-product"
      ref={region}
      tabIndex={-1}
      aria-label={t('settings:storefrontTest.region')}
      data-storefront-test-state={state.kind}
    >
      <s-section heading={t('settings:storefrontTest.heading')}>
        <s-stack gap="base">
          <div class="storefront-test__selection">
            <div class="storefront-test__product">
              {product ? (
                <>
                  <div ref={titleRef} class="storefront-test__name">
                    <s-text fontWeight="medium">{product.title}</s-text>
                  </div>
                  <s-text color="subdued">
                    {state.kind === 'published'
                      ? t('settings:storefrontTest.status.published')
                      : state.kind === 'unpublished'
                        ? t('settings:storefrontTest.status.unpublished')
                        : state.kind === 'error'
                          ? t('settings:storefrontTest.status.unverified')
                          : t('settings:storefrontTest.status.checking')}
                  </s-text>
                  {titleClipped && (
                    <>
                      <div>
                        <s-button
                          variant="tertiary"
                          commandFor="storefront-product-name"
                          accessibilityLabel={t('settings:storefrontTest.actions.viewFullProductName')}
                        >
                          {t('settings:storefrontTest.actions.viewFullName')}
                        </s-button>
                      </div>
                      <s-popover id="storefront-product-name" inlineSize="280px">
                        <s-box padding="base">
                          <s-paragraph>{product.title}</s-paragraph>
                        </s-box>
                      </s-popover>
                    </>
                  )}
                </>
              ) : (
                <s-paragraph>
                  {requestedProductId.current
                    ? t('settings:storefrontTest.copy.confirmProduct')
                    : t('settings:storefrontTest.copy.chooseProduct')}
                </s-paragraph>
              )}
            </div>
            {editor && pickerAvailable && (
              <s-button loading={picking} disabled={picking || checking} onClick={() => void choose()}>
                {product
                  ? t('settings:storefrontTest.actions.changeProduct')
                  : requestedProductId.current
                    ? t('settings:storefrontTest.actions.confirmProduct')
                    : t('settings:storefrontTest.actions.chooseProduct')}
              </s-button>
            )}
          </div>
          {state.kind === 'error' && (
            <s-banner tone="warning">
              <s-paragraph>{errorMessage}</s-paragraph>
            </s-banner>
          )}
          {state.kind === 'unpublished' && (
            <s-paragraph>{t('settings:storefrontTest.copy.publishBeforeTesting')}</s-paragraph>
          )}
          {product && (
            <div class="storefront-test__actions">
              <s-button
                variant="primary"
                loading={checking}
                disabled={checking}
                href={
                  state.kind === 'published'
                    ? (previewHref ?? undefined)
                    : state.kind === 'unpublished'
                      ? setupHref
                      : undefined
                }
                target={state.kind === 'published' ? '_blank' : undefined}
                accessibilityLabel={
                  state.kind === 'published' ? t('settings:storefrontTest.actions.previewAccessible') : undefined
                }
                onClick={() => {
                  if (state.kind === 'error' && state.product) {
                    retryFocus.current = true;
                    void verify(state.product);
                  }
                }}
              >
                {state.kind === 'published'
                  ? t('settings:storefrontTest.actions.previewInThemeEditor')
                  : state.kind === 'unpublished'
                    ? t('settings:storefrontTest.actions.openProductSetup')
                    : state.kind === 'checking'
                      ? t('settings:storefrontTest.actions.checkProduct')
                      : t('common:actions.retry')}
              </s-button>
            </div>
          )}
          {state.kind === 'published' && (
            <s-ordered-list>
              <s-list-item>{t('settings:storefrontTest.steps.customizeProduct')}</s-list-item>
              <s-list-item>{t('settings:storefrontTest.steps.reviewCart')}</s-list-item>
            </s-ordered-list>
          )}
          {(!editor || !pickerAvailable) && (
            <s-paragraph color="subdued">
              {editor ? (
                <s-link href={editor} target="_top">
                  {t('settings:storefrontTest.copy.choosePublishedProductInEditor')}
                </s-link>
              ) : (
                t('settings:storefrontTest.copy.openFromAdmin')
              )}
            </s-paragraph>
          )}
          {state.kind === 'error' && state.reason === 'access-denied' && (
            <s-link href="/admin/settings/permissions">{t('admin-shell:shared.actions.reviewPermissions')}</s-link>
          )}
          <span class="storefront-setup__announcement" role="status" aria-live="polite">
            {state.kind === 'published'
              ? t('settings:storefrontTest.announcements.published')
              : state.kind === 'unpublished'
                ? t('settings:storefrontTest.announcements.unpublished')
                : state.kind === 'error'
                  ? errorMessage
                  : ''}
          </span>
        </s-stack>
      </s-section>
    </section>
  );
}
