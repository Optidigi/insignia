import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { withAdminLocale } from '../shared/admin-i18n';
import { authenticatedJson, isShopifyBusy } from '../shared/admin-request';
import { createMerchantPreferencesClient } from '../shared/merchant-preferences-client';
import { homeGuidanceReducer, initialHomeGuidanceState } from '../shared/home-workflow-state';
import type {
  HomeOrdersPanel,
  HomePanel,
  HomeProductsPanel,
  HomeSetup,
  HomeStatistics,
  MerchantHomeModel,
} from '../shared/merchant-home';
import {
  homeHasPublishedProduct,
  homeOrdersFromResponse,
  homeProductsFromResponse,
  homeSetupFromTheme,
  homeStatisticsFromResponse,
  homeStatisticsFromAggregate,
} from '../shared/merchant-home-source';
import { themeSetupStatus, unknownThemeSetup } from '../shared/storefront-setup';
import MerchantHome from './MerchantHome';

/** Composition of existing authenticated reads. This does not create an aggregation or task-authority endpoint. */
function MerchantHomeContainer() {
  const [products, setProducts] = useState<HomeProductsPanel>({ state: 'loading' });
  const [orders, setOrders] = useState<HomeOrdersPanel>({ state: 'loading' });
  const [setup, setSetup] = useState<HomeSetup>();
  const [restrictedPlan, setRestrictedPlan] = useState(false);
  const [sessionLost, setSessionLost] = useState(false);
  const [statistics, setStatistics] = useState<HomeStatistics | undefined>({ state: 'loading' });
  const [guidance, dispatchGuidance] = useReducer(homeGuidanceReducer, undefined, initialHomeGuidanceState);
  const guidanceRef = useRef(guidance);
  guidanceRef.current = guidance;
  const guidanceQueue = useRef<Promise<void>>(Promise.resolve());
  const preferences = useMemo(() => createMerchantPreferencesClient(), []);
  /** One owner for the guidance read/write outcome: `busy` is Shopify throttling, which a retry can clear. */
  const [guidanceFailure, setGuidanceFailure] = useState<null | 'failed' | 'busy'>(null);
  const [guidanceEditable, setGuidanceEditable] = useState(false);
  const guidanceDismissed = guidance.dismissed;
  const guidanceCompletedSteps = guidance.completedSteps;
  const mounted = useRef(false);
  const requests = useRef<Partial<Record<HomePanel, AbortController>>>({});
  const facts = useRef({ theme: unknownThemeSetup(), published: false });
  const refreshSetup = () => setSetup(homeSetupFromTheme(facts.current.theme, facts.current.published));
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
        setProducts(homeProductsFromResponse(value));
        facts.current.published = homeHasPublishedProduct(value);
        refreshSetup();
      } else {
        setOrders(homeOrdersFromResponse(value));
        setStatistics(homeStatisticsFromResponse(value));
        try {
          const totals = await authenticatedJson<unknown>('/api/purchases/v1/statistics', { signal: controller.signal });
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
    async function loadGuidance() {
      try {
        const value = await preferences.read();
        if (!mounted.current) return;
        guidanceRef.current = homeGuidanceReducer(guidanceRef.current, { type: 'preferences-loaded', ...value.guidance });
        dispatchGuidance({ type: 'preferences-loaded', ...value.guidance });
        setGuidanceEditable(value.canEdit === true);
        setGuidanceFailure(null);
      } catch (error) {
        if (mounted.current) setGuidanceFailure(isShopifyBusy(error) ? 'busy' : 'failed');
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
      facts.current.theme = unknownThemeSetup();
      refreshSetup();
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
          facts.current.theme = themeSetupStatus(result);
          refreshSetup();
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
        if (
          mounted.current &&
          !current.signal.aborted &&
          value &&
          typeof value === 'object' &&
          'newActionsAllowed' in value &&
          typeof value.newActionsAllowed === 'boolean'
        )
          setRestrictedPlan(!value.newActionsAllowed);
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
        const saved = await preferences.saveGuidance({ dismissed: next.dismissed, completedSteps: next.completedSteps });
        if (!mounted.current) return;
        guidanceRef.current = homeGuidanceReducer(guidanceRef.current, { type: 'preferences-loaded', ...saved.guidance });
        dispatchGuidance({ type: 'preferences-loaded', ...saved.guidance });
        setGuidanceFailure(null);
      } catch (error) {
        if (mounted.current) setGuidanceFailure(isShopifyBusy(error) ? 'busy' : 'failed');
      }
    });
  }
  const model: MerchantHomeModel = sessionLost || guidanceFailure
    ? {
        state: 'unavailable',
        reopenHref: '/admin/home',
        ...(sessionLost
          ? { reason: 'session-lost' as const }
          : guidanceFailure === 'busy'
            ? { reason: 'busy' as const }
            : {}),
      }
    : {
        state: 'ready',
        products: products.state === 'ready' ? { ...products, canConfigure: !restrictedPlan } : products,
        orders,
        ...(statistics ? { statistics } : {}),
        ...(products.state === 'ready'
          ? { guidance: { dismissed: guidanceDismissed, completedSteps: guidanceCompletedSteps } }
          : {}),
        ...(setup
          ? { setup: { ...setup, initiallyCollapsed: orders.state === 'ready' && orders.items.length > 0 } }
          : {}),
        ...(restrictedPlan ? { notice: { kind: 'plan-restriction' as const } } : {}),
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
      onCompleteGuidanceStep={guidanceEditable ? (step, complete) => updateGuidance({ type: 'step-acknowledged', step, complete }) : undefined}
    />
  );
}

export default withAdminLocale(MerchantHomeContainer);
