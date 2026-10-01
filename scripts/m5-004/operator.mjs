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
    .update(typeof v === 'string' ? v : JSON.stringify(v))
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
export function initialize(directory, binding) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
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
async function body(response) {
  requireValue(response.body, 'response_body');
  const reader = response.body.getReader();
  let length = 0;
  const chunks = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      requireValue(length <= 128 * 1024, 'response_bound');
      chunks.push(part.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks, length).toString('utf8');
  try {
    return { value: JSON.parse(text), digest: hash(text) };
  } catch {
    throw new Stop('response_json');
  }
}
export function createOperator({ directory, fetchImpl = globalThis.fetch }) {
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
    serial = Promise.resolve();
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
      parsed = await body(response);
    } catch {
      event.result = 'UNKNOWN';
      save();
      throw new Stop('unknown_http_result');
    }
    event.httpStatus = response.status;
    if (kind === 'auth') {
      // Never persist access tokens, credentials, headers, auth bodies or their digests.
      event.result = response.ok ? 'RESPONDED' : 'REJECTED';
      save();
      return Response.json(parsed.value, { status: response.status });
    }
    event.responseDigest = parsed.digest;
    event.response = {
      data: structuredClone(parsed.value.data ?? null),
      errors: parsed.value.errors?.map((e) => ({ path: e.path ?? null, code: e.extensions?.code ?? null })) ?? null,
    };
    // Remote error messages are not retained. The selected fixture fields remain factual raw data.
    for (const field of ['productCreate', 'productUpdate'])
      if (event.response.data?.[field]?.userErrors) {
        event.response.data[field].userErrors = event.response.data[field].userErrors.map((e) => ({ field: e.field }));
      }
    const mutation = parsed.value.data?.[kind === 'create' ? 'productCreate' : 'productUpdate'];
    if (['create', 'update'].includes(kind)) {
      const product = mutation?.product;
      event.result =
        response.ok &&
        !parsed.value.errors &&
        mutation?.userErrors?.length === 0 &&
        product &&
        gid.test(product.id) &&
        product.status === request.variables.product.status &&
        (kind === 'create' || product.id === state.fixture)
          ? 'ACKNOWLEDGED'
          : mutation?.userErrors?.length > 0 && !product && !parsed.value.errors
            ? 'REJECTED'
            : 'UNKNOWN';
      if (kind === 'create' && event.result === 'ACKNOWLEDGED') {
        state.fixture = product.id;
        event.fixture = product.id;
        try {
          assertOwned(product, state);
          state.owned = true;
        } catch {
          state.blocked = 'creation_ownership_or_exposure';
        }
      }
    } else event.result = 'RESPONDED';
    const product = mutation?.product ?? parsed.value.data?.product ?? parsed.value.data?.node;
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
    return Response.json(parsed.value, { status: response.status });
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
      const pending = serial.then(() => dispatch(url, init));
      serial = pending.catch(() => {});
      return pending;
    },
    close() {
      requireValue(!closed, 'closed');
      closed = true;
      unlinkSync(lock);
    },
  };
}
