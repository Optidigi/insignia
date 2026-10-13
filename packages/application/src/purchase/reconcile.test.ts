import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { encodeHeader, encodeMember, wholeQuoteSignBytes } from '@insignia/cart-authorization';
import { describe, expect, it, vi } from 'vitest';
import type { AcceptedQuote } from '../quote/accept-quote.js';
import { localDay } from '../quote/accept-quote.js';
import type { HistoricalPurchaseOffer, VerifiedOrder } from './model.js';
import { firstFullyPaid, reconcilePurchase } from './reconcile.js';

function fixture() {
  const createdAt = '2026-10-20T10:00:00.000Z';
  const day = localDay(new Date(createdAt), 'Europe/Berlin').ordinal;
  const quoteId = '11111111-1111-4111-8111-111111111111';
  const setId = '22222222-2222-4222-8222-222222222222';
  const generation = '33333333-3333-4333-8333-333333333333';
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const header = {
    keyId: 1,
    generationHex: generation.replaceAll('-', ''),
    epoch: 1,
    quoteHex: quoteId.replaceAll('-', ''),
    setHex: setId.replaceAll('-', ''),
    count: 2,
    currency: 'EUR',
    exponent: 2,
    country: 'DE',
    marketId: '42',
    validThroughDay: day + 2,
    totalQuantity: 3,
    totalMinor: '9100',
  };
  const members = [
    { index: 0, variantId: '8', quantity: 1, unitMinor: '3034' },
    { index: 1, variantId: '8', quantity: 2, unitMinor: '3033' },
  ];
  const envelope = Buffer.concat([
    encodeHeader(header),
    sign(null, wholeQuoteSignBytes(header, members), pair.privateKey),
  ]).toString('base64url');
  const carriers = members.map((member) => encodeMember(member).toString('base64url'));
  const quote = {
    quoteId,
    shopId: 'shop',
    installationGeneration: '1',
    authorizationGeneration: generation,
    authorizationEpoch: 1,
    acceptedAt: '2026-10-01T10:00:00Z',
    acceptedDay: day - 19,
    validThroughDay: day - 17,
    shopTimezone: 'Europe/Berlin',
    presentmentCurrency: 'EUR',
    presentmentExponent: 2,
    country: 'DE',
    marketId: '42',
    economics: {
      customizedQuantity: 3,
      totalMinor: '9100',
      lines: members.map((member) => ({
        lineIndex: member.index,
        productId: '7',
        variantId: member.variantId,
        quantity: member.quantity,
        unitPriceMinor: member.unitMinor,
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
      envelopeCarrier: envelope,
      members: carriers.map((carrier, lineIndex) => ({ carrier, lineIndex })),
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
    designPayload: { historicalGeometry: 'not current config' },
    payloadCollectedAt: '2026-10-01T10:00:00.000Z',
    payloadExpiresAt: '2027-04-01T00:00:00.000Z',
  };
  const order: VerifiedOrder = {
    shopId: 'shop',
    installationGeneration: '1',
    orderId: 'gid://shopify/Order/9',
    createdAt,
    updatedAt: createdAt,
    observedAt: '2027-01-01T00:00:00.000Z',
    currency: 'EUR',
    country: 'DE',
    marketId: '42',
    contextVerified: true,
    totalPriceMinor: '9100',
    test: false,
    edited: false,
    sourceApiVersion: '2026-07',
    complete: true,
    financialStatus: 'PAID',
    cancelledAt: null,
    lines: members.map((member) => ({
      lineId: `line-${member.index}`,
      productId: 'gid://shopify/Product/7',
      variantId: 'gid://shopify/ProductVariant/8',
      quantity: member.quantity,
      currentQuantity: member.quantity,
      originalUnitPriceMinor: member.unitMinor,
      sellingPlanId: null,
      attributes: [
        { key: '_insignia_quote_v2', value: envelope },
        { key: '_insignia_member_v2', value: carriers[member.index]! },
      ],
    })),
    transactions: [
      {
        transactionId: 'pay',
        kind: 'SALE',
        status: 'SUCCESS',
        occurredAt: createdAt,
        currency: 'EUR',
        amountMinor: '9100',
      },
    ],
    refunds: [],
  };
  const ports = {
    orders: { read: vi.fn(async () => order) },
    offers: { get: vi.fn(async () => offer) },
    store: { reconcile: vi.fn(async (observation: unknown) => observation) },
  };
  return { order, offer, ports };
}
describe('verified purchase reconciliation', () => {
  it('binds a qualified checkout offer to actual merchandise without inventing observed localization', async () => {
    const { order, ports } = fixture();
    order.country = null;
    order.marketId = null;
    order.contextVerified = false;
    const origin = {
      creatorAppId: 'gid://shopify/App/77',
      sourceName: 'web',
      checkoutTokenDigest: 'a'.repeat(64),
    };
    const providerOrder = { ...order, checkoutOrigin: origin };
    const checkout = {
      admit: vi.fn(async () => ({ creatorAppId: origin.creatorAppId, enforcementObservedAt: order.observedAt })),
    };
    const observation = await reconcilePurchase(
      { shopId: order.shopId, installationGeneration: '1', orderId: order.orderId },
      { ...ports, orders: { read: async () => providerOrder }, checkout },
    );
    expect(observation).toMatchObject({
      exception: null,
      firstPaidAt: '2026-10-20T10:00:00.000Z',
      order: { country: null, marketId: null, contextVerified: false },
      bindings: [
        {
          evidence: {
            kind: 'signed_offer_order_match',
            creatorAppId: origin.creatorAppId,
            checkoutTokenDigest: origin.checkoutTokenDigest,
            enforcementObservedAt: order.observedAt,
            checkoutContext: null,
          },
        },
      ],
    });
    providerOrder.orderId = 'gid://shopify/Order/10';
    const second = await reconcilePurchase(
      { shopId: order.shopId, installationGeneration: '1', orderId: providerOrder.orderId },
      { ...ports, orders: { read: async () => providerOrder }, checkout },
    );
    expect(second).toMatchObject({
      exception: null,
      bindings: [{ authorizationSetId: '22222222-2222-4222-8222-222222222222' }],
    });
  });

  it('refuses unknown origins, absent or stale enforcement and partial provider context', async () => {
    for (const problem of [
      'missing_origin',
      'pos',
      'missing_token',
      'other_creator',
      'refused',
      'stale',
      'partial_context',
    ]) {
      const { order, ports } = fixture();
      const origin = { creatorAppId: 'gid://shopify/App/77', sourceName: 'web', checkoutTokenDigest: 'a'.repeat(64) };
      const providerOrder = { ...order, country: null, marketId: null, contextVerified: false, checkoutOrigin: origin };
      if (problem === 'missing_origin') providerOrder.checkoutOrigin = undefined as unknown as typeof origin;
      if (problem === 'pos') origin.sourceName = 'pos';
      if (problem === 'missing_token') origin.checkoutTokenDigest = '';
      if (problem === 'other_creator') origin.creatorAppId = 'gid://shopify/App/88';
      if (problem === 'partial_context') providerOrder.country = 'DE' as unknown as null;
      const checkout = {
        admit: async () =>
          problem === 'refused'
            ? null
            : {
                creatorAppId: 'gid://shopify/App/77',
                enforcementObservedAt: problem === 'stale' ? '2026-12-31T23:59:00Z' : order.observedAt,
              },
      };
      const observation = await reconcilePurchase(
        { shopId: order.shopId, installationGeneration: '1', orderId: order.orderId },
        { ...ports, orders: { read: async () => providerOrder }, checkout },
      );
      expect(observation, problem).toMatchObject({ bindings: [], exception: expect.any(String) });
    }
  });

  it('checkout admission cannot replace signature, merchandise or observed-context verification', async () => {
    for (const problem of ['quantity', 'price', 'signature', 'provider_context', 'currency']) {
      const { order, ports } = fixture();
      const providerOrder = {
        ...order,
        country: null as string | null,
        marketId: null as string | null,
        contextVerified: false,
        checkoutOrigin: {
          creatorAppId: 'gid://shopify/App/77',
          sourceName: 'web',
          checkoutTokenDigest: 'a'.repeat(64),
        },
      };
      if (problem === 'quantity') providerOrder.lines[0]!.quantity = 2;
      if (problem === 'price') providerOrder.lines[0]!.originalUnitPriceMinor = '3000';
      if (problem === 'signature') providerOrder.lines[0]!.attributes[0]!.value = 'invalid';
      if (problem === 'provider_context') {
        providerOrder.contextVerified = true;
        providerOrder.country = 'US';
        providerOrder.marketId = '42';
      }
      if (problem === 'currency') providerOrder.currency = 'USD';
      const checkout = {
        admit: vi.fn(async () => ({ creatorAppId: 'gid://shopify/App/77', enforcementObservedAt: order.observedAt })),
      };
      const observation = await reconcilePurchase(
        { shopId: order.shopId, installationGeneration: '1', orderId: order.orderId },
        { ...ports, orders: { read: async () => providerOrder }, checkout },
      );
      expect(observation, problem).toMatchObject({ bindings: [], exception: expect.any(String) });
      expect(checkout.admit).not.toHaveBeenCalled();
    }
  });
  it('binds the exact renewed set at order creation despite delayed delivery and records Shopify payment', async () => {
    const { ports, offer } = fixture();
    await reconcilePurchase({ shopId: 'shop', installationGeneration: '1', orderId: 'gid://shopify/Order/9' }, ports);
    expect(ports.store.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        exception: null,
        firstPaidAt: '2026-10-20T10:00:00.000Z',
        bindings: [
          expect.objectContaining({
            authorizationSetId: offer.authorization.setId,
            quote: offer.quote,
            lines: [
              expect.objectContaining({ orderLineId: 'line-0', quantity: 1 }),
              expect.objectContaining({ orderLineId: 'line-1', quantity: 2 }),
            ],
          }),
        ],
      }),
    );
  });
  it.each([
    [
      'missing physical member',
      (order: VerifiedOrder) => {
        order.lines = order.lines.slice(0, 1);
      },
      'INCOMPLETE_AUTHORIZATION_SET',
    ],
    [
      'quantity clipping',
      (order: VerifiedOrder) => {
        order.lines = order.lines.map((line, index) => (index === 1 ? { ...line, quantity: 1 } : line));
      },
      'ORDER_LINE_MISMATCH',
    ],
    [
      'pre-discount base-price fallback',
      (order: VerifiedOrder) => {
        order.lines = order.lines.map((line) => ({ ...line, originalUnitPriceMinor: '2000' }));
      },
      'ORDER_LINE_MISMATCH',
    ],
    [
      'unverified market context',
      (order: VerifiedOrder) => {
        order.contextVerified = false;
        order.marketId = null;
      },
      'CONTEXT_UNVERIFIED',
    ],
    [
      'different independently observed market',
      (order: VerifiedOrder) => {
        order.marketId = '43';
      },
      'ORDER_CONTEXT_MISMATCH',
    ],
    [
      'subscription purchase',
      (order: VerifiedOrder) => {
        order.lines = order.lines.map((line) => ({ ...line, sellingPlanId: 'subscription' }));
      },
      'ORDER_LINE_MISMATCH',
    ],
    [
      'duplicate physical index',
      (order: VerifiedOrder) => {
        order.lines = order.lines.map((line) => ({ ...line, attributes: order.lines[0]!.attributes }));
      },
      'ORDER_LINE_MISMATCH',
    ],
    [
      'marker with no envelope',
      (order: VerifiedOrder) => {
        order.lines = order.lines.map((line) => ({
          ...line,
          attributes: line.attributes.filter((attribute) => attribute.key !== '_insignia_quote_v2'),
        }));
      },
      'INVALID_ORDER_CARRIERS',
    ],
  ] as const)('records %s as an explicit unbound exception', async (_label, change, expected) => {
    const { order, ports } = fixture();
    change(order);
    await reconcilePurchase({ shopId: 'shop', installationGeneration: '1', orderId: order.orderId }, ports);
    expect(ports.store.reconcile).toHaveBeenCalledWith(expect.objectContaining({ exception: expected, bindings: [] }));
  });
  it('does not infer payment from paid webhook/status and ignores authorizations and refunds', () => {
    const { order } = fixture();
    order.transactions = [
      {
        transactionId: 'auth',
        kind: 'AUTHORIZATION',
        status: 'SUCCESS',
        occurredAt: order.createdAt,
        amountMinor: '9100',
        currency: 'EUR',
      },
      {
        transactionId: 'pending',
        kind: 'SALE',
        status: 'PENDING',
        occurredAt: null,
        amountMinor: '9100',
        currency: 'EUR',
      },
    ];
    expect(firstFullyPaid(order)).toBeNull();
  });
  it('finds the actual final settlement time from unordered partial captures and retains it after refunds', () => {
    const { order } = fixture();
    order.transactions = [
      {
        transactionId: 'capture2',
        kind: 'CAPTURE',
        status: 'SUCCESS',
        occurredAt: '2026-10-22T10:00:00.000Z',
        amountMinor: '5100',
        currency: 'EUR',
      },
      {
        transactionId: 'refund',
        kind: 'REFUND',
        status: 'SUCCESS',
        occurredAt: '2026-10-23T10:00:00.000Z',
        amountMinor: '9100',
        currency: 'EUR',
      },
      {
        transactionId: 'capture1',
        kind: 'CAPTURE',
        status: 'SUCCESS',
        occurredAt: '2026-10-21T10:00:00.000Z',
        amountMinor: '4000',
        currency: 'EUR',
      },
    ];
    expect(firstFullyPaid(order)).toBe('2026-10-22T10:00:00.000Z');
  });
  it('does not infer missing successful payment timestamps', () => {
    const { order } = fixture();
    order.transactions = [{ ...order.transactions[0]!, occurredAt: null }];
    expect(() => firstFullyPaid(order)).toThrow('PAYMENT_TIME_UNAVAILABLE');
  });
  it('does not invent a fully-paid event when partial payment was refunded before the balance settled', () => {
    const { order } = fixture();
    order.transactions = [
      {
        transactionId: 'capture1',
        kind: 'CAPTURE',
        status: 'SUCCESS',
        occurredAt: '2026-10-21T10:00:00.000Z',
        amountMinor: '4000',
        currency: 'EUR',
      },
      {
        transactionId: 'refund1',
        kind: 'REFUND',
        status: 'SUCCESS',
        occurredAt: '2026-10-22T10:00:00.000Z',
        amountMinor: '4000',
        currency: 'EUR',
      },
      {
        transactionId: 'capture2',
        kind: 'CAPTURE',
        status: 'SUCCESS',
        occurredAt: '2026-10-23T10:00:00.000Z',
        amountMinor: '5100',
        currency: 'EUR',
      },
    ];
    expect(firstFullyPaid(order)).toBeNull();
  });
  it('refuses incomplete or wrong-tenant independently fetched facts before durable mutation', async () => {
    const { order, ports } = fixture();
    order.shopId = 'other';
    await expect(
      reconcilePurchase({ shopId: 'shop', installationGeneration: '1', orderId: order.orderId }, ports),
    ).rejects.toThrow('ORDER_OWNERSHIP_MISMATCH');
    expect(ports.store.reconcile).not.toHaveBeenCalled();
  });
  it('retains verified economic and first-paid facts while tombstoning expired production detail', async () => {
    const { order, ports, offer } = fixture();
    offer.payloadExpiresAt = '2026-12-01T00:00:00.000Z';
    await reconcilePurchase({ shopId: 'shop', installationGeneration: '1', orderId: order.orderId }, ports);
    expect(ports.store.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        exception: null,
        firstPaidAt: '2026-10-20T10:00:00.000Z',
        bindings: [
          expect.objectContaining({
            designPayload: null,
            payloadCollectedAt: offer.payloadCollectedAt,
            payloadExpiresAt: offer.payloadExpiresAt,
            quote: offer.quote,
          }),
        ],
      }),
    );
  });
  it('reconciles a delayed successful payment after detail erasure without renewing its collection deadline', async () => {
    const { order, ports, offer } = fixture();
    offer.designPayload = null;
    offer.payloadExpiresAt = '2026-10-28T10:00:00.000Z';
    order.transactions = [{ ...order.transactions[0]!, occurredAt: '2026-12-01T10:00:00.000Z' }];
    await reconcilePurchase({ shopId: 'shop', installationGeneration: '1', orderId: order.orderId }, ports);
    expect(ports.store.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        exception: null,
        firstPaidAt: '2026-12-01T10:00:00.000Z',
        bindings: [expect.objectContaining({ designPayload: null, payloadExpiresAt: '2026-10-28T10:00:00.000Z' })],
      }),
    );
  });
  it('rejects an order created after the historical signer was revoked', async () => {
    const { order, ports, offer } = fixture();
    offer.keyRevokedAt = '2026-10-20T09:00:00.000Z';
    await reconcilePurchase({ shopId: 'shop', installationGeneration: '1', orderId: order.orderId }, ports);
    expect(ports.store.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ exception: 'AUTHORIZATION_REVOKED_AT_PURCHASE', bindings: [] }),
    );
  });
  it('preserves an order made before revocation when delivery or payment arrives later', async () => {
    const { order, ports, offer } = fixture();
    offer.keyRevokedAt = '2026-10-21T09:00:00.000Z';
    await reconcilePurchase({ shopId: 'shop', installationGeneration: '1', orderId: order.orderId }, ports);
    expect(ports.store.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        exception: null,
        bindings: [expect.objectContaining({ quoteId: offer.quote.quoteId })],
      }),
    );
  });
  it('binds a prior-installation order and delayed payment under a currently authenticated reinstall without restoring private detail', async () => {
    const { order, ports, offer } = fixture();
    order.installationGeneration = '2';
    order.transactions = [{ ...order.transactions[0]!, occurredAt: '2026-12-01T10:00:00.000Z' }];
    offer.installationWindow.deactivatedAt = '2026-10-21T00:00:00.000Z';
    await reconcilePurchase({ shopId: 'shop', installationGeneration: '2', orderId: order.orderId }, ports);
    expect(ports.offers.get).toHaveBeenCalledWith(expect.objectContaining({ installationGeneration: '2' }));
    expect(ports.store.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        exception: null,
        firstPaidAt: '2026-12-01T10:00:00.000Z',
        bindings: [expect.objectContaining({ quote: offer.quote, designPayload: null })],
      }),
    );
  });
  it('does not authorize a new order using an old installation after deactivation', async () => {
    const { order, ports, offer } = fixture();
    order.installationGeneration = '2';
    offer.installationWindow.deactivatedAt = '2026-10-20T09:00:00.000Z';
    await reconcilePurchase({ shopId: 'shop', installationGeneration: '2', orderId: order.orderId }, ports);
    expect(ports.store.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ exception: 'INSTALLATION_INACTIVE_AT_PURCHASE', bindings: [] }),
    );
  });
  it('keeps an observation exception when a provider reports a future-created order', async () => {
    const { order, ports } = fixture();
    order.observedAt = '2026-10-19T00:00:00.000Z';
    order.transactions = [];
    await reconcilePurchase({ shopId: 'shop', installationGeneration: '1', orderId: order.orderId }, ports);
    expect(ports.store.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ exception: 'INVALID_ORDER_TIME', bindings: [] }),
    );
  });
  it('rejects a forged signature even if all copied economics and carriers agree', async () => {
    const { order, ports, offer } = fixture();
    const bytes = Buffer.from(offer.authorization.envelopeCarrier, 'base64url');
    bytes[100] = bytes[100]! ^ 1;
    const forged = bytes.toString('base64url');
    offer.authorization.envelopeCarrier = forged;
    order.lines = order.lines.map((line) => ({
      ...line,
      attributes: line.attributes.map((attribute) =>
        attribute.key === '_insignia_quote_v2' ? { ...attribute, value: forged } : attribute,
      ),
    }));
    await reconcilePurchase({ shopId: 'shop', installationGeneration: '1', orderId: order.orderId }, ports);
    expect(ports.store.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ exception: 'INVALID_AUTHORIZATION_SIGNATURE', bindings: [] }),
    );
  });
  it('retains verified refund observations on an unsupported edited order without inventing a new binding', async () => {
    const { order, ports } = fixture();
    order.edited = true;
    order.refunds = [
      {
        refundId: 'refund-1',
        occurredAt: '2026-10-22T10:00:00.000Z',
        currency: 'EUR',
        amountMinor: '3034',
        lines: [{ lineId: 'line-0', quantity: 1, amountMinor: '3034' }],
      },
    ];
    await reconcilePurchase({ shopId: 'shop', installationGeneration: '1', orderId: order.orderId }, ports);
    expect(ports.store.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ exception: 'UNSUPPORTED_ORDER_EDIT', bindings: [], firstPaidAt: null, order }),
    );
  });
  it('records payment-time uncertainty without discarding a verified immutable purchase binding', async () => {
    const { order, ports } = fixture();
    order.transactions = [{ ...order.transactions[0]!, occurredAt: null }];
    await reconcilePurchase({ shopId: 'shop', installationGeneration: '1', orderId: order.orderId }, ports);
    expect(ports.store.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        exception: 'PAYMENT_TIME_UNAVAILABLE',
        firstPaidAt: null,
        bindings: [expect.objectContaining({ quoteId: '11111111-1111-4111-8111-111111111111' })],
      }),
    );
  });
  it('does not rebind a refunded line using its current remaining quantity', async () => {
    const { order, ports } = fixture();
    order.lines = order.lines.map((line) => ({ ...line, currentQuantity: 0 }));
    await reconcilePurchase({ shopId: 'shop', installationGeneration: '1', orderId: order.orderId }, ports);
    expect(ports.store.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        exception: null,
        bindings: [
          expect.objectContaining({
            lines: [expect.objectContaining({ quantity: 1 }), expect.objectContaining({ quantity: 2 })],
          }),
        ],
      }),
    );
  });
  it('does not use arbitrary transaction-ID order to decide simultaneous capture/refund payment', () => {
    const { order } = fixture();
    order.transactions = [
      {
        transactionId: 'capture1',
        kind: 'CAPTURE',
        status: 'SUCCESS',
        occurredAt: '2026-10-21T10:00:00.000Z',
        amountMinor: '4000',
        currency: 'EUR',
      },
      {
        transactionId: 'a-capture2',
        kind: 'CAPTURE',
        status: 'SUCCESS',
        occurredAt: '2026-10-22T10:00:00.000Z',
        amountMinor: '5100',
        currency: 'EUR',
      },
      {
        transactionId: 'z-refund',
        kind: 'REFUND',
        status: 'SUCCESS',
        occurredAt: '2026-10-22T10:00:00.000Z',
        amountMinor: '4000',
        currency: 'EUR',
      },
    ];
    expect(() => firstFullyPaid(order)).toThrow('PAYMENT_SEQUENCE_AMBIGUOUS');
  });
});
