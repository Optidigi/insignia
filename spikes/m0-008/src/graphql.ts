import { TransportFault } from './publisher.ts';
import type { Cell, Digest, Field, PolicyTransport, PublishIntent, RemoteState, WriteResult } from './publisher.ts';

/** Pinned Admin GraphQL 2026-07 shapes. No URL, auth, or live Shopify client is provided. */
export const READ_PRODUCT_POLICY = `query M0008ProductPolicy($ownerId: ID!, $namespace: String!) {
  product(id: $ownerId) {
    id
    registration: metafield(namespace: $namespace, key: "m0_007_registration") {
      id namespace key type value compareDigest owner { __typename ... on Product { id } }
    }
    policy: metafield(namespace: $namespace, key: "m0_007_policy") {
      id namespace key type value compareDigest owner { __typename ... on Product { id } }
    }
  }
}`;
export const WRITE_PRODUCT_POLICY = `mutation M0008SetPolicy($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key type value compareDigest owner { __typename ... on Product { id } } }
    userErrors { field message code }
  }
}`;
export interface GraphQLClient { execute(query: string, variables: Record<string, unknown>): Promise<unknown> }

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function response(raw: unknown): Record<string, unknown> {
  const root = object(raw);
  if (!root || !object(root.data) || (Array.isArray(root.errors) && root.errors.length > 0))
    throw new TransportFault('malformed-response', 'GraphQL data absent or errors present');
  return root.data as Record<string, unknown>;
}
function cell(raw: unknown, key: string, namespace: string, ownerId: string): Cell | null {
  if (raw === null) return null;
  const c = object(raw), owner = object(c?.owner);
  if (!c || !owner || owner.__typename !== 'Product' || owner.id !== ownerId || c.namespace !== namespace ||
      c.key !== key || c.type !== 'single_line_text_field' || typeof c.value !== 'string' ||
      typeof c.compareDigest !== 'string' || !/^[0-9a-f]{64}$/.test(c.compareDigest) ||
      typeof c.id !== 'string' || !c.id.startsWith('gid://shopify/Metafield/'))
    throw new TransportFault('malformed-response', `${key} owner/namespace/type/digest mismatch`);
  return { value: c.value, digest: c.compareDigest };
}
function key(field: Field): string { return field === 'registration' ? 'm0_007_registration' : 'm0_007_policy'; }

export class GraphQLPolicyTransport implements PolicyTransport {
  private readonly client: GraphQLClient;
  constructor(client: GraphQLClient) { this.client = client; }
  async read(intent: PublishIntent): Promise<RemoteState> {
    const data = response(await this.client.execute(READ_PRODUCT_POLICY,
      { ownerId: intent.ownerId, namespace: intent.namespace }));
    const product = object(data.product);
    if (!product || product.id !== intent.ownerId || !('registration' in product) || !('policy' in product))
      throw new TransportFault('malformed-response', 'product or policy projection absent');
    return {
      registration: cell(product.registration, key('registration'), intent.namespace, intent.ownerId),
      policy: cell(product.policy, key('policy'), intent.namespace, intent.ownerId)
    };
  }
  async set(intent: PublishIntent, field: Field, value: string, compareDigest: Digest): Promise<WriteResult> {
    // compareDigest is deliberately present even when null. Null means create-if-absent;
    // omission would disable the CAS guard in Shopify Admin GraphQL.
    const input = { ownerId: intent.ownerId, namespace: '$app', key: key(field),
      type: 'single_line_text_field', value, compareDigest };
    const data = response(await this.client.execute(WRITE_PRODUCT_POLICY, { metafields: [input] }));
    const payload = object(data.metafieldsSet);
    if (!payload || !Array.isArray(payload.userErrors))
      throw new TransportFault('malformed-response', 'metafieldsSet payload absent');
    const errors = payload.userErrors.map((raw: unknown) => {
      const e = object(raw);
      if (!e || typeof e.code !== 'string' || typeof e.message !== 'string')
        throw new TransportFault('malformed-response', 'malformed mutation user error');
      return { code: e.code, message: e.message };
    });
    if (errors.length > 0) return { kind: 'user-errors', errors };
    if (!Array.isArray(payload.metafields)) throw new TransportFault('malformed-response', 'mutation metafields absent on success');
    if (payload.metafields.length !== 1) throw new TransportFault('malformed-response', 'mutation field count mismatch');
    const result = cell(payload.metafields[0], key(field), intent.namespace, intent.ownerId);
    if (!result || result.value !== value) throw new TransportFault('malformed-response', 'mutation acknowledgement mismatch');
    return { kind: 'ack' }; // exact separate Admin readback remains mandatory
  }
}
