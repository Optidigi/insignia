import { withAdminDeadline } from './admin-deadline.js';

export type UninstallSubscriptionGrant = { shop: string; accessToken: string };
export type UninstallSubscriptionContext = { shopId: string; installationId: string; appClientId: string };
export type UninstallSubscription = { id: string; topic: 'APP_UNINSTALLED'; uri: string };
export type UninstallSubscriptionCreateResult =
  | { kind: 'acknowledged'; subscription: UninstallSubscription }
  | { kind: 'rejected'; reason: 'not_dispatched' | 'provider_rejected' }
  | { kind: 'unknown' };
export class UninstallSubscriptionError extends Error {
  constructor() {
    super('Uninstall subscription unavailable');
    this.name = 'UninstallSubscriptionError';
  }
}
const identityQuery = `query LifecycleIdentity { shop { id myshopifyDomain } currentAppInstallation { id app { apiKey } } }`;
const createQuery = `mutation LifecycleSubscribe($uri: String!) { webhookSubscriptionCreate(topic: APP_UNINSTALLED, webhookSubscription: {uri: $uri, format: JSON}) { webhookSubscription {id topic uri} userErrors {field message} } }`;
const readQuery = `query LifecycleReadback($id: ID!) { webhookSubscription(id: $id) {id topic uri} }`;
const findQuery = `query LifecycleSettle($uri: String!, $after: String) { webhookSubscriptions(first: 100, after: $after, topics: [APP_UNINSTALLED], uri: $uri) { nodes {id topic uri} pageInfo {hasNextPage endCursor} } }`;
const fail = (): never => {
  throw new UninstallSubscriptionError();
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : fail();
const gid = (kind: string, value: unknown): value is string =>
  typeof value === 'string' && value.length <= 128 && new RegExp(`^gid://shopify/${kind}/[1-9][0-9]*$`).test(value);

/** Caller supplies a verified online grant and immutable expected installation binding.
 * No retries, URL/token/provider-body logging or inference from denied access. */
export function createUninstallSubscriptionClient(input: { expectedOrigin: string; fetchImpl?: typeof fetch }) {
  let origin: URL;
  try {
    origin = new URL(input.expectedOrigin);
  } catch {
    return fail();
  }
  if (origin.protocol !== 'https:' || origin.origin !== input.expectedOrigin || origin.username || origin.password)
    return fail();
  function callback(uri: string): void {
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      throw new UninstallSubscriptionError();
    }
    if (
      url.origin !== origin.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/api\/webhooks\/uninstall\/[a-f0-9]{64}$/.test(url.pathname) ||
      uri !== url.origin + url.pathname
    )
      fail();
  }
  function scope(grant: UninstallSubscriptionGrant, expected: UninstallSubscriptionContext): void {
    if (
      !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(grant.shop) ||
      !grant.accessToken ||
      /[\r\n\0]/.test(grant.accessToken) ||
      !gid('Shop', expected.shopId) ||
      !gid('AppInstallation', expected.installationId) ||
      !expected.appClientId ||
      expected.appClientId.length > 128
    )
      fail();
  }
  async function query(
    grant: UninstallSubscriptionGrant,
    queryText: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      return await withAdminDeadline(
        async (signal) => {
          const response = await (input.fetchImpl ?? fetch)(`https://${grant.shop}/admin/api/2026-07/graphql.json`, {
            method: 'POST',
            redirect: 'error',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': grant.accessToken },
            body: JSON.stringify({ query: queryText, variables }),
            signal,
          });
          if (!response.ok) return fail();
          reader = response.body?.getReader();
          if (!reader) return fail();
          const chunks: Uint8Array[] = [];
          let size = 0;
          try {
            for (;;) {
              const part = await reader.read();
              if (part.done) break;
              size += part.value.byteLength;
              if (size > 262144) return fail();
              chunks.push(part.value);
            }
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          const root = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
          if (root.errors !== undefined && root.errors !== null) return fail();
          return record(root.data);
        },
        'Uninstall subscription',
        () => {
          void reader?.cancel().catch(() => {});
        },
      );
    } catch {
      return fail();
    }
  }
  async function identity(grant: UninstallSubscriptionGrant, expected: UninstallSubscriptionContext) {
    scope(grant, expected);
    const data = await query(grant, identityQuery, {});
    const shop = record(data.shop),
      installed = record(data.currentAppInstallation);
    if (
      shop.id !== expected.shopId ||
      shop.myshopifyDomain !== grant.shop ||
      installed.id !== expected.installationId ||
      record(installed.app).apiKey !== expected.appClientId
    )
      fail();
  }
  function observed(raw: unknown): UninstallSubscription {
    const value = record(raw);
    if (
      !gid('WebhookSubscription', value.id) ||
      value.topic !== 'APP_UNINSTALLED' ||
      typeof value.uri !== 'string' ||
      value.uri.length < 1 ||
      value.uri.length > 2048 ||
      /[\u0000-\u0020\u007f]/.test(value.uri)
    )
      return fail();
    return { id: value.id, topic: 'APP_UNINSTALLED', uri: value.uri };
  }
  function project(raw: unknown, expectedUri?: string): UninstallSubscription {
    const value = observed(raw);
    callback(value.uri);
    if (expectedUri !== undefined && value.uri !== expectedUri) return fail();
    return value;
  }
  return {
    async create(
      grant: UninstallSubscriptionGrant,
      expected: UninstallSubscriptionContext,
      uri: string,
    ): Promise<UninstallSubscriptionCreateResult> {
      try {
        callback(uri);
        await identity(grant, expected);
      } catch {
        return { kind: 'rejected', reason: 'not_dispatched' };
      }
      try {
        const data = await query(grant, createQuery, { uri });
        const result = record(data.webhookSubscriptionCreate);
        if (!Array.isArray(result.userErrors)) return { kind: 'unknown' };
        if (
          result.userErrors.some((raw) => {
            const error = record(raw);
            return (
              typeof error.message !== 'string' ||
              error.message.length > 4096 ||
              (error.field !== undefined &&
                error.field !== null &&
                (!Array.isArray(error.field) || error.field.some((item) => typeof item !== 'string')))
            );
          })
        )
          return { kind: 'unknown' };
        if (result.userErrors.length > 0 && result.webhookSubscription === null) {
          await identity(grant, expected);
          return { kind: 'rejected', reason: 'provider_rejected' };
        }
        if (result.userErrors.length > 0) return { kind: 'unknown' };
        const subscription = project(result.webhookSubscription, uri);
        await identity(grant, expected);
        return { kind: 'acknowledged', subscription };
      } catch {
        return { kind: 'unknown' };
      }
    },
    async read(
      grant: UninstallSubscriptionGrant,
      expected: UninstallSubscriptionContext,
      id: string,
    ): Promise<UninstallSubscription | null> {
      if (!gid('WebhookSubscription', id)) return fail();
      await identity(grant, expected);
      const data = await query(grant, readQuery, { id });
      // Observing an exact saved subscription is different from authorizing a
      // destination. Return definitive URI drift only after owner revalidation;
      // callers never fetch/log this URI and can retire the old capability.
      const result = data.webhookSubscription === null ? null : observed(data.webhookSubscription);
      if (result && result.id !== id) return fail();
      await identity(grant, expected);
      return result;
    },
    async reconcile(
      grant: UninstallSubscriptionGrant,
      expected: UninstallSubscriptionContext,
      uri: string,
    ): Promise<UninstallSubscription | null> {
      callback(uri);
      await identity(grant, expected);
      let after: string | null = null;
      let found: UninstallSubscription | null = null;
      const ids = new Set<string>(),
        cursors = new Set<string>();
      for (let page = 0; page < 4; page++) {
        const data = await query(grant, findQuery, { uri, after });
        const connection = record(data.webhookSubscriptions),
          info = record(connection.pageInfo);
        if (!Array.isArray(connection.nodes) || connection.nodes.length > 100 || typeof info.hasNextPage !== 'boolean')
          return fail();
        for (const raw of connection.nodes) {
          const item = project(raw, uri);
          if (ids.has(item.id) || found) return fail();
          ids.add(item.id);
          found = item;
        }
        if (!info.hasNextPage) {
          await identity(grant, expected);
          return found;
        }
        if (
          typeof info.endCursor !== 'string' ||
          !info.endCursor ||
          info.endCursor.length > 2048 ||
          cursors.has(info.endCursor) ||
          connection.nodes.length === 0
        )
          return fail();
        cursors.add(info.endCursor);
        after = info.endCursor;
      }
      return fail();
    },
  };
}
