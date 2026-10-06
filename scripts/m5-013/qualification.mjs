import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { protectedCredentials } from '../m5-004/qualification.mjs';
import { verifyGate } from './binding.mjs';
import { ARCHIVE, FINAL, FIXTURE, PRESTATE, TARGET } from './documents.mjs';
import { createOperator, LIVE_DIRECTORY, requireValue, Stop } from './operator.mjs';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export async function runSynthetic(options) {
  const directory = resolve(options.directory);
  requireValue(
    directory !== LIVE_DIRECTORY &&
      !['004', '009', '010', '011', '012'].some(
        (n) => directory === `/home/serveradmin/insignia-m5-${n}-handoff/run`,
      ) &&
      typeof options.fetchImpl === 'function' &&
      options.fetchImpl !== globalThis.fetch &&
      typeof options.credentialLoader === 'function' &&
      options.credentialLoader !== protectedCredentials,
    'synthetic_boundaries',
  );
  return run({
    ...options,
    synthetic: true,
    binding: { synthetic: true },
    assertCurrent: () => {},
    credentialLoader: () => {
      const c = options.credentialLoader();
      requireValue(c.secret?.startsWith('synthetic-'), 'synthetic_credential');
      return c;
    },
  });
}
export async function qualify({ root = ROOT, directory = LIVE_DIRECTORY, binding, gate }) {
  requireValue(root === ROOT && resolve(directory) === LIVE_DIRECTORY, 'live_root');
  verifyGate(ROOT, binding, gate);
  return run({
    directory,
    binding,
    fetchImpl: globalThis.fetch,
    credentialLoader: protectedCredentials,
    assertCurrent: () => verifyGate(ROOT, binding, gate),
  });
}
async function run({ directory, binding, fetchImpl, credentialLoader, assertCurrent, synthetic = false }) {
  const op = createOperator({ directory, binding, fetchImpl, assertCurrent });
  const evidence = { version: 1, binding, outcome: 'STOPPED', cleanup: { outcome: 'NOT_ATTEMPTED' } };
  let token,
    finalAttempted = false;
  const save = () =>
    writeFileSync(resolve(directory, 'qualification.json'), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  async function request(query, variables = {}) {
    requireValue(Date.now() + 30000 < token.expiresAt, 'credential_fence');
    const response = await op.fetch(`https://${TARGET.domain}/admin/api/2026-07/graphql.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': token.accessToken },
      body: JSON.stringify({ query, variables }),
    });
    return (await response.json()).data;
  }
  async function final() {
    finalAttempted = true;
    evidence.final = (await request(FINAL)).product;
    evidence.finalIdentity = op.state().observations.final;
    requireValue(evidence.final.status === 'ARCHIVED', 'final_state');
  }
  function settled() {
    const archive = op.state().events.find((e) => e.operation === 'archive');
    if (archive) op.settleCleanup();
    evidence.cleanup = {
      outcome: archive ? 'FINAL_ARCHIVED_UNPUBLISHED' : 'ALREADY_ARCHIVED_VERIFIED',
      status: 'ARCHIVED',
      effective: false,
      acknowledgement: !archive ? 'NOT_APPLICABLE' : archive.response ? 'ACKNOWLEDGED' : 'NOT_ACKNOWLEDGED',
    };
    if (evidence.acknowledged)
      evidence.timestamps = {
        acknowledgedUpdatedAt: evidence.acknowledged.updatedAt,
        finalUpdatedAt: evidence.final.updatedAt,
        equal: evidence.acknowledged.updatedAt === evidence.final.updatedAt,
        deltaMilliseconds: Date.parse(evidence.final.updatedAt) - Date.parse(evidence.acknowledged.updatedAt),
      };
    evidence.outcome = 'SETTLED';
  }
  try {
    assertCurrent();
    const c = credentialLoader();
    evidence.credentialMetadata = c.ownership;
    const response = await op.fetch(`https://${TARGET.domain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: TARGET.client, client_secret: c.secret, grant_type: 'client_credentials' }),
    });
    const raw = await response.json();
    if (synthetic) requireValue(raw.access_token?.startsWith('synthetic-'), 'synthetic_token');
    token = { accessToken: raw.access_token, expiresAt: Date.now() + raw.expires_in * 1000 };
    evidence.prestate = await request(PRESTATE);
    save();
    if (evidence.prestate.product.status === 'DRAFT') {
      const acknowledged = await request(ARCHIVE, { product: { id: FIXTURE, status: 'ARCHIVED' } });
      evidence.acknowledged = acknowledged.productUpdate.product;
      save();
    }
    await final();
    settled();
  } catch (e) {
    evidence.stop = e instanceof Stop ? e.kind : 'local_failure';
    const archive = op.state().events.find((x) => x.operation === 'archive');
    if (archive?.invoked && op.state().pending !== null)
      evidence.cleanup = { outcome: 'UNKNOWN_WRITE_REQUEST_STILL_OUTSTANDING' };
    else if (archive?.invoked && !finalAttempted) {
      try {
        await final();
        settled();
      } catch (error) {
        evidence.finalStop = error instanceof Stop ? error.kind : 'local_failure';
        evidence.cleanup = { outcome: 'UNSETTLED_FINAL_READ' };
      }
    } else if (archive?.invoked) evidence.cleanup = { outcome: 'UNSETTLED_FINAL_READ' };
  }
  token = null;
  const state = op.state();
  evidence.accounting = state.counts;
  evidence.pendingAtClose = state.pending;
  evidence.settlements = state.events
    .filter((e) => e.kind === 'update')
    .map((e) => ({
      operation: e.operation,
      invoked: e.invoked,
      settlement: e.settlement,
      acknowledgementSettlement: e.acknowledgementSettlement ?? null,
    }));
  op.finish({ outcome: evidence.outcome, stop: evidence.stop ?? null, cleanup: evidence.cleanup });
  save();
  return evidence;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.argv.length === 2, 'no_arguments');
    const binding = JSON.parse(readFileSync(resolve(LIVE_DIRECTORY, 'binding.json'))),
      gate = JSON.parse(readFileSync(resolve(LIVE_DIRECTORY, 'gate.json')));
    const e = await qualify({ binding, gate });
    process.stdout.write(
      `${JSON.stringify({ outcome: e.outcome, stop: e.stop ?? null, cleanup: e.cleanup, counts: e.accounting })}\n`,
    );
  } catch (e) {
    process.stdout.write(
      `${JSON.stringify({ outcome: 'LOCAL_GATE_STOP', kind: e instanceof Stop ? e.kind : 'local_failure' })}\n`,
    );
    process.exitCode = 1;
  }
}
