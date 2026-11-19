import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { withAdminLocale } from '../shared/admin-i18n';
import { authenticatedJson, isShopifyBusy } from '../shared/admin-request';
import { homeGuidanceReducer, initialHomeGuidanceState } from '../shared/home-workflow-state';
import type {
  HomeOrdersPanel,
  HomePanel,
  HomeProductsPanel,
  HomeStatistics,
  MerchantHomeModel,
} from '../shared/merchant-home';
import {
  homeGuidanceWithObservedSteps,
  homeHasPublishedProductFromSetupStatus,
  homeObservedGuidanceSteps,
  homeOrdersFromResponse,
  homeProductsFromResponse,
  homeSetupFromTheme,
  homeStatisticsFromAggregate,
  homeStatisticsFromResponse,
} from '../shared/merchant-home-source';
import { createMerchantPreferencesClient } from '../shared/merchant-preferences-client';
import { claimPlanSelectionPrompt, planSelectionTarget } from '../shared/plan-prompt';
import { type ThemeSetupStatus, themeSetupStatus } from '../shared/storefront-setup';
import MerchantHome from './MerchantHome';

/** Quiet retries of Home's first read while a fresh install's access is still being set up. */
const GUIDANCE_RETRIES = 2;
const GUIDANCE_RETRY_MS = 2000;

/** A 403 is a missing permission (app scope or staff access), not a lost session or a transient failure. */
function guidanceFailureFrom(error: unknown): 'failed' | 'busy' | 'restricted' {
  if (isShopifyBusy(error)) return 'busy';
  return error && typeof error === 'object' && 'status' in error && error.status === 403 ? 'restricted' : 'failed';
}

/** Composition of existing authenticated reads. This does not create an aggregation or task-authority endpoint. */
function MerchantHomeContainer() {
  const [products, setProducts] = useState<HomeProductsPanel>({ state: 'loading' });
  const [orders, setOrders] = useState<HomeOrdersPanel>({ state: 'loading' });
  const [theme, setTheme] = useState<ThemeSetupStatus>('unknown');
  const [published, setPublished] = useState(false);
  // Both are derived from the store's observations, never stored separately. Any order in the store-wide
  // recent-orders read (test orders included) proves a customization was tested.
  const setup = homeSetupFromTheme(theme, published);
  const observedSteps = homeObservedGuidanceSteps(
    theme,
    published,
    orders.state === 'ready' && orders.items.length > 0,
  );
  const [restrictedPlan, setRestrictedPlan] = useState(false);
  const [planSelectionUrl, setPlanSelectionUrl] = useState<string | null>(null);
  const [sessionLost, setSessionLost] = useState(false);
  const [statistics, setStatistics] = useState<HomeStatistics | undefined>({ state: 'loading' });
  const [guidance, dispatchGuidance] = useReducer(homeGuidanceReducer, undefined, initialHomeGuidanceState);
  const guidanceRef = useRef(guidance);
  guidanceRef.current = guidance;
  const guidanceQueue = useRef<Promise<void>>(Promise.resolve());
  const preferences = useMemo(() => createMerchantPreferencesClient(), []);
  /**
   * One owner for the guidance read/write outcome: `busy` is Shopify throttling, which a retry can clear;
   * `restricted` is a 403 (the app or this staff account lacks product access), which reopening cannot clear.
   */
  const [guidanceFailure, setGuidanceFailure] = useState<null | 'failed' | 'busy' | 'restricted'>(null);
  const [guidanceEditable, setGuidanceEditable] = useState(false);
  const guidanceDismissed = guidance.dismissed;
  const guidanceCompletedSteps = guidance.completedSteps;
  const mounted = useRef(false);
  const requests = useRef<Partial<Record<HomePanel, AbortController>>>({});
  async function load(panel: HomePanel) {
    requests.current[panel]?.abort();
    const controller = new AbortController();
    requests.current[panel] = controller;
    const update = panel === 'products' ? setProducts : setOrders;
    update({ state: 'loading' });
    try {
      const value = await authenticatedJson<unknown>(
        panel === 'products' ? '/api/admin/products' : '/api/purchases/v1?limit=5&sort=date-desc',
        { signal: controller.signal },
      );
      if (!mounted.current || controller.signal.aborted) return;
      if (panel === 'products') {
        // The default list is one page; Insignia's database alone says whether any product is published.
        let anyPublished: boolean | undefined;
        try {
          anyPublished = homeHasPublishedProductFromSetupStatus(
            await authenticatedJson<unknown>('/api/admin/setup-status', { signal: controller.signal }),
          );
        } catch {
          /* An unanswered read leaves publication to what the first page proves; unknown never ticks the step. */
        }
        if (!mounted.current || controller.signal.aborted) return;
        const { hasPublishedProduct: firstPage, ...ready } = homeProductsFromResponse(value);
        const publication = anyPublished ?? firstPage;
        setProducts(publication === undefined ? ready : { ...ready, hasPublishedProduct: publication });
        setPublished(publication === true);
      } else {
        setOrders(homeOrdersFromResponse(value));
        setStatistics(homeStatisticsFromResponse(value));
        try {
          const totals = await authenticatedJson<unknown>('/api/purchases/v1/statistics', {
            signal: controller.signal,
          });
          if (mounted.current && !controller.signal.aborted) setStatistics(homeStatisticsFromAggregate(totals));
        } catch {
          if (mounted.current && !controller.signal.aborted) setStatistics(undefined);
        }
      }
    } catch (error: unknown) {
      if (!mounted.current || controller.signal.aborted) return;
      const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
      if (status === 401) setSessionLost(true);
      if (panel === 'orders') setStatistics(undefined);
      if (status === 403) update({ state: 'restricted' });
      else update(isShopifyBusy(error) ? { state: 'failed', reason: 'busy' } : { state: 'failed' });
    }
  }
  useEffect(() => {
    mounted.current = true;
    async function loadGuidance(attempt = 0) {
      try {
        const value = await preferences.read();
        if (!mounted.current) return;
        guidanceRef.current = homeGuidanceReducer(guidanceRef.current, {
          type: 'preferences-loaded',
          ...value.guidance,
        });
        dispatchGuidance({ type: 'preferences-loaded', ...value.guidance });
        setGuidanceEditable(value.canEdit === true);
        setGuidanceFailure(null);
      } catch (error) {
        if (!mounted.current) return;
        const failure = guidanceFailureFrom(error);
        const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
        // Right after an install the store's access is still being set up for a few seconds: retry quietly
        // before saying Home is unavailable. A permission or session answer is final.
        if (failure !== 'restricted' && status !== 401 && attempt < GUIDANCE_RETRIES) {
          const timer = setTimeout(() => {
            timers.delete(timer);
            if (mounted.current) void loadGuidance(attempt + 1);
          }, GUIDANCE_RETRY_MS);
          timers.add(timer);
          return;
        }
        setGuidanceFailure(failure);
      }
    }
    let departed = false;
    const bridge = (window as unknown as { shopify?: { app?: { extensions?: () => Promise<unknown> } } }).shopify;
    let themeGeneration = 0;
    let billingController: AbortController | undefined;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    async function theme() {
      const generation = ++themeGeneration;
      let timer: ReturnType<typeof setTimeout> | undefined;
      setTheme('unknown');
      if (!bridge?.app?.extensions) return;
      try {
        const result = await Promise.race([
          bridge.app.extensions(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Theme check timeout')), 8000);
            timers.add(timer);
          }),
        ]);
        if (mounted.current && generation === themeGeneration) {
          setTheme(themeSetupStatus(result));
        }
      } catch {
        /* Unknown is displayed as unverified, never as missing. Setup owns recovery. */
      } finally {
        clearTimeout(timer);
        if (timer) timers.delete(timer);
      }
    }
    async function billing() {
      billingController?.abort();
      const current = new AbortController();
      billingController = current;
      try {
        const value = await authenticatedJson<unknown>('/api/admin/billing', { signal: current.signal });
        if (!mounted.current || current.signal.aborted) return;
        if (
          value &&
          typeof value === 'object' &&
          'newActionsAllowed' in value &&
          typeof value.newActionsAllowed === 'boolean'
        )
          setRestrictedPlan(!value.newActionsAllowed);
        // Managed pricing: a store definitively without a plan goes to Shopify's plan selection once per
        // session. The plan banner stays as the fallback if the navigation is blocked or the merchant returns.
        const planSelection = planSelectionTarget(value);
        // Where the browser denies storage (third-party cookies blocked) the automatic prompt cannot be
        // limited to once per session, so the banner offers plan selection directly instead.
        setPlanSelectionUrl(planSelection);
        if (planSelection && claimPlanSelectionPrompt(() => window.sessionStorage)) window.open(planSelection, '_top');
      } catch {
        /* A failed observation never implies an inactive plan. Billing owns recovery. */
      }
    }
    const reload = () => {
      void loadGuidance();
      void load('products');
      void load('orders');
      void theme();
      void billing();
    };
    const leave = () => {
      departed = true;
    };
    const returned = () => {
      if (departed && document.visibilityState !== 'hidden') {
        departed = false;
        reload();
      }
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') leave();
      else returned();
    };
    reload();
    window.addEventListener('blur', leave);
    window.addEventListener('focus', returned);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false;
      themeGeneration++;
      for (const timer of timers) clearTimeout(timer);
      billingController?.abort();
      for (const request of Object.values(requests.current)) request?.abort();
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', returned);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  function updateGuidance(event: Parameters<typeof homeGuidanceReducer>[1]) {
    guidanceQueue.current = guidanceQueue.current.then(async () => {
      if (!mounted.current || !guidanceRef.current.loaded) return;
      try {
        // Reconcile any original uncertain command, then apply this single user event
        // to the latest store state rather than replacing another staff member's steps.
        const observed = await preferences.read();
        const base = homeGuidanceReducer(guidanceRef.current, { type: 'preferences-loaded', ...observed.guidance });
        const next = homeGuidanceReducer(base, event);
        const saved = await preferences.saveGuidance({
          dismissed: next.dismissed,
          completedSteps: next.completedSteps,
        });
        if (!mounted.current) return;
        guidanceRef.current = homeGuidanceReducer(guidanceRef.current, {
          type: 'preferences-loaded',
          ...saved.guidance,
        });
        dispatchGuidance({ type: 'preferences-loaded', ...saved.guidance });
        setGuidanceFailure(null);
      } catch (error) {
        if (mounted.current) setGuidanceFailure(guidanceFailureFrom(error));
      }
    });
  }
  const model: MerchantHomeModel =
    sessionLost || guidanceFailure
      ? sessionLost || guidanceFailure !== 'restricted'
        ? {
            state: 'unavailable',
            reopenHref: '/admin/home',
            ...(sessionLost
              ? { reason: 'session-lost' as const }
              : guidanceFailure === 'busy'
                ? { reason: 'busy' as const }
                : {}),
          }
        : { state: 'unavailable', reason: 'permission', reopenHref: '/admin/settings/permissions' }
      : {
          state: 'ready',
          products: products.state === 'ready' ? { ...products, canConfigure: !restrictedPlan } : products,
          orders,
          ...(statistics ? { statistics } : {}),
          ...(products.state === 'ready'
            ? {
                guidance: homeGuidanceWithObservedSteps(
                  { dismissed: guidanceDismissed, completedSteps: guidanceCompletedSteps },
                  observedSteps,
                ),
              }
            : {}),
          ...(setup
            ? { setup: { ...setup, initiallyCollapsed: orders.state === 'ready' && orders.items.length > 0 } }
            : {}),
          ...(restrictedPlan
            ? {
                notice: {
                  kind: 'plan-restriction' as const,
                  ...(planSelectionUrl ? { planSelectionUrl } : {}),
                },
              }
            : {}),
        };
  async function createProduct() {
    const intents = (
      window as unknown as {
        shopify?: {
          intents?: { invoke: (intent: 'create:shopify/Product') => Promise<{ complete: Promise<{ code: string }> }> };
        };
      }
    ).shopify?.intents;
    if (!intents) throw new Error('Product creation unavailable');
    const activity = await intents.invoke('create:shopify/Product');
    const result = await activity.complete;
    if (mounted.current && result.code === 'ok') await load('products');
  }
  const dismissGuidance = (dismissed: boolean) => {
    updateGuidance({ type: dismissed ? 'guide-dismissed' : 'guide-restored' });
  };
  return (
    <MerchantHome
      model={model}
      onRetry={load}
      onCreateProduct={createProduct}
      onDismissGuidance={guidanceEditable ? () => dismissGuidance(true) : undefined}
      onRestoreGuidance={guidanceEditable ? () => dismissGuidance(false) : undefined}
      onCompleteGuidanceStep={
        guidanceEditable ? (step, complete) => updateGuidance({ type: 'step-acknowledged', step, complete }) : undefined
      }
    />
  );
}

export default withAdminLocale(MerchantHomeContainer);
