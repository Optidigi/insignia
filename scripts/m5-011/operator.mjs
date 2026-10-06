import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ADAPTER_READ,
  ADAPTER_UPDATE,
  ARCHIVE,
  CREATED_AT,
  FIXTURE,
  IDENTITY,
  MARKER,
  PARTITIONS,
  PROJECTION,
  PUBLICATION,
  PUBLICATION_ID,
  TARGET,
  V2_DOCUMENTS,
} from './documents.mjs';
export const LIVE_DIRECTORY = '/home/serveradmin/insignia-m5-011-handoff/run';
export const LIMITS = Object.freeze({ auth: 3, read: 16, update: 2 });
export class Stop extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}
export const requireValue = (value, kind) => {
  if (!value) throw new Stop(kind);
};
export const digest = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keys = (value, names) =>
  value && typeof value === 'object' && !Array.isArray(value) && equal(Object.keys(value).sort(), [...names].sort());
const date = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value));
const gid = (type, value) => typeof value === 'string' && new RegExp(`^gid://shopify/${type}/[1-9][0-9]*$`).test(value);
export function assertIdentity(data) {
  const i = data?.currentAppInstallation;
  requireValue(
    data?.shop?.id === TARGET.shop &&
      data.shop.myshopifyDomain === TARGET.domain &&
      data.shop.plan?.partnerDevelopment === true &&
      i?.id === TARGET.installation &&
      i.app?.id === TARGET.app &&
      i.app.apiKey === TARGET.client,
    'identity',
  );
  const grants = i.accessScopes;
  requireValue(
    Array.isArray(grants) &&
      grants.length <= 250 &&
      grants.every(
        (x) => keys(x, ['handle']) && typeof x.handle === 'string' && /^[a-z][a-z0-9_]{0,127}$/.test(x.handle),
      ) &&
      new Set(grants.map((x) => x.handle)).size === grants.length &&
      ['write_products', 'read_products', 'read_publications', 'read_product_listings'].every((x) =>
        grants.some((y) => y.handle === x),
      ),
    'grants',
  );
}
export function assertOwned(product) {
  if (
    !(
      product?.__typename === 'Product' &&
      product.id === FIXTURE &&
      product.handle === MARKER &&
      product.title === MARKER &&
      JSON.stringify(product.tags) === JSON.stringify([MARKER]) &&
      product.createdAt === CREATED_AT
    )
  )
    throw new Stop('ownership');
}
function connection(value, limit = 250) {
  requireValue(
    value &&
      Array.isArray(value.nodes) &&
      value.nodes.length <= limit &&
      value.pageInfo?.hasNextPage === false &&
      value.pageInfo.hasPreviousPage === false,
    'connection_incomplete',
  );
  return value.nodes;
}
export function visibility(product) {
  requireValue(
    product?.__typename === 'Product' &&
      product.id === FIXTURE &&
      ['ACTIVE', 'DRAFT', 'ARCHIVED'].includes(product.status) &&
      date(product.updatedAt) &&
      Date.parse(product.updatedAt) <= Date.now() + 1000 &&
      (product.publishedAt === null || date(product.publishedAt)) &&
      (product.onlineStoreUrl === null ||
        (typeof product.onlineStoreUrl === 'string' && product.onlineStoreUrl.startsWith('https://'))),
    'product_shape',
  );
  const publications = connection(product.resourcePublications)
    .map((n) => {
      requireValue(
        gid('Publication', n?.publication?.id) && typeof n.isPublished === 'boolean' && date(n.publishDate),
        'publication_shape',
      );
      return { id: n.publication.id, isPublished: n.isPublished, publishDate: new Date(n.publishDate).toISOString() };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const unpublished = connection(product.unpublishedPublications)
    .map((n) => {
      requireValue(gid('Publication', n?.id), 'publication_shape');
      return n.id;
    })
    .sort();
  requireValue(
    new Set(publications.map((n) => n.id)).size === publications.length &&
      new Set(unpublished).size === unpublished.length,
    'publication_duplicate',
  );
  return {
    publications,
    unpublished,
    publishedAt: product.publishedAt === null ? null : new Date(product.publishedAt).toISOString(),
    onlineStoreUrl: product.onlineStoreUrl,
  };
}
export function assertProjection(data) {
  assertIdentity(data);
  const p = data.product;
  assertOwned(p);
  visibility(p);
  for (const type of PARTITIONS) {
    const nodes = connection(p[type]);
    requireValue(
      nodes.every(
        (n) =>
          gid('Publication', n?.publication?.id) &&
          typeof n.isPublished === 'boolean' &&
          (n.publishDate === null || date(n.publishDate)),
      ) && new Set(nodes.map((n) => n.publication.id)).size === nodes.length,
      'v2_shape',
    );
  }
  return p;
}
export function assertPublication(data) {
  const p = data?.publication;
  requireValue(
    p?.id === PUBLICATION_ID && typeof p.autoPublish === 'boolean' && typeof p.supportsFuturePublishing === 'boolean',
    'publication_identity',
  );
  if (p.catalog !== null)
    requireValue(
      ['AppCatalog', 'MarketCatalog', 'CompanyLocationCatalog'].includes(p.catalog?.__typename) &&
        gid(p.catalog.__typename, p.catalog.id) &&
        typeof p.catalog.title === 'string' &&
        typeof p.catalog.status === 'string',
      'catalog_shape',
    );
  const channels = connection(p.channels, 50);
  requireValue(
    channels.every(
      (n) =>
        gid('Channel', n?.id) && typeof n.name === 'string' && gid('App', n.app?.id) && typeof n.app.title === 'string',
    ) && new Set(channels.map((n) => n.id)).size === channels.length,
    'channel_shape',
  );
  return p;
}
export const membershipDigest = (p) => {
  const v = visibility(p);
  return digest({ publications: v.publications, unpublished: v.unpublished });
};
export const sameProduct = (a, b) =>
  a.status === b.status && a.updatedAt === b.updatedAt && equal(visibility(a), visibility(b));
function persist(directory, state) {
  const temp = resolve(directory, 'register.next');
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, resolve(directory, 'register.json'));
  const dir = openSync(directory, 'r');
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
async function boundedBody(response, signal) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  let cancellation;
  const cancel = () => (cancellation ??= reader.cancel());
  const abort = () => {
    void cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const n = await reader.read();
      if (n.done) break;
      const part = n.value.subarray(0, 128 * 1024 + 1 - length);
      length += part.byteLength;
      chunks.push(part);
      if (length > 128 * 1024) {
        await cancel();
        break;
      }
    }
  } finally {
    if (signal.aborted) await cancel();
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  requireValue(!signal.aborted, 'transport_timeout');
  return Buffer.concat(chunks, length);
}
const select = (value, names) =>
  value && typeof value === 'object'
    ? Object.fromEntries(names.filter((n) => Object.hasOwn(value, n)).map((n) => [n, value[n]]))
    : value;
function selectedIdentity(data, adapter = false) {
  return {
    shop: adapter
      ? select(data.shop, ['id'])
      : {
          ...select(data.shop, ['id', 'myshopifyDomain']),
          plan: select(data.shop?.plan, ['partnerDevelopment', 'displayName']),
        },
    currentAppInstallation: {
      ...select(data.currentAppInstallation, adapter ? [] : ['id']),
      app: select(data.currentAppInstallation?.app, adapter ? ['apiKey'] : ['id', 'apiKey']),
      accessScopes: data.currentAppInstallation?.accessScopes?.map((n) => select(n, ['handle'])),
    },
  };
}
function selectedProduct(p, own = false, v2 = false) {
  if (!p) return p;
  const out = select(p, [
    '__typename',
    'id',
    'status',
    'updatedAt',
    'publishedAt',
    'onlineStoreUrl',
    ...(own ? ['handle', 'title', 'tags', 'createdAt'] : []),
  ]);
  for (const name of ['resourcePublications', 'unpublishedPublications', ...(v2 ? PARTITIONS : [])]) {
    const c = p[name];
    out[name] = c && {
      pageInfo: select(c.pageInfo, ['hasNextPage', 'hasPreviousPage']),
      nodes: c.nodes?.map((n) =>
        name === 'unpublishedPublications'
          ? select(n, ['id'])
          : { ...select(n, ['isPublished', 'publishDate']), publication: select(n.publication, ['id']) },
      ),
    };
  }
  return out;
}
// Retain only the fixed selection, never unexpected provider fields or extensions.
function selectedData(data, operation) {
  if (operation === 'identity') return selectedIdentity(data);
  if (operation === 'projection') return { ...selectedIdentity(data), product: selectedProduct(data.product, true) };
  if (operation.startsWith('v2_')) {
    const type = operation.slice(3),
      p = data.product,
      c = p?.[type];
    return {
      ...selectedIdentity(data),
      product: p && {
        ...select(p, [
          '__typename',
          'id',
          'handle',
          'title',
          'tags',
          'createdAt',
          'status',
          'updatedAt',
          'publishedAt',
          'onlineStoreUrl',
        ]),
        [type]: c && {
          pageInfo: select(c.pageInfo, ['hasNextPage', 'hasPreviousPage']),
          nodes: c.nodes?.map((n) => ({
            ...select(n, ['isPublished', 'publishDate']),
            publication: select(n.publication, ['id']),
          })),
        },
      },
    };
  }
  if (operation === 'adapter_read') return { ...selectedIdentity(data, true), node: selectedProduct(data.node) };
  if (operation === 'draft' || operation === 'archive')
    return {
      productUpdate: data.productUpdate && {
        product: selectedProduct(data.productUpdate.product, operation === 'archive'),
        userErrors: data.productUpdate.userErrors?.map((n) => ({ field: n.field, message: '<provider user error>' })),
      },
    };
  if (operation === 'publication') {
    const p = data.publication;
    return {
      publication: p && {
        ...select(p, ['id', 'autoPublish', 'supportsFuturePublishing']),
        catalog: select(p.catalog, ['__typename', 'id', 'title', 'status']),
        channels: p.channels && {
          pageInfo: select(p.channels.pageInfo, ['hasNextPage', 'hasPreviousPage']),
          nodes: p.channels.nodes?.map((n) => ({ ...select(n, ['id', 'name']), app: select(n.app, ['id', 'title']) })),
        },
      },
    };
  }
  throw new Stop('response_selection');
}
export function createOperator({ directory, binding, fetchImpl = globalThis.fetch, assertCurrent = () => {} }) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  requireValue(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid(), 'register_directory');
  try {
    closeSync(openSync(resolve(directory, 'initialized.once'), 'wx', 0o600));
  } catch {
    throw new Stop('reentry');
  }
  const state = {
    version: 1,
    profile: 'm5-011',
    binding,
    fixture: FIXTURE,
    marker: MARKER,
    publication: PUBLICATION_ID,
    counts: { auth: 0, read: 0, update: 0 },
    attempts: { draft: 0, archive: 0 },
    events: [],
    phase: 'INITIAL',
    pending: null,
    identity: null,
    owned: null,
    hold: null,
    result: null,
    closed: false,
  };
  persist(directory, state);
  let busy = false;
  const save = () => persist(directory, state);
  const identity = (data) => {
    assertIdentity(data);
    if (state.identity)
      requireValue(
        equal(
          data.currentAppInstallation.accessScopes.map((n) => n.handle).sort(),
          state.identity.data.currentAppInstallation.accessScopes.map((n) => n.handle).sort(),
        ),
        'grant_drift',
      );
    state.identity = { data, at: Date.now() };
  };
  const fresh = () => {
    requireValue(
      state.identity && Date.now() - state.identity.at < 60_000 && state.owned && Date.now() - state.owned.at < 60_000,
      'stale_precondition',
    );
    assertCurrent();
  };
  function classify(url, init, body) {
    requireValue(!state.closed && !busy && state.pending === null, 'closed_or_parallel');
    requireValue(init?.method === 'POST' && typeof init.body === 'string', 'request_shape');
    if (url === `https://${TARGET.domain}/admin/oauth/access_token`) {
      requireValue(
        state.phase === 'INITIAL' &&
          keys(body, ['client_id', 'client_secret', 'grant_type']) &&
          body.client_id === TARGET.client &&
          body.grant_type === 'client_credentials' &&
          typeof body.client_secret === 'string' &&
          body.client_secret.length > 0,
        'auth_request',
      );
      return { kind: 'auth', operation: 'client_credentials' };
    }
    requireValue(
      url === `https://${TARGET.domain}/admin/api/2026-07/graphql.json` && keys(body, ['query', 'variables']),
      'endpoint_or_document',
    );
    const q = body.query,
      v = body.variables;
    if (q === IDENTITY && keys(v, [])) return { kind: 'read', operation: 'identity' };
    if (q === PROJECTION && keys(v, ['id']) && v.id === FIXTURE) return { kind: 'read', operation: 'projection' };
    for (const type of PARTITIONS)
      if (
        q === V2_DOCUMENTS[type] &&
        keys(v, ['id']) &&
        v.id === FIXTURE &&
        ['PRESTATE', 'POST_DRAFT'].includes(state.phase) &&
        state.owned &&
        !Object.hasOwn(state.owned.product, type)
      )
        return { kind: 'read', operation: `v2_${type}` };
    if (q === PUBLICATION && keys(v, ['id']) && v.id === PUBLICATION_ID)
      return { kind: 'read', operation: 'publication' };
    if (
      q === ADAPTER_READ &&
      keys(v, ['productId']) &&
      v.productId === FIXTURE &&
      ['SNAPSHOT', 'ACQUIRE'].includes(state.phase)
    )
      return { kind: 'read', operation: 'adapter_read' };
    if (
      (q === ADAPTER_UPDATE || q === ARCHIVE) &&
      keys(v, ['product']) &&
      keys(v.product, ['id', 'status']) &&
      v.product.id === FIXTURE
    ) {
      const draft =
        q === ADAPTER_UPDATE &&
        v.product.status === 'DRAFT' &&
        state.phase === 'ACQUIRE' &&
        state.owned?.product.status === 'ACTIVE';
      const archive =
        q === ARCHIVE &&
        v.product.status === 'ARCHIVED' &&
        state.phase === 'CLEANUP' &&
        state.owned?.product.status === 'DRAFT';
      requireValue(draft || archive, 'status_authority');
      const operation = draft ? 'draft' : 'archive';
      requireValue(state.attempts[operation] === 0, 'write_reentry');
      fresh();
      return { kind: 'update', operation };
    }
    throw new Stop('document_or_target_denied');
  }
  async function transport(url, init) {
    let body;
    try {
      body = JSON.parse(init.body);
    } catch {
      throw new Stop('request_json');
    }
    const request = classify(url, init, body);
    assertCurrent();
    requireValue(state.counts[request.kind] < LIMITS[request.kind], 'ceiling');
    state.counts[request.kind]++;
    if (request.kind === 'update') state.attempts[request.operation]++;
    const event = {
      index: state.events.length,
      ...request,
      startedAt: new Date().toISOString(),
      request: request.kind === 'auth' ? { client_id: TARGET.client, grant_type: 'client_credentials' } : body,
      settlement: request.kind === 'update' ? 'UNKNOWN' : 'PENDING',
      invoked: false,
    };
    state.events.push(event);
    state.pending = event.index;
    save();
    busy = true;
    let underlyingSettled = true,
      received;
    const adapter = request.operation === 'adapter_read' || request.operation === 'draft';
    try {
      if (request.kind === 'update') fresh();
      else assertCurrent();
      const signal = AbortSignal.any([AbortSignal.timeout(8000), ...(init.signal ? [init.signal] : [])]);
      if (request.kind === 'update') fresh();
      else assertCurrent();
      requireValue(!signal.aborted, 'transport_timeout');
      const aborted = new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Stop('transport_timeout')), { once: true }),
      );
      underlyingSettled = false;
      received = await Promise.race([
        aborted,
        (async () => {
          let responseReceived = false,
            bodySettled = false;
          try {
            event.invoked = true;
            const response = await fetchImpl(url, { ...init, redirect: 'error', signal });
            responseReceived = true;
            let bytes = null;
            if (response.status === 200 && !signal.aborted) bytes = await boundedBody(response, signal);
            else await response.body?.cancel();
            bodySettled = true;
            requireValue(!signal.aborted, 'transport_timeout');
            return { response, bytes };
          } finally {
            underlyingSettled = !responseReceived || bodySettled;
          }
        })(),
      ]);
      const response = received.response;
      let raw = null;
      if (received.bytes && received.bytes.length <= 128 * 1024) {
        try {
          raw = JSON.parse(received.bytes.toString('utf8'));
        } catch {
          /* Keep original wire semantics for the production adapter. */
        }
      }
      event.status = response.status;
      if (request.kind === 'auth') {
        event.observation = {
          status: response.status,
          hasToken: typeof raw?.access_token === 'string',
          expiresIn: Number.isSafeInteger(raw?.expires_in) ? raw.expires_in : null,
        };
        requireValue(response.status === 200 && raw, 'auth_response');
      } else if (response.status === 200 && raw?.data && !raw.errors) {
        // Documents select only synthetic ownership, publication and minimal app/channel identity.
        try {
          raw = { data: selectedData(raw.data, request.operation) };
        } catch {
          // Malformed selections belong to the adapter's provider-shape branch.
          // Authority and persistence checks below remain separate and fail closed.
          throw new Stop('response_selection');
        }
        event.response = structuredClone(raw);
        if (request.operation === 'identity') {
          identity(raw.data);
        }
        if (request.operation === 'projection') {
          assertIdentity(raw.data);
          const p = raw.data.product;
          assertOwned(p);
          visibility(p);
          identity(raw.data);
          state.owned = { product: p, at: Date.now() };
        }
        if (request.operation.startsWith('v2_')) {
          identity(raw.data);
          const p = raw.data.product,
            type = request.operation.slice(3);
          assertOwned(p);
          const fields = ['status', 'updatedAt', 'publishedAt', 'onlineStoreUrl'];
          requireValue(equal(select(p, fields), select(state.owned.product, fields)), 'projection_state_drift');
          const nodes = connection(p[type]);
          requireValue(
            nodes.every(
              (n) =>
                gid('Publication', n?.publication?.id) &&
                typeof n.isPublished === 'boolean' &&
                (n.publishDate === null || date(n.publishDate)),
            ) && new Set(nodes.map((n) => n.publication.id)).size === nodes.length,
            'v2_shape',
          );
          state.owned.product[type] = p[type];
          state.owned.at = Date.now();
        }
        if (request.operation === 'publication') assertPublication(raw.data);
        if (request.operation === 'adapter_read') {
          const p = raw.data.node;
          visibility(p);
          const scopes = raw.data.currentAppInstallation?.accessScopes;
          requireValue(
            Array.isArray(scopes) &&
              scopes.every((n) => n && typeof n === 'object' && !Array.isArray(n) && typeof n.handle === 'string'),
            'response_selection',
          );
          requireValue(
            raw.data.shop?.id === TARGET.shop &&
              raw.data.currentAppInstallation?.app?.apiKey === TARGET.client &&
              Array.isArray(raw.data.currentAppInstallation.accessScopes) &&
              ['read_products', 'write_products', 'read_publications', 'read_product_listings'].every((x) =>
                raw.data.currentAppInstallation.accessScopes.some((y) => y.handle === x),
              ) &&
              equal(
                raw.data.currentAppInstallation.accessScopes.map((n) => n.handle).sort(),
                state.identity.data.currentAppInstallation.accessScopes.map((n) => n.handle).sort(),
              ),
            'adapter_identity',
          );
          const draftEvent = state.events.find((e) => e.operation === 'draft');
          if (!draftEvent) requireValue(sameProduct(p, state.owned.product), 'prestate_drift');
        }
        if (request.kind === 'update') {
          const result = raw.data.productUpdate;
          if (adapter && Array.isArray(result?.userErrors) && result.userErrors.length > 0) {
            event.observation = { status: response.status, userErrors: true };
            event.completedAt = new Date().toISOString();
            save();
            return new Response(received.bytes, { status: response.status });
          }
          requireValue(Array.isArray(result?.userErrors) && result.userErrors.length === 0, 'mutation_user_error');
          visibility(result.product);
          requireValue(
            result.product.status === (request.operation === 'draft' ? 'DRAFT' : 'ARCHIVED'),
            'mutation_state',
          );
          if (request.operation === 'archive') assertOwned(result.product);
          event.settlement = 'ACKNOWLEDGED';
        }
      } else {
        event.observation = {
          status: response.status,
          graphqlErrors: Boolean(raw?.errors),
          malformedBody: raw === null,
        };
        if (!adapter) throw new Stop('provider_error');
      }
      event.completedAt = new Date().toISOString();
      save();
      return adapter
        ? new Response(received.bytes, { status: response.status })
        : Response.json(raw, { status: response.status });
    } catch (error) {
      event.failure = error instanceof Stop ? error.kind : 'transport_failure';
      event.completedAt = new Date().toISOString();
      if (!event.invoked && request.kind === 'update') event.settlement = 'NOT_DISPATCHED';
      save();
      if (
        adapter &&
        received &&
        error instanceof Stop &&
        [
          'product_shape',
          'publication_shape',
          'publication_duplicate',
          'connection_incomplete',
          'mutation_user_error',
          'mutation_state',
          'response_selection',
        ].includes(error.kind)
      ) {
        return new Response(received.bytes, { status: received.response.status });
      }
      throw new Stop(event.failure);
    } finally {
      busy = false;
      state.pending = underlyingSettled ? null : event.index;
      if (!underlyingSettled) event.quarantined = 'underlying_transport_still_outstanding';
      save();
    }
  }
  return {
    fetch: transport,
    state: () => structuredClone(state),
    projection() {
      assertProjection({ ...state.identity.data, product: state.owned.product });
      return structuredClone(state.owned.product);
    },
    phase(value) {
      requireValue(!busy && !state.closed, 'phase');
      state.phase = value;
      save();
    },
    hold(value) {
      requireValue(state.hold === null, 'snapshot_reentry');
      state.hold = structuredClone(value);
      save();
    },
    settle(operation, product) {
      assertOwned(product);
      visibility(product);
      const event = state.events.find((e) => e.operation === operation);
      requireValue(
        event?.settlement === 'ACKNOWLEDGED' && sameProduct(event.response.data.productUpdate.product, product),
        'write_settlement',
      );
      event.settlement = 'EXACT';
      save();
    },
    finish(result) {
      requireValue(!busy && !state.closed, 'finish');
      state.result = result;
      state.closed = true;
      state.phase = 'CLOSED';
      save();
    },
  };
}
