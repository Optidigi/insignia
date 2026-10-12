import { withAdminDeadline } from '../admin-deadline.js';
import type { AdminCredentialSource } from '../contextual-pricing.js';

export type VariantAvailabilityTarget = {
  shopId: string;
  installationGeneration: string;
  productId: string;
  variantIds: readonly string[];
};
export type VariantAvailabilitySnapshot = {
  shopId: string;
  installationGeneration: string;
  productId: string;
  observedAt: string;
  freshUntil: string;
  variants: readonly { id: string; available: boolean }[];
};
export class VariantAvailabilityError extends Error {
  constructor(
    readonly kind:
      | 'invalid_request'
      | 'credential_unavailable'
      | 'provider_unavailable'
      | 'invalid_provider_shape'
      | 'wrong_identity',
  ) {
    super(`Variant availability unavailable: ${kind}`);
    this.name = 'VariantAvailabilityError';
  }
}
const QUERY = `query InsigniaVariantAvailability($ids: [ID!]!) {
  nodes(ids: $ids) { ... on ProductVariant { id availableForSale product { id status } } }
}`;
const variantGid = /^gid:\/\/shopify\/ProductVariant\/[1-9][0-9]{0,19}$/;
const productGid = /^gid:\/\/shopify\/Product\/[1-9][0-9]{0,19}$/;
const MAX_BODY = 128 * 1024;
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** Fixed Admin 2026-07 read_products query. This observation is selection availability, not a
 * Market/quantity/order promise; native cart mutation and checkout remain authoritative.
 * Source: https://shopify.dev/docs/api/admin-graphql/2026-07/objects/ProductVariant#field-ProductVariant.fields.availableForSale */
export async function readVariantAvailability(
  target: VariantAvailabilityTarget,
  dependencies: {
    credentials: AdminCredentialSource;
    fetchImpl?: typeof fetch;
    clock?: () => Date;
  },
): Promise<VariantAvailabilitySnapshot> {
  if (
    !target?.shopId ||
    !/^[1-9][0-9]*$/.test(target.installationGeneration) ||
    !productGid.test(target.productId) ||
    !Array.isArray(target.variantIds) ||
    target.variantIds.length < 1 ||
    target.variantIds.length > 250 ||
    target.variantIds.some((id) => !variantGid.test(id)) ||
    new Set(target.variantIds).size !== target.variantIds.length ||
    typeof dependencies?.credentials?.acquire !== 'function'
  )
    throw new VariantAvailabilityError('invalid_request');
  const clock = dependencies.clock ?? (() => new Date());
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    return await withAdminDeadline(
      async (signal) => {
        const credential = await dependencies.credentials.acquire({
          shopId: target.shopId,
          installationGeneration: target.installationGeneration,
        });
        if (
          credential.kind !== 'usable' ||
          !/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/.test(credential.shopDomain) ||
          !credential.accessToken ||
          credential.accessToken.length > 8192 ||
          hasControlCharacters(credential.accessToken) ||
          !(credential.accessExpiresAt instanceof Date) ||
          !Number.isFinite(+credential.accessExpiresAt) ||
          !Number.isFinite(+clock()) ||
          +credential.accessExpiresAt <= +clock() + 30000
        )
          throw new VariantAvailabilityError('credential_unavailable');
        if (signal.aborted) throw new VariantAvailabilityError('provider_unavailable');
        const response = await (dependencies.fetchImpl ?? fetch)(
          `https://${credential.shopDomain}/admin/api/2026-07/graphql.json`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': credential.accessToken },
            body: JSON.stringify({ query: QUERY, variables: { ids: target.variantIds } }),
            redirect: 'error',
            signal,
          },
        );
        if (response.status !== 200) throw new VariantAvailabilityError('provider_unavailable');
        reader = response.body?.getReader();
        if (!reader) throw new VariantAvailabilityError('invalid_provider_shape');
        let bytes = 0;
        const chunks: Uint8Array[] = [];
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > MAX_BODY) throw new VariantAvailabilityError('invalid_provider_shape');
            chunks.push(part.value);
          }
        } catch (error) {
          void reader.cancel().catch(() => {});
          throw error;
        } finally {
          reader.releaseLock();
        }
        const buffer = Buffer.concat(chunks);
        let payload: Record<string, unknown> | null;
        try {
          payload = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)));
        } catch {
          throw new VariantAvailabilityError('invalid_provider_shape');
        }
        const nodes = record(payload?.data)?.nodes;
        if (
          !payload ||
          payload.errors !== undefined ||
          !Array.isArray(nodes) ||
          nodes.length !== target.variantIds.length
        )
          throw new VariantAvailabilityError('invalid_provider_shape');
        const byId = new Map<string, boolean>();
        for (const raw of nodes) {
          const node = record(raw),
            product = record(node?.product);
          if (
            !node ||
            typeof node.id !== 'string' ||
            !target.variantIds.includes(node.id) ||
            byId.has(node.id) ||
            !product ||
            product.id !== target.productId ||
            product.status !== 'ACTIVE'
          )
            throw new VariantAvailabilityError('wrong_identity');
          if (typeof node.availableForSale !== 'boolean') throw new VariantAvailabilityError('invalid_provider_shape');
          byId.set(node.id, node.availableForSale);
        }
        const observed = clock();
        if (!Number.isFinite(+observed)) throw new VariantAvailabilityError('provider_unavailable');
        return {
          shopId: target.shopId,
          installationGeneration: target.installationGeneration,
          productId: target.productId,
          observedAt: observed.toISOString(),
          freshUntil: new Date(+observed + 30000).toISOString(),
          variants: target.variantIds.map((id) => ({ id, available: byId.get(id) === true })),
        };
      },
      'Variant availability',
      () => {
        void reader?.cancel().catch(() => {});
      },
    );
  } catch (error) {
    if (error instanceof VariantAvailabilityError) throw error;
    throw new VariantAvailabilityError('provider_unavailable');
  }
}
