import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AVAILABILITY_ADMIN_API_VERSION } from '../../packages/shopify/dist/index.js';
import { atomic, digest, requireValue, Stop, saveJSON } from '../m5-015r/operator.mjs';
import { bytes } from './body.mjs';
import { ARCHIVE, CATALOGS, DIRECT, FINAL, FIXTURE, PRESTATE, PUBLICATIONS, TARGET } from './documents.mjs';
import { identity, owned, selected, selectedIdentity, visible } from './projections.mjs';

export { atomic, digest, requireValue, Stop, saveJSON };
export const LIVE_DIRECTORY = '/home/serveradmin/insignia-m5-016-handoff/run';
export const LIMITS = Object.freeze({ auth: 1, graphql: 16, directUpdate: 1, create: 0, adapterMutation: 0 });
const keys = (v, n) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...n].sort());
export function createOperator({ directory, binding, fetchImpl, assertCurrent, monotonicNow }) {
  requireValue(typeof fetchImpl === 'function', 'transport_required');
  requireValue(typeof monotonicNow === 'function', 'monotonic_clock');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  requireValue(
    info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() && (info.mode & 0o077) === 0,
    'register_permissions',
  );
  try {
    atomic(directory, 'initialized.once', '', true);
  } catch {
    throw new Stop('reentry');
  }
  const state = {
    version: 1,
    profile: 'm5-016-phase-a',
    binding,
    initialPid: process.pid,
    createdAt: new Date().toISOString(),
    phase: 'INITIALIZED',
    closed: false,
    counts: { auth: 0, graphql: 0, directUpdate: 0, create: 0, adapterMutation: 0 },
    transport: { invocations: 0, denials: 0, mismatch: false },
    events: [],
    pending: null,
    identity: null,
    fixture: null,
    ownedAt: null,
    ownedMonotonicAt: null,
    identityFailed: false,
    prestateVerified: false,
    adjudicated: false,
  };
  let busy = false,
    token = null,
    mode = 'auth';
  const save = () => saveJSON(directory, 'register.json', state);
  save();
  const current = () => {
    assertCurrent();
    requireValue(
      !state.closed && !state.transport.mismatch && state.transport.denials === 0 && !state.identityFailed,
      'closed_or_poisoned',
    );
  };
  const known = () =>
    state.pending === null &&
    !state.transport.mismatch &&
    !state.identityFailed &&
    state.events.filter((e) => e.mutation).every((e) => e.settlement === 'ACKNOWLEDGED');
  const freshOwnedPrestate = () => {
    const elapsed = monotonicNow();
    return (
      state.adjudicated &&
      state.prestateVerified &&
      state.fixture?.status === 'ACTIVE' &&
      state.identity &&
      state.ownedAt &&
      Number.isFinite(elapsed) &&
      Number.isFinite(state.identity.monotonicAt) &&
      Number.isFinite(state.ownedMonotonicAt) &&
      elapsed >= state.identity.monotonicAt &&
      elapsed - state.identity.monotonicAt < 30000 &&
      elapsed >= state.ownedMonotonicAt &&
      elapsed - state.ownedMonotonicAt < 30000 &&
      Date.now() >= state.identity.at &&
      Date.now() - state.identity.at < 30000 &&
      Date.now() >= state.ownedAt &&
      Date.now() - state.ownedAt < 30000
    );
  };
  function safeToArchive() {
    current();
    requireValue(freshOwnedPrestate() && known() && state.counts.directUpdate === 0, 'cleanup_authority');
  }
  function assertArchiveDispatch(index) {
    current();
    const event = state.events[index];
    requireValue(
      freshOwnedPrestate() &&
        state.pending === index &&
        event?.operation === 'archive' &&
        event.settlement === 'UNKNOWN' &&
        state.counts.directUpdate === 1 &&
        state.events.filter((e) => e.mutation && e.index !== index).every((e) => e.settlement === 'ACKNOWLEDGED'),
      'cleanup_authority',
    );
  }
  function rejectDispatch(index, kind) {
    const event = state.events[index];
    requireValue(event?.invoked && state.pending === index && !event.nativeDenied, 'transport_accounting_mismatch');
    event.nativeDenied = true;
    event.failure = kind;
    event.settlement = event.mutation ? 'NOT_DISPATCHED' : 'FAILED';
    state.transport.denials++;
    save();
  }
  function classify(url, init, body) {
    current();
    requireValue(
      !busy && state.pending === null && init?.method === 'POST' && typeof init.body === 'string',
      'closed_or_parallel',
    );
    if (url === `https://${TARGET.domain}/admin/oauth/access_token`) {
      requireValue(
        mode === 'auth' &&
          token === null &&
          keys(body, ['client_id', 'client_secret', 'grant_type']) &&
          body.client_id === TARGET.client &&
          body.grant_type === 'client_credentials' &&
          typeof body.client_secret === 'string' &&
          body.client_secret.length > 0,
        'auth_request',
      );
      return { kind: 'auth', operation: 'auth', mutation: false };
    }
    requireValue(
      url === `https://${TARGET.domain}/admin/api/${AVAILABILITY_ADMIN_API_VERSION}/graphql.json` &&
        token &&
        Date.now() + 30000 < token.expiresAt &&
        init.headers?.['x-shopify-access-token'] === token.accessToken &&
        keys(body, ['query', 'variables']),
      'endpoint_or_credential',
    );
    const queries = {
      prestate: PRESTATE,
      direct: DIRECT,
      publications: PUBLICATIONS,
      catalogs: CATALOGS,
      final: FINAL,
    };
    if (Object.hasOwn(queries, mode) && body.query === queries[mode]) {
      if (mode === 'publications' || mode === 'catalogs')
        requireValue(
          keys(body.variables, ['after']) &&
            (body.variables.after === null ||
              (typeof body.variables.after === 'string' &&
                body.variables.after.length > 0 &&
                body.variables.after.length <= 2048)),
          'cursor',
        );
      else requireValue(keys(body.variables, []) && !state.events.some((e) => e.operation === mode), 'read_reentry');
      requireValue(mode === 'prestate' || state.prestateVerified, 'prestate_required');
      return { kind: 'graphql', operation: mode, mutation: false };
    }
    if (mode === 'archive' && body.query === ARCHIVE) {
      safeToArchive();
      requireValue(
        keys(body.variables, ['product']) &&
          keys(body.variables.product, ['id', 'status']) &&
          body.variables.product.id === FIXTURE &&
          body.variables.product.status === 'ARCHIVED',
        'status_target',
      );
      return { kind: 'directUpdate', operation: 'archive', mutation: true };
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
    const observationOrigin = Date.now(),
      observationMonotonicOrigin = monotonicNow();
    requireValue(Number.isFinite(observationMonotonicOrigin), 'monotonic_clock');
    state.counts[r.kind]++;
    if (r.kind === 'directUpdate') state.counts.graphql++;
    const event = {
      index: state.events.length,
      ...r,
      request: r.kind === 'auth' ? { client_id: TARGET.client, grant_type: 'client_credentials' } : body,
      startedAt: new Date().toISOString(),
      observationOrigin,
      observationMonotonicOrigin,
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
      current();
      requireValue(!signal.aborted, 'transport_timeout');
      const aborted = new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Stop('transport_timeout')), { once: true }),
      );
      const work = (async () => {
        underlyingSettled = false;
        event.invoked = true;
        event.transportOrdinal = ++state.transport.invocations;
        event.transportPid = process.pid;
        save();
        try {
          const response = await fetchImpl(url, { ...init, redirect: 'error', signal });
          event.status = response.status;
          const raw = JSON.parse((await bytes(response, signal)).toString('utf8'));
          return raw;
        } catch (error) {
          if (error instanceof Stop && error.kind === 'body_disposal_unsettled') event.disposalUnsettled = true;
          throw error;
        } finally {
          underlyingSettled = event.disposalUnsettled !== true;
        }
      })();
      const raw = await Promise.race([aborted, work]);
      requireValue(raw && typeof raw === 'object' && !Array.isArray(raw), 'provider_shape');
      let returned;
      if (r.kind === 'auth') {
        requireValue(event.status === 200, 'provider_status');
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
        const hasErrors = Object.hasOwn(raw, 'errors');
        let d;
        if (hasErrors)
          event.response = {
            errors: Array.isArray(raw.errors)
              ? raw.errors.map((e) => ({
                  message: '<provider error>',
                  code:
                    typeof e?.extensions?.code === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(e.extensions.code)
                      ? e.extensions.code
                      : null,
                }))
              : [],
          };
        try {
          requireValue(
            raw.data === undefined || raw.data === null || (typeof raw.data === 'object' && !Array.isArray(raw.data)),
            'provider_shape',
          );
          // Reported identity is independent evidence, even in an error envelope.
          // A pure denial without data carries no affirmative identity observation.
          if (raw?.data && typeof raw.data === 'object') {
            if (!r.mutation) {
              event.identity = selectedIdentity(raw.data);
              if (
                (!hasErrors && event.status === 200) ||
                raw.data.shop !== undefined ||
                raw.data.currentAppInstallation !== undefined
              )
                identity(raw.data);
            }
            d = selected(raw.data, r.operation);
            event.response = { ...event.response, data: d };
          }
        } catch (error) {
          if (error.kind === 'identity' || error.kind === 'grants') state.identityFailed = true;
          throw error;
        }
        const errorsValid =
          !hasErrors ||
          (Array.isArray(raw.errors) &&
            raw.errors.length > 0 &&
            raw.errors.every(
              (e) =>
                e !== null &&
                typeof e === 'object' &&
                !Array.isArray(e) &&
                typeof e.message === 'string' &&
                e.message.length > 0 &&
                (e.extensions === undefined ||
                  (e.extensions !== null && typeof e.extensions === 'object' && !Array.isArray(e.extensions))),
            ));
        requireValue(errorsValid, 'provider_error_shape');
        event.denied =
          event.status === 403 &&
          Array.isArray(raw.errors) &&
          raw.errors.length > 0 &&
          raw.errors.every((e) => typeof e?.message === 'string' && e?.extensions?.code === 'ACCESS_DENIED');
        requireValue(event.status === 200, 'provider_status');
        if (hasErrors) throw new Stop('provider_error');
        requireValue(d, 'provider_shape');
        if (!r.mutation)
          state.identity = {
            at: observationOrigin,
            monotonicAt: observationMonotonicOrigin,
            grants: d.currentAppInstallation.accessScopes.map((n) => n.handle).sort(),
          };
        if (r.operation === 'prestate') {
          state.fixture = visible(d.product, true);
          state.prestateVerified = true;
          state.ownedAt = observationOrigin;
          state.ownedMonotonicAt = observationMonotonicOrigin;
        }
        if (r.operation === 'final') state.fixture = owned(d.product);
        if (r.mutation) {
          requireValue(
            Array.isArray(d.productUpdate?.userErrors) && d.productUpdate.userErrors.length === 0,
            'mutation_error',
          );
          const p = owned(d.productUpdate.product);
          requireValue(p.status === 'ARCHIVED', 'mutation_state');
          state.fixture = p;
        }
        event.response = { data: d };
        returned = { data: d };
      }
      event.settlement = r.mutation ? 'ACKNOWLEDGED' : 'SETTLED';
      event.completedAt = new Date().toISOString();
      save();
      return Response.json(returned);
    } catch (error) {
      event.failure = error instanceof Stop ? error.kind : 'transport_or_shape';
      if (!event.invoked && r.mutation) event.settlement = 'NOT_DISPATCHED';
      if (!r.mutation) event.settlement = underlyingSettled ? 'FAILED' : 'UNKNOWN_READ';
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
    directory,
    state: () => structuredClone(state),
    safeToArchive,
    assertArchiveDispatch,
    rejectDispatch,
    setToken(value) {
      requireValue(token === null, 'token_replacement');
      token = value;
    },
    mode(value) {
      current();
      requireValue(
        ['auth', 'prestate', 'direct', 'publications', 'catalogs', 'archive', 'final'].includes(value),
        'mode',
      );
      mode = value;
      state.phase = value.toUpperCase();
      save();
    },
    patch(fn) {
      fn(state);
      save();
    },
    close(evidence) {
      requireValue(!busy, 'busy_close');
      state.closed = true;
      state.phase = 'CLOSED';
      state.evidence = evidence;
      save();
      saveJSON(directory, 'qualification.json', evidence);
      for (const name of ['initialized.once', 'register.json', 'qualification.json', 'binding.json', 'gate.json']) {
        const file = resolve(directory, name);
        try {
          chmodSync(file, 0o400);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    },
  };
}
