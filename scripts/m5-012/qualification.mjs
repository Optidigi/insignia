import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { protectedCredentials } from '../m5-004/qualification.mjs';
import { verifyGate } from './binding.mjs';
import { ARCHIVE, FIXTURE, PROJECTION, READS, TARGET } from './documents.mjs';
import { createOperator, LIVE_DIRECTORY, requireValue, Stop } from './operator.mjs';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export async function runSynthetic(options) {
  const directory = resolve(options.directory);
  requireValue(
    directory !== LIVE_DIRECTORY &&
      !['004', '009', '010', '011'].some((n) => directory === `/home/serveradmin/insignia-m5-${n}-handoff/run`) &&
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
  const evidence = {
    version: 1,
    binding,
    classification: 'INCONSISTENT',
    cleanup: { outcome: 'NOT_ATTEMPTED' },
    outcome: 'STOPPED',
  };
  let token,
    finalAttempted = false;
  const save = () =>
    writeFileSync(resolve(directory, 'qualification.json'), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  async function request(query, variables = {}) {
    requireValue(Date.now() + 30000 < token.expiresAt, 'credential_fence');
    const r = await op.fetch(`https://${TARGET.domain}/admin/api/2026-07/graphql.json`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-access-token': token.accessToken,
        'Shopify-Search-Query-Debug': '1',
      },
      body: JSON.stringify({ query, variables }),
    });
    return (await r.json()).data;
  }
  async function final() {
    finalAttempted = true;
    evidence.final = (await request(PROJECTION)).product;
  }
  try {
    assertCurrent();
    const c = credentialLoader();
    evidence.credentialMetadata = c.ownership;
    const r = await op.fetch(`https://${TARGET.domain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: TARGET.client, client_secret: c.secret, grant_type: 'client_credentials' }),
    });
    const raw = await r.json();
    if (synthetic) requireValue(raw.access_token?.startsWith('synthetic-'), 'synthetic_token');
    token = { accessToken: raw.access_token, expiresAt: Date.now() + raw.expires_in * 1000 };
    for (const [name, query] of Object.entries(READS)) {
      evidence[name] = await request(query);
      save();
    }
    evidence.intent = op.state().classification;
    evidence.classification = evidence.intent.classification;
    save();
    requireValue(evidence.classification !== 'INCONSISTENT', 'intent_inconsistent');
    if (evidence.projection.product.status === 'ARCHIVED') {
      await final();
      requireValue(evidence.final.status === 'ARCHIVED', 'final_state_drift');
      requireValue(
        JSON.stringify(evidence.final) === JSON.stringify(evidence.projection.product),
        'already_archived_drift',
      );
      evidence.cleanup = { outcome: 'ALREADY_ARCHIVED', status: 'ARCHIVED' };
      evidence.outcome = 'OBSERVED_ALREADY_ARCHIVED';
    } else {
      const d = await request(ARCHIVE, { product: { id: FIXTURE, status: 'ARCHIVED' } });
      evidence.acknowledged = d.productUpdate.product;
      save();
      await final();
      requireValue(evidence.final.status === 'ARCHIVED', 'final_state_drift');
      // Exact equality, no timestamp tolerance; this cleanup does not redefine v1 hold semantics.
      requireValue(
        JSON.stringify(evidence.final) === JSON.stringify(evidence.acknowledged),
        'archive_ack_readback_drift',
      );
      op.settleCleanup();
      evidence.cleanup = { outcome: 'EXACT_ARCHIVED', status: 'ARCHIVED' };
      evidence.outcome = 'INTENT_RESOLVED_AND_ARCHIVED';
    }
  } catch (e) {
    evidence.stop = e instanceof Stop ? e.kind : 'local_failure';
    evidence.outcome = 'STOPPED';
    const state = op.state(),
      archive = state.events.find((x) => x.operation === 'archive');
    if (archive?.invoked && state.pending !== null)
      evidence.cleanup = { outcome: 'UNKNOWN_WRITE_REQUEST_STILL_OUTSTANDING' };
    else if (archive?.invoked && !finalAttempted) {
      try {
        await final();
        evidence.cleanup = {
          outcome:
            evidence.final.status === 'ARCHIVED'
              ? 'AMBIGUOUS_WRITE_OBSERVED_ARCHIVED'
              : 'AMBIGUOUS_WRITE_OBSERVED_OTHER_STATE',
          status: evidence.final.status,
        };
      } catch {
        evidence.cleanup = { outcome: 'AMBIGUOUS_WRITE_OBSERVATION_FAILED' };
      }
    } else if (archive?.invoked)
      evidence.cleanup = {
        outcome:
          evidence.final?.status === 'ARCHIVED' ? 'ACK_READBACK_CONFLICT_OBSERVED_ARCHIVED' : 'CLEANUP_NOT_EXACT',
        status: evidence.final?.status ?? null,
      };
  }
  token = null;
  const state = op.state();
  evidence.accounting = state.counts;
  evidence.pendingAtClose = state.pending;
  evidence.settlements = state.events
    .filter((e) => e.kind === 'update')
    .map((e) => ({ operation: e.operation, invoked: e.invoked, settlement: e.settlement }));
  op.finish({
    outcome: evidence.outcome,
    stop: evidence.stop ?? null,
    classification: evidence.classification,
    cleanup: evidence.cleanup,
  });
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
      `${JSON.stringify({ outcome: e.outcome, stop: e.stop ?? null, classification: e.classification, cleanup: e.cleanup, counts: e.accounting })}\n`,
    );
  } catch (e) {
    process.stdout.write(
      `${JSON.stringify({ outcome: 'LOCAL_GATE_STOP', kind: e instanceof Stop ? e.kind : 'local_failure' })}\n`,
    );
    process.exitCode = 1;
  }
}
