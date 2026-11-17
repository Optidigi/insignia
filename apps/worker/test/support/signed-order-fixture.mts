import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import type { HistoricalPurchaseOffer, VerifiedOrder } from '@insignia/application';
import { localDay } from '@insignia/application';
import { encodeHeader, encodeMember, wholeQuoteSignBytes } from '@insignia/cart-authorization';

type AcceptedQuote = HistoricalPurchaseOffer['quote'];
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Fixture value missing');
  return value;
}

/** A correctly signed v2 offer and an order that carries it (adapted from the application's
 * reconciliation fixture), so worker tests reach real binding and checkout admission. */
export function signedOrderFixture() {
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
  const quote: AcceptedQuote = {
    schemaVersion: 'm4-accepted-quote-v1',
    acceptedDate: '2026-10-01',
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
    acceptedAt: '2026-10-01T10:00:00Z',
    acceptedDay: day - 19,
    validThroughDay: day - 17,
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
      effectiveAt: '2026-10-01T10:00:00Z',
      marketContext: '42',
      groups: [],
      customizedQuantity: 3,
      totalMinor: '9100',
      lines: members.map((member) => ({
        lineIndex: member.index,
        shopId: 'shop',
        configRevisionId: 'revision',
        revisionContentHash: 'a'.repeat(64),
        canonicalIdentitySha256: 'b'.repeat(64),
        unitOrdinalStart: member.index === 0 ? 0 : 1,
        unitOrdinalEnd: member.index === 0 ? 1 : 3,
        setupPerUnitMinor: '0',
        lineTotalMinor: (BigInt(member.unitMinor) * BigInt(member.quantity)).toString(),
        productId: '7',
        variantId: member.variantId,
        quantity: member.quantity,
        unitPriceMinor: member.unitMinor,
      })),
    },
  };
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
        { key: '_insignia_member_v2', value: required(carriers[member.index]) },
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
  return { order, offer };
}
