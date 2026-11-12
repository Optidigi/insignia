import { randomUUID } from 'node:crypto';
import {
  type ArtworkScope,
  BuyerRejectedError,
  bindProviderSubscription,
  createArtworkUsabilityPort,
  type EntitlementPolicyConfig,
  projectEntitlement,
  type QuoteArtworkPort,
  type QuoteAuthorityPorts,
} from '@insignia/application';
import {
  type AuthorizationSigner,
  admitCandidate,
  currencyExponent,
  type HeaderV3Claims,
  issueLineSetV3,
  type LineRecordV3,
  linearLineRecordsV3,
} from '@insignia/cart-authorization';
import type { DurableCore } from '@insignia/database';
import {
  type ActiveSubscriptionSnapshot,
  type AdminCredentialSource,
  type AdminGraphqlReadTransport,
  readShopContext,
  resolveVariantContext,
} from '@insignia/shopify';

function numericShopifyId(value: string): string {
  if (!/^[1-9][0-9]*$/.test(value) || BigInt(value) > (1n << 64n) - 1n)
    throw new Error('invalid canonical Shopify numeric ID');
  return value;
}

function uuidHex(uuid: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid))
    throw new Error('invalid durable UUID');
  return uuid.replaceAll('-', '').toLowerCase();
}

type Economics = Parameters<typeof linearLineRecordsV3>[0];
type EconomicsInput = Omit<Economics, 'lines'> & {
  lines: readonly (Economics['lines'][number] & { canonicalIdentity?: string })[];
};
/** Cart-line v3 signs a per-unit price that holds at any quantity; non-linear economics are refused. */
function lineRecordsFor(economics: EconomicsInput): LineRecordV3[] {
  // Proposal economics carry the raw design identity, accepted economics its digest: either separates designs.
  const lines = economics.lines.map((line) => ({
    ...line,
    canonicalIdentitySha256: line.canonicalIdentitySha256 ?? line.canonicalIdentity,
  }));
  return linearLineRecordsV3({ groups: economics.groups, lines }).map((record) => ({
    ...record,
    variantId: numericShopifyId(record.variantId),
  }));
}

/** Server-only composition. Every provider and key access remains injected and installation scoped. */
export function createQuoteAuthorityPorts(input: {
  core: DurableCore;
  appId: string;
  entitlementPolicy: EntitlementPolicyConfig;
  leanContext?: QuoteAuthorityPorts['leanContext'];
  readSubscription: (target: { appId: string; shopId: string }) => Promise<ActiveSubscriptionSnapshot>;
  credentials: AdminCredentialSource;
  catalogTransport: AdminGraphqlReadTransport;
  artwork?: QuoteArtworkPort;
  /** Current verified resource authority; bind per request, never from quote JSON or a shared cache. */
  artworkAuthority?: ArtworkScope;
  signing: { keyId: number; signer: AuthorizationSigner };
  readiness: QuoteAuthorityPorts['readiness'];
  clock?: () => Date;
  ids?: { quoteId(): string; setId(): string };
  fetchImpl?: typeof fetch;
}): QuoteAuthorityPorts {
  const clock = input.clock ?? (() => new Date());
  const artwork = input.artwork ?? createArtworkUsabilityPort(input.core.artwork, clock, input.artworkAuthority);
  if (!artwork.replayBinding) throw new Error('Quote resource replay authority required');
  const ids = input.ids ?? { quoteId: randomUUID, setId: randomUUID };
  return {
    clock,
    leanContext: input.leanContext,
    ids: { quoteId: ids.quoteId },
    tenant: {
      async getActive(shopId, installationGeneration) {
        const scope = await input.core.tenants.getActiveAuthorizationScope({ shopId, installationGeneration });
        return scope
          ? {
              shopId: scope.shopId,
              installationGeneration: scope.installationGeneration,
              shopifyShopGid: `gid://shopify/Shop/${scope.shopifyShopId}`,
              authorizationGeneration: scope.authorizationGeneration,
              authorizationEpoch: scope.authorizationEpoch,
            }
          : null;
      },
    },
    shop: {
      async getContext(tenant) {
        const shopifyShopId = tenant.shopifyShopGid.slice('gid://shopify/Shop/'.length);
        const result = await readShopContext(
          { shopId: tenant.shopId, installationGeneration: tenant.installationGeneration, shopifyShopId },
          { credentials: input.credentials, fetchImpl: input.fetchImpl, now: clock },
        );
        const current = clock().getTime();
        if (current < Date.parse(result.observedAt) || current >= Date.parse(result.freshUntil))
          throw new Error('stale shop context');
        return {
          shopId: tenant.shopId,
          installationGeneration: tenant.installationGeneration,
          shopifyShopGid: tenant.shopifyShopGid,
          currency: result.shopCurrency,
          timezone: result.ianaTimezone,
        };
      },
    },
    entitlement: {
      async getFresh(tenant) {
        const raw = await input.readSubscription({ appId: input.appId, shopId: tenant.shopifyShopGid });
        const bound = await bindProviderSubscription(
          raw,
          {
            appId: input.appId,
            shopId: tenant.shopifyShopGid,
            tenantShopId: tenant.shopId,
            installationGeneration: tenant.installationGeneration,
          },
          input.core.tenants,
        );
        return projectEntitlement(bound, input.entitlementPolicy, {
          appId: input.appId,
          shopId: tenant.shopifyShopGid,
          tenantShopId: tenant.shopId,
          installationGeneration: tenant.installationGeneration,
          now: clock(),
        });
      },
    },
    publication: {
      getEffective: (shopId, productId) => input.core.acceptedQuotes.getEffective(shopId, productId),
    },
    catalog: {
      async resolveVariantContext(target) {
        const productId = numericShopifyId(target.productId);
        const variantIds = target.variantIds.map(numericShopifyId);
        const result = await resolveVariantContext(
          {
            ...target,
            productId: `gid://shopify/Product/${productId}`,
            variantIds: variantIds.map((variant) => `gid://shopify/ProductVariant/${variant}`),
          },
          { transport: input.catalogTransport, now: clock },
        );
        return result.map((snapshot) => ({
          ...snapshot,
          productId,
          variantId: numericShopifyId(snapshot.variantId.slice('gid://shopify/ProductVariant/'.length)),
        }));
      },
    },
    currency: { exponent: (code) => currencyExponent(code) ?? null },
    artwork,
    readiness: input.readiness,
    authorization: {
      admit({ economics, capacity }) {
        lineRecordsFor(economics);
        const result = admitCandidate(
          economics.lines.map((line) => ({ index: line.lineIndex, quantity: line.quantity })),
          { ordinaryLineHint: capacity.ordinaryLineCount },
        );
        if (result.status !== 'ADMIT')
          throw ['BUCKET_COUNT', 'CART_LINES', 'PHYSICAL_QUANTITY'].includes(result.reason)
            ? new BuyerRejectedError('CAPACITY_EXCEEDED', `candidate capacity rejected: ${result.reason}`)
            : new Error(`candidate capacity rejected: ${result.reason}`);
        if (!Number.isSafeInteger(capacity.inputBytes) || capacity.inputBytes < 0 || capacity.inputBytes > 128_000)
          throw new Error('cart input availability estimate exceeds candidate reference');
      },
      async issue({ quote, window }) {
        const records = lineRecordsFor(quote.economics);
        const setId = ids.setId();
        const validThroughDay = window?.validThroughDay ?? quote.validThroughDay;
        const claims: HeaderV3Claims = {
          keyId: input.signing.keyId,
          generationHex: uuidHex(quote.authorizationGeneration),
          epoch: quote.authorizationEpoch,
          quoteHex: uuidHex(quote.quoteId),
          setHex: uuidHex(setId),
          currency: quote.presentmentCurrency,
          exponent: quote.presentmentExponent,
          country: quote.country,
          marketId: quote.marketId,
          validThroughDay,
        };
        const signed = await issueLineSetV3(
          claims,
          records,
          window?.issuedDay ?? quote.acceptedDay,
          input.signing.signer,
        );
        return {
          setId,
          keyId: signed.keyId,
          publicKeyFingerprint: signed.publicKeyFingerprint,
          firstValidDay: signed.firstValidDay,
          lastValidDay: signed.lastValidDay,
          validThroughDay,
          envelopeCarrier: signed.prefix,
          members: signed.carriers.map((carrier, lineIndex) => ({ lineIndex, carrier })),
        };
      },
    },
    store: input.core.acceptedQuotes,
  };
}
