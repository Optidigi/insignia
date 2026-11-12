// Owner emergency command (#375): revoke named keys, optionally bump the authorization epoch, and
// publish the resulting stricter public config. It never creates or activates a key and needs no
// private key material: the signer and its wrapping key are not involved.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DurableCore } from '@insignia/database';
import {
  APP_ID,
  hash,
  journaledOperation,
  reserveSigningRun,
  SHOP,
  type SigningProvisionPorts,
  type SigningRunJournal,
  sameScope,
} from './signing-provision.ts';

/**
 * `authorizationEpoch` is the binding's epoch before this plan runs. It is part of the plan so that
 * the epoch command (keyed by the plan digest) is distinct for every incident and idempotent within
 * one: re-running the plan after an interruption finds its bump already recorded.
 * Publish-only mode: no `revokeKeyIds` and no `bumpEpoch`.
 */
export type SigningEmergencyPlan = {
  authorizationEpoch: number;
  revokeKeyIds: number[];
  bumpEpoch: boolean;
  /** Explicit consent to leave no active key: issuance stops until a rotation (the emergency result). */
  allowNoActiveKey: boolean;
  reason: string;
};
type Operation =
  | 'VERIFY_IDENTITY'
  | 'EXCHANGE_ONLINE'
  | 'READ_INSTALLATION_OPEN'
  | 'READ_CONFIG_BEFORE'
  | 'BUMP_EPOCH'
  | 'REVOKE_KEYS'
  | 'PUBLISH_CONFIG'
  | 'READ_INSTALLATION_CLOSE'
  | 'READ_CONFIG_CLOSE';
const operations = new Set<Operation>([
  'VERIFY_IDENTITY',
  'EXCHANGE_ONLINE',
  'READ_INSTALLATION_OPEN',
  'READ_CONFIG_BEFORE',
  'BUMP_EPOCH',
  'REVOKE_KEYS',
  'PUBLISH_CONFIG',
  'READ_INSTALLATION_CLOSE',
  'READ_CONFIG_CLOSE',
]);
export type SigningEmergencyResult = {
  classification: 'SIGNING_EMERGENCY_PUBLISHED' | 'SIGNING_EMERGENCY_STOPPED';
  /** This plan's epoch command is recorded (by this run or an earlier run of the same plan). */
  epochBumped: boolean;
  /** The plan's keys that are revoked (or already destroyed) after this run. */
  revokedKeyIds: number[];
  publicConfigWriteAttempted: boolean;
  publicConfigWriteAcknowledged: boolean;
  ambiguousPublicationSettledByRead: boolean;
  /** Only the publication can be uncertain: the database steps are idempotent for the plan, so a
   * lost acknowledgement there is settled by running the same plan again. */
  ambiguousOperation: 'PUBLISH_CONFIG' | null;
  /** After a published run: the remaining active key, and whether it can issue today. */
  activeKeyId: number | null;
  issuanceReady: boolean;
  retryAuthorized: false;
  quoteIssuanceAuthorized: false;
  receiptDurable: boolean;
};
export type SigningEmergencyJournal = SigningRunJournal<Operation, SigningEmergencyResult>;
export type SigningEmergencyPorts = Pick<SigningProvisionPorts, 'app' | 'identity' | 'now' | 'bindProvider'> & {
  core: Pick<DurableCore, 'tenants' | 'signingKeys'>;
  journal: SigningEmergencyJournal;
};

export function qualifySigningEmergencyPlan(plan: SigningEmergencyPlan): SigningEmergencyPlan {
  assert.deepEqual(Object.keys(plan).sort(), [
    'allowNoActiveKey',
    'authorizationEpoch',
    'bumpEpoch',
    'reason',
    'revokeKeyIds',
  ]);
  assert.ok(Number.isSafeInteger(plan.authorizationEpoch) && plan.authorizationEpoch >= 0);
  assert.ok(plan.authorizationEpoch < 0xffffffff || !plan.bumpEpoch);
  assert.ok(Array.isArray(plan.revokeKeyIds) && plan.revokeKeyIds.length <= 4);
  assert.ok(plan.revokeKeyIds.every((id) => Number.isInteger(id) && id >= 1 && id <= 65535));
  assert.equal(new Set(plan.revokeKeyIds).size, plan.revokeKeyIds.length);
  assert.ok(typeof plan.bumpEpoch === 'boolean' && typeof plan.allowNoActiveKey === 'boolean');
  // The store's revocation reason limit.
  assert.ok(typeof plan.reason === 'string' && plan.reason.trim() && plan.reason.length <= 500);
  return Object.freeze({ ...plan, revokeKeyIds: [...plan.revokeKeyIds].sort((a, b) => a - b) });
}

export async function reserveSigningEmergencyRun(
  directory: string,
  plan: SigningEmergencyPlan,
): Promise<SigningEmergencyJournal> {
  return reserveSigningRun(
    directory,
    'm5-signing-emergency-reservation-v1',
    qualifySigningEmergencyPlan(plan),
    operations,
  );
}

const sha256 = (value: unknown) =>
  typeof value === 'string' ? createHash('sha256').update(value).digest('hex') : null;

/**
 * One journaled owner run. Order: pre-check (before any write), epoch bump, revocations, the same
 * pre-check against the new stored config, compare-and-set publication, exact readback. Every
 * database write is idempotent for the plan, so the same plan re-run in a new run root completes an
 * interrupted run and never bumps the epoch twice.
 */
export async function applySigningEmergency(
  inputPlan: SigningEmergencyPlan,
  idToken: string,
  ports: SigningEmergencyPorts,
): Promise<SigningEmergencyResult> {
  const flags = {
    epochBumped: false,
    publicConfigWriteAttempted: false,
    publicConfigWriteAcknowledged: false,
    ambiguousPublicationSettledByRead: false,
  };
  let uncertain: SigningEmergencyResult['ambiguousOperation'] = null,
    completed = false,
    activeKeyId: number | null = null,
    issuanceReady = false,
    revokedKeyIds: number[] = [];
  const operation = journaledOperation(ports.journal);
  try {
    const plan = qualifySigningEmergencyPlan(inputPlan);
    assert.equal(ports.journal.planSha256, hash(plan));
    const command = `owner-emergency:${ports.journal.planSha256}`;
    assert.ok(typeof idToken === 'string' && idToken.length > 0 && idToken.length <= 8192 && !/\s/.test(idToken));
    const start = ports.now().getTime();
    assert.ok(Number.isFinite(start));
    const identity = await operation('VERIFY_IDENTITY', () => ports.identity.verify(idToken));
    assert.equal(identity.shop, SHOP);
    assert.ok(identity.staffId && identity.sessionId && identity.expiresAtMs > start);
    const grant = await operation('EXCHANGE_ONLINE', () => ports.identity.exchangeOnline(idToken, identity));
    assert.equal(grant.shop, SHOP);
    assert.equal(grant.staffId, identity.staffId);
    assert.ok(grant.appScopes.includes('write_products') && grant.userScopes.includes('write_products'));
    const deadline = Math.min(start + 30000, identity.expiresAtMs, grant.expiresAtMs - 30000);
    function live() {
      const now = ports.now().getTime();
      assert.ok(Number.isFinite(now) && now >= start && now < deadline);
    }
    live();
    const provider = await operation('READ_INSTALLATION_OPEN', () => ports.identity.readInstallation(grant));
    assert.equal(provider.shop, SHOP);
    assert.ok(provider.grantedScopes.includes('write_products'));
    const managedRead = await ports.core.tenants.getManagedInstallationState(SHOP);
    assert.ok(managedRead?.active);
    const managed = managedRead;
    assert.equal(`gid://shopify/Shop/${managed.shopifyShopId}`, provider.shopId);
    assert.equal(managed.externalInstallationId, provider.installationId);
    const active = await ports.core.tenants.getActiveAuthorizationScope({
      shopId: managed.shopId,
      installationGeneration: managed.currentGeneration,
    });
    assert.ok(active && active.shopDomain === SHOP && active.shopifyShopId === managed.shopifyShopId);
    // The plan's epoch, or the one its own bump produced in an earlier run (checked by the bump).
    assert.ok(
      active.authorizationEpoch === plan.authorizationEpoch ||
        (plan.bumpEpoch && active.authorizationEpoch === plan.authorizationEpoch + 1),
    );
    const planned = {
      shopId: active.shopId,
      installationGeneration: active.installationGeneration,
      authorizationGeneration: active.authorizationGeneration,
      authorizationEpoch: plan.authorizationEpoch,
    };
    let scope = { ...planned, authorizationEpoch: active.authorizationEpoch };
    const tenant = {
      shopId: scope.shopId,
      installationGeneration: scope.installationGeneration,
      appId: APP_ID,
      shopifyShopId: provider.shopId,
    };
    async function currentScope() {
      live();
      const state = await ports.core.tenants.getManagedInstallationState(SHOP);
      assert.ok(
        state?.active &&
          state.shopId === managed.shopId &&
          state.currentGeneration === scope.installationGeneration &&
          state.shopifyShopId === managed.shopifyShopId &&
          state.externalInstallationId === provider.installationId,
      );
      sameScope(await ports.core.tenants.getActiveAuthorizationScope(scope), scope);
      sameScope(await ports.core.signingKeys.getActiveScope(scope.shopId, scope.installationGeneration), scope);
      live();
    }
    await currentScope();
    const { admin } = ports.bindProvider(grant, currentScope, tenant);
    const lifecycle = new ports.app.SigningKeyLifecycle(ports.core.signingKeys);
    const rows = await ports.core.signingKeys.list(scope);
    for (const id of plan.revokeKeyIds) assert.ok(rows.some((row) => row.id === id));
    // Refuse before any write to leave the shop without an active key unless the plan consents.
    const remaining = rows.filter((row) => row.state === 'active' && !plan.revokeKeyIds.includes(row.id));
    assert.ok(remaining.length > 0 || plan.allowNoActiveKey);
    const prior = await operation('READ_CONFIG_BEFORE', () => admin.read({ ...tenant, field: 'public_config' }));
    const evidence = { publishedSha256: sha256(prior?.value), compareDigest: prior?.compareDigest ?? null };
    // Pre-check before any write: the published config is the stored one, or one the database has
    // since only tightened. A pending key may be unpublished only if this plan revokes it; any other
    // unpublished pending key would become verifiable by this publication, so the run stops.
    const stored = await lifecycle.desiredPublicConfig(scope, ports.now());
    const leakedPending = rows.find((row) => row.state === 'pending' && plan.revokeKeyIds.includes(row.id));
    const precheck = ports.app.rotationRepublishDifferences(stored, prior?.value ?? null, leakedPending?.id ?? 0);
    assert.ok(precheck);
    await ports.journal.record('emergency-precheck', {
      ...evidence,
      storedSha256: sha256(stored.value),
      differences: precheck,
    });
    if (plan.bumpEpoch) {
      // Idempotent by command key: a re-run returns the epoch this plan produced, never a second bump.
      const epoch = await operation('BUMP_EPOCH', async () => {
        live();
        return lifecycle.incrementEpoch({
          scope: planned,
          commandKey: command,
          requestDigest: ports.journal.planSha256,
        });
      });
      assert.equal(epoch, plan.authorizationEpoch + 1);
      flags.epochBumped = true;
      scope = { ...planned, authorizationEpoch: epoch };
      await currentScope();
    } else assert.equal(scope.authorizationEpoch, plan.authorizationEpoch);
    // A key already revoked (an earlier run of this plan, or by hand) or destroyed needs nothing.
    const revocable = (await ports.core.signingKeys.list(scope)).filter(
      (row) => plan.revokeKeyIds.includes(row.id) && ['pending', 'active', 'retiring'].includes(row.state),
    );
    if (revocable.length)
      await operation('REVOKE_KEYS', async () => {
        for (const row of revocable) {
          await currentScope();
          await lifecycle.revoke(scope, row.id, command, plan.reason);
        }
      });
    const after = await ports.core.signingKeys.list(scope);
    assert.ok(
      plan.revokeKeyIds.every((id) =>
        ['revoked', 'destroyed'].includes(String(after.find((row) => row.id === id)?.state)),
      ),
    );
    revokedKeyIds = plan.revokeKeyIds;
    assert.ok(after.some((row) => row.state === 'active') || plan.allowNoActiveKey);
    // The same pre-check as the owner rotation, with no pending key: only tightening is published.
    const desired = await lifecycle.desiredPublicConfig(scope, ports.now());
    const differences = ports.app.rotationRepublishDifferences(desired, prior?.value ?? null, 0);
    assert.ok(differences);
    await ports.journal.record('emergency-publication', {
      priorPublishedSha256: evidence.publishedSha256,
      compareDigest: evidence.compareDigest,
      desiredSha256: sha256(desired.value),
      epoch: scope.authorizationEpoch,
      revokedKeyIds,
      activeKeyIds: after.filter((row) => row.state === 'active').map((row) => row.id),
      differences,
    });
    await currentScope();
    // Already published (a re-run after a lost acknowledgement, or nothing to tighten): read back only.
    if (prior?.value !== desired.value)
      await operation('PUBLISH_CONFIG', async () => {
        flags.publicConfigWriteAttempted = true;
        uncertain = 'PUBLISH_CONFIG';
        try {
          const result = await admin.set(
            { ...tenant, field: 'public_config', value: desired.value, compareDigest: prior?.compareDigest ?? null },
            () => {
              try {
                live();
                return true;
              } catch {
                return false;
              }
            },
          );
          assert.equal(result.observed.value, desired.value);
          flags.publicConfigWriteAcknowledged = true;
          flags.ambiguousPublicationSettledByRead = result.kind === 'applied_after_ambiguous_response';
          uncertain = null;
        } catch (error) {
          if (
            error &&
            typeof error === 'object' &&
            'kind' in error &&
            ['cas_conflict', 'not_dispatched'].includes(String(error.kind))
          )
            uncertain = null;
          throw error;
        }
      });
    const closing = await operation('READ_INSTALLATION_CLOSE', () => ports.identity.readInstallation(grant));
    assert.deepEqual(closing, provider);
    const observed = await operation('READ_CONFIG_CLOSE', () => admin.read({ ...tenant, field: 'public_config' }));
    assert.equal(observed?.value, desired.value);
    await currentScope();
    const final = await lifecycle.desiredPublicConfig(scope, ports.now());
    assert.equal(final.value, desired.value);
    assert.ok(ports.app.publishedConfigMatches(final, observed.value));
    // Readiness after the run: the remaining active key issues; with none, issuance is blocked.
    const remainingActive = final.keys.find((key) => key.state === 'active');
    if (remainingActive) {
      activeKeyId = remainingActive.id;
      try {
        ports.app.requireIssuanceReady({
          config: final,
          keyId: remainingActive.id,
          acceptedDay: ports.app.localDay(ports.now(), provider.ianaTimezone).ordinal,
        });
        issuanceReady = true;
      } catch {
        /* Reported, not fatal: the stricter config is published either way. */
      }
    }
    await ports.journal.record('emergency-readback', {
      observedSha256: sha256(observed.value),
      compareDigest: observed.compareDigest,
      activeKeyId,
      issuanceReady,
    });
    completed = true;
  } catch {
    /* Only closed facts survive; private provider/DB errors never do. */
  }
  const result: SigningEmergencyResult = {
    classification: completed ? 'SIGNING_EMERGENCY_PUBLISHED' : 'SIGNING_EMERGENCY_STOPPED',
    ...flags,
    revokedKeyIds,
    ambiguousOperation: uncertain,
    activeKeyId,
    issuanceReady,
    retryAuthorized: false,
    quoteIssuanceAuthorized: false,
    receiptDurable: true,
  };
  try {
    await ports.journal.finish(result);
  } catch {
    result.classification = 'SIGNING_EMERGENCY_STOPPED';
    result.receiptDurable = false;
  }
  return result;
}
