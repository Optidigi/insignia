/** Explicit local Home scenarios. These records are not backend summaries or merchant data. */
import type {
  HomeActivityDay,
  HomeNotice,
  HomeOrder,
  HomeOrdersPanel,
  HomeOrderTask,
  HomeProduct,
  HomeProductsPanel,
  HomeSetup,
  HomeSetupTask,
  HomeStatistics,
  MerchantHomeModel,
} from '../../../src/shared/merchant-home.js';

export const homeExamples = [
  ['no-products', 'No Shopify products'],
  ['no-products-dismissed', 'No products, guide dismissed'],
  ['create-product-error', 'Product creation cannot open'],
  ['create-product-pending', 'Product creation in progress'],
  ['first-use', 'First product setup'],
  ['draft', 'Saved product draft'],
  ['published-setup-pending', 'Published product, theme setup pending'],
  ['test-invitation', 'Customer test invitation'],
  ['quiet-no-orders', 'Setup complete, no customized orders'],
  ['operating', 'Operating store'],
  ['orders-row-hover', 'Recent order row hover'],
  ['orders-last-row-hover', 'Recent order last-row hover'],
  ['merchant-task', 'Merchant action needed'],
  ['awaiting-customer', 'Waiting for customer artwork'],
  ['expired-historic', 'Historic artwork expiry'],
  ['mixed-setup-orders', 'Orders with setup still pending'],
  ['busy-bounded', 'Busy store, bounded summaries'],
  ['restricted', 'Order access restricted'],
  ['partialfail-products', 'Products panel failed'],
  ['partialfail-orders', 'Orders panel failed'],
  ['retry-fail-then-recovery', 'Retry fails once, then recovers'],
  ['loading-all', 'Initial loading'],
  ['independent-loading', 'Orders still loading'],
  ['unavailable', 'Shop context unavailable'],
  ['plan-restricted', 'Plan blocks a new action'],
  ['theme-unknown', 'Theme status unknown'],
  ['long-content', 'Long product and order names'],
  ['statistics-loading', 'Activity statistics loading'],
  ['statistics-hover', 'Activity metric hover'],
  ['operating-default-guide', 'Operating store, unmarked guide'],
  ['returning-no-products', 'Order history, no current products'],
  ['statistics-unavailable', 'Activity statistics unavailable'],
  ['statistics-restricted', 'Activity statistics restricted'],
  ['guidance-first-visit', 'Getting started, first visit'],
  ['guidance-expanded', 'Getting started, expanded guide'],
  ['guidance-dismissed', 'Getting started, dismissed guide'],
  ['guidance-progress', 'Getting started, one task complete'],
  ['guidance-complete', 'Getting started, all tasks complete'],
  ['older-artwork-work', 'Older artwork work outside the recent orders'],
  ['many-artwork-tasks', 'More artwork work than the Home summary'],
] as const satisfies readonly (readonly [string, string])[];

export type HomeExampleId = (typeof homeExamples)[number][0];

const productIds = {
  tee: '15464675246464',
  hoodie: '15468416336256',
  polo: '15468473450880',
} as const;

const products: Record<keyof typeof productIds, Omit<HomeProduct, 'published'>> = {
  tee: {
    id: productIds.tee,
    title: 'Ontwerp je eigen superfunny T-shirt',
    href: `/admin/products/${productIds.tee}/config`,
    thumbnail: '/__preview/demo/files/t-shirt-front-preview.jpg',
  },
  hoodie: {
    id: productIds.hoodie,
    title: 'Ontwerp je eigen Superfunny hoodie',
    href: `/admin/products/${productIds.hoodie}/config`,
    thumbnail: '/__preview/demo/files/hoodie-front-preview.jpg',
  },
  polo: {
    id: productIds.polo,
    title: 'Ontwerp je eigen Superfunny polo',
    href: `/admin/products/${productIds.polo}/config`,
    thumbnail: '/__preview/demo/files/polo-front-preview.jpg',
  },
};

type SampleOrderNumber = 1042 | 1043 | 1044 | 1045 | 1046 | 1047 | 1048 | 1049;

const purchaseIds: Record<SampleOrderNumber, string> = {
  1042: '10000000-0000-4000-8000-000000000101',
  1043: '10000000-0000-4000-8000-000000000102',
  1044: '10000000-0000-4000-8000-000000000103',
  1045: '10000000-0000-4000-8000-000000000104',
  1046: '10000000-0000-4000-8000-000000000105',
  1047: '10000000-0000-4000-8000-000000000106',
  1048: '10000000-0000-4000-8000-000000000107',
  1049: '10000000-0000-4000-8000-000000000108',
};

const storeOrderHref = '/admin/orders';
const storefrontSetupHref = '/admin/settings/storefront';

function product(key: keyof typeof products, options: { published?: boolean; title?: string } = {}): HomeProduct {
  return { ...products[key], ...options };
}

function productPanel(
  drafts: HomeProduct[] = [],
  options: { catalog?: 'unconfigured' | 'configured' | 'unknown'; canConfigure?: boolean } = {},
): HomeProductsPanel {
  return {
    state: 'ready',
    catalog: options.catalog ?? 'configured',
    drafts,
    canConfigure: options.canConfigure ?? true,
    hasPublishedProduct: drafts.length === 0 || drafts.some((p) => p.published),
  };
}

function order(
  number: SampleOrderNumber,
  productTitle: string,
  createdAt: string,
  status: HomeOrder['status'],
  itemCount: number,
  test = false,
): HomeOrder {
  const id = purchaseIds[number];
  return {
    id,
    orderName: `#${number}`,
    orderNumber: String(number),
    href: `${storeOrderHref}/${id}`,
    productTitles: [productTitle],
    orderCreatedAt: createdAt,
    status,
    itemCount: BigInt(itemCount),
    ...(test ? { test: true } : {}),
  };
}

function task(number: SampleOrderNumber, productTitle: string, reason: HomeOrderTask['reason']): HomeOrderTask {
  const id = purchaseIds[number];
  return {
    id,
    orderName: `#${number}`,
    orderNumber: String(number),
    href: `${storeOrderHref}/${id}`,
    productTitle,
    reason,
    action: 'review-order',
  };
}

function orderPanel(
  items: HomeOrder[] = [],
  tasks: HomeOrderTask[] = [],
): Extract<HomeOrdersPanel, { state: 'ready' }> {
  const recent = [...items].sort((a, b) => Date.parse(b.orderCreatedAt) - Date.parse(a.orderCreatedAt));
  return { state: 'ready', items: recent, tasks, hasMore: false, timeZone: 'UTC' };
}

function setupTask(
  id: string,
  kind: HomeSetupTask['kind'],
  state: HomeSetupTask['state'],
  options: { reason?: HomeSetupTask['reason']; actionHref?: string } = {},
): HomeSetupTask {
  return {
    id,
    kind,
    state,
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.actionHref ? { action: { href: options.actionHref } } : {}),
  };
}

function storefrontSetup(
  buttonState: HomeSetupTask['state'],
  cartState: HomeSetupTask['state'],
  testState: HomeSetupTask['state'],
): HomeSetup | undefined {
  const themeComplete = buttonState === 'complete' && cartState === 'complete';
  if (themeComplete && testState === 'acknowledged') return undefined;

  if (themeComplete) {
    return {
      tasks: [
        setupTask('customer-test', 'test', testState, {
          actionHref: `${storefrontSetupHref}#test-product`,
        }),
      ],
    };
  }

  const pendingButton = buttonState === 'pending';
  const pendingCart = cartState === 'pending';
  const hasKnownTask = pendingButton || pendingCart;
  const reason =
    !hasKnownTask || buttonState === 'unknown' || cartState === 'unknown'
      ? 'check'
      : pendingButton && pendingCart
        ? 'both-disabled'
        : pendingButton
          ? 'button-disabled'
          : 'cart-review-disabled';
  return {
    tasks: [
      setupTask('storefront-setup', 'storefront', hasKnownTask ? 'pending' : 'unknown', {
        reason,
        actionHref: storefrontSetupHref,
      }),
    ],
  };
}

function setupDetails(
  buttonState: HomeSetupTask['state'],
  cartState: HomeSetupTask['state'],
  testState: HomeSetupTask['state'],
): { setup?: HomeSetup } {
  const setup = storefrontSetup(buttonState, cartState, testState);
  return setup ? { setup } : {};
}

function readyHome(
  productsPanel: HomeProductsPanel,
  ordersPanel: HomeOrdersPanel,
  extras: { setup?: HomeSetup; notice?: HomeNotice } = {},
): MerchantHomeModel {
  return {
    state: 'ready',
    products: productsPanel,
    orders: ordersPanel,
    ...extras,
  };
}

const tee = () => product('tee');
const hoodie = () => product('hoodie');
const polo = () => product('polo');

const orderExamples = {
  testTee: () => order(1042, 'Organic cotton T-shirt', '2026-10-20T09:42:00Z', 'artwork-ready', 3, true),
  waitingHoodie: () => order(1043, 'Superfunny hoodie', '2026-10-20T10:42:00Z', 'waiting', 4),
  readyPoloSix: () => order(1044, 'Superfunny polo', '2026-10-20T11:42:00Z', 'artwork-ready', 6),
  readyMixed: () => order(1045, 'T-shirt, hoodie and polo', '2026-10-20T12:42:00Z', 'artwork-ready', 6),
  readyTwoHoodieDesigns: () => order(1046, 'Two hoodie designs', '2026-10-20T13:42:00Z', 'artwork-ready', 5),
  readyPoloEight: () => order(1047, 'Superfunny polo', '2026-10-20T14:42:00Z', 'artwork-ready', 8),
  readyTee: () => order(1048, 'Superfunny T-shirt', '2026-10-20T15:42:00Z', 'artwork-ready', 1),
  waitingMultiSizeHoodie: () => order(1049, 'Superfunny hoodie', '2026-10-20T16:42:00Z', 'waiting', 10),
};

function makeHome(id: HomeExampleId): MerchantHomeModel {
  switch (id) {
    case 'returning-no-products':
      return readyHome(
        {
          state: 'ready',
          catalog: 'no-products',
          drafts: [],
          canConfigure: true,
          createProductHref: '/__preview/home/create-product-handoff',
        },
        orderPanel([orderExamples.readyPoloSix()]),
      );
    case 'statistics-hover':
    case 'statistics-loading':
    case 'statistics-unavailable':
    case 'statistics-restricted':
    case 'guidance-expanded':
    case 'guidance-dismissed':
    case 'guidance-progress':
    case 'guidance-complete':
      return readyHome(
        productPanel([tee()]),
        orderPanel([orderExamples.readyPoloSix(), orderExamples.readyMixed(), orderExamples.readyTee()]),
      );
    case 'guidance-first-visit':
      return readyHome(
        productPanel([tee()]),
        {
          ...orderPanel(
            [orderExamples.readyPoloSix(), orderExamples.readyMixed(), orderExamples.readyTee()],
            [task(1043, 'Superfunny hoodie', 'artwork-missing')],
          ),
          hasMore: true,
          tasksTotal: 1,
        },
        setupDetails('pending', 'pending', 'pending'),
      );
    case 'older-artwork-work':
      return readyHome(productPanel([tee()]), {
        ...orderPanel(
          [
            orderExamples.readyPoloSix(),
            orderExamples.readyMixed(),
            orderExamples.readyTwoHoodieDesigns(),
            orderExamples.readyPoloEight(),
            orderExamples.readyTee(),
          ],
          [task(1043, 'Superfunny hoodie', 'artwork-missing')],
        ),
        hasMore: true,
        tasksTotal: 1,
      });
    case 'many-artwork-tasks':
      return readyHome(productPanel([tee()]), {
        ...orderPanel(
          [orderExamples.readyPoloSix(), orderExamples.readyMixed(), orderExamples.readyTee()],
          [
            task(1043, 'Superfunny hoodie', 'artwork-missing'),
            task(1049, 'Superfunny hoodie', 'artwork-supplied'),
            task(1042, 'Organic cotton T-shirt', 'replacement-artwork-review'),
          ],
        ),
        hasMore: true,
        tasksTotal: 8,
      });
    case 'no-products':
    case 'no-products-dismissed':
    case 'create-product-error':
    case 'create-product-pending':
      return readyHome(
        {
          state: 'ready',
          catalog: 'no-products',
          drafts: [],
          canConfigure: false,
          createProductHref: '/__preview/home/create-product-handoff',
        },
        orderPanel(),
      );
    case 'first-use':
      return readyHome(
        productPanel([], { catalog: 'unconfigured' }),
        orderPanel(),
        setupDetails('pending', 'pending', 'pending'),
      );
    case 'draft':
      return readyHome(productPanel([tee()]), orderPanel(), setupDetails('pending', 'pending', 'pending'));
    case 'published-setup-pending':
      return readyHome(productPanel(), orderPanel(), setupDetails('pending', 'pending', 'pending'));
    case 'test-invitation':
      return readyHome(productPanel(), orderPanel(), setupDetails('complete', 'complete', 'pending'));
    case 'quiet-no-orders':
      return readyHome(productPanel(), orderPanel(), setupDetails('complete', 'complete', 'acknowledged'));
    case 'operating-default-guide':
    case 'orders-row-hover':
    case 'orders-last-row-hover':
    case 'operating':
      return readyHome(
        productPanel([tee()]),
        orderPanel([
          orderExamples.readyPoloSix(),
          orderExamples.readyMixed(),
          orderExamples.readyTwoHoodieDesigns(),
          orderExamples.readyPoloEight(),
          orderExamples.readyTee(),
        ]),
        setupDetails('complete', 'complete', 'acknowledged'),
      );
    case 'merchant-task':
      return readyHome(
        productPanel([hoodie()]),
        orderPanel(
          [orderExamples.readyPoloSix(), orderExamples.readyMixed()],
          [task(1046, 'Superfunny hoodie', 'replacement-artwork-review')],
        ),
        setupDetails('complete', 'complete', 'acknowledged'),
      );
    case 'awaiting-customer':
      return readyHome(
        productPanel([tee()]),
        orderPanel([orderExamples.waitingHoodie(), orderExamples.waitingMultiSizeHoodie()]),
        setupDetails('complete', 'complete', 'acknowledged'),
      );
    case 'expired-historic':
      return readyHome(
        productPanel([tee()]),
        orderPanel([order(1047, 'Superfunny polo', '2025-03-14T12:00:00Z', 'expired', 8)]),
        setupDetails('complete', 'complete', 'acknowledged'),
      );
    case 'mixed-setup-orders':
      return readyHome(
        productPanel([hoodie()]),
        orderPanel([orderExamples.readyMixed(), orderExamples.readyPoloSix()]),
        setupDetails('pending', 'pending', 'pending'),
      );
    case 'busy-bounded':
      return readyHome(
        productPanel([tee(), hoodie(), polo()]),
        orderPanel(
          [
            orderExamples.testTee(),
            orderExamples.waitingHoodie(),
            orderExamples.readyPoloSix(),
            orderExamples.readyMixed(),
            orderExamples.readyTee(),
            orderExamples.waitingMultiSizeHoodie(),
          ],
          [
            task(1046, 'Superfunny hoodie', 'replacement-artwork-review'),
            task(1047, 'Superfunny polo', 'artwork-confirmation'),
          ],
        ),
        setupDetails('complete', 'complete', 'acknowledged'),
      );
    case 'restricted':
      return readyHome(productPanel([tee()]), { state: 'restricted' }, setupDetails('pending', 'pending', 'pending'));
    case 'partialfail-products':
      return readyHome(
        { state: 'failed' },
        orderPanel([orderExamples.readyPoloSix(), orderExamples.readyMixed()]),
        setupDetails('complete', 'complete', 'acknowledged'),
      );
    case 'partialfail-orders':
      return readyHome(productPanel([tee()]), { state: 'failed' }, setupDetails('pending', 'pending', 'pending'));
    case 'retry-fail-then-recovery':
      return readyHome(
        productPanel([tee()]),
        { state: 'failed' },
        setupDetails('complete', 'complete', 'acknowledged'),
      );
    case 'loading-all':
      return { state: 'loading' };
    case 'independent-loading':
      return readyHome(productPanel([tee()]), { state: 'loading' });
    case 'unavailable':
      return {
        state: 'unavailable',
        reason: 'session-lost',
      };
    case 'plan-restricted':
      return readyHome(productPanel([tee()], { canConfigure: false }), orderPanel([orderExamples.readyPoloSix()]), {
        notice: { kind: 'plan-restriction' },
      });
    case 'theme-unknown':
      return readyHome(
        productPanel([product('tee', { published: true })]),
        orderPanel(),
        setupDetails('unknown', 'unknown', 'pending'),
      );
    case 'long-content': {
      const longTitle =
        'Organic cotton heavyweight relaxed-fit unisex T-shirt with a garment-dyed finish and reinforced rib-knit crew neck';
      return readyHome(
        productPanel([product('tee', { title: longTitle })]),
        orderPanel(
          [order(1048, longTitle, '2026-10-20T15:42:00Z', 'artwork-ready', 1)],
          [task(1049, longTitle, 'replacement-artwork-review')],
        ),
        setupDetails('pending', 'pending', 'pending'),
      );
    }
    default:
      throw new Error('Unreachable Home preview fixture.');
  }
}

const exampleDailyOrders = [0, 0, 0, 1, 0, 0, 1, 2, 0, 0, 2, 1, 1, 3, 2, 0, 1, 4, 3, 2, 1, 3, 0, 1, 5, 3, 0, 2, 4, 1];
const exampleDailyItems = [
  0, 0, 0, 2, 0, 0, 4, 10, 0, 0, 5, 3, 1, 14, 6, 0, 2, 9, 18, 7, 2, 12, 0, 2, 20, 11, 0, 4, 16, 3,
];
const exampleDailyProducts = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 2, 1, 1, 2, 2, 0, 1, 3, 2, 1, 1, 2, 0, 1, 3, 2, 0, 2, 2, 1];
const exampleActivity: HomeActivityDay[] = exampleDailyOrders.map((orders, index) => ({
  date: new Date(Date.UTC(2026, 8, 27 + index)).toISOString().slice(0, 10),
  customizedOrders: orders,
  customizedItems: BigInt(exampleDailyItems[index] ?? 0),
  productsOrdered: exampleDailyProducts[index] ?? 0,
}));

const previousDailyOrders = [0, 1, 0, 0, 1, 1, 0, 2, 0, 1, 1, 1, 0, 2, 1, 0, 1, 2, 1, 0, 1, 1, 0, 2, 3, 1, 0, 1, 2, 1];
const previousActivity: HomeActivityDay[] = previousDailyOrders.map((orders, index) => ({
  date: new Date(Date.UTC(2026, 7, 28 + index)).toISOString().slice(0, 10),
  customizedOrders: orders,
  customizedItems: BigInt(
    [0, 2, 0, 0, 3, 4, 0, 5, 0, 2, 3, 2, 0, 7, 2, 0, 4, 6, 3, 0, 2, 4, 0, 5, 8, 3, 0, 4, 5, 2][index] ?? 0,
  ),
  productsOrdered: Math.min(2, previousDailyOrders[index] ?? 0),
}));

export function homeExample(id: string): MerchantHomeModel {
  if (!homeExamples.some(([exampleId]) => exampleId === id))
    throw new RangeError(`Unknown Home preview example: ${id}`);
  const model = makeHome(id as HomeExampleId);
  if (model.state !== 'ready') return model;
  const firstUse =
    model.products.state === 'ready' &&
    ['no-products', 'unconfigured'].includes(model.products.catalog) &&
    model.orders.state === 'ready' &&
    model.orders.items.length === 0 &&
    !model.orders.hasMore;
  const statistics: HomeStatistics =
    id === 'statistics-loading' || id === 'independent-loading'
      ? { state: 'loading' }
      : id === 'statistics-unavailable'
        ? { state: 'unavailable' }
        : id === 'statistics-restricted' || id === 'restricted'
          ? { state: 'restricted' }
          : {
              state: 'ready',
              periodDays: 30,
              customizedOrders:
                model.orders.state === 'ready' && (model.orders.items.length === 0 || id === 'expired-historic')
                  ? 0
                  : exampleActivity.reduce((sum, day) => sum + day.customizedOrders, 0),
              customizedItems:
                model.orders.state === 'ready' && (model.orders.items.length === 0 || id === 'expired-historic')
                  ? 0n
                  : exampleActivity.reduce((sum, day) => sum + day.customizedItems, 0n),
              productsOrdered:
                model.orders.state === 'ready' && (model.orders.items.length === 0 || id === 'expired-historic')
                  ? 0
                  : 7,
              excludesTestOrders: true,
              previousPeriod: {
                customizedOrders:
                  model.orders.state === 'ready' && (model.orders.items.length === 0 || id === 'expired-historic')
                    ? 0
                    : previousActivity.reduce((sum, day) => sum + day.customizedOrders, 0),
                customizedItems:
                  model.orders.state === 'ready' && (model.orders.items.length === 0 || id === 'expired-historic')
                    ? 0n
                    : previousActivity.reduce((sum, day) => sum + day.customizedItems, 0n),
                series:
                  model.orders.state === 'ready' && (model.orders.items.length === 0 || id === 'expired-historic')
                    ? previousActivity.map((day) => ({
                        ...day,
                        customizedOrders: 0,
                        customizedItems: 0n,
                        productsOrdered: 0,
                      }))
                    : previousActivity,
              },
              series:
                model.orders.state === 'ready' && (model.orders.items.length === 0 || id === 'expired-historic')
                  ? exampleActivity.map((day) => ({
                      ...day,
                      customizedOrders: 0,
                      customizedItems: 0n,
                      productsOrdered: 0,
                    }))
                  : exampleActivity,
            };
  return {
    ...model,
    ...(!firstUse ? { statistics } : {}),
    ...(model.products.state === 'ready'
      ? {
          guidance: {
            dismissed: id === 'guidance-dismissed' || id === 'no-products-dismissed',
            ...(id === 'operating-default-guide' || id === 'returning-no-products'
              ? {}
              : {
                  initiallyExpanded: ![
                    'operating',
                    'quiet-no-orders',
                    'orders-row-hover',
                    'orders-last-row-hover',
                  ].includes(id),
                }),
            completedSteps:
              id === 'guidance-complete' || id === 'quiet-no-orders'
                ? ['product', 'storefront', 'test']
                : id === 'guidance-progress' || id === 'published-setup-pending'
                  ? ['product']
                  : id === 'test-invitation'
                    ? ['product', 'storefront']
                    : [],
          },
        }
      : {}),
    orders:
      model.orders.state === 'ready'
        ? { ...model.orders, hasMore: model.orders.hasMore || id === 'operating' || id === 'busy-bounded' }
        : model.orders,
  };
}
