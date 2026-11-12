import { randomUUID } from 'node:crypto';
import { signLinesV3 } from './line-v3.js';
import type { purchaseFixture } from './purchase-fixture.js';

type Fixture = Awaited<ReturnType<typeof purchaseFixture>>;

/** A fresh acceptance command for the fixture shop: a new quote, set and idempotency key, signed with
 * the fixture's active key (cart-line v3) only when `sign` runs inside the acceptance fence. */
export function acceptance(fixture: Fixture, idempotencyKey: string, requestDigest = 'a'.repeat(64)) {
  const quoteId = randomUUID();
  const setId = randomUUID();
  const quote = { ...fixture.quote, quoteId };
  const input = {
    shopId: fixture.shopId,
    installationGeneration: fixture.generation,
    authorizationGeneration: fixture.authorizationGeneration,
    authorizationEpoch: fixture.authorizationEpoch,
    idempotencyKey,
    requestDigest,
    effectiveRevisions: quote.effectiveRevisions,
  };
  const sign = () => ({
    quote,
    authorization: {
      setId,
      keyId: 7,
      publicKeyFingerprint: fixture.publicKeyFingerprint,
      firstValidDay: 20000,
      lastValidDay: 21000,
      validThroughDay: quote.validThroughDay,
      ...signLinesV3(
        {
          keyId: 7,
          generationHex: quote.authorizationGeneration.replaceAll('-', ''),
          epoch: quote.authorizationEpoch,
          quoteHex: quoteId.replaceAll('-', ''),
          setHex: setId.replaceAll('-', ''),
          currency: quote.presentmentCurrency,
          exponent: quote.presentmentExponent,
          country: quote.country,
          marketId: quote.marketId,
          validThroughDay: quote.validThroughDay,
        },
        quote.economics.lines.map((line) => ({
          index: line.lineIndex,
          variantId: line.variantId,
          unitMinor: line.unitPriceMinor,
        })),
        fixture.keys.privateKey,
      ),
    },
  });
  return { quoteId, input, sign };
}
