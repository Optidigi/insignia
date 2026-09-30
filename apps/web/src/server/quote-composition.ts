import { randomUUID } from 'node:crypto';
import {
  bindProviderSubscription,
  type CustomizationFxProvider,
  type EntitlementPolicyConfig,
  projectEntitlement,
  type QuoteArtworkPort,
  type QuoteAuthorityPorts,
} from '@insignia/application';
import {
  type AuthorizationSigner,
  admitCandidate,
  currencyExponent,
  type Header,
  issueWholeQuote,
  type Member,
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

function membersFor(quote: {
  economics: { lines: readonly { lineIndex: number; variantId: string; quantity: number; unitPriceMinor: string }[] };
}): Member[] {
  return quote.economics.lines.map((line, index) => {
    if (line.lineIndex !== index) throw new Error('M2 lines are not quote-global ordered');
    return {
      index,
      variantId: numericShopifyId(line.variantId),
      quantity: line.quantity,
      unitMinor: line.unitPriceMinor,
    };
  });
}

/** Server-only composition. Every provider and key access remains injected and installation scoped. */
export function createQuoteAuthorityPorts(input: {
  core: DurableCore;
  appId: string;
  entitlementPolicy: EntitlementPolicyConfig;
  readSubscription: (target: { appId: string; shopId: string }) => Promise<ActiveSubscriptionSnapshot>;
  credentials: AdminCredentialSource;
  catalogTransport: AdminGraphqlReadTransport;
  artwork?: QuoteArtworkPort;
  fx?: CustomizationFxProvider;
  signing: { keyId: number; signer: AuthorizationSigner };
  clock?: () => Date;
  ids?: { quoteId(): string; setId(): string };
  fetchImpl?: typeof fetch;
}): QuoteAuthorityPorts {
  const clock = input.clock ?? (() => new Date());
  const ids = input.ids ?? { quoteId: randomUUID, setId: randomUUID };
  return {
    clock,
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
    artwork: input.artwork ?? {
      readUsability: async () => {
        throw new Error('trusted artwork usability authority is not configured');
      },
    },
    fx: input.fx ?? {
      resolve: async () => {
        throw new Error('approved FX source is not configured');
      },
    },
    authorization: {
      admit({ economics, capacity }) {
        const members = membersFor({ economics });
        const result = admitCandidate(members, { ordinaryLineHint: capacity.ordinaryLineCount });
        if (result.status !== 'ADMIT') throw new Error(`candidate capacity rejected: ${result.reason}`);
        if (!Number.isSafeInteger(capacity.inputBytes) || capacity.inputBytes < 0 || capacity.inputBytes > 128_000)
          throw new Error('cart input availability estimate exceeds candidate reference');
      },
      async issue({ quote }) {
        const members = membersFor(quote);
        const setId = ids.setId();
        const header: Header = {
          keyId: input.signing.keyId,
          generationHex: uuidHex(quote.authorizationGeneration),
          epoch: quote.authorizationEpoch,
          quoteHex: uuidHex(quote.quoteId),
          setHex: uuidHex(setId),
          count: members.length,
          currency: quote.presentmentCurrency,
          exponent: quote.presentmentExponent,
          country: quote.country,
          marketId: quote.marketId,
          validThroughDay: quote.validThroughDay,
          totalQuantity: quote.economics.customizedQuantity,
          totalMinor: quote.economics.totalMinor,
        };
        const signed = await issueWholeQuote(header, members, quote.acceptedDay, input.signing.signer);
        return {
          setId,
          keyId: String(signed.keyId),
          publicKeyFingerprint: signed.publicKeyFingerprint,
          firstValidDay: quote.acceptedDay,
          lastValidDay: quote.validThroughDay,
          validThroughDay: quote.validThroughDay,
          envelopeCarrier: signed.envelope,
          members: signed.members.map((carrier, lineIndex) => ({ lineIndex, carrier })),
        };
      },
    },
    store: input.core.acceptedQuotes,
  };
}
