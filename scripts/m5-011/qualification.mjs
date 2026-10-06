import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createShopifyAvailabilityHoldPort } from '../../packages/shopify/dist/index.js';
import { protectedCredentials } from '../m5-004/qualification.mjs';
import { verifyGate } from './binding.mjs';
import {
  ARCHIVE,
  FIXTURE,
  IDENTITY,
  PARTITIONS,
  PROJECTION,
  PUBLICATION,
  PUBLICATION_ID,
  TARGET,
  V2_DOCUMENTS,
} from './documents.mjs';
import {
  createOperator,
  digest,
  LIVE_DIRECTORY,
  membershipDigest,
  requireValue,
  Stop,
  visibility,
} from './operator.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scope = Object.freeze({
  shopId: 'm5_011_fixture_only',
  installationGeneration: '1',
  shopifyShopId: TARGET.shop,
  appClientId: TARGET.client,
});
export function classify(before, after) {
  const active = PARTITIONS.flatMap((t) =>
    before[t].nodes.filter((n) => n.publication.id === PUBLICATION_ID).map((n) => ({ partition: t, ...n })),
  );
  const draft = PARTITIONS.flatMap((t) =>
    after[t].nodes.filter((n) => n.publication.id === PUBLICATION_ID).map((n) => ({ partition: t, ...n })),
  );
  const legacyDisappeared =
    before.resourcePublications.nodes.some((n) => n.publication.id === PUBLICATION_ID && n.isPublished) &&
    !after.resourcePublications.nodes.some((n) => n.publication.id === PUBLICATION_ID);
  const retained = active.length > 0 && draft.length > 0;
  return {
    classification: retained && legacyDisappeared ? 'SNAPSHOT_FIELD_DEFECT_SUPPORTED' : 'DIFFERENT_PLATFORM_BEHAVIOR',
    legacyDisappeared,
    v2Retained: retained,
    v2NewlyAppeared: active.length === 0 && draft.length > 0,
    v2Staged: draft.some((n) => n.isPublished === false),
    active,
    draft,
  };
}
export async function runSynthetic(options) {
  requireValue(
    resolve(options.directory) !== LIVE_DIRECTORY &&
      typeof options.fetchImpl === 'function' &&
      options.fetchImpl !== globalThis.fetch &&
      typeof options.credentialLoader === 'function' &&
      options.credentialLoader !== protectedCredentials,
    'synthetic_boundaries',
  );
  for (const profile of ['m5-004', 'm5-009', 'm5-010'])
    requireValue(resolve(options.directory) !== `/home/serveradmin/insignia-${profile}-handoff/run`, 'closed_register');
  return run({
    ...options,
    binding: { synthetic: true },
    synthetic: true,
    assertCurrent: () => {},
    credentialLoader: () => {
      const value = options.credentialLoader();
      requireValue(value.secret?.startsWith('synthetic-'), 'synthetic_credential');
      return value;
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
  const evidence = { version: 1, binding, classification: 'INCONCLUSIVE', adapter: null, cleanup: null };
  let token,
    cleanupReadAttempted = false;
  const save = () =>
    writeFileSync(resolve(directory, 'qualification.json'), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  async function request(query, variables = {}) {
    const response = await op.fetch(`https://${TARGET.domain}/admin/api/2026-07/graphql.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': token.accessToken },
      body: JSON.stringify({ query, variables }),
    });
    requireValue(response.status === 200, 'provider_http_error');
    const raw = await response.json();
    requireValue(response.status === 200 && raw.data && !raw.errors, 'provider_error');
    return raw.data;
  }
  async function projection() {
    await request(PROJECTION, { id: FIXTURE });
    for (const type of PARTITIONS) await request(V2_DOCUMENTS[type], { id: FIXTURE });
    return op.projection();
  }
  try {
    assertCurrent();
    const credentials = credentialLoader();
    evidence.credentialMetadata = credentials.ownership;
    const auth = await op.fetch(`https://${TARGET.domain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: TARGET.client,
        client_secret: credentials.secret,
        grant_type: 'client_credentials',
      }),
    });
    const raw = await auth.json();
    if (synthetic) requireValue(raw.access_token?.startsWith('synthetic-'), 'synthetic_token');
    requireValue(
      auth.status === 200 &&
        typeof raw.access_token === 'string' &&
        raw.access_token.length > 0 &&
        raw.access_token.length <= 8192 &&
        [...raw.access_token].every((c) => c.charCodeAt(0) > 32 && c.charCodeAt(0) !== 127) &&
        Number.isSafeInteger(raw.expires_in) &&
        raw.expires_in > 60,
      'auth_response',
    );
    token = { accessToken: raw.access_token, expiresAt: Date.now() + raw.expires_in * 1000 };
    evidence.identity = await request(IDENTITY);
    op.phase('PRESTATE');
    evidence.before = await projection();
    requireValue(
      evidence.before.status === 'ACTIVE' &&
        evidence.before.resourcePublications.nodes.some(
          (n) => n.publication.id === PUBLICATION_ID && n.isPublished === true,
        ),
      'prestate_drift',
    );
    evidence.publication = (await request(PUBLICATION, { id: PUBLICATION_ID })).publication;
    const port = createShopifyAvailabilityHoldPort({
      fetchImpl: op.fetch,
      credentials: {
        acquire: async (input) => {
          assertCurrent();
          requireValue(
            input.shopId === scope.shopId &&
              input.installationGeneration === scope.installationGeneration &&
              Date.now() + 30000 < token.expiresAt,
            'credential_fence',
          );
          return {
            kind: 'usable',
            shopDomain: TARGET.domain,
            accessToken: token.accessToken,
            accessExpiresAt: new Date(token.expiresAt),
          };
        },
      },
      isCurrent: async (input) => {
        assertCurrent();
        return JSON.stringify(input) === JSON.stringify(scope);
      },
    });
    op.phase('SNAPSHOT');
    const snapshot = await port.snapshot(scope, FIXTURE);
    requireValue(
      snapshot.state === 'available' &&
        snapshot.providerVersion === new Date(evidence.before.updatedAt).toISOString() &&
        snapshot.visibilityDigest === digest(visibility(evidence.before)),
      'snapshot_drift',
    );
    const hold = {
      version: 'm5-availability-hold-v1',
      operationId: 'insignia_m5_011_fixed_adjudication',
      before: snapshot,
      held: null,
    };
    op.hold(hold);
    evidence.hold = hold;
    save();
    op.phase('ACQUIRE');
    try {
      evidence.adapter = await port.acquire(scope, hold);
    } catch (error) {
      evidence.adapter = { kind: 'FAILURE', failureKind: error.kind ?? 'local_failure' };
      throw error;
    }
    save();
    const draftEvent = op.state().events.find((e) => e.operation === 'draft');
    requireValue(draftEvent?.settlement === 'ACKNOWLEDGED', 'draft_settlement_unknown');
    op.phase('POST_DRAFT');
    evidence.after = await projection();
    requireValue(evidence.after.status === 'DRAFT', 'post_state_drift');
    op.settle('draft', evidence.after);
    const current = evidence.adapter.current;
    requireValue(
      current?.state === 'unavailable' &&
        current.providerVersion === new Date(evidence.after.updatedAt).toISOString() &&
        current.visibilityDigest === digest(visibility(evidence.after)),
      'adapter_readback_drift',
    );
    evidence.adjudication = classify(evidence.before, evidence.after);
    evidence.classification = evidence.adjudication.classification;
    evidence.membership = { before: membershipDigest(evidence.before), after: membershipDigest(evidence.after) };
    evidence.adapterConflictBecauseLegacyMembershipChanged =
      evidence.adapter.kind === 'CONFLICT' &&
      evidence.membership.before !== evidence.membership.after &&
      Date.parse(evidence.after.updatedAt) > Date.parse(evidence.before.updatedAt);
    save();
    // All five post-DRAFT reads carry exact ownership/state/identity; each partition
    // must match the legacy anchor. Use that freshly completed projection for cleanup.
    evidence.preCleanup = structuredClone(evidence.after);
    op.phase('CLEANUP');
    await request(ARCHIVE, { product: { id: FIXTURE, status: 'ARCHIVED' } });
    op.phase('FINAL');
    cleanupReadAttempted = true;
    evidence.final = (await request(PROJECTION, { id: FIXTURE })).product;
    requireValue(evidence.final.status === 'ARCHIVED', 'final_state_drift');
    op.settle('archive', evidence.final);
    evidence.cleanup = { outcome: 'EXACT_ARCHIVED', status: 'ARCHIVED' };
    evidence.outcome = 'ADJUDICATED_AND_ARCHIVED';
  } catch (error) {
    evidence.stop = error instanceof Stop ? error.kind : typeof error?.kind === 'string' ? error.kind : 'local_failure';
    evidence.outcome = 'STOPPED';
    const archive = op.state().events.find((e) => e.operation === 'archive');
    if (archive?.invoked && op.state().pending !== null) {
      evidence.cleanup = { outcome: 'UNKNOWN_WRITE_REQUEST_STILL_OUTSTANDING' };
    } else if (archive?.invoked && !cleanupReadAttempted) {
      cleanupReadAttempted = true;
      op.phase('BOUNDED_CLEANUP_OBSERVATION');
      try {
        evidence.final = (await request(PROJECTION, { id: FIXTURE })).product;
        evidence.cleanup = {
          outcome:
            evidence.final.status === 'ARCHIVED'
              ? 'UNKNOWN_WRITE_OBSERVED_ARCHIVED'
              : 'UNKNOWN_WRITE_OBSERVED_OTHER_STATE',
          status: evidence.final.status,
        };
      } catch {
        evidence.cleanup = { outcome: 'UNKNOWN_WRITE_OBSERVATION_FAILED' };
      }
    }
    // No resend and no cleanup after any unresolved write; the port owns its one bounded observation.
  }
  evidence.accounting = op.state().counts;
  evidence.pendingAtClose = op.state().pending;
  evidence.settlements = op
    .state()
    .events.filter((e) => e.kind === 'update')
    .map((e) => ({ operation: e.operation, invoked: e.invoked, settlement: e.settlement }));
  op.finish({ outcome: evidence.outcome, stop: evidence.stop ?? null, classification: evidence.classification });
  save();
  return evidence;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.argv.length === 2, 'no_arguments');
    const binding = JSON.parse(readFileSync(resolve(LIVE_DIRECTORY, 'binding.json')));
    const gate = JSON.parse(readFileSync(resolve(LIVE_DIRECTORY, 'gate.json')));
    const result = await qualify({ binding, gate });
    process.stdout.write(
      `${JSON.stringify({
        outcome: result.outcome,
        stop: result.stop ?? null,
        classification: result.classification,
        cleanup: result.cleanup,
        counts: result.accounting,
      })}\n`,
    );
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ outcome: 'LOCAL_GATE_STOP', kind: error instanceof Stop ? error.kind : 'local_failure' })}\n`,
    );
    process.exitCode = 1;
  }
}
