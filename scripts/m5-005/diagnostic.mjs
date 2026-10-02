import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireValue, Stop, TARGET } from '../m5-004/operator.mjs';
import { protectedCredentials } from '../m5-004/qualification.mjs';
import { digest, verifyGate } from './binding.mjs';
import { DECLARED, IDENTITY, validatedDocuments } from './schema-contract.mjs';

export { DECLARED, IDENTITY, TARGET };
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DIRECTORY = '/home/serveradmin/insignia-m5-005-handoff/run';
const host = `https://${TARGET.domain}`;
const routes = {
  auth: { url: `${host}/admin/oauth/access_token`, method: 'POST' },
  identity: { url: `${host}/admin/api/2026-07/graphql.json`, method: 'POST', query: IDENTITY },
  declared: { url: `${host}/admin/api/2026-07/graphql.json`, method: 'POST', query: DECLARED },
  rest: { url: `${host}/admin/oauth/access_scopes.json`, method: 'GET' },
};
const jsonType = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const noControl = (s) =>
  typeof s === 'string' && ![...s].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
export function scopeProjection(parent, field, format) {
  const present = object(parent) && Object.hasOwn(parent, field);
  const value = present ? parent[field] : undefined;
  const base = {
    present,
    jsonType: present ? jsonType(value) : 'missing',
    handles: [],
    duplicateCount: 0,
    malformedCount: 0,
  };
  if (!present || value === null) return { ...base, state: present ? 'NULL' : 'MISSING' };
  let items;
  if (format === 'token' && typeof value === 'string')
    items = value === '' ? [] : value.split(',').map((s) => s.trim());
  else if (format === 'objects' && Array.isArray(value)) items = value.map((x) => (object(x) ? x.handle : undefined));
  else return { ...base, state: 'MALFORMED', malformedCount: 1 };
  if (items.length > 512) return { ...base, state: 'MALFORMED', malformedCount: items.length };
  const seen = new Set();
  for (const item of items) {
    if (typeof item !== 'string' || !/^(?:unauthenticated_)?(?:read|write)_[a-z][a-z0-9_]{0,95}$/.test(item))
      base.malformedCount++;
    else if (seen.has(item)) base.duplicateCount++;
    else seen.add(item);
  }
  base.handles = [...seen].sort();
  return {
    ...base,
    state: base.malformedCount || base.duplicateCount ? 'MALFORMED' : items.length ? 'VALID' : 'EMPTY',
  };
}
function identityMatches(data, declared = false) {
  const i = data?.currentAppInstallation;
  return (
    i?.id === TARGET.installation &&
    i.app?.id === TARGET.app &&
    i.app.apiKey === TARGET.client &&
    (declared ||
      (data.shop?.id === TARGET.shop &&
        data.shop.myshopifyDomain === TARGET.domain &&
        data.shop.plan?.partnerDevelopment === true))
  );
}
function errors(raw) {
  if (!object(raw) || !Object.hasOwn(raw, 'errors')) return { present: false };
  const list = raw.errors;
  if (!Array.isArray(list)) return { present: true, type: jsonType(list), malformed: true };
  const codes = new Set([
    'ACCESS_DENIED',
    'UNAUTHENTICATED',
    'THROTTLED',
    'GRAPHQL_VALIDATION_FAILED',
    'MAX_COST_EXCEEDED',
    'INTERNAL_SERVER_ERROR',
  ]);
  return {
    present: true,
    count: list.length,
    codes: list.map((e) => (codes.has(e?.extensions?.code) ? e.extensions.code : 'UNCLASSIFIED')),
  };
}
function project(kind, body, status, started, received) {
  const base = {
    httpStatus: status,
    startedAt: new Date(started).toISOString(),
    receivedAt: new Date(received).toISOString(),
  };
  if (kind === 'auth')
    return {
      ...base,
      expiresIn: Number.isInteger(body?.expires_in) ? body.expires_in : null,
      scopes: scopeProjection(body, 'scope', 'token'),
    };
  const error = errors(body);
  if (kind === 'rest')
    return {
      ...base,
      errors: error,
      scopes: scopeProjection(body, 'access_scopes', 'objects'),
      bodyType: jsonType(body),
    };
  const data = body?.data,
    i = data?.currentAppInstallation;
  const knownIdentity = identityMatches(data, kind === 'declared');
  return kind === 'identity'
    ? {
        ...base,
        errors: error,
        identityMatches: knownIdentity,
        identity: knownIdentity
          ? {
              shop: TARGET.shop,
              domain: TARGET.domain,
              app: TARGET.app,
              client: TARGET.client,
              installation: TARGET.installation,
              partnerDevelopment: true,
            }
          : null,
        scopes: scopeProjection(i, 'accessScopes', 'objects'),
      }
    : {
        ...base,
        errors: error,
        identityMatches: knownIdentity,
        requested: scopeProjection(i?.app, 'requestedAccessScopes', 'objects'),
        optional: scopeProjection(i?.app, 'optionalAccessScopes', 'objects'),
      };
}
export function assertRequest(kind, url, init) {
  const expected = routes[kind];
  requireValue(
    expected && url === expected.url && init.method === expected.method && init.redirect === 'error',
    'fixed_request',
  );
  if (kind === 'rest') requireValue(init.body === undefined, 'get_body');
  else {
    const b = JSON.parse(init.body);
    if (kind === 'auth')
      requireValue(
        Object.keys(b).sort().join() === 'client_id,client_secret,grant_type' &&
          b.client_id === TARGET.client &&
          b.grant_type === 'client_credentials' &&
          noControl(b.client_secret) &&
          b.client_secret.length > 0 &&
          b.client_secret.length <= 4096,
        'auth_request',
      );
    else
      requireValue(
        Object.keys(b).sort().join() === 'query,variables' &&
          b.query === expected.query &&
          object(b.variables) &&
          Object.keys(b.variables).length === 0,
        'fixed_document',
      );
  }
}
function persist(directory, state) {
  const path = resolve(directory, 'register.next');
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(path, resolve(directory, 'register.json'));
  const dir = openSync(directory, 'r');
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
async function boundedBody(response) {
  if (!response.body) return { bodyState: 'MISSING_BODY' };
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > 128 * 1024) {
      await reader.cancel();
      return { bodyState: 'OVERSIZED_BODY' };
    }
    chunks.push(next.value);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    return { bodyState: 'INVALID_UTF8' };
  }
  try {
    return { bodyState: 'JSON', value: JSON.parse(text) };
  } catch {
    return { bodyState: 'INVALID_JSON' };
  }
}
async function run({
  directory,
  binding,
  credentials,
  fetchImpl,
  synthetic,
  deadlineMs = 12_000,
  requestTransform = (x) => x,
  validated = validatedDocuments(),
}) {
  requireValue(synthetic || resolve(directory) === DIRECTORY, 'canonical_register');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const d = lstatSync(directory);
  requireValue(
    d.isDirectory() && !d.isSymbolicLink() && d.uid === process.getuid() && (d.mode & 0o077) === 0,
    'register_permissions',
  );
  // A run is created exactly once; even a lost initial history cannot reset it.
  requireValue(
    !existsSync(resolve(directory, 'register.json')) && !existsSync(resolve(directory, 'register.next')),
    'existing_history',
  );
  const once = openSync(resolve(directory, 'initialized.once'), 'wx', 0o600);
  fsyncSync(once);
  closeSync(once);
  const lock = resolve(directory, 'operator.lock'),
    fd = openSync(lock, 'wx', 0o600);
  closeSync(fd);
  const state = {
    version: 1,
    source: binding.source,
    binding,
    target: TARGET,
    mode: synthetic ? 'SYNTHETIC_OFF_STORE' : 'LIVE_FROZEN_DIAGNOSTIC',
    counts: { auth: 0, identity: 0, declared: 0, rest: 0 },
    events: [],
    observations: {},
    outcome: 'IN_PROGRESS',
  };
  persist(directory, state);
  let bearer,
    expiry = 0,
    verified = false,
    pending = 0,
    unknown = false;
  async function request(kind, prepare) {
    requireValue(!unknown && pending === 0 && state.counts[kind] === 0, 'request_history');
    requireValue(
      kind === 'auth' || ((kind === 'identity' || verified) && bearer && Date.now() + 30_000 < expiry),
      'identity_or_token',
    );
    const started = Date.now(),
      deadline = started + deadlineMs,
      controller = new AbortController();
    let expired = false,
      sent = false,
      timer;
    const event = {
      kind,
      source: binding.source,
      startedAt: new Date(started).toISOString(),
      deadline: new Date(deadline).toISOString(),
      result: 'RESERVED',
    };
    state.counts[kind]++;
    state.events.push(event);
    persist(directory, state);
    pending++;
    const job = (async () => {
      const original = await prepare();
      const { url, init } = requestTransform(original);
      assertRequest(kind, url, init);
      requireValue(!expired && Date.now() < deadline, 'preparation_expired');
      sent = true;
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      const parsed = await boundedBody(response);
      requireValue(!expired && Date.now() < deadline, 'response_expired');
      return { response, parsed };
    })().finally(() => {
      pending--;
    });
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => {
            expired = true;
            controller.abort();
            reject(new Stop('request_deadline'));
          },
          Math.max(0, deadline - Date.now()),
        );
      });
      const { response, parsed } = await Promise.race([job, timeout]);
      const projection = project(kind, parsed.value, response.status, started, Date.now());
      projection.bodyState = parsed.bodyState;
      event.result = 'RESPONDED';
      event.httpStatus = response.status;
      event.observation = projection;
      event.safeProjectionDigest = digest(JSON.stringify(projection));
      state.observations[kind] = projection;
      persist(directory, state);
      if (response.status === 401 || projection.errors?.codes?.includes('UNAUTHENTICATED'))
        throw new Stop('token_invalid');
      if (kind === 'auth') {
        const b = parsed.value;
        requireValue(
          response.status === 200 &&
            parsed.bodyState === 'JSON' &&
            noControl(b?.access_token) &&
            b.access_token.length > 0 &&
            b.access_token.length <= 8192 &&
            Number.isInteger(b.expires_in) &&
            b.expires_in > 60 &&
            b.expires_in <= 86400,
          'unusable_authentication',
        );
        requireValue(!synthetic || b.access_token.startsWith('synthetic-'), 'synthetic_bearer');
        bearer = b.access_token;
        expiry = Date.now() + b.expires_in * 1000;
      } else if (kind === 'identity') {
        requireValue(response.status === 200 && parsed.bodyState === 'JSON' && projection.identityMatches, 'identity');
        verified = true;
      } else if (kind === 'declared') {
        const i = parsed.value?.data?.currentAppInstallation;
        const identities = [
          [i, 'id', TARGET.installation],
          [i?.app, 'id', TARGET.app],
          [i?.app, 'apiKey', TARGET.client],
        ];
        if (identities.some(([o, k, v]) => object(o) && Object.hasOwn(o, k) && o[k] !== null && o[k] !== v))
          throw new Stop('declared_identity');
      }
      return projection;
    } catch (e) {
      if (event.result === 'RESERVED') {
        event.result = sent ? 'UNKNOWN' : 'NOT_SENT';
        event.reason = e instanceof Stop ? e.kind : 'transport_or_preparation';
        unknown = sent;
        state.events[state.events.length - 1] = event;
        persist(directory, state);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  const graphql = (kind) =>
    request(kind, async () => ({
      url: routes[kind].url,
      init: {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-shopify-access-token': bearer },
        body: JSON.stringify({ query: routes[kind].query, variables: {} }),
      },
    }));
  try {
    requireValue(validated.identity, 'identity_document_unvalidated');
    await request('auth', async () => {
      const c = await credentials();
      requireValue(!synthetic || c.secret.startsWith('synthetic-'), 'synthetic_credential');
      return {
        url: routes.auth.url,
        init: {
          method: 'POST',
          redirect: 'error',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ client_id: TARGET.client, client_secret: c.secret, grant_type: 'client_credentials' }),
        },
      };
    });
    await graphql('identity');
    if (validated.declared) await graphql('declared');
    else state.observations.declared = { outcome: 'NOT_RUN', reason: 'offline_metadata_document_unvalidated' };
    await request('rest', async () => ({
      url: routes.rest.url,
      init: { method: 'GET', redirect: 'error', headers: { 'x-shopify-access-token': bearer } },
    }));
    state.outcome = 'OBSERVATIONS_COMPLETE';
  } catch (e) {
    state.outcome = 'STOPPED';
    state.stop = e instanceof Stop ? e.kind : 'transport_or_local_error';
  }
  function compare(a, b) {
    const reliable = (x) =>
      x?.httpStatus === 200 &&
      x.bodyState === 'JSON' &&
      x.identityMatches !== false &&
      !x.errors?.malformed &&
      !(x.errors?.count > 0) &&
      ['VALID', 'EMPTY'].includes(x.scopes?.state);
    return !reliable(a) || !reliable(b)
      ? 'UNKNOWN'
      : JSON.stringify(a.scopes.handles) === JSON.stringify(b.scopes.handles)
        ? 'SAME'
        : 'DIFFERENT';
  }
  state.comparison = {
    tokenVsInstallation: compare(state.observations.auth, state.observations.identity),
    restVsInstallation: compare(state.observations.rest, state.observations.identity),
  };
  state.remaining = ['auth', 'identity', 'declared', 'rest'].filter((kind) => !state.observations[kind]);
  state.pendingAtClose = pending;
  state.lockReleased = pending === 0;
  persist(directory, state);
  if (pending === 0) unlinkSync(lock);
  // Late work cannot persist or start a new request; its unknown allowance and
  // retained lock prohibit ordinary re-entry. Never export a bearer or auth body.
  return state;
}
export async function diagnose({ binding, gate }) {
  verifyGate(ROOT, gate, binding);
  return run({
    directory: DIRECTORY,
    binding,
    credentials: protectedCredentials,
    fetchImpl: globalThis.fetch,
    synthetic: false,
  });
}
export async function diagnoseSynthetic({
  directory,
  binding = { source: 'synthetic-source', modules: {} },
  credentials,
  fetchImpl,
  ...options
}) {
  requireValue(
    resolve(directory) !== DIRECTORY &&
      credentials !== protectedCredentials &&
      typeof credentials === 'function' &&
      typeof fetchImpl === 'function' &&
      fetchImpl !== globalThis.fetch,
    'synthetic_boundary',
  );
  return run({ ...options, directory, binding, credentials, fetchImpl, synthetic: true });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.argv.length === 2, 'no_flags');
    const folder = '/home/serveradmin/insignia-m5-005-handoff';
    const binding = JSON.parse(readFileSync(resolve(folder, 'frozen-binding.json'))),
      gate = JSON.parse(readFileSync(resolve(folder, 'gate.json')));
    const result = await diagnose({ binding, gate });
    process.stdout.write(
      `${JSON.stringify({
        outcome: result.outcome,
        stop: result.stop ?? null,
        counts: result.counts,
        pendingAtClose: result.pendingAtClose,
      })}\n`,
    );
  } catch (e) {
    process.stdout.write(
      `${JSON.stringify({ outcome: 'LOCAL_GATE_STOP', kind: e instanceof Stop ? e.kind : 'local_error' })}\n`,
    );
    process.exitCode = 1;
  }
}
