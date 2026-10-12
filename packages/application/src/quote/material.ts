import { createHash } from 'node:crypto';
import { parseMinor } from '@insignia/domain';
import type { AcceptedQuote } from './accept-quote.js';

/** Material comparison excludes refreshed observation/issuance evidence, never economic or production facts.
 * Freshness, effective publication fences, resource ownership and retention remain separate mandatory checks. */
export function quoteMaterial(quote: AcceptedQuote) {
  const { effectiveAt: _effectiveAt, groups, fx, ...economics } = quote.economics;
  return {
    version: 'm7-quote-material-v1',
    shopId: quote.shopId,
    installationGeneration: quote.installationGeneration,
    authorizationGeneration: quote.authorizationGeneration,
    authorizationEpoch: quote.authorizationEpoch,
    country: quote.country,
    marketId: quote.marketId,
    shopCurrency: quote.shopCurrency,
    shopTimezone: quote.shopTimezone,
    presentmentCurrency: quote.presentmentCurrency,
    presentmentExponent: quote.presentmentExponent,
    policyVersion: quote.policyVersion,
    recognizedPolicyId: quote.recognizedPolicyId,
    trial: quote.trial,
    qualifyingUsageDisposition: quote.qualifyingUsageDisposition,
    physicalGroups: quote.physicalGroups,
    artwork: quote.artworkChecks.map(({ choiceSha256, kind }) => ({ choiceSha256, kind })),
    revisions: quote.effectiveRevisions
      .map(({ productId, revisionId, contentHash }) => ({
        productId,
        revisionId,
        contentHash,
      }))
      .sort((a, b) => a.productId.localeCompare(b.productId)),
    catalog: quote.catalogSnapshots
      .map((snapshot) => ({
        productId: snapshot.productId,
        variantId: snapshot.variantId,
        country: snapshot.context.country,
        currency: snapshot.currencyCode,
        amountMinor: parseMinor(snapshot.amount, quote.presentmentExponent).toString(),
        productIdVerified: snapshot.productIdVerified,
      }))
      .sort((a, b) => `${a.productId}:${a.variantId}`.localeCompare(`${b.productId}:${b.variantId}`)),
    economics: {
      ...economics,
      groups: groups.map(({ variants, ...group }) => ({
        ...group,
        variants: variants.map(({ contextId: _contextId, ...variant }) => variant),
      })),
      fx: fx
        ? {
            version: fx.version,
            fromCurrency: fx.fromCurrency,
            toCurrency: fx.toCurrency,
            rateDecimal: fx.rateDecimal,
            sourceId: fx.sourceId,
            rateVersion: fx.rateVersion,
          }
        : null,
    },
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export function materialHash(quote: AcceptedQuote): string {
  return createHash('sha256')
    .update(canonical(quoteMaterial(quote)))
    .digest('hex');
}
