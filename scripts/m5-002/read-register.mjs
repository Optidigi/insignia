import { closeSync, fsyncSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Operator-only diagnostic transport. Locks and reservations precede every attempt, including SDK retries. */
export function createPreviewOperator({ directory, fetchImpl = globalThis.fetch }) {
  const register = resolve(directory, 'external-register.json');
  const lock = openSync(resolve(directory, 'operator.lock'), 'wx', 0o600);
  closeSync(lock);
  const state = JSON.parse(readFileSync(register, 'utf8'));
  if (
    state.appId !== '429028933633' ||
    state.clientId !== '1443cf6d03d39edae7c101a943c5c684' ||
    state.shop !== 'insignia-rewrite-dev.myshopify.com'
  )
    throw new Error('Operator register target mismatch');
  for (const [kind, limit] of Object.entries({ adminRead: 30, adminAuth: 4, partnerRead: 4 })) {
    if (
      state.limits[kind] !== limit ||
      !Number.isInteger(state.counts[kind]) ||
      state.counts[kind] < 0 ||
      state.counts[kind] > limit ||
      !Array.isArray(state.events) ||
      state.events.filter((event) => event.kind === kind).length !== state.counts[kind]
    )
      throw new Error('Operator history ambiguous');
  }
  function reserve(kind) {
    if (!Object.hasOwn(state.counts, kind) || state.counts[kind] >= state.limits[kind])
      throw new Error('M5-002 external ceiling reached');
    state.counts[kind]++;
    state.events.push({ kind, at: new Date().toISOString() });
    const descriptor = openSync(register, 'w', 0o600);
    try {
      writeFileSync(descriptor, JSON.stringify(state, null, 2) + '\n');
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }
  async function guardedFetch(input, init) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (
      url.origin !== `https://${state.shop}` ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      init?.method !== 'POST'
    )
      throw new Error('Diagnostic external target denied');
    const body = JSON.parse(String(init.body ?? ''));
    if (url.pathname === '/admin/oauth/access_token') {
      if (
        body.client_id !== state.clientId ||
        body.grant_type !== 'urn:ietf:params:oauth:grant-type:token-exchange' ||
        body.requested_token_type !== 'urn:shopify:params:oauth:token-type:online-access-token'
      )
        throw new Error('Diagnostic auth operation denied');
      reserve('adminAuth');
    } else if (url.pathname === '/admin/api/2026-07/graphql.json') {
      if (typeof body.query !== 'string' || !/^\s*query\b/.test(body.query) || /\bmutation\b/.test(body.query))
        throw new Error('Diagnostic mutation denied');
      reserve('adminRead');
    } else throw new Error('Diagnostic external operation denied');
    return fetchImpl(input, { ...init, redirect: 'error' });
  }
  let serial = Promise.resolve();
  return {
    state,
    reserve,
    fetch(input, init) {
      const result = serial.then(() => guardedFetch(input, init));
      serial = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
