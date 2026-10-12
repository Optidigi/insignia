import { createHash } from 'node:crypto';
import {
  type AcceptedQuote,
  type AcceptedQuoteResult,
  localDay,
  prepareQuote,
  type QuoteAuthorityPorts,
  type QuoteIssuanceWindow,
  type QuoteRequest,
} from './accept-quote.js';
import { materialHash } from './material.js';

export type RenewedQuoteResult = AcceptedQuoteResult & { issuance: QuoteIssuanceWindow };
export type QuoteRenewalIdentity = {
  shopId: string;
  installationGeneration: string;
  authorizationGeneration: string;
  authorizationEpoch: number;
  quoteId: string;
  ownerBinding: string;
};
export type QuoteRenewalCommand = QuoteRenewalIdentity & {
  idempotencyKey: string;
  requestDigest: string;
  materialHash: string;
  effectiveRevisions: AcceptedQuote['effectiveRevisions'];
};
export interface QuoteRenewalStore {
  getOwned(input: QuoteRenewalIdentity): Promise<AcceptedQuote | null>;
  findCompleted(input: QuoteRenewalCommand): Promise<RenewedQuoteResult | null>;
  renew(input: QuoteRenewalCommand, commit: () => Promise<RenewedQuoteResult>): Promise<RenewedQuoteResult>;
}
export type QuoteRenewalPorts = QuoteAuthorityPorts & { renewalStore: QuoteRenewalStore };

function canonical(value: unknown, depth = 0, budget = { nodes: 0, bytes: 0 }): string {
  if (depth > 16 || ++budget.nodes > 4096) throw new Error('invalid renewal request');
  budget.bytes += 2;
  if (budget.bytes > 128000) throw new Error('invalid renewal request');
  if (Array.isArray(value)) {
    if (value.length > 4096) throw new Error('invalid renewal request');
    return `[${value.map((entry) => canonical(entry, depth + 1, budget)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    if (entries.length > 64) throw new Error('invalid renewal request');
    return `{${entries
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => {
        if (key.length > 128000) throw new Error('invalid renewal request');
        const encodedKey = JSON.stringify(key);
        budget.bytes += Buffer.byteLength(encodedKey) + 2;
        return `${encodedKey}:${canonical(entry, depth + 1, budget)}`;
      })
      .join(',')}}`;
  }
  if ((typeof value === 'string' && value.length > 128000) || (typeof value === 'number' && !Number.isFinite(value)))
    throw new Error('invalid renewal request');
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('invalid renewal request');
  budget.bytes += Buffer.byteLength(encoded);
  if (budget.bytes > 128000) throw new Error('invalid renewal request');
  return encoded;
}

/** Renewal extends only an independently qualified issuance window; accepted history stays immutable. */
export async function renewQuote(
  request: { quoteId: string; desired: QuoteRequest },
  ports: QuoteRenewalPorts,
): Promise<RenewedQuoteResult> {
  const desired = request.desired;
  if (!/^[a-f0-9-]{36}$/i.test(request.quoteId) || !desired?.idempotencyKey || desired.idempotencyKey.length > 128)
    throw new Error('invalid renewal request');
  const encoded = canonical(request);
  if (Buffer.byteLength(encoded) > 128000) throw new Error('invalid renewal request');
  const ownerBinding = ports.artwork.replayBinding?.(desired);
  if (!ownerBinding || !/^[a-f0-9]{64}$/.test(ownerBinding)) throw new Error('quote resource authority unavailable');
  const tenant = await ports.tenant.getActive(desired.shopId, desired.installationGeneration);
  if (!tenant || tenant.shopId !== desired.shopId || tenant.installationGeneration !== desired.installationGeneration)
    throw new Error('inactive tenant or installation');
  const identity: QuoteRenewalIdentity = {
    shopId: desired.shopId,
    installationGeneration: desired.installationGeneration,
    authorizationGeneration: tenant.authorizationGeneration,
    authorizationEpoch: tenant.authorizationEpoch,
    quoteId: request.quoteId,
    ownerBinding,
  };
  const original = await ports.renewalStore.getOwned(identity);
  if (
    !original ||
    original.quoteId !== identity.quoteId ||
    original.shopId !== identity.shopId ||
    original.installationGeneration !== identity.installationGeneration ||
    original.authorizationGeneration !== identity.authorizationGeneration ||
    original.authorizationEpoch !== identity.authorizationEpoch
  )
    throw new Error('quote ownership unavailable');
  const command: QuoteRenewalCommand = {
    ...identity,
    idempotencyKey: desired.idempotencyKey,
    requestDigest: createHash('sha256')
      .update('m7-renewal-v1\0')
      .update(encoded)
      .update('\0')
      .update(ownerBinding)
      .digest('hex'),
    materialHash: materialHash(original),
    effectiveRevisions: original.effectiveRevisions,
  };
  const completed = await ports.renewalStore.findCompleted(command);
  if (completed) return completed;
  const prepared = await prepareQuote(desired, ports);
  if (materialHash(prepared.quote) !== command.materialHash) throw new Error('REVIEW_REQUIRED');
  return ports.renewalStore.renew({ ...command, effectiveRevisions: prepared.quote.effectiveRevisions }, async () => {
    if (ports.artwork.replayBinding?.(desired) !== ownerBinding) throw new Error('quote resource authority changed');
    const current = await prepareQuote(desired, ports);
    if (materialHash(current.quote) !== command.materialHash) throw new Error('REVIEW_REQUIRED');
    const issuance: QuoteIssuanceWindow = {
      issuedAt: current.quote.acceptedAt,
      issuedDay: current.quote.acceptedDay,
      validThroughDay: current.quote.validThroughDay,
      shopTimezone: current.quote.shopTimezone,
    };
    if (localDay(ports.clock(), issuance.shopTimezone).ordinal !== issuance.issuedDay)
      throw new Error('renewal local day changed');
    const authorization = await ports.authorization.issue({ quote: original, window: issuance });
    if (localDay(ports.clock(), issuance.shopTimezone).ordinal !== issuance.issuedDay)
      throw new Error('renewal local day changed');
    if (
      !authorization.setId ||
      !authorization.envelopeCarrier ||
      authorization.validThroughDay !== issuance.validThroughDay ||
      authorization.firstValidDay > issuance.issuedDay ||
      authorization.lastValidDay < issuance.validThroughDay ||
      authorization.members.length !== original.economics.lines.length ||
      authorization.members.some((member, index) => member.lineIndex !== index || !member.carrier)
    )
      throw new Error('incomplete or invalid renewed authorization');
    return { quote: original, authorization, issuance };
  });
}
