import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { protectedCredentials } from '../m5-004/qualification.mjs';
import { EVIDENCE_ROOT, verifyGate } from './binding.mjs';
import { classify, enumerate } from './discovery.mjs';
import { ARCHIVE, CATALOGS, DIRECT, FINAL, FIXTURE, PRESTATE, PUBLICATIONS, TARGET } from './documents.mjs';
import { assertGuard, createGuardedOperator } from './guard.mjs';
import { LIVE_DIRECTORY, requireValue, saveJSON } from './operator.mjs';
import { directIncluded, visible } from './projections.mjs';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export async function qualify() {
  assertGuard();
  const binding = JSON.parse(readFileSync(resolve(EVIDENCE_ROOT, 'binding.json'))),
    gate = JSON.parse(readFileSync(resolve(EVIDENCE_ROOT, 'gate.json')));
  const assertCurrent = () => {
    assertGuard();
    verifyGate(ROOT, binding, gate);
  };
  assertCurrent();
  return run({ directory: LIVE_DIRECTORY, binding, gate, assertCurrent, credentialLoader: protectedCredentials });
}
export async function runSynthetic(options) {
  const directory = resolve(options.directory);
  requireValue(
    dirname(directory) === tmpdir() &&
      /^insignia-m5-016-[A-Za-z0-9_-]+$/.test(directory.split('/').at(-1)) &&
      typeof options.fetchImpl === 'function' &&
      options.fetchImpl !== globalThis.fetch &&
      typeof options.credentialLoader === 'function' &&
      options.credentialLoader !== protectedCredentials,
    'synthetic_boundaries',
  );
  return run({
    ...options,
    directory,
    binding: { synthetic: true },
    synthetic: true,
    assertCurrent: options.assertCurrent ?? (() => {}),
    credentialLoader: () => {
      const c = options.credentialLoader();
      requireValue(c.secret?.startsWith('synthetic-'), 'synthetic_credential');
      return c;
    },
  });
}
async function run({
  directory,
  binding,
  gate,
  assertCurrent,
  credentialLoader,
  fetchImpl,
  monotonicNow,
  synthetic = false,
}) {
  assertGuard();
  assertCurrent();
  const op = createGuardedOperator({ directory, binding, fetchImpl, monotonicNow, synthetic, assertCurrent });
  if (!synthetic) {
    saveJSON(directory, 'binding.json', binding, true);
    saveJSON(directory, 'gate.json', gate, true);
  }
  const e = {
    profile: 'm5-016-phase-a',
    outcome: 'STOPPED',
    classification: 'UNRESOLVED',
    fixture: FIXTURE,
    cleanup: { outcome: 'NOT_DISPATCHED' },
    direct: { confirmed: false },
    publications: { complete: false, nodes: [], failure: 'NOT_RUN' },
    catalogs: { complete: false, nodes: [], failure: 'NOT_RUN' },
  };
  let token;
  const failure = (error) => error.code ?? error.kind ?? 'local_failure';
  async function request(query, variables = {}) {
    const response = await op.fetch(`https://${TARGET.domain}/admin/api/2026-07/graphql.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': token.accessToken },
      body: JSON.stringify({ query, variables }),
    });
    return (await response.json()).data;
  }
  try {
    assertGuard();
    assertCurrent();
    const c = credentialLoader();
    e.credentialOwnership = c.ownership ?? { synthetic: true };
    const auth = await (
      await op.fetch(`https://${TARGET.domain}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: TARGET.client, client_secret: c.secret, grant_type: 'client_credentials' }),
      })
    ).json();
    token = { accessToken: auth.access_token, expiresAt: Date.now() + auth.expires_in * 1000 };
    op.setToken(token);
    op.mode('prestate');
    e.prestate = await request(PRESTATE);
    visible(e.prestate.product, true);
    op.mode('direct');
    try {
      const d = await request(DIRECT);
      e.direct = { publication: d.publication, confirmed: directIncluded(d.publication) };
    } catch (error) {
      e.direct.failure = failure(error);
    }
    e.publications = await enumerate(op, request, PUBLICATIONS, 'publications', 3);
    e.catalogs = await enumerate(op, request, CATALOGS, 'catalogs', 2);
    Object.assign(e, classify(e.direct, e.publications, e.catalogs));
    if (op.state().identityFailed || op.state().pending !== null || !op.transportAudit().matches)
      Object.assign(e, { classification: 'UNRESOLVED', provenSurface: null, ambiguity: true });
    op.patch((s) => {
      s.adjudicated = true;
    });
    // Diagnostic coverage failure does not grant production correction, nor revoke
    // the independent fixed disposable-fixture cleanup when ownership remains exact.
    op.safeToArchive();
    op.mode('archive');
    let ack;
    try {
      ack = (await request(ARCHIVE, { product: { id: FIXTURE, status: 'ARCHIVED' } })).productUpdate.product;
      e.cleanup.outcome = 'ARCHIVE_ACKNOWLEDGED';
    } catch (error) {
      const s = op.state();
      if (s.events.at(-1)?.settlement === 'NOT_DISPATCHED') {
        e.cleanup = { outcome: 'NOT_DISPATCHED', failure: failure(error) };
        throw error;
      }
      e.cleanup = { outcome: 'UNKNOWN_ARCHIVE_WRITE', failure: failure(error) };
      requireValue(
        s.pending === null &&
          op.transportAudit().matches &&
          s.events.some((n) => n.operation === 'archive' && n.invoked),
        'classification_read_unsafe',
      );
    }
    op.mode('final');
    e.final = await request(FINAL);
    visible(e.final.product, false);
    if (ack) {
      e.cleanup = {
        outcome: 'FINAL_ARCHIVED_UNPUBLISHED',
        acknowledgedUpdatedAt: ack.updatedAt,
        readbackUpdatedAt: e.final.product.updatedAt,
        deltaMilliseconds: Date.parse(e.final.product.updatedAt) - Date.parse(ack.updatedAt),
      };
      e.outcome = 'PHASE_A_SETTLED';
    } else e.cleanup.finalExactArchived = true;
  } catch (error) {
    e.stop = failure(error);
  }
  const state = op.state();
  e.accounting = state.counts;
  e.transportAccounting = op.transportAudit();
  e.pending = state.pending;
  e.unknownMutations = state.events.filter((n) => n.mutation && n.settlement === 'UNKNOWN').length;
  e.fixtureLastVerified = state.fixture;
  e.authorityForFurtherProviderAccess = false;
  if (state.identityFailed || !e.transportAccounting.matches || e.pending !== null)
    Object.assign(e, { classification: 'UNRESOLVED', provenSurface: null, ambiguity: true });
  if (!e.transportAccounting.matches || e.pending !== null || e.unknownMutations > 0) e.outcome = 'STOPPED';
  op.close(e);
  return e;
}
