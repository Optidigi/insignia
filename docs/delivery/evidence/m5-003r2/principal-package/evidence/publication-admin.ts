/** Fixed 2026-07 Admin documents for the app-owned fields consumed by both v2 Functions. */
import type { AdminCredentialSource } from './contextual-pricing.js';

export const PUBLICATION_ADMIN_API_VERSION = '2026-07' as const;
export type PublicationField = 'public_config' | 'registration' | 'policy';
export type PublicationTenant = {
  shopId: string;
  installationGeneration: string;
  shopifyShopId: string;
  /** Numeric Shopify app ID, from trusted installation configuration. */
  appId: string;
};
export type PublicationTarget = PublicationTenant & { field: PublicationField; productId?: string };
export type PublicationObserved = {
  ownerId: string;
  namespace: string;
  key: string;
  type: 'json' | 'single_line_text_field';
  value: string;
  compareDigest: string;
};
export type PublicationFailureKind =
  | 'invalid_request'
  | 'credential_missing'
  | 'credential_inactive'
  | 'reauth_required'
  | 'unauthorized'
  | 'forbidden'
  | 'throttled'
  | 'network_or_timeout'
  | 'provider_unavailable'
  | 'graphql_error'
  | 'user_error'
  | 'cas_conflict'
  | 'provider_shape'
  | 'owner_mismatch'
  | 'readback_mismatch'
  | 'ambiguous_write';

/** Deliberately contains no provider message, body, token or metafield value. */
export class PublicationAdminError extends Error {
  constructor(readonly kind: PublicationFailureKind) {
    super(`Shopify publication Admin operation failed: ${kind}`);
    this.name = 'PublicationAdminError';
  }
}

export const FUNCTION_OWNERSHIP_QUERY = `query InsigniaOwnedFunctions {
  shop { id }
  shopifyFunctions(first: 25) {
    nodes { id handle appKey apiVersion apiType inputQuery }
    pageInfo { hasNextPage }
  }
  cartTransforms(first: 25) {
    nodes { id functionId blockOnFailure }
    pageInfo { hasNextPage }
  }
  validations(first: 25) {
    nodes { id enabled blockOnFailure shopifyFunction { id handle appKey } }
    pageInfo { hasNextPage }
  }
}`;
const READ_SHOP = `query InsigniaReadPublicConfig {
  shop { id field: metafield(namespace: "$app", key: "insignia_public_config_v2") {
    owner { ... on Shop { id } } namespace key type value compareDigest
  } }
}`;
const READ_REGISTRATION = `query InsigniaReadRegistration($productId: ID!) {
  node(id: $productId) { __typename ... on Product {
    id field: metafield(namespace: "$app", key: "insignia_registration_v2") {
      owner { ... on Product { id } } namespace key type value compareDigest
    }
  } }
}`;
const READ_POLICY = `query InsigniaReadPolicy($productId: ID!) {
  node(id: $productId) { __typename ... on Product {
    id field: metafield(namespace: "$app", key: "insignia_policy_v2") {
      owner { ... on Product { id } } namespace key type value compareDigest
    }
  } }
}`;
const SET = `mutation InsigniaSetMetafield($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { owner { ... on Shop { id } ... on Product { id } }
      namespace key type value compareDigest }
    userErrors { code }
  }
}`;

export type PublicationAdminRequest = {
  operation: 'read_shop' | 'read_product' | 'set' | 'function_ownership';
  tenant: PublicationTenant;
  query: string;
  variables: Record<string, unknown>;
};
export interface PublicationAdminTransport {
  execute(request: PublicationAdminRequest): Promise<{ status: number; body: unknown }>;
}

const FIELDS = {
  public_config: { key: 'insignia_public_config_v2', type: 'json', read: READ_SHOP },
  registration: { key: 'insignia_registration_v2', type: 'single_line_text_field', read: READ_REGISTRATION },
  policy: { key: 'insignia_policy_v2', type: 'single_line_text_field', read: READ_POLICY },
} as const;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const fail = (kind: PublicationFailureKind): never => {
  throw new PublicationAdminError(kind);
};
const gid = (type: string, value: unknown): boolean =>
  typeof value === 'string' && new RegExp(`^gid://shopify/${type}/[1-9][0-9]*$`).test(value);
function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
function validPolicyValue(field: PublicationField, value: string): boolean {
  if (field === 'public_config') {
    try {
      return record(JSON.parse(value)) !== null;
    } catch {
      return false;
    }
  }
  const parts = value.match(/^([0-9a-f]{32}):([1-9][0-9]*):([a-z]+)$/);
  if (!parts || value.length > 64 || Number(parts[2]) > 0xffff_ffff) return false;
  return field === 'registration'
    ? parts[3] === 'pending' || parts[3] === 'ready'
    : parts[3] === 'required' || parts[3] === 'optional';
}

function assertTarget(input: PublicationTarget): { ownerId: string; definition: (typeof FIELDS)[PublicationField] } {
  if (
    !input ||
    !Object.hasOwn(FIELDS, input.field) ||
    typeof input.shopId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(input.shopId) ||
    !/^[1-9][0-9]*$/.test(input.installationGeneration) ||
    !gid('Shop', input.shopifyShopId) ||
    !/^[1-9][0-9]*$/.test(input.appId)
  )
    fail('invalid_request');
  if (input.field === 'public_config') {
    if (input.productId !== undefined) fail('invalid_request');
  } else if (!gid('Product', input.productId)) fail('invalid_request');
  return {
    ownerId: input.field === 'public_config' ? input.shopifyShopId : (input.productId ?? fail('invalid_request')),
    definition: FIELDS[input.field],
  };
}

function unwrap(response: { status: number; body: unknown }): Record<string, unknown> {
  if (!response || !Number.isInteger(response.status)) return fail('provider_shape');
  if (response.status === 401) return fail('unauthorized');
  if (response.status === 403) return fail('forbidden');
  if (response.status === 429) return fail('throttled');
  if (response.status >= 500) return fail('provider_unavailable');
  if (response.status !== 200) return fail('graphql_error');
  const body = record(response.body);
  if (!body) return fail('provider_shape');
  if (body.errors !== undefined) {
    if (!Array.isArray(body.errors) || body.errors.length === 0) return fail('provider_shape');
    const codes = body.errors.map((error: unknown) => record(record(error)?.extensions)?.code);
    if (codes.includes('THROTTLED') || codes.includes('MAX_COST_EXCEEDED')) return fail('throttled');
    if (codes.includes('ACCESS_DENIED')) return fail('forbidden');
    return fail('graphql_error');
  }
  return record(body.data) ?? fail('provider_shape');
}

function observed(raw: unknown, target: PublicationTarget, ownerId: string): PublicationObserved {
  const field = record(raw);
  const definition = FIELDS[target.field];
  if (!field) return fail('provider_shape');
  const actualOwner = record(field.owner)?.id;
  if (actualOwner !== ownerId) return fail('owner_mismatch');
  const expectedNamespace = `app--${target.appId}`;
  if (
    field.namespace !== expectedNamespace ||
    field.key !== definition.key ||
    field.type !== definition.type ||
    typeof field.value !== 'string' ||
    typeof field.compareDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(field.compareDigest)
  )
    return fail('provider_shape');
  return {
    ownerId,
    namespace: expectedNamespace,
    key: definition.key,
    type: definition.type,
    value: field.value,
    compareDigest: field.compareDigest,
  };
}

async function execute(transport: PublicationAdminTransport, request: PublicationAdminRequest) {
  try {
    return await transport.execute(request);
  } catch (error) {
    if (error instanceof PublicationAdminError) throw error;
    return fail('network_or_timeout');
  }
}

/** The caller supplies a trusted, journaled projection value; field identity is never caller-selectable. */
export function createPublicationAdminAdapter(config: { transport: PublicationAdminTransport }) {
  if (!config?.transport || typeof config.transport.execute !== 'function') fail('invalid_request');
  const transport = config.transport;
  const read = async (target: PublicationTarget): Promise<PublicationObserved | null> => {
    const { ownerId, definition } = assertTarget(target);
    const response = await execute(transport, {
      operation: target.field === 'public_config' ? 'read_shop' : 'read_product',
      tenant: target,
      query: definition.read,
      variables: target.field === 'public_config' ? {} : { productId: target.productId },
    });
    const data = unwrap(response);
    const resource = record(target.field === 'public_config' ? data.shop : data.node);
    if (!resource) return fail('provider_shape');
    if (target.field !== 'public_config' && resource.__typename !== 'Product') return fail('owner_mismatch');
    if (resource.id !== ownerId) return fail('owner_mismatch');
    if (resource.field === null) return null;
    return observed(resource.field, target, ownerId);
  };
  return {
    read,
    async set(input: PublicationTarget & { value: string; compareDigest: string | null }): Promise<{
      kind: 'applied' | 'applied_after_ambiguous_response';
      observed: PublicationObserved;
    }> {
      const { ownerId, definition } = assertTarget(input);
      if (
        typeof input.value !== 'string' ||
        Buffer.byteLength(input.value, 'utf8') > 9_000 ||
        input.value.length === 0 ||
        (input.compareDigest !== null &&
          (typeof input.compareDigest !== 'string' || !/^[a-f0-9]{64}$/.test(input.compareDigest)))
      )
        fail('invalid_request');
      if (!validPolicyValue(input.field, input.value)) fail('invalid_request');
      const request: PublicationAdminRequest = {
        operation: 'set',
        tenant: input,
        query: SET,
        variables: {
          metafields: [
            {
              ownerId,
              namespace: '$app',
              key: definition.key,
              type: definition.type,
              value: input.value,
              compareDigest: input.compareDigest,
            },
          ],
        },
      };
      let acknowledged: PublicationObserved | null = null;
      try {
        const data = unwrap(await execute(transport, request));
        const result = record(data.metafieldsSet) ?? fail('provider_shape');
        const errors = result.userErrors;
        const fields = result.metafields;
        if (!Array.isArray(errors) || !Array.isArray(fields)) return fail('provider_shape');
        if (errors.length) {
          const codes = errors.map((entry: unknown) => record(entry)?.code);
          if (codes.includes('STALE_OBJECT') || codes.includes('INVALID_COMPARE_DIGEST')) fail('cas_conflict');
          if (codes.includes('APP_NOT_AUTHORIZED')) fail('forbidden');
          fail('user_error');
        }
        if (fields.length !== 1) fail('provider_shape');
        acknowledged = observed(fields[0], input, ownerId);
        if (acknowledged.value !== input.value) fail('readback_mismatch');
      } catch (error) {
        if (
          !(error instanceof PublicationAdminError) ||
          !['network_or_timeout', 'provider_unavailable'].includes(error.kind)
        )
          throw error;
        // A timeout or 5xx may have committed. Read once; never issue a second blind mutation.
        let after: PublicationObserved | null;
        try {
          after = await read(input);
        } catch {
          return fail('ambiguous_write');
        }
        if (after?.value === input.value) return { kind: 'applied_after_ambiguous_response', observed: after };
        return fail('ambiguous_write');
      }
      let after: PublicationObserved | null;
      try {
        after = await read(input);
      } catch (error) {
        if (
          error instanceof PublicationAdminError &&
          !['network_or_timeout', 'provider_unavailable', 'throttled'].includes(error.kind)
        )
          throw error;
        return fail('ambiguous_write');
      }
      if (!after || after.value !== input.value || after.compareDigest !== acknowledged.compareDigest)
        return fail('readback_mismatch');
      return { kind: 'applied', observed: after };
    },
  };
}

const DOCUMENTS = new Set([READ_SHOP, READ_REGISTRATION, READ_POLICY, SET, FUNCTION_OWNERSHIP_QUERY]);
const MAX_RESPONSE_BYTES = 128 * 1024;
function validWireVariables(request: PublicationAdminRequest): boolean {
  if (!request.tenant) return false;
  const variables = record(request.variables);
  if (!variables) return false;
  if (request.operation === 'read_shop' || request.operation === 'function_ownership')
    return Object.keys(variables).length === 0;
  if (request.operation === 'read_product')
    return Object.keys(variables).length === 1 && gid('Product', variables.productId);
  if (Object.keys(variables).length !== 1 || !Array.isArray(variables.metafields) || variables.metafields.length !== 1)
    return false;
  const field = record(variables.metafields[0]);
  if (
    !field ||
    Object.keys(field).sort().join(',') !== 'compareDigest,key,namespace,ownerId,type,value' ||
    field.namespace !== '$app'
  )
    return false;
  const definition = Object.values(FIELDS).find((entry) => entry.key === field.key);
  const fieldKind = Object.keys(FIELDS).find((key) => FIELDS[key as PublicationField].key === field.key) as
    | PublicationField
    | undefined;
  if (
    !definition ||
    !fieldKind ||
    definition.type !== field.type ||
    !(definition.key === FIELDS.public_config.key
      ? field.ownerId === request.tenant.shopifyShopId
      : gid('Product', field.ownerId)) ||
    typeof field.value !== 'string' ||
    !field.value ||
    Buffer.byteLength(field.value, 'utf8') > 9_000 ||
    !validPolicyValue(fieldKind, field.value) ||
    (field.compareDigest !== null &&
      (typeof field.compareDigest !== 'string' || !/^[a-f0-9]{64}$/.test(field.compareDigest)))
  )
    return false;
  return true;
}
/** HTTP transport for the exact fixed documents. The credential source must fence active installations. */
export function createPublicationAdminHttpTransport(config: {
  credentials: AdminCredentialSource;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}): PublicationAdminTransport {
  if (
    !config?.credentials ||
    typeof config.credentials.acquire !== 'function' ||
    (config.timeoutMs !== undefined &&
      (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 30_000))
  )
    fail('invalid_request');
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? (() => new Date());
  return {
    async execute(request) {
      if (
        !request ||
        !DOCUMENTS.has(request.query) ||
        (request.operation === 'read_shop' && request.query !== READ_SHOP) ||
        (request.operation === 'read_product' &&
          request.query !== READ_REGISTRATION &&
          request.query !== READ_POLICY) ||
        (request.operation === 'set' && request.query !== SET) ||
        (request.operation === 'function_ownership' && request.query !== FUNCTION_OWNERSHIP_QUERY) ||
        !['read_shop', 'read_product', 'set', 'function_ownership'].includes(request.operation) ||
        !validWireVariables(request)
      )
        fail('invalid_request');
      const target = request.tenant;
      if (
        !target ||
        typeof target.shopId !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(target.shopId) ||
        !/^[1-9][0-9]*$/.test(target.installationGeneration) ||
        !gid('Shop', target.shopifyShopId)
      )
        fail('invalid_request');
      let credential: Awaited<ReturnType<AdminCredentialSource['acquire']>>;
      try {
        credential = await config.credentials.acquire({
          shopId: target.shopId,
          installationGeneration: target.installationGeneration,
        });
      } catch {
        return fail('network_or_timeout');
      }
      if (credential.kind !== 'usable') {
        if (credential.kind === 'missing') return fail('credential_missing');
        if (credential.kind === 'inactive') return fail('credential_inactive');
        if (credential.kind === 'reauth_required') return fail('reauth_required');
        return fail('provider_unavailable');
      }
      if (
        !/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/.test(credential.shopDomain) ||
        typeof credential.accessToken !== 'string' ||
        !credential.accessToken ||
        credential.accessToken.length > 8192 ||
        hasControlCharacters(credential.accessToken) ||
        !(credential.accessExpiresAt instanceof Date) ||
        !Number.isFinite(credential.accessExpiresAt.getTime()) ||
        credential.accessExpiresAt.getTime() <= now().getTime() + 30_000
      )
        fail('credential_inactive');
      const body = JSON.stringify({ query: request.query, variables: request.variables });
      if (Buffer.byteLength(body, 'utf8') > 16 * 1024) fail('invalid_request');
      const controller = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          // The injected fetch or stream may ignore AbortSignal. Never wait for cancellation.
          void reader?.cancel().catch(() => {});
          reject(new PublicationAdminError('network_or_timeout'));
        }, config.timeoutMs ?? 8_000);
      });
      try {
        const fetchAndRead = async () => {
          const response = await fetchImpl(`https://${credential.shopDomain}/admin/api/2026-07/graphql.json`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-shopify-access-token': credential.accessToken },
            body,
            signal: controller.signal,
            redirect: 'error',
          });
          if (response.status !== 200) return { status: response.status, body: null };
          if (!response.body) return fail('provider_shape');
          reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let length = 0;
          try {
            while (true) {
              const next = await reader.read();
              if (next.done) break;
              length += next.value.byteLength;
              if (length > MAX_RESPONSE_BYTES) {
                await reader.cancel().catch(() => {});
                return fail('provider_shape');
              }
              chunks.push(next.value);
            }
          } finally {
            reader.releaseLock();
            reader = null;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(Buffer.concat(chunks, length).toString('utf8')) as unknown;
          } catch {
            return fail('provider_shape');
          }
          return { status: 200, body: parsed };
        };
        return await Promise.race([fetchAndRead(), deadline]);
      } catch (error) {
        if (error instanceof PublicationAdminError) throw error;
        return fail('network_or_timeout');
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
