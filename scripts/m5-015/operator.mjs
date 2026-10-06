import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AVAILABILITY_ADMIN_API_VERSION } from '../../packages/shopify/dist/index.js';
import { digest, requireValue, Stop } from '../m5-011/operator.mjs';
import { CREATE, FIND, IDENTITY, OWNED, SCOPE, STATUS, TARGET } from './documents.mjs';

export { digest, requireValue, Stop };
export const LIVE_DIRECTORY = '/home/serveradmin/insignia-m5-015-handoff/run';
export const LIMITS = Object.freeze({ auth: 2, graphql: 96, create: 1, directUpdate: 3, adapterMutation: 2 });
const keys = (v, names) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...names].sort());
const date = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value));
const productGid = (value) =>
  typeof value === 'string' &&
  /^gid:\/\/shopify\/Product\/[1-9][0-9]{0,30}$/.test(value) &&
  !['gid://shopify/Product/10490211467547', 'gid://shopify/Product/10490128138523'].includes(value);
export function atomic(directory, filename, bytes, exclusive = false) {
  requireValue(/^[a-z0-9.-]+$/.test(filename), 'artifact_name');
  const target = resolve(directory, filename),
    temporary = `${target}.next`;
  const fd = openSync(exclusive ? target : temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (!exclusive) renameSync(temporary, target);
  const dir = openSync(directory, 'r');
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
export const saveJSON = (directory, name, value, exclusive = false) =>
  atomic(directory, name, `${JSON.stringify(value, null, 2)}\n`, exclusive);
export function identity(data) {
  const installation = data?.currentAppInstallation;
  requireValue(
    data?.shop?.id === TARGET.shop &&
      data.shop.myshopifyDomain === TARGET.domain &&
      data.shop.plan?.partnerDevelopment === true &&
      installation?.id === TARGET.installation &&
      installation.app?.id === TARGET.app &&
      installation.app.apiKey === TARGET.client,
    'identity',
  );
  const grants = installation.accessScopes;
  requireValue(
    Array.isArray(grants) &&
      grants.length <= 250 &&
      grants.every(
        (g) => keys(g, ['handle']) && typeof g.handle === 'string' && /^[a-z][a-z0-9_]{0,127}$/.test(g.handle),
      ) &&
      new Set(grants.map((g) => g.handle)).size === grants.length &&
      ['read_products', 'write_products', 'read_publications'].every((g) => grants.some((n) => n.handle === g)),
    'grants',
  );
  return {
    shop: { id: TARGET.shop, myshopifyDomain: TARGET.domain, plan: { partnerDevelopment: true } },
    currentAppInstallation: {
      id: TARGET.installation,
      app: { id: TARGET.app, apiKey: TARGET.client },
      accessScopes: grants,
    },
  };
}
export function owned(product, state, initial = false) {
  requireValue(
    product?.__typename === 'Product' &&
      productGid(product.id) &&
      product.handle === state.marker &&
      product.title === state.marker &&
      JSON.stringify(product.tags) === JSON.stringify([state.marker]) &&
      date(product.createdAt) &&
      date(product.updatedAt) &&
      ['DRAFT', 'ACTIVE', 'ARCHIVED', 'UNLISTED'].includes(product.status),
    'ownership',
  );
  requireValue(
    initial
      ? Date.parse(product.createdAt) >= Date.parse(state.createdAt)
      : product.id === state.fixture.id && product.createdAt === state.fixture.createdAt,
    'ownership',
  );
  return Object.fromEntries(
    ['__typename', 'id', 'handle', 'title', 'tags', 'createdAt', 'status', 'updatedAt'].map((key) => [
      key,
      product[key],
    ]),
  );
}
// Retain only the fields the production static documents requested.
function projection(p) {
  return (
    p &&
    Object.fromEntries(
      ['__typename', 'id', 'status', 'updatedAt', 'publishedAt', 'onlineStoreUrl', 'resourcePublications'].map(
        (key) => [key, p[key]],
      ),
    )
  );
}
const page = (value, cursor = false) =>
  value && {
    hasNextPage: value.hasNextPage,
    hasPreviousPage: value.hasPreviousPage,
    ...(cursor ? { endCursor: value.endCursor } : {}),
  };
function adapterData(data) {
  const mapConnection = (c) =>
    c && {
      nodes: c.nodes?.map((p) => ({
        id: p.id,
        autoPublish: p.autoPublish,
        supportsFuturePublishing: p.supportsFuturePublishing,
        includedProducts: p.includedProducts && {
          nodes: p.includedProducts.nodes?.map((n) => ({ id: n.id })),
          pageInfo: page(p.includedProducts.pageInfo),
        },
      })),
      pageInfo: page(c.pageInfo, true),
    };
  const product = projection(data.node ?? data.productUpdate?.product);
  if (product?.resourcePublications)
    product.resourcePublications = {
      nodes: product.resourcePublications.nodes?.map((n) => ({
        isPublished: n.isPublished,
        publishDate: n.publishDate,
        publication: { id: n.publication?.id },
      })),
      pageInfo: page(product.resourcePublications.pageInfo),
    };
  if (data.productUpdate) return { productUpdate: { product, userErrors: [] } };
  return {
    shop: { id: data.shop?.id },
    currentAppInstallation: {
      app: { apiKey: data.currentAppInstallation?.app?.apiKey },
      accessScopes: data.currentAppInstallation?.accessScopes?.map((g) => ({ handle: g.handle })),
    },
    node: product,
    publications: mapConnection(data.publications),
  };
}
async function bytes(response, signal) {
  requireValue(response.body, 'body_missing');
  const reader = response.body.getReader();
  let cancellation;
  const cancel = () =>
    (cancellation ??= reader.cancel().catch(() => {
      throw new Stop('body_disposal_unsettled');
    }));
  const abort = () => {
    void cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const n = await reader.read();
      if (n.done) break;
      size += n.value.byteLength;
      requireValue(size <= 128 * 1024, 'body_bound');
      chunks.push(n.value);
    }
  } catch (error) {
    await cancel();
    throw error;
  } finally {
    if (signal.aborted) await cancel();
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  requireValue(!signal.aborted, 'transport_timeout');
  return Buffer.concat(chunks, size);
}
export function createOperator({ directory, binding, documents, phase, synthetic = false, fetchImpl, assertCurrent }) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  requireValue(
    info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() && (info.mode & 0o077) === 0,
    'register_permissions',
  );
  let state;
  if (phase === 'start') {
    try {
      atomic(directory, 'initialized.once', '', true);
    } catch {
      throw new Stop('reentry');
    }
    state = {
      version: 1,
      profile: 'm5-015',
      binding,
      marker: `insignia-m5-015-${randomUUID()}`,
      operationId: randomUUID(),
      createdAt: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(),
      initialPid: process.pid,
      phase: 'STARTED',
      closed: false,
      counts: { auth: 0, graphql: 0, create: 0, directUpdate: 0, adapterMutation: 0 },
      calls: { acquire: 0, observe: 0, restore: 0, setup: 0, cleanup: 0, recovery: 0 },
      events: [],
      pending: null,
      fixture: null,
      identity: null,
      ownedAt: null,
      evidence: { outcome: 'STOPPED', cleanup: { outcome: 'NOT_ATTEMPTED' } },
    };
  } else {
    const file = resolve(directory, 'register.json'),
      info = lstatSync(file);
    requireValue(
      info.isFile() &&
        !info.isSymbolicLink() &&
        info.uid === process.getuid() &&
        (info.mode & 0o077) === 0 &&
        info.size < 2 * 1024 * 1024,
      'register_permissions',
    );
    state = JSON.parse(readFileSync(file));
    requireValue(
      !state.closed &&
        state.phase === 'HELD_PERSISTED' &&
        state.pending === null &&
        JSON.stringify(state.binding) === JSON.stringify(binding),
      'resume_gate',
    );
    requireValue(synthetic || state.initialPid !== process.pid, 'fresh_process_required');
    try {
      atomic(directory, 'resume.once', '', true);
    } catch {
      throw new Stop('resume_reentry');
    }
    state.resumePid = process.pid;
    state.phase = 'RESUMING';
  }
  let busy = false,
    token = null,
    mode = 'startup';
  const save = () => saveJSON(directory, 'register.json', state);
  save();
  const fresh = () => requireValue(state.identity && Date.now() - state.identity.at < 30000, 'stale_identity');
  const freshOwned = () => {
    fresh();
    requireValue(state.fixture && state.ownedAt && Date.now() - state.ownedAt < 30000, 'stale_ownership');
  };
  const allWritesSettled = () =>
    state.pending === null &&
    state.events
      .filter((e) => e.mutation)
      .every(
        (e) => e.settlement === 'ACKNOWLEDGED' && (e.kind !== 'adapterMutation' || e.validatedAcknowledgement === true),
      );
  function classify(url, init, body) {
    requireValue(!busy && !state.closed && state.pending === null, 'closed_or_parallel');
    assertCurrent();
    requireValue(init?.method === 'POST' && typeof init.body === 'string', 'request_shape');
    if (url === `https://${TARGET.domain}/admin/oauth/access_token`) {
      requireValue(
        token === null &&
          mode === 'startup' &&
          !state.events.some((e) => e.kind === 'auth' && e.phase === state.phase) &&
          keys(body, ['client_id', 'client_secret', 'grant_type']) &&
          body.client_id === TARGET.client &&
          body.grant_type === 'client_credentials' &&
          typeof body.client_secret === 'string' &&
          body.client_secret.length > 0,
        'auth_request',
      );
      return { kind: 'auth', operation: 'client_credentials', mutation: false };
    }
    requireValue(
      url === `https://${TARGET.domain}/admin/api/${AVAILABILITY_ADMIN_API_VERSION}/graphql.json` &&
        keys(body, ['query', 'variables']) &&
        token &&
        Date.now() + 30000 < token.expiresAt &&
        init.headers?.['x-shopify-access-token'] === token.accessToken,
      'endpoint_or_credential',
    );
    if (body.query === IDENTITY && keys(body.variables, []))
      return { kind: 'graphql', operation: 'identity', mutation: false };
    if (body.query === OWNED && keys(body.variables, ['id']) && body.variables.id === state.fixture?.id)
      return { kind: 'graphql', operation: 'owned', mutation: false };
    if (body.query === CREATE) {
      fresh();
      requireValue(
        mode === 'create' &&
          !state.fixture &&
          state.counts.create === 0 &&
          keys(body.variables, ['product']) &&
          keys(body.variables.product, ['title', 'handle', 'tags', 'status']) &&
          body.variables.product.title === state.marker &&
          body.variables.product.handle === state.marker &&
          JSON.stringify(body.variables.product.tags) === JSON.stringify([state.marker]) &&
          body.variables.product.status === 'DRAFT',
        'create_authority',
      );
      return { kind: 'create', operation: 'create', mutation: true };
    }
    if (body.query === FIND) {
      requireValue(
        mode === 'recovery' &&
          state.calls.recovery === 1 &&
          !state.events.some((e) => e.operation === 'recovery') &&
          keys(body.variables, ['search']) &&
          body.variables.search === `tag:'${state.marker}' AND handle:'${state.marker}'`,
        'recovery_authority',
      );
      return { kind: 'graphql', operation: 'recovery', mutation: false };
    }
    if (body.query === STATUS) {
      freshOwned();
      requireValue(
        keys(body.variables, ['product']) &&
          keys(body.variables.product, ['id', 'status']) &&
          body.variables.product.id === state.fixture.id,
        'status_target',
      );
      requireValue(
        (mode === 'setup' &&
          state.calls.setup === 1 &&
          state.fixture.status === 'DRAFT' &&
          body.variables.product.status === 'ACTIVE') ||
          (mode === 'cleanup' &&
            state.calls.cleanup === 1 &&
            allWritesSettled() &&
            body.variables.product.status === 'ARCHIVED'),
        'status_authority',
      );
      requireValue(!state.events.some((e) => e.operation === mode && e.mutation), 'status_replay');
      return { kind: 'directUpdate', operation: mode, mutation: true };
    }
    if (body.query === documents.read) {
      freshOwned();
      requireValue(
        ['draft', 'before', 'acquire', 'observe', 'restore', 'cleanup-read', 'final'].includes(mode) &&
          keys(body.variables, ['productId', 'productQuery', 'after']) &&
          body.variables.productId === state.fixture.id &&
          body.variables.productQuery === `id:${state.fixture.id.split('/').at(-1)}` &&
          (body.variables.after === null ||
            (typeof body.variables.after === 'string' && body.variables.after.length <= 2048)),
        'adapter_read_target',
      );
      return { kind: 'graphql', operation: `${mode}-read`, mutation: false, adapter: true };
    }
    if (body.query === documents.update) {
      freshOwned();
      requireValue(
        ['acquire', 'restore'].includes(mode) &&
          state.calls[mode] === 1 &&
          keys(body.variables, ['product']) &&
          keys(body.variables.product, ['id', 'status']) &&
          body.variables.product.id === state.fixture.id &&
          body.variables.product.status === (mode === 'acquire' ? 'DRAFT' : 'ACTIVE') &&
          !state.events.some((e) => e.operation === mode && e.mutation),
        'adapter_mutation_authority',
      );
      return { kind: 'adapterMutation', operation: mode, mutation: true, adapter: true };
    }
    throw new Stop('document_denied');
  }
  async function fetch(url, init) {
    let body;
    try {
      body = JSON.parse(init.body);
    } catch {
      throw new Stop('request_json');
    }
    const r = classify(url, init, body);
    requireValue(
      state.counts[r.kind] < LIMITS[r.kind] && (r.kind === 'auth' || state.counts.graphql < LIMITS.graphql),
      'ceiling',
    );
    state.counts[r.kind]++;
    if (!['auth', 'graphql'].includes(r.kind)) state.counts.graphql++;
    const event = {
      index: state.events.length,
      phase: state.phase,
      ...r,
      startedAt: new Date().toISOString(),
      request: r.kind === 'auth' ? { client_id: TARGET.client, grant_type: 'client_credentials' } : body,
      invoked: false,
      settlement: r.mutation ? 'UNKNOWN' : 'PENDING',
    };
    state.events.push(event);
    state.pending = event.index;
    save();
    busy = true;
    let underlyingSettled = true;
    const signal = AbortSignal.any([AbortSignal.timeout(8000), ...(init.signal ? [init.signal] : [])]);
    try {
      assertCurrent();
      requireValue(!signal.aborted, 'transport_timeout');
      const aborted = new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Stop('transport_timeout')), { once: true }),
      );
      const work = (async () => {
        underlyingSettled = false;
        event.invoked = true;
        try {
          const response = await fetchImpl(url, { ...init, redirect: 'error', signal });
          event.status = response.status;
          const raw = JSON.parse((await bytes(response, signal)).toString('utf8'));
          requireValue(response.status === 200, 'provider_status');
          return raw;
        } catch (error) {
          if (error instanceof Stop && error.kind === 'body_disposal_unsettled') event.disposalUnsettled = true;
          throw error;
        } finally {
          underlyingSettled = event.disposalUnsettled !== true;
        }
      })();
      const raw = await Promise.race([aborted, work]);
      let returned;
      if (r.kind === 'auth') {
        requireValue(
          typeof raw.access_token === 'string' &&
            raw.access_token.length > 0 &&
            raw.access_token.length <= 8192 &&
            [...raw.access_token].every((c) => c.charCodeAt(0) > 32 && c.charCodeAt(0) !== 127) &&
            Number.isSafeInteger(raw.expires_in) &&
            raw.expires_in > 60,
          'auth_response',
        );
        event.observation = { hasToken: true, expiresIn: raw.expires_in };
        returned = raw;
      } else {
        requireValue(raw?.data && !Object.hasOwn(raw, 'errors'), 'provider_error');
        const d = raw.data;
        if (r.operation === 'identity' || r.operation === 'owned' || r.operation === 'recovery') {
          const selected = identity(d);
          state.identity = {
            grants: selected.currentAppInstallation.accessScopes.map((g) => g.handle).sort(),
            at: Date.now(),
          };
          returned = { data: selected };
        }
        if (r.operation === 'owned') {
          const p = owned(d.product, state);
          state.fixture = p;
          state.ownedAt = Date.now();
          returned.data.product = p;
        }
        if (r.operation === 'recovery') {
          const c = d.products;
          requireValue(
            Array.isArray(c?.nodes) &&
              c.nodes.length <= 1 &&
              c.pageInfo?.hasNextPage === false &&
              c.pageInfo.hasPreviousPage === false,
            'recovery_connection',
          );
          returned.data.products = {
            nodes: c.nodes.map((p) => owned(p, state, true)),
            pageInfo: { hasNextPage: false, hasPreviousPage: false },
          };
        }
        if (r.operation === 'create' || r.kind === 'directUpdate') {
          const reply = r.operation === 'create' ? d.productCreate : d.productUpdate;
          requireValue(Array.isArray(reply?.userErrors) && reply.userErrors.length === 0, 'mutation_error');
          const p = owned(reply.product, state, r.operation === 'create');
          requireValue(
            p.status === (r.operation === 'create' ? 'DRAFT' : r.operation === 'setup' ? 'ACTIVE' : 'ARCHIVED'),
            'mutation_state',
          );
          state.fixture = p;
          state.ownedAt = Date.now();
          returned = {
            data: { [r.operation === 'create' ? 'productCreate' : 'productUpdate']: { product: p, userErrors: [] } },
          };
        }
        if (r.adapter) {
          if (r.mutation) {
            const p = d.productUpdate?.product;
            requireValue(
              Array.isArray(d.productUpdate?.userErrors) &&
                d.productUpdate.userErrors.length === 0 &&
                p?.id === state.fixture.id &&
                p.status === body.variables.product.status,
              'adapter_ack',
            );
          }
          returned = { data: adapterData(d) };
        }
        event.response = returned;
      }
      event.settlement = r.mutation ? 'ACKNOWLEDGED' : 'SETTLED';
      event.completedAt = new Date().toISOString();
      save();
      return Response.json(returned);
    } catch (error) {
      event.failure = error instanceof Stop ? error.kind : 'transport_or_shape';
      if (!event.invoked && r.mutation) event.settlement = 'NOT_DISPATCHED';
      event.completedAt = new Date().toISOString();
      save();
      throw new Stop(event.failure);
    } finally {
      busy = false;
      state.pending = underlyingSettled ? null : event.index;
      if (!underlyingSettled) event.quarantined = true;
      save();
    }
  }
  return {
    fetch,
    state: () => structuredClone(state),
    save: () => save(),
    setToken(value) {
      requireValue(token === null, 'token_replacement');
      token = value;
    },
    isCurrent(scope) {
      assertCurrent();
      return (
        JSON.stringify(scope) === JSON.stringify(SCOPE) &&
        state.identity &&
        Date.now() - state.identity.at < 30000 &&
        state.pending === null
      );
    },
    mode(value) {
      mode = value;
    },
    reserve(name) {
      requireValue(Object.hasOwn(state.calls, name) && state.calls[name] === 0 && !state.closed, 'call_reentry');
      state.calls[name]++;
      save();
    },
    patch(fn) {
      fn(state);
      save();
    },
    allWritesSettled,
    close() {
      requireValue(!busy, 'busy_close');
      state.closed = true;
      state.phase = 'CLOSED';
      save();
    },
    directory,
  };
}
