import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  type AuthorizationSigner,
  encodeHeader,
  encodeMember,
  issueLineSetV3,
  LINE_ATTRIBUTE,
  lineRefV3,
  REF_ATTRIBUTE,
  wholeQuoteSignBytes,
} from '@insignia/cart-authorization';
import { describe, expect, it, vi } from 'vitest';
import type { AcceptedQuote } from '../quote/accept-quote.js';
import { localDay } from '../quote/accept-quote.js';
import type { HistoricalPurchaseOffer, PurchaseObservation, VerifiedOrder } from './model.js';
import { reconcilePurchase } from './reconcile.js';

/** Replaces the final character with a different one, so the tamper can never be a no-op. */
function alterLastChar(value: string): string {
  const altered = `${value.slice(0, -1)}${value.endsWith('A') ? 'B' : 'A'}`;
  expect(altered).not.toBe(value);
  return altered;
}

const createdAt = '2026-10-20T10:00:00.000Z';
const day = localDay(new Date(createdAt), 'Europe/Berlin').ordinal;
const quoteId = '11111111-1111-4111-8111-111111111111';
const setId = '22222222-2222-4222-8222-222222222222';
const generation = '33333333-3333-4333-8333-333333333333';
const accepted = [
  { variantId: '8', quantity: 1, unitMinor: '3034' },
  { variantId: '9', quantity: 2, unitMinor: '3033' },
  { variantId: '8', quantity: 4, unitMinor: '1000' },
];

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}

async function fixture() {
  // Synthetic labelled test key; never a merchant key.
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const signer: AuthorizationSigner = {
    signWholeQuote: async (input) => ({
      keyId: 1,
      publicKeyFingerprint: 'synthetic',
      firstValidDay: day - 1,
      lastValidDay: day + 3,
      signature: sign(null, input.message, pair.privateKey),
    }),
  };
  const records = accepted.map((line, index) => ({ index, variantId: line.variantId, unitMinor: line.unitMinor }));
  const issued = await issueLineSetV3(
    {
      keyId: 1,
      generationHex: generation.replaceAll('-', ''),
      epoch: 1,
      quoteHex: quoteId.replaceAll('-', ''),
      setHex: setId.replaceAll('-', ''),
      currency: 'EUR',
      exponent: 2,
      country: 'DE',
      marketId: '42',
      validThroughDay: day + 2,
    },
    records,
    day,
    signer,
  );
  const quote = {
    schemaVersion: 'm4-accepted-quote-v1',
    acceptedDate: '2026-10-20',
    shopCurrency: 'EUR',
    policyVersion: 'fixture',
    recognizedPolicyId: 'fixture',
    trial: false,
    qualifyingUsageDisposition: 'NOT_METERED',
    physicalGroups: [],
    artworkChecks: [],
    effectiveRevisions: [],
    catalogSnapshots: [],
    fxSnapshot: null,
    quoteId,
    shopId: 'shop',
    installationGeneration: '1',
    authorizationGeneration: generation,
    authorizationEpoch: 1,
    acceptedAt: '2026-10-20T08:00:00Z',
    acceptedDay: day,
    validThroughDay: day + 2,
    shopTimezone: 'Europe/Berlin',
    presentmentCurrency: 'EUR',
    presentmentExponent: 2,
    country: 'DE',
    marketId: '42',
    economics: {
      version: 'm4-quote-economics-v1',
      shopId: 'shop',
      pricingEngineVersion: 'm2-pricing-v1',
      roundingPolicy: 'm2-half-even-v1',
      currency: { version: 'm2-currency-resolution-v1', presentmentCurrency: 'EUR', exponents: { EUR: 2 } },
      fx: null,
      effectiveAt: '2026-10-20T08:00:00Z',
      marketContext: '42',
      groups: [],
      customizedQuantity: 7,
      totalMinor: '13100',
      lines: accepted.map((line, index) => ({
        lineIndex: index,
        shopId: 'shop',
        configRevisionId: 'revision',
        revisionContentHash: 'a'.repeat(64),
        canonicalIdentitySha256: 'b'.repeat(64),
        unitOrdinalStart: 1,
        unitOrdinalEnd: line.quantity,
        setupPerUnitMinor: '0',
        lineTotalMinor: (BigInt(line.unitMinor) * BigInt(line.quantity)).toString(),
        productId: '7',
        variantId: line.variantId,
        quantity: line.quantity,
        unitPriceMinor: line.unitMinor,
      })),
    },
  } as unknown as AcceptedQuote;
  const offer: HistoricalPurchaseOffer = {
    quote,
    authorization: {
      setId,
      keyId: 1,
      publicKeyFingerprint: createHash('sha256').update(publicKey).digest('hex'),
      firstValidDay: day - 1,
      lastValidDay: day + 3,
      validThroughDay: day + 2,
      envelopeCarrier: issued.prefix,
      members: issued.carriers.map((carrier, lineIndex) => ({ carrier, lineIndex })),
    },
    issuance: {
      issuedAt: '2026-10-20T08:00:00.000Z',
      issuedDay: day,
      validThroughDay: day + 2,
      shopTimezone: 'Europe/Berlin',
    },
    publicKey,
    keyRevokedAt: null,
    installationWindow: { generation: '1', startedAt: '2026-10-01T00:00:00.000Z', deactivatedAt: null },
    designPayload: { historical: true },
    payloadCollectedAt: '2026-10-20T08:00:00.000Z',
    payloadExpiresAt: '2027-04-01T00:00:00.000Z',
  };
  const orderLine = (index: number, quantity: number, carrier = must(issued.carriers[index])) => ({
    lineId: `gid://shopify/LineItem/${index + 1}`,
    productId: 'gid://shopify/Product/7',
    variantId: `gid://shopify/ProductVariant/${must(accepted[index]).variantId}`,
    quantity,
    currentQuantity: quantity,
    originalUnitPriceMinor: must(accepted[index]).unitMinor,
    sellingPlanId: null as string | null,
    attributes: [
      { key: REF_ATTRIBUTE, value: lineRefV3(setId.replaceAll('-', ''), index) },
      { key: LINE_ATTRIBUTE, value: carrier },
    ],
  });
  // The buyer ordered five of design 0 (accepted one) and none of design 1.
  const lines = [orderLine(0, 5), orderLine(2, 1)];
  const order: VerifiedOrder = {
    shopId: 'shop',
    installationGeneration: '1',
    orderId: 'gid://shopify/Order/9',
    createdAt,
    updatedAt: createdAt,
    observedAt: '2026-10-21T00:00:00.000Z',
    currency: 'EUR',
    country: 'DE',
    marketId: '42',
    contextVerified: true,
    totalPriceMinor: '16170',
    test: false,
    edited: false,
    sourceApiVersion: '2026-07',
    complete: true,
    financialStatus: 'PAID',
    cancelledAt: null,
    lines,
    transactions: [
      {
        transactionId: 'pay',
        kind: 'SALE',
        status: 'SUCCESS',
        occurredAt: createdAt,
        currency: 'EUR',
        amountMinor: '16170',
      },
    ],
    refunds: [],
  };
  const ports = {
    orders: { read: vi.fn(async () => order) },
    offers: { get: vi.fn(async () => offer) },
    store: { reconcile: vi.fn(async (observation: PurchaseObservation) => observation) },
  };
  return { order, offer, ports, issued, orderLine, pair };
}
const run = async (ports: Awaited<ReturnType<typeof fixture>>['ports']) =>
  (await reconcilePurchase(
    { shopId: 'shop', installationGeneration: '1', orderId: 'gid://shopify/Order/9' },
    ports,
  )) as PurchaseObservation;

describe('cart-line v3 purchase reconciliation', () => {
  it('binds ordered quantities and admits a subset of the accepted quote', async () => {
    const { ports } = await fixture();
    const observation = await run(ports);
    expect(observation.exception).toBeNull();
    expect(observation.bindings).toHaveLength(1);
    expect(observation.bindings[0]?.lines).toEqual([
      {
        orderLineId: 'gid://shopify/LineItem/1',
        lineIndex: 0,
        productId: '7',
        variantId: '8',
        quantity: 5,
        unitPriceMinor: '3034',
      },
      {
        orderLineId: 'gid://shopify/LineItem/3',
        lineIndex: 2,
        productId: '7',
        variantId: '8',
        quantity: 1,
        unitPriceMinor: '1000',
      },
    ]);
    expect(observation.bindings[0]?.evidence).toEqual({ kind: 'provider_context', country: 'DE', marketId: '42' });
    expect(ports.offers.get).toHaveBeenCalledWith(expect.objectContaining({ quoteId, authorizationSetId: setId }));
  });

  it('accepts an unexpanded line without a child reference but never a wrong reference', async () => {
    const { ports, order } = await fixture();
    const first = must(order.lines[0]);
    order.lines = [{ ...first, attributes: first.attributes.filter((a) => a.key !== REF_ATTRIBUTE) }];
    expect((await run(ports)).exception).toBeNull();
    order.lines = [
      {
        ...first,
        attributes: [
          { key: REF_ATTRIBUTE, value: lineRefV3(setId.replaceAll('-', ''), 1) },
          { key: LINE_ATTRIBUTE, value: must(first.attributes[1]).value },
        ],
      },
    ];
    expect((await run(ports)).exception).toBe('ORDER_LINE_MISMATCH');
  });

  const rejections: [string, string, (f: Awaited<ReturnType<typeof fixture>>) => void][] = [
    [
      'forged proof',
      'INVALID_AUTHORIZATION_SIGNATURE',
      ({ order, issued, orderLine }) => {
        const bytes = Buffer.from(must(issued.carriers[0]), 'base64url');
        bytes[200] = must(bytes[200]) ^ 1;
        order.lines = [orderLine(0, 1, bytes.toString('base64url'))];
      },
    ],
    [
      'forged signature',
      'INVALID_AUTHORIZATION_SIGNATURE',
      ({ order, offer, issued, orderLine }) => {
        const bytes = Buffer.from(must(issued.carriers[0]), 'base64url');
        bytes[150] = must(bytes[150]) ^ 1;
        const forged = bytes.toString('base64url');
        offer.authorization.envelopeCarrier = forged.slice(0, 236);
        offer.authorization.members = offer.authorization.members.map((m, i) =>
          i === 0 ? { ...m, carrier: forged } : m,
        );
        order.lines = [orderLine(0, 1, forged)];
      },
    ],
    [
      'duplicate carrier',
      'INVALID_AUTHORIZATION_SIGNATURE',
      ({ order, orderLine }) => {
        order.lines = [orderLine(0, 1), { ...orderLine(0, 2), lineId: 'gid://shopify/LineItem/9' }];
      },
    ],
    [
      'mixed v2 and v3',
      'MIXED_AUTHORIZATION_SETS',
      ({ order, orderLine, pair }) => {
        const header = {
          keyId: 1,
          generationHex: generation.replaceAll('-', ''),
          epoch: 1,
          quoteHex: quoteId.replaceAll('-', ''),
          setHex: setId.replaceAll('-', ''),
          count: 1,
          currency: 'EUR',
          exponent: 2,
          country: 'DE',
          marketId: '42',
          validThroughDay: day + 2,
          totalQuantity: 1,
          totalMinor: '3033',
        };
        const members = [{ index: 0, variantId: '9', quantity: 1, unitMinor: '3033' }];
        const envelope = Buffer.concat([
          encodeHeader(header),
          sign(null, wholeQuoteSignBytes(header, members), pair.privateKey),
        ]).toString('base64url');
        order.lines = [
          orderLine(0, 1),
          {
            ...orderLine(1, 1),
            attributes: [
              { key: '_insignia_quote_v2', value: envelope },
              { key: '_insignia_member_v2', value: encodeMember(must(members[0])).toString('base64url') },
            ],
          },
        ];
      },
    ],
    [
      'carrier from another set',
      'MIXED_AUTHORIZATION_SETS',
      ({ order, orderLine, issued }) => {
        const other = Buffer.from(must(issued.carriers[1]), 'base64url');
        other[59] = must(other[59]) ^ 1; // set UUID byte: a different prefix
        order.lines = [orderLine(0, 1), orderLine(1, 1, other.toString('base64url'))];
      },
    ],
    [
      'stored history differs',
      'AUTHORIZATION_HISTORY_MISMATCH',
      ({ offer }) => {
        offer.authorization.envelopeCarrier = alterLastChar(offer.authorization.envelopeCarrier);
      },
    ],
    [
      'stored member differs',
      'ORDER_LINE_MISMATCH',
      ({ offer, issued }) => {
        offer.authorization.members = offer.authorization.members.map((m, i) =>
          i === 0 ? { ...m, carrier: must(issued.carriers[1]) } : m,
        );
      },
    ],
    [
      'order unit differs from signed unit',
      'ORDER_LINE_MISMATCH',
      ({ order }) => {
        order.lines = [{ ...must(order.lines[0]), originalUnitPriceMinor: '3033' }];
      },
    ],
    [
      'real variant differs',
      'ORDER_LINE_MISMATCH',
      ({ order }) => {
        order.lines = [{ ...must(order.lines[0]), variantId: 'gid://shopify/ProductVariant/9' }];
      },
    ],
    [
      'selling plan',
      'ORDER_LINE_MISMATCH',
      ({ order }) => {
        order.lines = [{ ...must(order.lines[0]), sellingPlanId: 'gid://shopify/SellingPlan/1' }];
      },
    ],
    [
      'more than 10,000 customized units',
      'ORDER_LINE_MISMATCH',
      ({ order, orderLine }) => {
        order.lines = [orderLine(0, 6000), orderLine(1, 4001)];
      },
    ],
    [
      'order after D+2',
      'AUTHORIZATION_HISTORY_MISMATCH',
      ({ order }) => {
        order.createdAt = '2026-10-23T10:00:00.000Z';
        order.updatedAt = order.createdAt;
        order.observedAt = '2026-10-24T00:00:00.000Z';
        order.transactions = [];
      },
    ],
    [
      'order context differs',
      'ORDER_CONTEXT_MISMATCH',
      ({ order }) => {
        order.country = 'NL';
      },
    ],
    [
      'malformed carrier',
      'INVALID_ORDER_CARRIERS',
      ({ order, orderLine }) => {
        order.lines = [orderLine(0, 1, 'not-a-carrier')];
      },
    ],
    [
      'two carriers on one line',
      'INVALID_ORDER_CARRIERS',
      ({ order }) => {
        const line = must(order.lines[0]);
        order.lines = [{ ...line, attributes: [...line.attributes, { key: LINE_ATTRIBUTE, value: 'x' }] }];
      },
    ],
  ];
  for (const [name, exception, mutate] of rejections)
    it(`rejects ${name}`, async () => {
      const f = await fixture();
      mutate(f);
      const observation = await run(f.ports);
      expect(observation.exception).toBe(exception);
      expect(observation.bindings).toEqual([]);
    });

  it('allows exactly 10,000 customized units across ordered lines', async () => {
    const { ports, order, orderLine } = await fixture();
    order.lines = [orderLine(0, 6000), orderLine(1, 4000)];
    expect((await run(ports)).exception).toBeNull();
  });
});
