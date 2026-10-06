import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertIdentity, digest, requireValue, Stop } from '../m5-011/operator.mjs';
import { assertProduct as assertShape } from '../m5-012/operator.mjs';
import { ARCHIVE, FINAL, FIXTURE, MARKER, PRESTATE, TARGET } from './documents.mjs';

export { digest, requireValue, Stop };
export const LIVE_DIRECTORY = '/home/serveradmin/insignia-m5-013-handoff/run';
export const LIMITS = Object.freeze({ auth: 1, read: 3, update: 1 });
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keys = (v, n) => v && typeof v === 'object' && !Array.isArray(v) && equal(Object.keys(v).sort(), [...n].sort());
const pick = (v, n) =>
  v && typeof v === 'object' ? Object.fromEntries(n.filter((k) => Object.hasOwn(v, k)).map((k) => [k, v[k]])) : v;
const OWN = ['__typename', 'id', 'handle', 'title', 'tags', 'createdAt', 'status', 'updatedAt'];
export function assertProduct(p) {
  assertShape(p);
  requireValue(
    p.publishedOnPublication === false &&
      p.publishedAt === null &&
      p.onlineStoreUrl === null &&
      !p.resourcePublications.nodes.some((n) => n.isPublished),
    'effective_publication',
  );
}
function selectedIdentity(d) {
  return {
    shop: {
      ...pick(d.shop, ['id', 'myshopifyDomain']),
      plan: pick(d.shop?.plan, ['partnerDevelopment', 'displayName']),
    },
    currentAppInstallation: {
      ...pick(d.currentAppInstallation, ['id']),
      app: pick(d.currentAppInstallation?.app, ['id', 'apiKey']),
      accessScopes: Array.isArray(d.currentAppInstallation?.accessScopes)
        ? d.currentAppInstallation.accessScopes.map((n) => pick(n, ['handle']))
        : d.currentAppInstallation?.accessScopes,
    },
  };
}
function selectedConnection(c, node) {
  return (
    c && {
      nodes: Array.isArray(c.nodes) ? c.nodes.map(node) : c.nodes,
      pageInfo: pick(c.pageInfo, ['hasNextPage', 'hasPreviousPage']),
    }
  );
}
function selectedProduct(p) {
  return (
    p && {
      ...pick(p, [...OWN, 'publishedAt', 'onlineStoreUrl', 'publishedOnPublication']),
      resourcePublications: selectedConnection(
        p.resourcePublications,
        (n) => n && { ...pick(n, ['isPublished', 'publishDate']), publication: pick(n.publication, ['id']) },
      ),
    }
  );
}
function selected(d, name) {
  if (name === 'archive')
    return {
      productUpdate: d.productUpdate && {
        product: selectedProduct(d.productUpdate.product),
        userErrors: Array.isArray(d.productUpdate.userErrors)
          ? d.productUpdate.userErrors.map((n) => ({
              field: Array.isArray(n?.field) ? n.field.map(() => '<field>') : null,
              message: '<provider user error>',
            }))
          : d.productUpdate.userErrors,
      },
    };
  return { ...selectedIdentity(d), product: selectedProduct(d.product) };
}
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
    profile: 'm5-013',
    binding,
    fixture: FIXTURE,
    marker: MARKER,
    counts: { auth: 0, read: 0, update: 0 },
    events: [],
    pending: null,
    closed: false,
    observations: {},
    step: 0,
    prestate: null,
    identity: null,
    authenticated: false,
    ownedAt: null,
    result: null,
  };
  let busy = false;
  const save = () => persist(directory, state);
  save();
  function identify(d) {
    assertIdentity(d);
    const grants = d.currentAppInstallation.accessScopes.map((n) => n.handle).sort();
    if (state.identity) requireValue(equal(grants, state.identity.grants), 'grant_drift');
    state.identity = { grants, at: Date.now() };
  }
  function validate(d, name) {
    if (name === 'archive') {
      requireValue(
        Array.isArray(d.productUpdate?.userErrors) && d.productUpdate.userErrors.length === 0,
        'mutation_user_error',
      );
      assertProduct(d.productUpdate.product);
      requireValue(d.productUpdate.product.status === 'ARCHIVED', 'mutation_state');
      return;
    }
    identify(d);
    assertProduct(d.product);
    if (name === 'prestate') state.prestate = structuredClone(d.product);
    state.ownedAt = Date.now();
  }
  function fresh() {
    assertCurrent();
    requireValue(
      state.identity &&
        Date.now() - state.identity.at < 60000 &&
        state.ownedAt &&
        Date.now() - state.ownedAt < 60000 &&
        state.pending === null,
      'stale_precondition',
    );
  }
  function requestKind(url, init, body) {
    requireValue(!state.closed && !busy && state.pending === null, 'closed_or_parallel');
    requireValue(init?.method === 'POST' && typeof init.body === 'string', 'request_shape');
    if (url === `https://${TARGET.domain}/admin/oauth/access_token`) {
      requireValue(
        state.step === 0 &&
          state.counts.auth === 0 &&
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
    if (
      state.step === 0 &&
      body.query === PRESTATE &&
      keys(body.variables, []) &&
      state.counts.auth === 1 &&
      state.authenticated
    ) {
      requireValue(!state.events.some((e) => e.operation === 'prestate'), 'read_reentry');
      return { kind: 'read', operation: 'prestate' };
    }
    if (
      state.step === 1 &&
      body.query === ARCHIVE &&
      keys(body.variables, ['product']) &&
      keys(body.variables.product, ['id', 'status']) &&
      body.variables.product.id === FIXTURE &&
      body.variables.product.status === 'ARCHIVED'
    ) {
      requireValue(
        state.counts.update === 0 && state.counts.read === 1 && state.prestate.status === 'DRAFT',
        'cleanup_authority',
      );
      fresh();
      return { kind: 'update', operation: 'archive' };
    }
    if (
      state.step === 1 &&
      body.query === FINAL &&
      keys(body.variables, []) &&
      (state.events.some((e) => e.operation === 'archive' && e.invoked) || state.prestate.status === 'ARCHIVED')
    ) {
      requireValue(!state.events.some((e) => e.operation === 'final'), 'read_reentry');
      return { kind: 'read', operation: 'final' };
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
    const r = requestKind(url, init, body);
    assertCurrent();
    requireValue(state.counts[r.kind] < LIMITS[r.kind], 'ceiling');
    state.counts[r.kind]++;
    const event = {
      index: state.events.length,
      ...r,
      startedAt: new Date().toISOString(),
      request: r.kind === 'auth' ? { client_id: TARGET.client, grant_type: 'client_credentials' } : body,
      settlement: r.kind === 'update' ? 'UNKNOWN' : 'PENDING',
      invoked: false,
    };
    state.events.push(event);
    state.pending = event.index;
    save();
    busy = true;
    let underlyingSettled = true;
    try {
      assertCurrent();
      if (r.kind === 'update') {
        requireValue(
          state.identity && Date.now() - state.identity.at < 60000 && Date.now() - state.ownedAt < 60000,
          'stale_precondition',
        );
      }
      const signal = AbortSignal.any([AbortSignal.timeout(8000), ...(init.signal ? [init.signal] : [])]);
      requireValue(!signal.aborted, 'transport_timeout');
      const aborted = new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Stop('transport_timeout')), { once: true }),
      );
      underlyingSettled = false;
      const received = await Promise.race([
        aborted,
        (async () => {
          let got = false,
            disposed = false;
          try {
            event.invoked = true;
            const response = await fetchImpl(url, { ...init, redirect: 'error', signal });
            got = true;
            let bytes = null;
            if (response.status === 200 && !signal.aborted) bytes = await boundedBody(response, signal);
            else await response.body?.cancel();
            disposed = true;
            requireValue(!signal.aborted, 'transport_timeout');
            return { response, bytes };
          } finally {
            underlyingSettled = !got || disposed;
          }
        })(),
      ]);
      event.status = received.response.status;
      let raw = null;
      if (received.bytes && received.bytes.length <= 128 * 1024) {
        try {
          raw = JSON.parse(received.bytes.toString('utf8'));
        } catch {}
      }
      if (r.kind === 'auth') {
        event.observation = {
          status: event.status,
          hasToken: typeof raw?.access_token === 'string',
          expiresIn: Number.isSafeInteger(raw?.expires_in) ? raw.expires_in : null,
        };
        requireValue(
          event.status === 200 &&
            typeof raw?.access_token === 'string' &&
            raw.access_token.length > 0 &&
            raw.access_token.length <= 8192 &&
            [...raw.access_token].every((c) => c.charCodeAt(0) > 32 && c.charCodeAt(0) !== 127) &&
            Number.isSafeInteger(raw.expires_in) &&
            raw.expires_in > 60,
          'auth_response',
        );
        state.authenticated = true;
      } else {
        event.observation = {
          status: event.status,
          graphqlErrors: raw !== null && Object.hasOwn(raw, 'errors'),
          malformedBody: raw === null,
        };
        requireValue(event.status === 200 && raw?.data && !Object.hasOwn(raw, 'errors'), 'provider_error');
        raw = { data: selected(raw.data, r.operation) };
        validate(raw.data, r.operation);
        event.response = structuredClone(raw);
        state.observations[r.operation] = structuredClone(raw.data);
        if (r.operation === 'prestate') state.step++;
      }
      event.settlement = r.kind === 'update' ? 'ACKNOWLEDGED' : 'SETTLED';
      event.completedAt = new Date().toISOString();
      save();
      return Response.json(raw, { status: 200 });
    } catch (e) {
      event.failure = e instanceof Stop ? e.kind : 'transport_failure';
      event.completedAt = new Date().toISOString();
      if (!event.invoked && r.kind === 'update') event.settlement = 'NOT_DISPATCHED';
      save();
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
    settleCleanup() {
      const e = state.events.find((e) => e.operation === 'archive');
      requireValue(
        state.pending === null &&
          e?.invoked &&
          ['ACKNOWLEDGED', 'UNKNOWN'].includes(e.settlement) &&
          state.observations.final?.product.status === 'ARCHIVED',
        'final_settlement',
      );
      assertProduct(state.observations.final.product);
      e.acknowledgementSettlement = e.settlement;
      e.settlement = 'EXACT_FINAL_ARCHIVED_UNPUBLISHED';
      save();
    },
    finish(result) {
      requireValue(!busy && !state.closed, 'finish');
      state.result = result;
      state.closed = true;
      save();
    },
  };
}
