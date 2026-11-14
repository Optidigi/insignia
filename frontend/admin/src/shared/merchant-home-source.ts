import { PurchaseStatisticsSchema } from '@insignia/contracts';
import { z } from 'zod';
import {
  type HomeGuidance,
  type HomeGuidanceStepId,
  type HomeOrdersPanel,
  type HomeProductsPanel,
  type HomeSetup,
  type HomeStatistics,
  homeGuidanceStepIds,
} from './merchant-home.ts';
import { PurchaseListViewSchema } from './purchase-presentation.ts';
import { type ThemeSetupStatus, themeConnected } from './storefront-setup.ts';
import { offsetCalendarDay, orderCalendarDay, orderDayBoundary } from './purchase-view.ts';

const productsSchema = z.object({
  products: z
    .array(
      z.object({
        id: z.string().regex(/^gid:\/\/shopify\/Product\/[1-9][0-9]*$/),
        title: z.string().min(1).max(512),
        imageUrl: z.string().nullable().optional(),
        configurationSummary: z.object({ state: z.enum(['not_configured', 'draft', 'published']) }).optional(),
      }),
    )
    .max(100),
  nextCursor: z.string().nullable(),
});
type ReadyProducts = Extract<HomeProductsPanel, { state: 'ready' }>;
/** The first title-sorted page cannot establish store-wide configuration absence when more pages exist. */
export function homeProductsFromResponse(input: unknown): ReadyProducts {
  const page = productsSchema.parse(input);
  const configured = page.products.some(
    (p) => p.configurationSummary?.state === 'draft' || p.configurationSummary?.state === 'published',
  );
  const fullyKnown = page.nextCursor === null && page.products.every((p) => p.configurationSummary !== undefined);
  return {
    state: 'ready',
    catalog: configured
      ? 'configured'
      : !fullyKnown
        ? 'unknown'
        : page.products.length === 0
          ? 'no-products'
          : 'unconfigured',
    drafts: page.products
      .filter((p) => p.configurationSummary?.state === 'draft')
      .slice(0, 3)
      .map((p) => ({
        id: p.id,
        title: p.title,
        href: `/admin/products/${p.id.split('/').at(-1)}/config`,
        ...(p.imageUrl?.startsWith('https://') ? { thumbnail: p.imageUrl } : {}),
      })),
    canConfigure: true,
    ...(page.products.some((p) => p.configurationSummary?.state === 'published')
      ? { hasPublishedProduct: true }
      : fullyKnown
        ? { hasPublishedProduct: false }
        : {}),
  };
}

export function homeOrdersFromResponse(input: unknown, now = Date.now()): Extract<HomeOrdersPanel, { state: 'ready' }> {
  const page = PurchaseListViewSchema.parse(input);
  if (page.items.length === 0 && page.nextCursor !== null) throw new Error('Incomplete order page');
  const timeZone = page.timeZone ?? 'UTC';
  return {
    state: 'ready',
    // This is a bounded recent list, not a full attention queue. The list DTO has no precise recovery reason.
    tasks: [],
    timeZone,
    hasMore: page.nextCursor !== null || page.items.length > 5,
    items: page.items.slice(0, 5).map((order) => {
      const expired =
        order.artworkState === 'ERASED' ||
        order.groups.some(
          (group) =>
            Date.parse(group.payloadExpiresAt) <= now ||
            group.placements.some((p) => p.expired || (!!p.currentExpiresAt && Date.parse(p.currentExpiresAt) <= now)),
        );
      const ready =
        order.lines.length > 0 &&
        order.groups.length > 0 &&
        order.groups.every(
          (group) =>
            group.placements.length > 0 && group.placements.every((p) => p.currentAssetId && p.currentExpiresAt),
        );
      const itemCount = exactItemCount(order.lines);
      const productTitles = [...new Set(order.lines.map((line) => line.title ?? null))];
      const orderNumber = order.orderId.split('/').at(-1) || order.orderId;
      return {
        id: order.purchaseId,
        ...(order.orderName !== null && order.orderName !== undefined ? { orderName: order.orderName } : {}),
        orderNumber,
        href: `/admin/orders/${order.purchaseId}`,
        productTitles,
        orderCreatedAt: order.orderCreatedAt,
        itemCount,
        status: order.cancelledAt
          ? ('cancelled' as const)
          : expired
            ? ('expired' as const)
            : ready
              ? ('artwork-ready' as const)
              : ('artwork-needed' as const),
        ...(order.isTest === true ? { test: true } : {}),
      };
    }),
  };
}

function exactItemCount(lines: readonly { quantity: number }[]): bigint {
  return lines.reduce((total, line) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) throw new Error('Invalid customized item quantity');
    return total + BigInt(line.quantity);
  }, 0n);
}

export function homeSetupFromTheme(input: ThemeSetupStatus, hasPublishedProduct: boolean): HomeSetup | undefined {
  if (themeConnected(input))
    return hasPublishedProduct
      ? {
          initiallyCollapsed: true,
          tasks: [
            {
              id: 'test',
              kind: 'test',
              state: 'pending',
              action: { href: '/admin/settings/storefront#test-product' },
            },
          ],
        }
      : undefined;
  const knownMissing =
    [input.button, input.cart].every((value) => value === 'active' || value === 'available') &&
    (input.button === 'available' || input.cart === 'available');
  const reason = !knownMissing
    ? 'check'
    : input.button === 'active'
      ? 'cart-review-disabled'
      : input.cart === 'active'
        ? 'button-disabled'
        : 'both-disabled';
  return {
    initiallyCollapsed: false,
    tasks: [
      {
        id: 'storefront',
        kind: 'storefront',
        reason,
        state: knownMissing ? 'pending' : 'unknown',
        action: { href: '/admin/settings/storefront' },
      },
    ],
  };
}

export function homeHasPublishedProduct(input: unknown): boolean {
  return productsSchema.parse(input).products.some((p) => p.configurationSummary?.state === 'published');
}

/** Getting-started steps the store itself proves done; an unknown observation never counts. */
export function homeObservedGuidanceSteps(
  theme: ThemeSetupStatus,
  hasPublishedProduct: boolean,
): HomeGuidanceStepId[] {
  return homeGuidanceStepIds.filter((step) =>
    step === 'product' ? hasPublishedProduct : step === 'storefront' && themeConnected(theme),
  );
}

/** Merchant acknowledgements and observed facts form one completed list, in step order. */
export function homeGuidanceWithObservedSteps(
  guidance: { dismissed: boolean; completedSteps: HomeGuidanceStepId[] },
  observedSteps: HomeGuidanceStepId[],
): HomeGuidance {
  return {
    dismissed: guidance.dismissed,
    completedSteps: homeGuidanceStepIds.filter(
      (step) => guidance.completedSteps.includes(step) || observedSteps.includes(step),
    ),
    observedSteps,
  };
}

/** Exact metrics are available from this bounded read only when the entire collection was returned. */
export function homeStatisticsFromResponse(input: unknown, now = Date.now()): HomeStatistics | undefined {
  const page = PurchaseListViewSchema.parse(input);
  if (page.nextCursor !== null) return undefined;
  const timeZone = page.timeZone ?? 'UTC';
  const today = orderCalendarDay(new Date(now), timeZone);
  const startDay = offsetCalendarDay(today, -29);
  const start = Date.parse(orderDayBoundary(startDay, timeZone));
  const inPeriod = page.items.filter(
    (order) => Date.parse(order.orderCreatedAt) >= start && Date.parse(order.orderCreatedAt) <= now,
  );
  // An unknown test flag must not silently count as a live order or a verified zero.
  if (inPeriod.some((order) => order.isTest === null)) return undefined;
  const orders = inPeriod.filter((order) => order.isTest === false && order.cancelledAt === null);
  let items: bigint;
  try {
    items = orders.reduce((total, order) => total + exactItemCount(order.lines), 0n);
  } catch {
    return undefined;
  }
  const dailySeries = (firstDay: string, collection: typeof orders) =>
    Array.from({ length: 30 }, (_, index) => {
      const date = offsetCalendarDay(firstDay, index);
      const daily = collection.filter((order) => orderCalendarDay(new Date(order.orderCreatedAt), timeZone) === date);
      return {
        date,
        customizedOrders: daily.length,
        customizedItems: daily.reduce((total, order) => total + exactItemCount(order.lines), 0n),
        productsOrdered: new Set(daily.flatMap((order) => order.lines.map((line) => line.productId))).size,
      };
    });
  const series = dailySeries(startDay, orders);
  const previousDay = offsetCalendarDay(startDay, -30);
  const previousStart = Date.parse(orderDayBoundary(previousDay, timeZone));
  const previousRecords = page.items.filter(
    (order) => Date.parse(order.orderCreatedAt) >= previousStart && Date.parse(order.orderCreatedAt) < start,
  );
  const previousOrders = previousRecords.filter((order) => order.isTest === false && order.cancelledAt === null);
  let previousItems: bigint;
  let previousCountsAreExact = true;
  try {
    previousItems = previousOrders.reduce((total, order) => total + exactItemCount(order.lines), 0n);
  } catch {
    previousItems = -1n;
    previousCountsAreExact = false;
  }
  const previousPeriod =
    previousRecords.some((order) => order.isTest === null) || !previousCountsAreExact
      ? undefined
      : {
          customizedOrders: previousOrders.length,
          customizedItems: previousItems,
          series: dailySeries(previousDay, previousOrders),
        };
  return {
    state: 'ready',
    periodDays: 30,
    customizedOrders: orders.length,
    customizedItems: items,
    productsOrdered: new Set(orders.flatMap((order) => order.lines.map((line) => line.productId))).size,
    excludesTestOrders: true,
    series,
    ...(previousPeriod ? { previousPeriod } : {}),
  };
}

/** A dedicated store-wide aggregation is distinct from the bounded recent-orders panel. */
export function homeStatisticsFromAggregate(input: unknown): HomeStatistics | undefined {
  const parsed = PurchaseStatisticsSchema.safeParse(input);
  if (!parsed.success || !parsed.data.available) return undefined;
  const result = parsed.data;
  const today = orderCalendarDay(new Date(result.observedAt), result.timeZone);
  const first = offsetCalendarDay(today, -29), previousFirst = offsetCalendarDay(first, -30);
  const count = (value: string) => {
    const integer = BigInt(value);
    if (integer > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Count exceeds UI integer range');
    return Number(integer);
  };
  try {
    const period = (start: string) => {
      const days = Array.from({ length: 30 }, (_, index) => offsetCalendarDay(start, index));
      const source = days.map((day) => result.series.find((row) => row.day === day));
      const series = days.map((date, index) => ({ date, customizedOrders: count(source[index]?.orders ?? '0'), customizedItems: BigInt(source[index]?.items ?? '0'), productsOrdered: new Set(source[index]?.productIds ?? []).size }));
      return { customizedOrders: count(series.reduce((sum, row) => sum + BigInt(row.customizedOrders), 0n).toString()), customizedItems: series.reduce((sum, row) => sum + row.customizedItems, 0n), productsOrdered: new Set(source.flatMap((row) => row?.productIds ?? [])).size, series };
    };
    return { state: 'ready', periodDays: 30, excludesTestOrders: true, ...period(first), previousPeriod: period(previousFirst) };
  } catch { return undefined; }
}
