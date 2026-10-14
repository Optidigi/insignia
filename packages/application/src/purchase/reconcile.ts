import { createHash, createPublicKey, verify } from 'node:crypto';
import {
  checkCompleteSet,
  decodeEnvelope,
  decodeMemberCarrier,
  wholeQuoteSignBytes,
} from '@insignia/cart-authorization';
import { localDay } from '../quote/accept-quote.js';
import type {
  HistoricalPurchaseOffer,
  PurchaseBinding,
  PurchaseBindingEvidence,
  PurchasePorts,
  VerifiedOrder,
} from './model.js';

const envelopeKey = '_insignia_quote_v2';
const memberKey = '_insignia_member_v2';
function uuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function numericId(value: string | null, resource: string): string | null {
  if (!value) return null;
  if (/^[1-9][0-9]*$/.test(value)) return value;
  const prefix = `gid://shopify/${resource}/`;
  return value.startsWith(prefix) && /^[1-9][0-9]*$/.test(value.slice(prefix.length))
    ? value.slice(prefix.length)
    : null;
}
function fail(reason: string): never {
  throw new Error(reason);
}
function validTime(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) fail('INVALID_PROVIDER_TIME');
  return result;
}
function amount(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || value.length > 20) fail('INVALID_PROVIDER_MONEY');
  return BigInt(value);
}
/** First full chronological settlement. Later refunds preserve that fact; no usage dispatch. */
export function firstFullyPaid(order: VerifiedOrder): string | null {
  const seen = new Set<string>();
  const payments = order.transactions.filter(
    (transaction) =>
      transaction.status === 'SUCCESS' &&
      (transaction.kind === 'SALE' || transaction.kind === 'CAPTURE' || transaction.kind === 'REFUND'),
  );
  if (payments.some((transaction) => transaction.occurredAt === null)) fail('PAYMENT_TIME_UNAVAILABLE');
  let settled = 0n;
  let firstPaidAt: string | null = null;
  const target = amount(order.totalPriceMinor);
  for (const transaction of [...payments].sort(
    (a, b) => validTime(a.occurredAt!) - validTime(b.occurredAt!) || a.transactionId.localeCompare(b.transactionId),
  )) {
    if (
      firstPaidAt === null &&
      payments.some(
        (other) =>
          other !== transaction &&
          validTime(other.occurredAt!) === validTime(transaction.occurredAt!) &&
          (other.kind === 'REFUND') !== (transaction.kind === 'REFUND'),
      )
    )
      fail('PAYMENT_SEQUENCE_AMBIGUOUS');
    if (!transaction.transactionId || seen.has(transaction.transactionId) || transaction.currency !== order.currency)
      fail('INVALID_PAYMENT_FACT');
    seen.add(transaction.transactionId);
    if (
      validTime(transaction.occurredAt!) < validTime(order.createdAt) ||
      validTime(transaction.occurredAt!) > validTime(order.observedAt)
    )
      fail('INVALID_PAYMENT_TIME');
    settled += (transaction.kind === 'REFUND' ? -1n : 1n) * amount(transaction.amountMinor);
    if (settled < 0n) fail('PAYMENT_HISTORY_INCOMPLETE');
    if (firstPaidAt === null && transaction.kind !== 'REFUND' && settled >= target)
      firstPaidAt = transaction.occurredAt;
  }
  return firstPaidAt;
}
async function verifyOffer(
  order: VerifiedOrder,
  offer: HistoricalPurchaseOffer,
  envelope: string,
  lines: readonly VerifiedOrder['lines'][number][],
  checkout: PurchasePorts['checkout'],
): Promise<PurchaseBinding> {
  const { quote, authorization, issuance } = offer;
  const { header, signature } = decodeEnvelope(envelope);
  const members = authorization.members.map((member) => decodeMemberCarrier(member.carrier));
  checkCompleteSet(header, members);
  const orderDay = localDay(new Date(order.createdAt), issuance.shopTimezone).ordinal;
  const installation = offer.installationWindow;
  if (
    !installation ||
    installation.generation !== quote.installationGeneration ||
    validTime(order.createdAt) < validTime(installation.startedAt) ||
    (installation.deactivatedAt !== null &&
      (validTime(installation.deactivatedAt) < validTime(installation.startedAt) ||
        validTime(order.createdAt) >= validTime(installation.deactivatedAt))) ||
    (quote.installationGeneration !== order.installationGeneration && installation.deactivatedAt === null)
  )
    fail('INSTALLATION_INACTIVE_AT_PURCHASE');
  if (offer.keyRevokedAt !== null && validTime(order.createdAt) >= validTime(offer.keyRevokedAt))
    fail('AUTHORIZATION_REVOKED_AT_PURCHASE');
  if (
    quote.shopId !== order.shopId ||
    authorization.envelopeCarrier !== envelope ||
    header.quoteHex !== quote.quoteId.replaceAll('-', '') ||
    header.setHex !== authorization.setId.replaceAll('-', '') ||
    header.generationHex !== quote.authorizationGeneration.replaceAll('-', '') ||
    header.epoch !== quote.authorizationEpoch ||
    header.keyId !== authorization.keyId ||
    header.currency !== quote.presentmentCurrency ||
    header.exponent !== quote.presentmentExponent ||
    header.country !== quote.country ||
    header.marketId !== quote.marketId ||
    header.totalMinor !== quote.economics.totalMinor ||
    header.totalQuantity !== quote.economics.customizedQuantity ||
    header.validThroughDay !== issuance.validThroughDay ||
    authorization.validThroughDay !== issuance.validThroughDay ||
    issuance.validThroughDay !== issuance.issuedDay + 2 ||
    issuance.shopTimezone !== quote.shopTimezone ||
    authorization.firstValidDay > issuance.issuedDay ||
    authorization.lastValidDay < issuance.validThroughDay ||
    orderDay < issuance.issuedDay ||
    orderDay > issuance.validThroughDay ||
    validTime(order.createdAt) < validTime(issuance.issuedAt)
  )
    fail('AUTHORIZATION_HISTORY_MISMATCH');
  if (order.contextVerified && (order.country === null || order.marketId === null)) fail('CONTEXT_UNVERIFIED');
  if (
    order.contextVerified &&
    (order.currency !== header.currency ||
      order.country !== header.country ||
      numericId(order.marketId, 'Market') !== header.marketId)
  )
    fail('ORDER_CONTEXT_MISMATCH');
  if (order.currency !== header.currency) fail('ORDER_CONTEXT_MISMATCH');
  if (
    offer.publicKey.length !== 32 ||
    createHash('sha256').update(offer.publicKey).digest('hex') !== authorization.publicKeyFingerprint
  )
    fail('HISTORICAL_KEY_MISMATCH');
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(offer.publicKey)]),
    format: 'der',
    type: 'spki',
  });
  if (!verify(null, wholeQuoteSignBytes(header, members), key, signature)) fail('INVALID_AUTHORIZATION_SIGNATURE');
  if (lines.length !== header.count || quote.economics.lines.length !== header.count)
    fail('INCOMPLETE_AUTHORIZATION_SET');
  const mapped = lines
    .map((line) => {
      const carriers = line.attributes.filter((attribute) => attribute.key === memberKey);
      if (carriers.length !== 1) fail('INVALID_ORDER_CARRIERS');
      const member = decodeMemberCarrier(carriers[0]!.value);
      const stored = authorization.members[member.index];
      const economic = quote.economics.lines[member.index];
      if (
        !stored ||
        stored.lineIndex !== member.index ||
        stored.carrier !== carriers[0]!.value ||
        !economic ||
        economic.lineIndex !== member.index ||
        numericId(line.productId, 'Product') !== numericId(economic.productId, 'Product') ||
        numericId(line.variantId, 'ProductVariant') !== member.variantId ||
        economic.variantId !== member.variantId ||
        line.quantity !== member.quantity ||
        economic.quantity !== member.quantity ||
        line.originalUnitPriceMinor !== member.unitMinor ||
        economic.unitPriceMinor !== member.unitMinor ||
        line.sellingPlanId !== null
      )
        fail('ORDER_LINE_MISMATCH');
      return {
        orderLineId: line.lineId,
        lineIndex: member.index,
        productId: economic.productId,
        variantId: member.variantId,
        quantity: member.quantity,
        unitPriceMinor: member.unitMinor,
      };
    })
    .sort((a, b) => a.lineIndex - b.lineIndex);
  if (mapped.some((line, index) => line.lineIndex !== index)) fail('INCOMPLETE_AUTHORIZATION_SET');
  let evidence: PurchaseBindingEvidence;
  if (order.contextVerified && order.country !== null && order.marketId !== null) {
    evidence = { kind: 'provider_context', country: order.country, marketId: order.marketId };
  } else {
    // Only wholly unavailable historical context may use the separate matching proof.
    // Partial/contradictory context is never silently replaced by the signed quote.
    if (order.contextVerified || order.country !== null || order.marketId !== null || !checkout)
      fail('CONTEXT_UNVERIFIED');
    const origin = order.checkoutOrigin;
    if (
      !origin ||
      !origin.creatorAppId ||
      !/^gid:\/\/shopify\/App\/[1-9][0-9]{0,19}$/.test(origin.creatorAppId) ||
      origin.sourceName !== 'web' ||
      !origin.checkoutTokenDigest ||
      !/^[a-f0-9]{64}$/.test(origin.checkoutTokenDigest)
    )
      fail('CHECKOUT_ORIGIN_UNVERIFIED');
    const admission = await checkout.admit({ order });
    if (
      !admission ||
      admission.creatorAppId !== origin.creatorAppId ||
      validTime(admission.enforcementObservedAt) < validTime(order.observedAt)
    )
      fail('CHECKOUT_ENFORCEMENT_UNVERIFIED');
    evidence = {
      kind: 'signed_offer_order_match',
      creatorAppId: origin.creatorAppId,
      checkoutTokenDigest: origin.checkoutTokenDigest,
      enforcementObservedAt: admission.enforcementObservedAt,
      checkoutContext: null,
    };
  }
  const collectedAt = validTime(offer.payloadCollectedAt);
  const expiresAt = validTime(offer.payloadExpiresAt);
  if (collectedAt > validTime(order.createdAt) || expiresAt <= collectedAt)
    fail('HISTORICAL_RETENTION_METADATA_UNAVAILABLE');
  return {
    quoteId: quote.quoteId,
    authorizationSetId: authorization.setId,
    quote,
    lines: mapped,
    // Erasure ends production detail, never the independently verified economic offer.
    designPayload:
      expiresAt <= validTime(order.observedAt) || quote.installationGeneration !== order.installationGeneration
        ? null
        : (offer.designPayload ?? null),
    payloadCollectedAt: offer.payloadCollectedAt,
    payloadExpiresAt: offer.payloadExpiresAt,
    evidence,
  };
}
/** Webhook identity selects a read; its body and browser cart claims never create purchase authority. */
export async function reconcilePurchase(
  input: { shopId: string; installationGeneration: string; orderId: string },
  ports: PurchasePorts,
): Promise<unknown> {
  const order = await ports.orders.read({
    shopId: input.shopId,
    installationGeneration: input.installationGeneration,
    orderId: input.orderId,
  });
  if (
    order.shopId !== input.shopId ||
    order.installationGeneration !== input.installationGeneration ||
    order.orderId !== input.orderId
  )
    fail('ORDER_OWNERSHIP_MISMATCH');
  if (!order.complete) fail('ORDER_READ_INCOMPLETE');
  const bindings: PurchaseBinding[] = [];
  let exception: string | null = null;
  try {
    const created = validTime(order.createdAt),
      updated = validTime(order.updatedAt),
      observed = validTime(order.observedAt);
    if (created > updated || updated > observed) fail('INVALID_ORDER_TIME');
    if (
      order.sourceApiVersion !== '2026-07' ||
      order.lines.length > 1000 ||
      order.transactions.length > 1000 ||
      order.refunds.length > 1000
    )
      fail('UNSUPPORTED_ORDER_BOUNDARY');
    if (order.edited) fail('UNSUPPORTED_ORDER_EDIT');
    const ids = new Set<string>();
    const grouped = new Map<string, VerifiedOrder['lines'][number][]>();
    for (const line of order.lines) {
      if (!line.lineId || ids.has(line.lineId)) fail('DUPLICATE_ORDER_LINE');
      ids.add(line.lineId);
      const envelopes = line.attributes.filter((attribute) => attribute.key === envelopeKey);
      const members = line.attributes.filter((attribute) => attribute.key === memberKey);
      const marker = line.attributes.some((attribute) => attribute.key.startsWith('_insignia_'));
      if (!marker) continue;
      if (envelopes.length !== 1 || members.length !== 1) fail('INVALID_ORDER_CARRIERS');
      const envelope = envelopes[0]!.value;
      const groupedLines = grouped.get(envelope) ?? [];
      groupedLines.push(line);
      grouped.set(envelope, groupedLines);
    }
    if (grouped.size > 1) fail('MIXED_AUTHORIZATION_SETS');
    for (const [envelope, lines] of grouped) {
      const { header } = decodeEnvelope(envelope);
      const offer = await ports.offers.get({
        shopId: input.shopId,
        installationGeneration: input.installationGeneration,
        quoteId: uuid(header.quoteHex),
        authorizationSetId: uuid(header.setHex),
      });
      if (!offer) fail('AUTHORIZATION_HISTORY_UNAVAILABLE');
      bindings.push(await verifyOffer(order, offer, envelope, lines, ports.checkout));
    }
  } catch (error) {
    bindings.length = 0;
    exception = error instanceof Error ? error.message : 'PURCHASE_BINDING_FAILED';
  }
  let firstPaidAt: string | null = null;
  try {
    firstPaidAt = order.edited ? null : firstFullyPaid(order);
  } catch (error) {
    exception ??= error instanceof Error ? error.message : 'PAYMENT_FACT_UNVERIFIED';
  }
  return ports.store.reconcile({ order, bindings, exception, firstPaidAt });
}
