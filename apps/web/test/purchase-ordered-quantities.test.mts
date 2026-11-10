import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { AcceptedQuote, QuoteRequest } from '@insignia/application';
import type { PurchaseRecord } from '@insignia/database';
import {
  type CustomizationGroup,
  normalizeCustomizationGroups,
  type PricingRule,
  type PublishedConfig,
  priceProposal,
} from '@insignia/domain';
import { createPurchaseServices } from '../src/server/purchase/service.ts';
import { actorFixture, coreFixture, purchaseRecord, required } from './http-fixtures.mts';

type Binding = PurchaseRecord['bindings'][number];
type StoredLine = Binding['lines'][number];

const actor = actorFixture({
  tenantShopId: 'shop',
  canReadOrders: true,
  canReadArtwork: true,
  canUploadArtwork: true,
});
const hash = 'a'.repeat(64);
const later = '2099-01-01T00:00:00.000Z';

/** The purchase repository keeps economics without artwork-linked identity digests. */
function stored(quote: Pick<AcceptedQuote, 'economics' | 'physicalGroups'>): unknown {
  const strip = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(strip)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([key]) => key !== 'canonicalIdentitySha256' && key !== 'revisionContentHash')
              .map(([key, entry]) => [key, strip(entry)]),
          )
        : value;
  return {
    version: 'm8-purchase-economics-v1',
    economics: strip(quote.economics),
    physicalGroups: quote.physicalGroups.map(({ productId, configRevisionId, variants }) => ({
      productId,
      configRevisionId,
      variants,
    })),
  };
}

function config(productId: string): PublishedConfig {
  const setup: PricingRule = {
    id: 'setup',
    role: 'setup',
    scope: { kind: 'general' },
    rate: { kind: 'fixed', amount: { shopDecimal: '10.00', presentmentOverrides: [] } },
  };
  return {
    version: 'm2-published-config-v1',
    shopId: 'shop',
    productId,
    revisionId: `${productId}-r1`,
    revisionContentHash: hash,
    shopCurrency: 'EUR',
    methods: [{ id: 'embroidery' }],
    placements: [
      { id: 'front', allowedMethodIds: ['embroidery'], allowedStepIds: ['small'], logoLaterAllowed: true },
      { id: 'back', allowedMethodIds: ['embroidery'], allowedStepIds: ['small'], logoLaterAllowed: true },
    ],
    productionOptions: [],
    pricingRules: [setup],
  };
}
function design(
  productId: string,
  placementId: string,
  artwork: string,
  variants: { variantId: string; quantity: number }[],
): CustomizationGroup {
  return {
    version: 'm2-customization-group-v1',
    shopId: 'shop',
    productId,
    configRevisionId: `${productId}-r1`,
    revisionContentHash: hash,
    design: {
      placements: [
        { placementId, methodId: 'embroidery', stepId: 'small', artwork: { kind: 'revision', revisionId: artwork } },
      ],
      options: [],
    },
    variants,
  };
}

/** Real pricing engine output for a representative multi-design v2 offer, stored as reconciliation stores it. */
function pricedBinding() {
  // Two different designs share product and variant, and setup remainders split variants into bucket lines.
  const groups = [
    design('shirt', 'front', '11111111-1111-4111-8111-111111111111', [
      { variantId: 'm', quantity: 3 },
      { variantId: 'l', quantity: 4 },
    ]),
    design('shirt', 'back', '22222222-2222-4222-8222-222222222222', [{ variantId: 'm', quantity: 6 }]),
    design('cap', 'front', '33333333-3333-4333-8333-333333333333', [{ variantId: 'one', quantity: 7 }]),
  ];
  const configs = [config('shirt'), config('cap')];
  const economics = priceProposal({
    shopId: 'shop',
    groups,
    configs,
    bases: groups
      .flatMap((group) =>
        group.variants.map((variant) => ({
          shopId: 'shop',
          productId: group.productId,
          variantId: variant.variantId,
          currency: 'EUR',
          minor: '2000',
          contextId: 'market',
        })),
      )
      .filter(
        (base, index, all) =>
          all.findIndex((other) => other.productId === base.productId && other.variantId === base.variantId) === index,
      ),
    currency: { version: 'm2-currency-resolution-v1', presentmentCurrency: 'EUR', exponents: { EUR: 2 } },
    effectiveAt: '2026-10-01T10:00:00.000Z',
    marketContext: 'DE',
    roundingPolicy: 'm2-half-even-v1',
  });
  const normalized = normalizeCustomizationGroups(groups, configs);
  const request: QuoteRequest = {
    shopId: 'shop',
    installationGeneration: '1',
    idempotencyKey: 'key',
    country: 'DE',
    marketId: '1',
    groups: normalized.map(({ canonicalIdentity: _identity, ...group }) => ({ group })),
    capacity: { ordinaryLineCount: 0, inputBytes: 1 },
  };
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const quote = {
    economics: {
      ...economics,
      version: 'm4-quote-economics-v1' as const,
      groups: economics.groups.map(({ canonicalIdentity, ...group }) => ({
        ...group,
        canonicalIdentitySha256: digest(canonicalIdentity),
      })),
      lines: economics.lines.map(({ canonicalIdentity, ...line }) => ({
        ...line,
        canonicalIdentitySha256: digest(canonicalIdentity),
      })),
    },
    physicalGroups: normalized.map((group) => ({
      productId: group.productId,
      configRevisionId: group.configRevisionId,
      revisionContentHash: group.revisionContentHash,
      canonicalIdentitySha256: digest(group.canonicalIdentity),
      variants: group.variants,
    })),
  };
  return { request, quote, revisionIds: configs.map((entry) => entry.revisionId) };
}

/** The committed real accepted-quote fixture: one design, one variant split into two signed bucket lines. */
function fixtureBinding() {
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../../packages/cart-authorization/fixtures/accepted-quote-example.json', import.meta.url),
      'utf8',
    ),
  ) as { quote: AcceptedQuote };
  const quote = fixture.quote;
  const accepted = required(quote.physicalGroups[0]);
  const request: QuoteRequest = {
    shopId: quote.shopId,
    installationGeneration: quote.installationGeneration,
    idempotencyKey: 'key',
    country: quote.country,
    marketId: quote.marketId,
    groups: [
      {
        group: {
          version: 'm2-customization-group-v1',
          shopId: quote.shopId,
          productId: accepted.productId,
          configRevisionId: accepted.configRevisionId,
          revisionContentHash: accepted.revisionContentHash,
          design: {
            placements: [
              {
                placementId: 'front',
                methodId: 'embroidery',
                stepId: 'small',
                artwork: { kind: 'revision', revisionId: '44444444-4444-4444-8444-444444444444' },
              },
            ],
            options: [],
          },
          variants: [...accepted.variants],
        },
      },
    ],
    capacity: { ordinaryLineCount: 0, inputBytes: 1 },
  };
  return { request, quote, revisionIds: [accepted.configRevisionId] };
}

function binding(
  source: ReturnType<typeof pricedBinding> | ReturnType<typeof fixtureBinding>,
  lines: readonly StoredLine[],
): Binding {
  return {
    quoteId: 'quote',
    authorizationSetId: 'set',
    economics: stored(source.quote),
    lines,
    designPayload: {
      version: 'm8-purchase-design-v1',
      request: source.request,
      collectedAt: '2026-10-01T10:00:00.000Z',
      revisions: source.revisionIds.map((revisionId) => ({
        revisionId,
        published: null,
        geometry: null,
        presentation: null,
      })),
    },
    payloadExpiresAt: later,
    erasedAt: null,
  };
}
/** A whole-set v2 order: exactly one order line per signed economics line, at the accepted quantity. */
function wholeSet(source: ReturnType<typeof pricedBinding> | ReturnType<typeof fixtureBinding>): StoredLine[] {
  return source.quote.economics.lines.map((line) => ({
    orderLineId: `gid://shopify/LineItem/${line.lineIndex + 1}`,
    lineIndex: line.lineIndex,
    productId: line.productId,
    variantId: line.variantId,
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
  }));
}
async function view(bindings: Binding[], overrides: Partial<PurchaseRecord> = {}) {
  const record = purchaseRecord({ shopId: 'shop', bindings, ...overrides });
  const services = createPurchaseServices({
    core: coreFixture({
      purchases: {
        get: async () => record,
        // Artwork authorization is outside this projection; the current asset ID is still reported.
        getAuthorizedArtwork: async () => null,
      },
    }),
    appOrigin: 'https://insignia.example',
    authenticate: async () => actor,
  });
  return required(await services.get(actor, record.purchaseId));
}
/** What the merchant view showed before ordered lines became the source: every accepted design and vector. */
function acceptedProjection(request: QuoteRequest) {
  return request.groups.map(({ group }, index) => ({
    index,
    productId: group.productId,
    configRevisionId: group.configRevisionId,
    variants: group.variants,
  }));
}
const projection = (groups: Awaited<ReturnType<typeof view>>['groups']) =>
  groups.map(({ index, productId, configRevisionId, variants }) => ({ index, productId, configRevisionId, variants }));

test('whole-set v2 orders show exactly the accepted designs and quantities', async () => {
  for (const source of [pricedBinding(), fixtureBinding()]) {
    const lines = wholeSet(source);
    assert.ok(
      lines.length > source.request.groups.reduce((sum, { group }) => sum + group.variants.length, 0),
      'fixture must include setup-remainder bucket lines',
    );
    const result = await view([binding(source, lines)]);
    assert.deepEqual(projection(result.groups), acceptedProjection(source.request));
    assert.deepEqual(
      result.lines.map((line) => line.orderLineId),
      lines.map((line) => line.orderLineId),
    );
  }
});

test('ordered quantities, not accepted quantities, drive design vectors and omit unordered designs', async () => {
  const source = pricedBinding();
  const all = wholeSet(source);
  const economics = source.quote.economics.lines;
  // Order one shirt/m line at a different quantity and the cap at quantity 1 per line; the other shirt design
  // (same product and variant) is absent.
  const firstShirtM = required(economics.find((line) => line.productId === 'shirt' && line.variantId === 'm'));
  const cap = economics.filter((line) => line.productId === 'cap');
  const lines = [
    { ...required(all[firstShirtM.lineIndex]), quantity: 9 },
    ...cap.map((line) => ({ ...required(all[line.lineIndex]), quantity: 1 })),
  ];
  const positions = source.request.groups.map(({ group }) => group.productId);
  const capIndex = positions.indexOf('cap');
  // Designs are priced in stored request order, so the first shirt/m economics line belongs to the first shirt design.
  const orderedShirt = positions.indexOf('shirt');
  const unorderedShirt = positions.lastIndexOf('shirt');
  assert.notEqual(orderedShirt, unorderedShirt);
  const deferredEvent = {
    eventId: 'event',
    version: 1,
    kind: 'ATTACH' as const,
    groupIndex: capIndex,
    placementId: 'front',
    assetId: '55555555-5555-4555-8555-555555555555',
    expiresAt: later,
    erasedAt: null,
  };
  const result = await view([binding(source, lines)], { artworkEvents: [deferredEvent], artworkVersion: 1 });
  const accepted = acceptedProjection(source.request);
  assert.deepEqual(
    projection(result.groups),
    [
      { ...required(accepted[orderedShirt]), variants: [{ variantId: 'm', quantity: 9 }] },
      { ...required(accepted[capIndex]), variants: [{ variantId: 'one', quantity: cap.length }] },
    ].sort((a, b) => a.index - b.index),
  );
  assert.equal(
    result.groups.some((group) => group.index === unorderedShirt),
    false,
  );
  const shownCap = required(result.groups.find((group) => group.index === capIndex));
  // Group indices remain the signed design positions that artwork events key on.
  assert.equal(required(shownCap.placements[0]).currentAssetId, deferredEvent.assetId);
  // Production completeness: design vectors now equal the order lines product/variant totals.
  const total = (entries: { variantId: string; quantity: number }[]) =>
    entries.reduce((sum, entry) => sum + entry.quantity, 0);
  assert.equal(total(result.groups.flatMap((group) => group.variants)), total(result.lines));
});

test('a bucket-split variant ordered partially sums its ordered lines', async () => {
  const source = fixtureBinding();
  const [first] = wholeSet(source);
  const result = await view([binding(source, [{ ...required(first), quantity: 5 }])]);
  assert.deepEqual(
    projection(result.groups).map((group) => group.variants),
    [[{ variantId: required(required(source.request.groups[0]).group.variants[0]).variantId, quantity: 5 }]],
  );
});

test('refunds and order lines remain the observed Shopify facts while design vectors follow ordered lines', async () => {
  const source = pricedBinding();
  const lines = wholeSet(source);
  const refunds = [
    {
      refundId: 'gid://shopify/Refund/1',
      occurredAt: '2026-10-02T10:00:00.000Z',
      currency: 'EUR',
      amountMinor: '100',
      lines: [{ lineId: required(lines[0]).orderLineId, quantity: 1, amountMinor: '100' }],
    },
  ];
  const result = await view([binding(source, lines)], { refunds, currency: 'EUR' });
  assert.deepEqual(result.refunds, refunds);
  assert.deepEqual(projection(result.groups), acceptedProjection(source.request));
});

test('unverifiable line mapping keeps the accepted vectors rather than inventing a production quantity', async () => {
  const source = pricedBinding();
  const lines = wholeSet(source);
  const malformed = [
    // Stored line index outside the signed economics.
    [...lines, { ...required(lines[0]), orderLineId: 'gid://shopify/LineItem/99', lineIndex: 31 }],
    // Stored variant disagrees with the signed economics line.
    [{ ...required(lines[0]), variantId: 'other' }, ...lines.slice(1)],
  ];
  for (const entries of malformed) {
    const result = await view([binding(source, entries)]);
    assert.deepEqual(projection(result.groups), acceptedProjection(source.request));
  }
  const missingEconomics = { ...binding(source, lines), economics: null };
  assert.deepEqual(projection((await view([missingEconomics])).groups), acceptedProjection(source.request));
});
