import { lstatSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  availabilityV2HeldSafe,
  availabilityV2IntentQualified,
  sameAvailabilityV2,
  validAvailabilityAcknowledgementV2,
  validAvailabilityV2,
} from '../../packages/application/dist/index.js';
import {
  AVAILABILITY_ADMIN_API_VERSION,
  createShopifyAvailabilityHoldV2Port,
  ShopifyAvailabilityHoldError,
} from '../../packages/shopify/dist/index.js';
import { protectedCredentials } from '../m5-004/qualification.mjs';
import { EVIDENCE_ROOT, verifyGate } from './binding.mjs';
import { CREATE, FIND, IDENTITY, OWNED, productionDocuments, SCOPE, STATUS, TARGET } from './documents.mjs';
import { assertGuard, createGuardedOperator } from './guard.mjs';
import { atomic, digest, LIVE_DIRECTORY, requireValue, Stop, saveJSON } from './operator.mjs';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const failure = (error) =>
  error?.code === 'network_escape_denied'
    ? error.code
    : error instanceof Stop || error instanceof ShopifyAvailabilityHoldError
      ? error.kind
      : 'local_failure';
export async function runSynthetic(options) {
  const directory = resolve(options.directory);
  requireValue(
    dirname(directory) === tmpdir() &&
      /^insignia-m5-015r-[A-Za-z0-9_-]+$/.test(directory.split('/').at(-1)) &&
      typeof options.fetchImpl === 'function' &&
      options.fetchImpl !== globalThis.fetch &&
      typeof options.credentialLoader === 'function' &&
      options.credentialLoader !== protectedCredentials,
    'synthetic_boundaries',
  );
  return run({
    ...options,
    directory,
    synthetic: true,
    binding: { synthetic: true },
    assertCurrent: options.assertCurrent ?? (() => {}),
    credentialLoader: () => {
      const c = options.credentialLoader();
      requireValue(c.secret?.startsWith('synthetic-'), 'synthetic_credential');
      return c;
    },
  });
}
export async function qualify({ root = ROOT, directory = LIVE_DIRECTORY, phase }) {
  requireValue(
    root === ROOT && resolve(directory) === LIVE_DIRECTORY && ['start', 'resume'].includes(phase),
    'live_root',
  );
  assertGuard();
  const binding = JSON.parse(readFileSync(resolve(EVIDENCE_ROOT, 'binding.json')));
  const gate = JSON.parse(readFileSync(resolve(EVIDENCE_ROOT, 'gate.json')));
  const assertCurrent = () => {
    assertGuard();
    verifyGate(root, binding, gate);
  };
  assertCurrent(); // Before canonical initialization and protected credential access.
  if (phase === 'resume') {
    requireValue(
      JSON.stringify(JSON.parse(readFileSync(resolve(directory, 'binding.json')))) === JSON.stringify(binding) &&
        JSON.stringify(JSON.parse(readFileSync(resolve(directory, 'gate.json')))) === JSON.stringify(gate),
      'resume_gate_binding',
    );
  }
  return run({ directory, binding, phase, credentialLoader: protectedCredentials, assertCurrent, gate });
}
async function run({ directory, binding, phase, fetchImpl, credentialLoader, assertCurrent, synthetic = false, gate }) {
  requireValue(['start', 'resume'].includes(phase), 'phase');
  assertCurrent();
  const op = createGuardedOperator({
    directory,
    binding,
    documents: productionDocuments(ROOT),
    phase,
    synthetic,
    fetchImpl,
    assertCurrent,
  });
  if (!synthetic && phase === 'start') {
    saveJSON(directory, 'binding.json', binding, true);
    saveJSON(directory, 'gate.json', gate, true);
  }
  let evidence = op.state().evidence,
    token = null,
    port,
    awaiting = false;
  const save = () => {
    op.patch((s) => {
      s.evidence = evidence;
    });
    saveJSON(directory, 'qualification.json', evidence);
  };
  const current = () => op.state().fixture.id;
  async function request(query, variables = {}) {
    requireValue(token && Date.now() + 30000 < token.expiresAt, 'credential_fence');
    const response = await op.fetch(
      `https://${TARGET.domain}/admin/api/${AVAILABILITY_ADMIN_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shopify-access-token': token.accessToken },
        body: JSON.stringify({ query, variables }),
      },
    );
    return (await response.json()).data;
  }
  async function owner() {
    evidence.latestOwnership = await request(OWNED, { id: current() });
    save();
    return evidence.latestOwnership.product;
  }
  function valid(snapshot) {
    requireValue(
      validAvailabilityV2(snapshot) &&
        snapshot.productId === current() &&
        JSON.stringify(snapshot.scope) === JSON.stringify(SCOPE),
      'v2_snapshot',
    );
    requireValue(availabilityV2IntentQualified(snapshot), 'SCHEDULED_PRODUCT_UNQUALIFIED');
    return snapshot;
  }
  async function snapshot(mode) {
    op.mode(mode);
    return valid(await port.snapshot(SCOPE, current(), 'v2'));
  }
  function acknowledge(operation, receipt) {
    const ack = receipt.acknowledgement ?? receipt.hold?.acquisitionAcknowledgement;
    if (
      validAvailabilityAcknowledgementV2(ack) &&
      ack.productId === current() &&
      JSON.stringify(ack.scope) === JSON.stringify(SCOPE)
    ) {
      op.patch((s) => {
        const event = s.events.find((e) => e.operation === operation && e.mutation);
        if (event && event.settlement === 'ACKNOWLEDGED') event.validatedAcknowledgement = true;
      });
    }
  }
  function diagnostics(ack, snapshot) {
    return {
      acknowledgedUpdatedAt: ack?.providerUpdatedAt ?? null,
      readbackUpdatedAt: snapshot?.providerUpdatedAt ?? null,
      deltaMilliseconds:
        ack && snapshot ? Date.parse(snapshot.providerUpdatedAt) - Date.parse(ack.providerUpdatedAt) : null,
    };
  }
  function future(snapshot) {
    const count = snapshot.configuredIntent.publicationSettings.filter((p) => p.supportsFuturePublishing).length;
    evidence.futureCapability = {
      flag: count ? 'FUTURE_CAPABILITY_OBSERVED' : 'FUTURE_CAPABILITY_NOT_OBSERVED',
      count,
      publicationSettings: snapshot.configuredIntent.publicationSettings,
    };
  }
  async function final() {
    await owner();
    evidence.final = await snapshot('final');
    save();
    const v = evidence.final.effectiveVisibility;
    requireValue(
      evidence.final.state === 'archived' &&
        v.publishedPublicationIds.length === 0 &&
        !v.onlineStore.publishedAtPresent &&
        !v.onlineStore.urlPresent,
      'final_unpublished',
    );
    evidence.cleanup.outcome = 'FINAL_ARCHIVED_UNPUBLISHED';
    const ack = op.state().events.find((e) => e.operation === 'cleanup' && e.mutation)?.response?.data
      ?.productUpdate?.product;
    evidence.cleanup.timestamps = ack
      ? {
          acknowledgedUpdatedAt: ack.updatedAt,
          readbackUpdatedAt: evidence.final.providerUpdatedAt,
          deltaMilliseconds: Date.parse(evidence.final.providerUpdatedAt) - Date.parse(ack.updatedAt),
        }
      : null;
    save();
  }
  async function cleanup() {
    if (!op.state().fixture || !op.allWritesSettled() || op.state().pending !== null) {
      evidence.cleanup = { outcome: 'NOT_AUTHORIZED_UNSETTLED_OR_NO_FIXTURE' };
      save();
      return;
    }
    const owned = await owner();
    // Schedules prevent lifecycle qualification. A complete production snapshot
    // still supplies the independently known current state required for cleanup.
    op.mode('cleanup-read');
    evidence.cleanupPrestate = await port.snapshot(SCOPE, current(), 'v2');
    requireValue(
      validAvailabilityV2(evidence.cleanupPrestate) &&
        evidence.cleanupPrestate.productId === current() &&
        JSON.stringify(evidence.cleanupPrestate.scope) === JSON.stringify(SCOPE) &&
        { DRAFT: 'unavailable', ACTIVE: 'available', ARCHIVED: 'archived', UNLISTED: 'unlisted' }[owned.status] ===
          evidence.cleanupPrestate.state,
      'cleanup_prestate',
    );
    save();
    if (owned.status !== 'ARCHIVED') {
      op.reserve('cleanup');
      op.mode('cleanup');
      try {
        evidence.cleanup.acknowledgement = (
          await request(STATUS, { product: { id: current(), status: 'ARCHIVED' } })
        ).productUpdate.product;
        save();
      } catch (error) {
        evidence.cleanup.failure = failure(error);
        evidence.cleanup.outcome = 'UNKNOWN_ARCHIVE_WRITE';
        save();
        if (op.state().pending === null && op.transportAudit().matches) {
          evidence.cleanup.classificationRead = await owner(); // one exact bounded read, not mutation settlement
          save();
        }
        throw error;
      }
    }
    await final();
  }
  let hold;
  try {
    if (phase === 'resume') {
      const path = resolve(directory, 'held.json'),
        info = lstatSync(path);
      requireValue(
        info.isFile() &&
          !info.isSymbolicLink() &&
          info.uid === process.getuid() &&
          (info.mode & 0o077) === 0 &&
          info.size < 128 * 1024,
        'persisted_hold_permissions',
      );
      const bytes = readFileSync(path);
      requireValue(
        digest(bytes) === evidence.persistedHold.sha256 && bytes.length === evidence.persistedHold.bytes,
        'persisted_hold_hash',
      );
      hold = JSON.parse(bytes);
      requireValue(JSON.stringify(hold) === JSON.stringify(evidence.acquire.hold), 'persisted_hold_exact');
      evidence.freshProcess = {
        initialPid: op.state().initialPid,
        resumePid: process.pid,
        different: op.state().initialPid !== process.pid,
        persistedHoldHash: digest(bytes),
      };
      save();
    }
    const c = credentialLoader();
    evidence.credentialMetadata = c.ownership ?? { synthetic: true };
    const response = await op.fetch(`https://${TARGET.domain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: TARGET.client, client_secret: c.secret, grant_type: 'client_credentials' }),
    });
    const raw = await response.json();
    if (synthetic) requireValue(raw.access_token?.startsWith('synthetic-'), 'synthetic_token');
    token = { accessToken: raw.access_token, expiresAt: Date.now() + raw.expires_in * 1000 };
    op.setToken(token);
    evidence.identity = await request(IDENTITY);
    save();
    port = createShopifyAvailabilityHoldV2Port({
      fetchImpl: op.fetch,
      isCurrent: (scope) => op.isCurrent(scope),
      credentials: {
        acquire: async () => ({
          kind: 'usable',
          shopDomain: TARGET.domain,
          accessToken: token.accessToken,
          accessExpiresAt: new Date(token.expiresAt),
        }),
      },
    });
    if (phase === 'start') {
      op.mode('create');
      try {
        const s = op.state();
        evidence.create = (
          await request(CREATE, { product: { title: s.marker, handle: s.marker, tags: [s.marker], status: 'DRAFT' } })
        ).productCreate.product;
        save();
      } catch (error) {
        if (
          !op.state().transport.mismatch &&
          op.state().pending === null &&
          op.state().events.some((e) => e.operation === 'create' && e.invoked)
        ) {
          op.reserve('recovery');
          op.mode('recovery');
          try {
            evidence.createRecovery = await request(FIND, {
              search: `tag:'${op.state().marker}' AND handle:'${op.state().marker}'`,
            });
            save();
          } catch (recoveryError) {
            evidence.recoveryStop = failure(recoveryError);
            save();
          }
        }
        throw error;
      }
      requireValue((await owner()).status === 'DRAFT', 'initial_draft');
      evidence.draft = await snapshot('draft');
      future(evidence.draft);
      save();
      requireValue(availabilityV2HeldSafe(evidence.draft), 'draft_not_held_safe');
      op.reserve('setup');
      op.mode('setup');
      evidence.setup = (await request(STATUS, { product: { id: current(), status: 'ACTIVE' } })).productUpdate.product;
      save();
      requireValue((await owner()).status === 'ACTIVE', 'active_setup');
      evidence.before = await snapshot('before');
      save();
      requireValue(
        evidence.before.state === 'available' && evidence.before.intentDigest === evidence.draft.intentDigest,
        'configured_intent_changed_after_setup',
      );
      if (evidence.before.effectiveVisibility.publishedPublicationIds.length === 0) {
        evidence.outcome = 'PARTIAL';
        throw new Stop('ACTIVE_EFFECTIVE_VISIBILITY_NOT_OBSERVED');
      }
      const intent = {
        version: 'm5-availability-hold-v2',
        operationId: op.state().operationId,
        before: evidence.before,
        held: null,
      };
      saveJSON(directory, 'hold-intent.json', intent, true);
      evidence.intent = intent;
      save();
      op.reserve('acquire');
      op.mode('acquire');
      evidence.acquire = await port.acquire(SCOPE, intent);
      acknowledge('acquire', evidence.acquire);
      save();
      requireValue(
        evidence.acquire.kind === 'HELD' &&
          evidence.acquire.hold.version === 'm5-availability-hold-v2' &&
          evidence.acquire.hold.acquisitionAcknowledgement &&
          availabilityV2HeldSafe(evidence.acquire.current) &&
          sameAvailabilityV2(evidence.acquire.hold.held, evidence.acquire.current) &&
          evidence.acquire.current.intentDigest === evidence.before.intentDigest &&
          op.allWritesSettled(),
        'acquire_not_exact_held',
      );
      evidence.acquireTimestamps = diagnostics(
        evidence.acquire.hold.acquisitionAcknowledgement,
        evidence.acquire.current,
      );
      const heldBytes = Buffer.from(JSON.stringify(evidence.acquire.hold));
      atomic(directory, 'held.json', heldBytes, true);
      evidence.persistedHold = { sha256: digest(heldBytes), bytes: heldBytes.length };
      evidence.outcome = 'AWAITING_FRESH_PROCESS';
      save();
      op.patch((s) => {
        s.phase = 'HELD_PERSISTED';
      });
      awaiting = true;
    } else {
      await owner();
      op.reserve('observe');
      op.mode('observe');
      evidence.observe = await port.observe(SCOPE, hold);
      save();
      requireValue(
        evidence.observe.kind === 'HELD' &&
          sameAvailabilityV2(hold.held, evidence.observe.current) &&
          availabilityV2HeldSafe(evidence.observe.current),
        'observe_not_exact_held',
      );
      await owner();
      op.reserve('restore');
      op.mode('restore');
      evidence.restore = await port.restore(SCOPE, hold, evidence.observe.current);
      acknowledge('restore', evidence.restore);
      save();
      requireValue(
        evidence.restore.kind === 'RESTORED' &&
          sameAvailabilityV2(hold.before, evidence.restore.current) &&
          availabilityV2IntentQualified(evidence.restore.current) &&
          op.allWritesSettled(),
        'restore_not_exact',
      );
      evidence.restoreTimestamps = diagnostics(evidence.restore.acknowledgement, evidence.restore.current);
      save();
      await cleanup();
      requireValue(
        evidence.cleanup.outcome === 'FINAL_ARCHIVED_UNPUBLISHED' &&
          op.transportAudit().matches &&
          evidence.freshProcess.different &&
          op.allWritesSettled(),
        'pass_settlement',
      );
      evidence.outcome = synthetic ? 'PASS_V2_SYNTHETIC' : 'PASS_V2_LIVE';
      save();
    }
  } catch (error) {
    evidence.stop = failure(error);
    if (evidence.outcome !== 'PARTIAL') evidence.outcome = 'STOPPED';
    save();
    if (port && token && op.state().calls.cleanup === 0) {
      try {
        await cleanup();
      } catch (cleanupError) {
        evidence.cleanupStop = failure(cleanupError);
        evidence.cleanup.outcome = ['FINAL_ARCHIVED_UNPUBLISHED', 'UNKNOWN_ARCHIVE_WRITE'].includes(
          evidence.cleanup.outcome,
        )
          ? evidence.cleanup.outcome
          : 'UNSETTLED_CLEANUP';
        save();
      }
    }
    if (
      evidence.outcome === 'PARTIAL' &&
      (evidence.cleanup.outcome !== 'FINAL_ARCHIVED_UNPUBLISHED' ||
        !op.allWritesSettled() ||
        !op.transportAudit().matches ||
        evidence.cleanupStop)
    )
      evidence.outcome = 'STOPPED';
  } finally {
    token = null;
    evidence.accounting = op.state().counts;
    evidence.transportAccounting = { ...op.state().transport, ...op.transportAudit() };
    evidence.processGuard = { immutable: Object.getOwnPropertyDescriptor(globalThis, 'fetch').writable === false };

    evidence.pendingAtClose = op.state().pending;
    evidence.settlements = op
      .state()
      .events.filter((e) => e.mutation)
      .map((e) => ({ operation: e.operation, invoked: e.invoked, settlement: e.settlement }));
    save();
    if (!awaiting) op.close();
  }
  return evidence;
}
