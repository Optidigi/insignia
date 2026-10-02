import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

export const TARGET = Object.freeze({
  app: 'gid://shopify/App/429028933633',
  client: '1443cf6d03d39edae7c101a943c5c684',
  domain: 'insignia-rewrite-dev.myshopify.com',
  shop: 'gid://shopify/Shop/105501393179',
  installation: 'gid://shopify/AppInstallation/1054356963611',
});
export const LIVE_DIRECTORY = '/home/serveradmin/insignia-m5-004-handoff/run';
export const LIMITS = Object.freeze({ auth: 3, read: 96, create: 1, update: 16 });
export const GRANTS = [
  'read_products',
  'write_products',
  'read_cart_transforms',
  'write_cart_transforms',
  'read_validations',
  'write_validations',
  'read_inventory',
  'write_inventory',
  'read_locations',
].sort();
// Exact current adapter documents; offline integration tests detect any drift.
export const PRODUCT_FIELDS = `__typename id status updatedAt publishedAt onlineStoreUrl
  resourcePublications(first: 250, onlyPublished: false) {
    nodes { isPublished publishDate publication { id } }
    pageInfo { hasNextPage hasPreviousPage }
  }
  unpublishedPublications(first: 250) {
    nodes { id }
    pageInfo { hasNextPage hasPreviousPage }
  }`;
export const ADAPTER_READ = `query InsigniaProductAvailability($productId: ID!) {
  shop { id }
  currentAppInstallation { app { apiKey } accessScopes { handle } }
  node(id: $productId) { ... on Product { ${PRODUCT_FIELDS} } }
}`;
export const ADAPTER_UPDATE = `mutation InsigniaProductAvailabilityStatus($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product { ${PRODUCT_FIELDS} }
    userErrors { field message }
  }
}`;
export const IDENTITY = `query M5004Identity { shop { id myshopifyDomain plan { partnerDevelopment displayName } }
  currentAppInstallation { id app { id apiKey } accessScopes { handle } } }`;
const OWN_FIELDS = `${PRODUCT_FIELDS} handle title tags createdAt`;
export const FIXTURE = `query M5004Fixture($id: ID!) { product(id: $id) { ${OWN_FIELDS} } }`;
export const FIND = `query M5004Find($search: String!) { products(first: 2, query: $search) {
  nodes { ${OWN_FIELDS} } pageInfo { hasNextPage hasPreviousPage } } }`;
export const CREATE = `mutation M5004Create($product: ProductCreateInput!) { productCreate(product: $product) {
  product { ${OWN_FIELDS} } userErrors { field message } } }`;
export const SETUP = `mutation M5004Setup($product: ProductUpdateInput!) { productUpdate(product: $product) {
  product { ${OWN_FIELDS} } userErrors { field message } } }`;
const catalogFields = 'id title status featuredMedia { preview { image { url altText } } }';
export const CATALOG_LIST = `query M5001Products($first: Int!, $after: String, $search: String) {
  products(first: $first, after: $after, query: $search, sortKey: TITLE) {
    nodes { ${catalogFields}
  variants(first: 8) { nodes { id title selectedOptions { name value } image { url altText } } pageInfo { hasNextPage } } }
    pageInfo { hasNextPage endCursor }
  }
}`;
export const CATALOG_DETAIL = `query M5001Product($id: ID!, $after: String) { product(id: $id) {
  ${catalogFields}
  variants(first: 100, after: $after) { nodes { id title selectedOptions { name value } image { url altText } } pageInfo { hasNextPage endCursor } }
} }`;
const gid = /^gid:\/\/shopify\/Product\/[1-9][0-9]*$/;
const hash = (v) =>
  createHash('sha256')
    .update(typeof v === 'string' || ArrayBuffer.isView(v) ? v : JSON.stringify(v))
    .digest('hex');
export class Stop extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}
export const requireValue = (value, kind) => {
  if (!value) throw new Stop(kind);
};
const keys = (value, allowed) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...allowed].sort().join();
function persist(directory, state) {
  const temp = resolve(directory, 'register.next');
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(state, null, 2) + '\n');
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
function protectDirectory(directory) {
  const d = lstatSync(directory);
  requireValue(
    d.isDirectory() && !d.isSymbolicLink() && d.uid === process.getuid() && (d.mode & 0o077) === 0,
    'register_permissions',
  );
}
export function initialize(directory, binding, { synthetic = false } = {}) {
  requireValue(synthetic || resolve(directory) === LIVE_DIRECTORY, 'canonical_register');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  protectDirectory(directory);
  const sentinel = openSync(resolve(directory, 'initialized.once'), 'wx', 0o600);
  fsyncSync(sentinel);
  closeSync(sentinel);
  const marker = `insignia-m5-004-${randomUUID()}`;
  const state = {
    version: 1,
    target: TARGET,
    binding,
    run: marker,
    createdAt: new Date().toISOString(),
    limits: LIMITS,
    counts: { auth: 0, read: 0, create: 0, update: 0 },
    events: [],
    fixture: null,
    fixtureIdentity: null,
    identity: null,
    owned: false,
    unpublished: null,
    blocked: null,
    finalizing: false,
  };
  const fd = openSync(resolve(directory, 'register.json'), 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(state, null, 2) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return state;
}
function validate(state) {
  requireValue(
    state?.version === 1 &&
      JSON.stringify(state.target) === JSON.stringify(TARGET) &&
      JSON.stringify(state.limits) === JSON.stringify(LIMITS) &&
      /^insignia-m5-004-[a-f0-9-]{36}$/.test(state.run) &&
      state.binding?.source &&
      state.binding.modules &&
      Array.isArray(state.events),
    'register',
  );
  requireValue(
    keys(state.counts, Object.keys(LIMITS)) && Number.isFinite(Date.parse(state.createdAt)),
    'register_history',
  );
  for (const [kind, limit] of Object.entries(LIMITS)) {
    requireValue(
      Number.isInteger(state.counts[kind]) &&
        state.counts[kind] >= 0 &&
        state.counts[kind] <= limit &&
        state.events.filter((e) => e.kind === kind).length === state.counts[kind],
      'register_history',
    );
  }
  for (let i = 0; i < state.events.length; i++) {
    const e = state.events[i];
    requireValue(
      e.index === i &&
        Object.hasOwn(LIMITS, e.kind) &&
        /^[a-f0-9]{64}$/.test(e.bodyDigest) &&
        ['RESERVED', 'UNKNOWN', 'RESPONDED', 'ACKNOWLEDGED', 'NOT_SENT', 'REJECTED'].includes(e.result),
      'register_history',
    );
  }
  requireValue(state.fixture === null || gid.test(state.fixture), 'register_fixture');
  if (state.fixture)
    requireValue(
      state.events.some(
        (e) =>
          e.kind === 'create' &&
          e.result === 'ACKNOWLEDGED' &&
          e.fixture === state.fixture &&
          e.response?.data?.productCreate?.product?.id === state.fixture,
      ),
      'register_fixture',
    );
  requireValue(
    state.events.every((e) => e.source === state.binding.source),
    'register_source',
  );
  if (state.owned) {
    const product = state.events.find((e) => e.kind === 'create' && e.result === 'ACKNOWLEDGED')?.response?.data
      ?.productCreate?.product;
    requireValue(
      product &&
        JSON.stringify(state.fixtureIdentity) ===
          JSON.stringify({
            handle: product.handle,
            title: product.title,
            tags: product.tags,
            createdAt: product.createdAt,
          }),
      'register_fixture_identity',
    );
  }
}
export function assertIdentity(data) {
  const install = data?.currentAppInstallation;
  requireValue(
    data?.shop?.id === TARGET.shop &&
      data.shop.myshopifyDomain === TARGET.domain &&
      data.shop.plan?.partnerDevelopment === true &&
      install?.id === TARGET.installation &&
      install.app?.id === TARGET.app &&
      install.app.apiKey === TARGET.client,
    'identity',
  );
  const grants = install.accessScopes?.map((x) => x.handle).sort();
  requireValue(JSON.stringify(grants) === JSON.stringify(GRANTS), 'retained_grants');
}
export function assertUnpublished(product) {
  requireValue(product?.__typename === 'Product' && gid.test(product.id), 'product_shape');
  requireValue(product.publishedAt === null && product.onlineStoreUrl === null, 'publication');
  for (const name of ['resourcePublications', 'unpublishedPublications']) {
    const connection = product[name];
    requireValue(
      Array.isArray(connection?.nodes) &&
        connection.nodes.length <= 250 &&
        connection.pageInfo?.hasNextPage === false &&
        connection.pageInfo.hasPreviousPage === false,
      'publication_completeness',
    );
  }
  requireValue(product.resourcePublications.nodes.length === 0, 'publication_membership');
  requireValue(['DRAFT', 'ACTIVE', 'UNLISTED', 'ARCHIVED'].includes(product.status), 'status');
}
export function assertOwned(product, state) {
  assertUnpublished(product);
  if (state.fixtureIdentity)
    requireValue(
      JSON.stringify({
        handle: product.handle,
        title: product.title,
        tags: product.tags,
        createdAt: product.createdAt,
      }) === JSON.stringify(state.fixtureIdentity),
      'fixture_identity',
    );
  requireValue(
    product.handle === state.run &&
      product.title === state.run &&
      Array.isArray(product.tags) &&
      product.tags.includes(state.run) &&
      Number.isFinite(Date.parse(product.createdAt)) &&
      Date.parse(product.createdAt) >= Date.parse(state.createdAt) - 5000 &&
      Date.parse(product.createdAt) <= Date.now() + 1000,
    'fixture_ownership',
  );
}
async function body(response, limit) {
  if (!response.body) return { bytes: null, observation: 'MISSING_BODY' };
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0,
    observedBytes = 0,
    oversized = false;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      observedBytes += part.value.byteLength;
      const take = Math.min(part.value.byteLength, limit + 1 - length);
      chunks.push(part.value.subarray(0, take));
      length += take;
      if (length > limit) {
        oversized = true;
        void reader.cancel().catch(() => {});
        break;
      }
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks, length);
  if (oversized) return { bytes, observation: 'OVERSIZED_BODY', prefixDigest: hash(bytes), observedBytes };
  const text = bytes.toString('utf8');
  let utf8Valid = true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    utf8Valid = false;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    /* Delivered unchanged to the actual adapter. */
  }
  return {
    bytes,
    value,
    observation: utf8Valid ? 'COMPLETE_BODY' : 'INVALID_UTF8',
    digest: hash(bytes),
    observedBytes,
  };
}
export function replayResponse(event) {
  if (event.replayKind === 'TRANSPORT_OR_STREAM_ERROR') throw new Error('synthetic captured transport/stream failure');
  const status = event.httpStatus;
  let bytes;
  if (event.replayKind === 'MISSING_BODY') bytes = null;
  else if (event.replayKind === 'OVERSIZED_BODY') {
    requireValue([128 * 1024, 1_000_000].includes(event.bodyLimit), 'replay_bound');
    bytes = Buffer.alloc(event.bodyLimit + 1, 32);
  } else if (event.replayKind === 'INVALID_UTF8') {
    let text = JSON.stringify(event.response);
    if (
      typeof text === 'string' &&
      !text.includes('\uFFFD') &&
      event.response &&
      typeof event.response === 'object' &&
      !Array.isArray(event.response)
    )
      text = JSON.stringify({ ...event.response, m5ReplayInvalidUtf8: '\uFFFD' });
    if (!text || !text.includes('\uFFFD')) bytes = Buffer.from([255]);
    else {
      const safe = Buffer.from(text),
        at = safe.indexOf(Buffer.from('\uFFFD'));
      bytes = Buffer.concat([safe.subarray(0, at), Buffer.from([255]), safe.subarray(at + 3)]);
    }
  } else if (event.replayKind === 'NON_JSON') bytes = Buffer.from('invalid-json-redacted');
  else if (event.replayBody === '') bytes = null;
  else bytes = Buffer.from(JSON.stringify(event.response));
  return new Response(bytes, { status });
}
function sanitizeEnvelope(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const out = {};
  if (Object.hasOwn(raw, 'data')) out.data = structuredClone(raw.data);
  if (Object.hasOwn(raw, 'errors')) {
    out.errors = Array.isArray(raw.errors)
      ? raw.errors.map((e) => {
          if (!e || typeof e !== 'object' || Array.isArray(e)) return e;
          const copy = structuredClone(e);
          if (typeof copy.message === 'string') copy.message = '<redacted provider message>';
          if (copy.extensions && typeof copy.extensions === 'object') {
            const code = copy.extensions.code;
            copy.extensions = Object.hasOwn(copy.extensions, 'code')
              ? {
                  code:
                    typeof code === 'string' && !['THROTTLED', 'MAX_COST_EXCEEDED', 'ACCESS_DENIED'].includes(code)
                      ? '<redacted code>'
                      : code,
                }
              : {};
          }
          return copy;
        })
      : structuredClone(raw.errors);
  }
  for (const field of ['productCreate', 'productUpdate']) {
    const errors = out.data?.[field]?.userErrors;
    if (Array.isArray(errors))
      for (const error of errors)
        if (error && typeof error.message === 'string') error.message = '<redacted provider message>';
  }
  return out;
}

export function createOperator({ directory, fetchImpl = globalThis.fetch }) {
  requireValue(fetchImpl !== globalThis.fetch || resolve(directory) === LIVE_DIRECTORY, 'canonical_register');
  protectDirectory(directory);
  const lock = resolve(directory, 'operator.lock');
  const fd = openSync(lock, 'wx', 0o600);
  writeFileSync(fd, JSON.stringify({ pid: process.pid }));
  fsyncSync(fd);
  closeSync(fd);
  let state;
  try {
    const file = lstatSync(resolve(directory, 'register.json')),
      dir = lstatSync(directory);
    requireValue(
      file.isFile() &&
        !file.isSymbolicLink() &&
        file.uid === process.getuid() &&
        (file.mode & 0o077) === 0 &&
        dir.isDirectory() &&
        !dir.isSymbolicLink(),
      'register_permissions',
    );
    state = JSON.parse(readFileSync(resolve(directory, 'register.json'), 'utf8'));
    validate(state);
  } catch (error) {
    unlinkSync(lock);
    throw error;
  }
  let step = null,
    closed = false,
    serial = Promise.resolve(),
    pendingDispatches = 0;
  const unknownWrite = () =>
    state.events.some((e) => ['create', 'update'].includes(e.kind) && ['RESERVED', 'UNKNOWN'].includes(e.result));
  const save = () => persist(directory, state);
  function reserve(kind, operation, publicBody) {
    const cap = state.finalizing ? LIMITS[kind] : kind === 'read' ? 84 : kind === 'update' ? 13 : LIMITS[kind];
    requireValue(state.counts[kind] < cap, 'ceiling');
    const event = {
      index: state.events.length,
      kind,
      operation,
      fixture: state.fixture,
      source: state.binding.source,
      step: step?.name ?? null,
      at: new Date().toISOString(),
      bodyDigest: hash(publicBody),
      result: 'RESERVED',
    };
    state.counts[kind]++;
    state.events.push(event);
    save();
    return event;
  }
  async function dispatch(url, init) {
    requireValue(!closed, 'closed');
    requireValue(!init?.signal?.aborted, 'cancelled_before_dispatch');
    const u = new URL(url);
    requireValue(
      u.origin === `https://${TARGET.domain}` &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        init?.method === 'POST' &&
        typeof init.body === 'string' &&
        init.body.length <= 32 * 1024,
      'target',
    );
    const request = JSON.parse(init.body);
    let kind,
      operation,
      publicBody = request;
    if (u.pathname === '/admin/oauth/access_token') {
      requireValue(
        keys(request, ['client_id', 'client_secret', 'grant_type']) &&
          request.client_id === TARGET.client &&
          request.grant_type === 'client_credentials' &&
          typeof request.client_secret === 'string' &&
          request.client_secret.length > 0,
        'auth_route',
      );
      kind = 'auth';
      operation = 'existing_admin_client_credentials';
      publicBody = { client_id: request.client_id, grant_type: request.grant_type, secret: '<not retained>' };
    } else {
      requireValue(
        u.pathname === '/admin/api/2026-07/graphql.json' && keys(request, ['query', 'variables']),
        'api_route',
      );
      const v = request.variables,
        q = request.query;
      if (q === IDENTITY) {
        requireValue(keys(v, []), 'variables');
        kind = 'read';
        operation = 'identity';
      } else if (q === FIND) {
        requireValue(
          keys(v, ['search']) &&
            v.search === `handle:${state.run}` &&
            state.counts.create === 1 &&
            !state.fixture &&
            unknownWrite() &&
            !state.events.some((e) => e.operation === 'creation_lookup'),
          'variables',
        );
        kind = 'read';
        operation = 'creation_lookup';
      } else if (q === CREATE) {
        requireValue(
          keys(v, ['product']) &&
            keys(v.product, ['title', 'handle', 'tags', 'status']) &&
            v.product.title === state.run &&
            v.product.handle === state.run &&
            JSON.stringify(v.product.tags) === JSON.stringify([state.run]) &&
            v.product.status === 'DRAFT' &&
            state.fixture === null &&
            state.identity &&
            !state.blocked &&
            !unknownWrite(),
          'create_permission',
        );
        kind = 'create';
        operation = 'create_draft';
      } else {
        requireValue(state.fixture && state.owned, 'fixture');
        if (q === ADAPTER_READ) {
          requireValue(keys(v, ['productId']) && v.productId === state.fixture, 'variables');
          kind = 'read';
          operation = 'adapter_read';
        } else if (q === FIXTURE) {
          requireValue(keys(v, ['id']) && v.id === state.fixture, 'variables');
          kind = 'read';
          operation = 'fixture_read';
        } else if (q === CATALOG_DETAIL) {
          requireValue(keys(v, ['id', 'after']) && v.id === state.fixture && v.after === null, 'variables');
          kind = 'read';
          operation = 'catalog_detail';
        } else if (q === CATALOG_LIST) {
          requireValue(
            keys(v, ['first', 'after', 'search']) &&
              v.first === 1 &&
              v.after === null &&
              v.search === `handle:${state.run}`,
            'variables',
          );
          kind = 'read';
          operation = 'catalog_list';
        } else {
          requireValue(
            (q === SETUP || q === ADAPTER_UPDATE) &&
              keys(v, ['product']) &&
              keys(v.product, ['id', 'status']) &&
              v.product.id === state.fixture &&
              step?.status === v.product.status &&
              step.query === q &&
              !step.consumed &&
              Date.now() <= step.deadline &&
              state.unpublished?.id === state.fixture &&
              Date.now() - Date.parse(state.unpublished.at) <= 60_000 &&
              state.identity &&
              Date.now() - Date.parse(state.identity.at) <= 60_000 &&
              (!state.blocked || state.finalizing) &&
              !unknownWrite(),
            'status_permission',
          );
          kind = 'update';
          operation = q === SETUP ? 'setup_status' : 'adapter_status';
        }
      }
    }
    const event = reserve(kind, operation, publicBody);
    if (kind === 'update') {
      step.consumed = true;
      if (Date.now() > step.deadline) {
        event.result = 'NOT_SENT';
        save();
        throw new Stop('deadline');
      }
    }
    let response, parsed;
    try {
      response = await fetchImpl(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(12_000), ...(init.signal ? [init.signal] : [])]),
      });
      event.httpStatus = response.status;
      if (kind !== 'auth' && (operation.startsWith('catalog_') ? !response.ok : response.status !== 200)) {
        event.result = ['create', 'update'].includes(kind) ? 'UNKNOWN' : 'RESPONDED';
        event.replayBody = '';
        event.bodyObservation = 'NOT_READ_STATUS_CLASSIFIED';
        save();
        void response.body?.cancel().catch(() => {});
        return new Response(null, { status: response.status });
      }
      parsed = await body(response, operation.startsWith('catalog_') ? 1_000_000 : 128 * 1024);
    } catch {
      event.result = 'UNKNOWN';
      event.replayKind = 'TRANSPORT_OR_STREAM_ERROR';
      save();
      throw new Stop('unknown_http_result');
    }
    event.httpStatus = response.status;
    if (kind === 'auth') {
      // Never persist access tokens, credentials, headers, auth bodies or their digests.
      event.result = response.ok ? 'RESPONDED' : 'REJECTED';
      save();
      return new Response(parsed.bytes, { status: response.status });
    }
    event.bodyObservation = parsed.observation;
    event.bodyLimit = operation.startsWith('catalog_') ? 1_000_000 : 128 * 1024;
    if (parsed.digest) event.responseDigest = parsed.digest;
    if (parsed.prefixDigest) {
      event.responsePrefixDigest = parsed.prefixDigest;
      event.observedBodyBytes = parsed.observedBytes;
    }
    event.replayKind = ['MISSING_BODY', 'OVERSIZED_BODY', 'INVALID_UTF8'].includes(parsed.observation)
      ? parsed.observation
      : parsed.value === undefined
        ? 'NON_JSON'
        : 'JSON';
    if (parsed.value === undefined && event.replayKind === 'NON_JSON') event.replayBody = 'invalid-json-redacted';
    if (parsed.value !== undefined) event.response = sanitizeEnvelope(parsed.value);
    const mutation = parsed.value?.data?.[kind === 'create' ? 'productCreate' : 'productUpdate'];
    if (['create', 'update'].includes(kind)) {
      const product = mutation?.product;
      event.result =
        response.status === 200 &&
        parsed.value &&
        !Object.hasOwn(parsed.value, 'errors') &&
        Array.isArray(mutation?.userErrors) &&
        mutation.userErrors.length === 0 &&
        product &&
        gid.test(product.id) &&
        product.status === request.variables.product.status &&
        (kind === 'create' || product.id === state.fixture)
          ? 'ACKNOWLEDGED'
          : response.status === 200 &&
              mutation?.product === null &&
              Array.isArray(mutation.userErrors) &&
              mutation.userErrors.length > 0 &&
              mutation.userErrors.every(
                (e) =>
                  e &&
                  typeof e.message === 'string' &&
                  (e.field === null || (Array.isArray(e.field) && e.field.every((x) => typeof x === 'string'))),
              ) &&
              parsed.value &&
              !Object.hasOwn(parsed.value, 'errors')
            ? 'REJECTED'
            : 'UNKNOWN';
      if (kind === 'create' && event.result === 'ACKNOWLEDGED') {
        state.fixture = product.id;
        event.fixture = product.id;
        try {
          assertOwned(product, state);
          state.owned = true;
          state.fixtureIdentity = {
            handle: product.handle,
            title: product.title,
            tags: [...product.tags],
            createdAt: product.createdAt,
          };
        } catch {
          state.blocked = 'creation_ownership_or_exposure';
        }
      }
    } else event.result = 'RESPONDED';
    const product = mutation?.product ?? parsed.value?.data?.product ?? parsed.value?.data?.node;
    if (product && Object.hasOwn(product, 'resourcePublications')) {
      try {
        assertUnpublished(product);
        requireValue(product.id === state.fixture, 'fixture');
        state.unpublished = { id: product.id, at: new Date().toISOString() };
      } catch (error) {
        state.unpublished = null;
        state.blocked = error.kind ?? 'publication';
      }
    }
    save();
    return new Response(parsed.bytes, { status: response.status });
  }
  return {
    state: () => structuredClone(state),
    identity(data) {
      try {
        assertIdentity(data);
        state.identity = { ...structuredClone(data), at: new Date().toISOString() };
        save();
      } catch (error) {
        state.blocked = error.kind ?? 'identity';
        save();
        throw error;
      }
    },
    step(name, status, query) {
      requireValue(['DRAFT', 'ACTIVE', 'UNLISTED', 'ARCHIVED'].includes(status), 'step');
      step = { name, status, query, consumed: false, deadline: Date.now() + 60_000 };
    },
    permittedRestore(fixture) {
      return (
        state.fixture === fixture &&
        state.owned &&
        !unknownWrite() &&
        step?.query === ADAPTER_UPDATE &&
        !step.consumed &&
        Date.now() <= step.deadline &&
        state.counts.update < (state.finalizing ? 16 : 13)
      );
    },
    block(kind) {
      state.blocked = kind;
      save();
    },
    finalize() {
      requireValue(state.fixture && state.owned && !unknownWrite(), 'unsettled_write');
      state.finalizing = true;
      save();
    },
    fetch(url, init) {
      pendingDispatches++;
      const pending = serial
        .then(() => dispatch(url, init))
        .finally(() => {
          pendingDispatches--;
        });
      serial = pending.catch(() => {});
      return pending;
    },
    close() {
      requireValue(!closed, 'closed');
      requireValue(pendingDispatches === 0, 'pending_dispatch');
      closed = true;
      unlinkSync(lock);
    },
  };
}
