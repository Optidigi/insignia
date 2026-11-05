/** Deterministic, secret-free purchase records for the local admin preview only. */

import { type PurchaseView, PurchaseViewSchema } from '@insignia/contracts';
import { PurchaseListViewSchema } from '../../../src/shared/purchase-presentation.ts';

const ORDER_COUNT = 55;
const FUTURE_ARTWORK_EXPIRY = '2030-01-01T00:00:00.000Z';
const PRODUCTS = [
  {
    id: 'gid://shopify/Product/111',
    title: 'Organic cotton crewneck sweatshirt with brushed interior and reinforced shoulder seams',
    variantIds: ['gid://shopify/ProductVariant/11', 'gid://shopify/ProductVariant/12'],
    variants: ['Midnight navy / Medium', 'Midnight navy / 3XL'],
  },
  {
    id: 'gid://shopify/Product/222',
    title: 'Heavyweight canvas tote',
    variantIds: ['gid://shopify/ProductVariant/21', 'gid://shopify/ProductVariant/22'],
    variants: ['Natural / One size', 'Black / One size'],
  },
  {
    id: 'gid://shopify/Product/333',
    title: 'Relaxed-fit long sleeve tee',
    variantIds: ['gid://shopify/ProductVariant/31', 'gid://shopify/ProductVariant/32'],
    variants: ['Moss / Small', 'Moss / XL'],
  },
] as const;

const LONG_PRESENTATION = {
  version: 'm5-presentation-v1' as const,
  labels: {
    methods: { embroidery: 'Raised metallic thread embroidery with a reinforced satin stitch edge' },
    placements: {
      front: 'Left chest placement selected for the oversized embroidered crest artwork',
      sleeve: 'Outer sleeve placement for the secondary commemorative mark',
    },
    steps: { large: 'Oversized back panel decoration, up to the maximum supported print area' },
  },
};

function uuid(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function createdAt(index: number): string {
  const timestamp = Date.UTC(2026, 9, 19, 12) - (ORDER_COUNT - 1 - index) * 24 * 60 * 60 * 1000;
  return new Date(timestamp).toISOString();
}

function statusFor(index: number): PurchaseView['artworkState'] {
  return (['PENDING_ARTWORK', 'READY', 'ARTWORK_LOCKED', 'ERASED'] as const)[index % 4] ?? 'PENDING_ARTWORK';
}

function placement(index: number, groupIndex: number, placementId: string, artworkState: PurchaseView['artworkState']) {
  const hasCurrentArtwork = artworkState === 'READY' || artworkState === 'ARTWORK_LOCKED';
  const assetNumber = index * 10 + groupIndex * 2 + (placementId === 'sleeve' ? 2 : 1);
  return {
    id: placementId,
    methodId: groupIndex === 1 ? 'print' : groupIndex === 2 ? 'foil' : 'embroidery',
    stepId: 'large',
    originalArtwork:
      index % 2 === 0
        ? { kind: 'deferred' as const, intentId: `synthetic-intent-${index}-${groupIndex}-${placementId}` }
        : { kind: 'revision' as const, revisionId: `synthetic-artwork-revision-${index}-${groupIndex}-${placementId}` },
    currentAssetId: hasCurrentArtwork ? uuid('30000000', assetNumber) : null,
    currentExpiresAt: hasCurrentArtwork ? FUTURE_ARTWORK_EXPIRY : null,
    expired: false,
  };
}

function group(
  index: number,
  groupIndex: number,
  productId: string,
  variants: { variantId: string; quantity: number }[],
  artworkState: PurchaseView['artworkState'],
  withLongLabels = false,
) {
  return {
    index: groupIndex,
    productId,
    configRevisionId: `synthetic-config-revision-${index}-${groupIndex}`,
    variants,
    placements: [
      placement(index, groupIndex, 'front', artworkState),
      ...(groupIndex === 0 && index % 3 === 0 ? [placement(index, groupIndex, 'sleeve', artworkState)] : []),
    ],
    geometry: null,
    presentation: withLongLabels
      ? LONG_PRESENTATION
      : {
          version: 'm5-presentation-v1' as const,
          labels: {
            methods: { embroidery: 'Embroidery', print: 'Screen printing', foil: 'Metallic foil print' },
            placements: { front: 'Front', sleeve: 'Sleeve' },
            steps: { large: 'Large' },
          },
        },
    imageUrls: {},
    payloadExpiresAt: FUTURE_ARTWORK_EXPIRY,
  };
}

function buildLines(index: number, isMultiCustomizationOrder: boolean) {
  if (isMultiCustomizationOrder) {
    return [
      {
        orderLineId: 'line-crewneck-first-design',
        title: PRODUCTS[0].title,
        variantTitle: PRODUCTS[0].variants[0],
        productId: PRODUCTS[0].id,
        variantId: PRODUCTS[0].variantIds[0],
        quantity: 2,
        unitPriceMinor: '4500',
      },
      {
        orderLineId: 'line-tote-design',
        title: PRODUCTS[1].title,
        variantTitle: PRODUCTS[1].variants[0],
        productId: PRODUCTS[1].id,
        variantId: PRODUCTS[1].variantIds[0],
        quantity: 1,
        unitPriceMinor: '2800',
      },
      {
        orderLineId: 'line-crewneck-second-design',
        title: PRODUCTS[0].title,
        variantTitle: PRODUCTS[0].variants[0],
        productId: PRODUCTS[0].id,
        variantId: PRODUCTS[0].variantIds[0],
        quantity: 1,
        unitPriceMinor: '4500',
      },
      {
        orderLineId: 'line-crewneck-large-size',
        title: PRODUCTS[0].title,
        variantTitle: PRODUCTS[0].variants[1],
        productId: PRODUCTS[0].id,
        variantId: PRODUCTS[0].variantIds[1],
        quantity: 1,
        unitPriceMinor: '5200',
      },
    ];
  }

  const product = PRODUCTS[index % PRODUCTS.length] ?? PRODUCTS[0];
  const variantIndex = index % 2;
  const quantities = [1 + (index % 3), ...(index % 5 === 0 ? [1] : [])];
  return quantities.map((quantity, lineIndex) => {
    const selectedVariant = (variantIndex + lineIndex) % product.variantIds.length;
    return {
      orderLineId: `line-${index + 1}-${lineIndex + 1}`,
      title: product.title,
      variantTitle: product.variants[selectedVariant] ?? 'One size',
      productId: product.id,
      variantId: product.variantIds[selectedVariant] ?? product.variantIds[0] ?? 'gid://shopify/ProductVariant/11',
      quantity,
      unitPriceMinor: String(4200 + selectedVariant * 650 + (index % 4) * 100),
    };
  });
}

function buildGroups(
  index: number,
  artworkState: PurchaseView['artworkState'],
  multiCustomization: boolean,
  lines: ReturnType<typeof buildLines>,
) {
  if (artworkState === 'ERASED') return [];
  if (multiCustomization) {
    return [
      group(
        index,
        0,
        PRODUCTS[0].id,
        [
          { variantId: PRODUCTS[0].variantIds[0], quantity: 2 },
          { variantId: PRODUCTS[0].variantIds[1], quantity: 1 },
        ],
        artworkState,
        true,
      ),
      group(index, 1, PRODUCTS[1].id, [{ variantId: PRODUCTS[1].variantIds[0], quantity: 1 }], artworkState),
      group(index, 2, PRODUCTS[0].id, [{ variantId: PRODUCTS[0].variantIds[0], quantity: 1 }], artworkState),
    ];
  }

  const product = PRODUCTS[index % PRODUCTS.length] ?? PRODUCTS[0];
  const variants = lines
    .filter((line) => line.productId === product.id)
    .map((line) => ({ variantId: line.variantId, quantity: line.quantity }));
  return [
    group(
      index,
      0,
      product.id,
      variants.length > 0
        ? variants
        : [{ variantId: product.variantIds[0] ?? 'gid://shopify/ProductVariant/11', quantity: 1 + (index % 3) }],
      artworkState,
      index === 5,
    ),
  ];
}

function artworkEvents(
  index: number,
  artworkState: PurchaseView['artworkState'],
  groups: ReturnType<typeof buildGroups>,
) {
  if (artworkState === 'ERASED') return [];
  if (artworkState === 'PENDING_ARTWORK') return [];

  let version = 0;
  const events = [];
  for (const currentGroup of groups) {
    for (const [placementIndex, currentPlacement] of currentGroup.placements.entries()) {
      version += 1;
      const attached = {
        eventId: `synthetic-attach-${index}-${currentGroup.index}-${placementIndex}`,
        version,
        kind: 'ATTACH' as const,
        groupIndex: currentGroup.index,
        placementId: currentPlacement.id,
        assetId: currentPlacement.currentAssetId,
        expiresAt: currentPlacement.currentExpiresAt,
        erasedAt: null,
      };
      events.push(attached);
      if (artworkState === 'ARTWORK_LOCKED') {
        version += 1;
        events.push({
          ...attached,
          eventId: `synthetic-lock-${index}-${currentGroup.index}-${placementIndex}`,
          version,
          kind: 'LOCK' as const,
        });
      }
    }
  }
  return events;
}

function purchase(index: number): PurchaseView {
  const artworkState = statusFor(index);
  const isMultiCustomizationOrder = index === 9;
  const cancelled = index % 13 === 0;
  const lines = buildLines(index, isMultiCustomizationOrder);
  const groups = buildGroups(index, artworkState, isMultiCustomizationOrder, lines);
  const events = artworkEvents(index, artworkState, groups);
  const totalMinor = lines.reduce((total, line) => total + Number(line.unitPriceMinor) * line.quantity, 0);
  const financialStatus = cancelled
    ? 'VOIDED'
    : index % 10 === 6
      ? 'PARTIALLY_REFUNDED'
      : index % 10 === 7
        ? 'REFUNDED'
        : index % 10 === 8
          ? 'PENDING'
          : 'PAID';
  const paid = financialStatus !== 'PENDING' && financialStatus !== 'VOIDED';
  const refund = financialStatus === 'PARTIALLY_REFUNDED' || financialStatus === 'REFUNDED';
  const orderDate = createdAt(index);

  return PurchaseViewSchema.parse({
    version: 'm8-purchase-v1',
    purchaseId: uuid('10000000', index + 1),
    orderId: `gid://shopify/Order/${900001 + index}`,
    orderName: `#${1001 + index}`,
    orderCreatedAt: orderDate,
    isTest: index % 10 === 0 ? true : index % 17 === 0 ? null : false,
    currency: 'USD',
    exponent: 2,
    originalTotalMinor: String(totalMinor),
    firstPaidAt: paid ? new Date(Date.parse(orderDate) + 60_000).toISOString() : null,
    financialStatus,
    cancelledAt: cancelled ? new Date(Date.parse(orderDate) + 120_000).toISOString() : null,
    exceptions: [],
    artworkVersion: events.at(-1)?.version ?? (artworkState === 'ERASED' ? 2 : 0),
    artworkState,
    refunds: refund
      ? [
          {
            refundId: `synthetic-refund-${index + 1}`,
            occurredAt: new Date(Date.parse(orderDate) + 180_000).toISOString(),
            currency: 'USD',
            amountMinor: financialStatus === 'REFUNDED' ? String(totalMinor) : '1200',
            lines:
              financialStatus === 'REFUNDED'
                ? lines.map((line) => ({
                    lineId: line.orderLineId,
                    quantity: line.quantity,
                    amountMinor: String(Number(line.unitPriceMinor) * line.quantity),
                  }))
                : [{ lineId: lines[0]?.orderLineId ?? 'line-missing', quantity: 1, amountMinor: '1200' }],
          },
        ]
      : [],
    lines,
    groups,
    artworkEvents: events,
  });
}

/** Produces isolated API fixtures; it never reads real orders or calls a provider. */
export function createRichPurchasePreviewFixtures(): Record<string, unknown> {
  const items = Array.from({ length: ORDER_COUNT }, (_, index) => purchase(index));
  const list = PurchaseListViewSchema.parse({
    version: 'm8-purchase-list-v1',
    timeZone: 'Europe/Amsterdam',
    items: [...items].sort((a, b) => Date.parse(b.orderCreatedAt) - Date.parse(a.orderCreatedAt)),
    nextCursor: null,
  });
  return Object.fromEntries([
    ['/api/purchases/v1', list],
    ...items.map((item) => [`/api/purchases/v1/${item.purchaseId}`, PurchaseViewSchema.parse(item)]),
  ]);
}
