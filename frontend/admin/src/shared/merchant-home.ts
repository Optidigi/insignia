/** Home presents current facts; owning product/order pages perform the work. */
export interface HomeLink {
  label: string;
  href: string;
}

export interface HomeProduct {
  id: string;
  title: string;
  href: string;
  thumbnail?: string;
  /** A newer draft may coexist with an effective published configuration. */
  published?: boolean;
}

export type HomeReadState = { state: 'loading' } | { state: 'failed' } | { state: 'restricted' };

export type HomeProductsPanel =
  | HomeReadState
  | {
      state: 'ready';
      catalog: 'no-products' | 'unconfigured' | 'configured' | 'unknown';
      drafts: HomeProduct[];
      canConfigure: boolean;
      hasPublishedProduct?: boolean;
      createProductHref?: string;
    };

export interface HomeOrder {
  id: string;
  /** Shopify's order name is content and may be absent. */
  orderName?: string;
  /** Stable display fallback input, kept separate from the app-owned reference caption. */
  orderNumber: string;
  href: string;
  productTitles: Array<string | null>;
  orderCreatedAt: string;
  status: 'artwork-ready' | 'artwork-needed' | 'waiting' | 'expired' | 'cancelled';
  itemCount: bigint;
  test?: boolean;
}

/** Only supported merchant interventions belong here, never waiting or historic expiry. */
export type HomeOrderTaskReason =
  | 'artwork-missing'
  | 'artwork-supplied'
  | 'replacement-artwork-review'
  | 'artwork-confirmation';
export type HomeOrderTaskAction = 'review-order';
export interface HomeOrderTask {
  id: string;
  orderName?: string;
  orderNumber: string;
  href: string;
  productTitle: string | null;
  reason: HomeOrderTaskReason;
  action: HomeOrderTaskAction;
}

export type HomeOrdersPanel =
  | HomeReadState
  | {
      state: 'ready';
      items: HomeOrder[];
      hasMore: boolean;
      tasks: HomeOrderTask[];
      timeZone: string;
      /** Only a complete, authoritative attention query can supply this total. */
      tasksTotal?: number;
    };

export interface HomeActivityDay {
  date: string;
  customizedOrders: number;
  customizedItems: bigint;
  productsOrdered: number;
}

/** Complete non-test, non-cancelled order facts for the last 30 store-calendar days including today. */
export type HomeStatistics =
  | {
      state: 'ready';
      periodDays: 30;
      customizedOrders: number;
      customizedItems: bigint;
      productsOrdered: number;
      excludesTestOrders?: true;
      series?: HomeActivityDay[];
      previousPeriod?: {
        customizedOrders: number;
        customizedItems: bigint;
        series?: HomeActivityDay[];
      };
    }
  | { state: 'loading' }
  | { state: 'unavailable' }
  | { state: 'restricted' };

export interface HomeGuidance {
  dismissed: boolean;
  initiallyExpanded?: boolean;
  /** Steps shown as done: merchant acknowledgements plus `observedSteps`. */
  completedSteps?: HomeGuidanceStepId[];
  /** Steps done because the store says so (published product, connected theme); the merchant cannot untick them. */
  observedSteps?: HomeGuidanceStepId[];
}

export const homeGuidanceStepIds = ['product', 'storefront', 'test'] as const;
export type HomeGuidanceStepId = (typeof homeGuidanceStepIds)[number];

export interface HomeSetupTask {
  id: string;
  kind: 'storefront' | 'test';
  reason?: 'button-disabled' | 'cart-review-disabled' | 'both-disabled' | 'check';
  state: 'complete' | 'acknowledged' | 'pending' | 'unknown';
  action?: Pick<HomeLink, 'href'>;
}

export interface HomeSetup {
  tasks: HomeSetupTask[];
  initiallyCollapsed?: boolean;
  /** Optional caller-scoped collapse key, separate from getting-started dismissal. */
  preferenceKey?: string;
}

export interface HomeNotice {
  kind: 'plan-restriction';
}

export type MerchantHomeModel =
  | { state: 'loading' }
  | { state: 'unavailable'; reason?: 'session-lost'; reopenHref?: string }
  | {
      state: 'ready';
      products: HomeProductsPanel;
      orders: HomeOrdersPanel;
      setup?: HomeSetup;
      notice?: HomeNotice;
      statistics?: HomeStatistics;
      guidance?: HomeGuidance;
    };

export type HomePanel = 'products' | 'orders';
