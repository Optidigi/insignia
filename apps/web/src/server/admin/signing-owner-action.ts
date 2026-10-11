import type { AdminActor } from './contracts.js';
export interface SigningOwnerConfiguration {
  directory: string;
  plan: { keyId: number; firstDay: number; lastDay: number };
  binding: {
    shop: string;
    shopId: string;
    installationId: string;
    tenantShopId: string;
    installationGeneration: string;
    authorizationGeneration: string;
    authorizationEpoch: number;
  };
  ring: { currentKeyId: string; keys: Readonly<Record<string, Buffer>> };
}
export interface SigningOwnerStatus {
  version: 'm5-signing-owner-action-v1';
  state: 'READY' | 'WAITING_FOR_VERIFICATION' | 'PENDING' | 'PROVISIONED' | 'STOPPED' | 'UNCERTAIN';
  actionAvailable: boolean;
  retryAuthorized: false;
  quoteIssuanceAuthorized: false;
}
export interface SigningOwnerAction {
  prepare(actor: AdminActor, idToken: string): Promise<SigningOwnerStatus>;
  start(actor: AdminActor, idToken: string): Promise<SigningOwnerStatus>;
  status(actor: AdminActor): Promise<SigningOwnerStatus>;
}

import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import type { SigningProvisionJournal, SigningProvisionPorts, SigningProvisionResult } from './signing-provision.ts';
import {
  provisionSigningKey,
  qualifySigningProvisionPlan,
  qualifySigningRuntimeIdentity,
  reserveSigningProvisionRun,
} from './signing-provision.ts';

const bindingFields = [
  'shop',
  'shopId',
  'installationId',
  'tenantShopId',
  'installationGeneration',
  'authorizationGeneration',
  'authorizationEpoch',
] as const;
const reply = (state: SigningOwnerStatus['state']): SigningOwnerStatus =>
  Object.freeze({
    version: 'm5-signing-owner-action-v1',
    state,
    actionAvailable: state === 'READY',
    retryAuthorized: false,
    quoteIssuanceAuthorized: false,
  });
function completedReply(result: SigningProvisionResult, keyId: number) {
  const flags = [
    'pendingCreateAttempted',
    'pendingCreateAcknowledged',
    'publicConfigWriteAttempted',
    'publicConfigWriteAcknowledged',
    'ambiguousPublicationSettledByRead',
    'activationAttempted',
    'activationAcknowledged',
  ] as const;
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      ...flags,
      'classification',
      'keyId',
      'ambiguousOperation',
      'retryAuthorized',
      'quoteIssuanceAuthorized',
      'receiptDurable',
    ].sort(),
  );
  assert.equal(result.keyId, keyId);
  assert.ok(flags.every((field) => typeof result[field] === 'boolean'));
  assert.equal(result.retryAuthorized, false);
  assert.equal(result.quoteIssuanceAuthorized, false);
  assert.ok(typeof result.receiptDurable === 'boolean');
  assert.ok([null, 'CREATE_PENDING', 'PUBLISH_CONFIG', 'ACTIVATE_KEY'].includes(result.ambiguousOperation));
  if (result.classification === 'SIGNING_KEY_CONFIG_PROVISIONED') {
    assert.ok(
      result.receiptDurable &&
        result.pendingCreateAcknowledged &&
        result.publicConfigWriteAcknowledged &&
        result.activationAcknowledged &&
        result.ambiguousOperation === null,
    );
    return reply('PROVISIONED');
  }
  assert.equal(result.classification, 'SIGNING_KEY_CONFIG_STOPPED');
  return reply(result.ambiguousOperation || !result.receiptDurable ? 'UNCERTAIN' : 'STOPPED');
}
async function privateJson(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    assert.ok(stat.isFile() && stat.uid === process.getuid?.() && (stat.mode & 0o777) === 0o600 && stat.size <= 32000);
    const bytes = Buffer.alloc(32001);
    const read = await file.read(bytes, 0, bytes.length, 0);
    assert.ok(read.bytesRead <= 32000);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, read.bytesRead)));
  } finally {
    await file.close();
  }
}
async function persist(directory: string, name: string, value: unknown) {
  const file = await open(join(directory, name), 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  const dir = await open(directory, 'r');
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}

/** Config and ports are private startup capabilities, never HTTP/environment JSON.
 * Durable exclusive reservation precedes original identity and signing operations.
 * Tokens remain only in the original request/SDK invocation's memory. */
export function createSigningOwnerAction(
  config: SigningOwnerConfiguration,
  ports: Omit<SigningProvisionPorts, 'journal' | 'ring'>,
): SigningOwnerAction {
  const runtimeIdentity = qualifySigningRuntimeIdentity(ports.runtimeIdentity);
  assert.deepEqual(Object.keys(config).sort(), ['binding', 'directory', 'plan', 'ring']);
  const plan = qualifySigningProvisionPlan(config.plan);
  assert.deepEqual(Object.keys(config.binding).sort(), [...bindingFields].sort());
  const binding = Object.freeze({ ...config.binding });
  assert.equal(binding.shop, 'insignia-rewrite-dev.myshopify.com');
  assert.match(binding.shopId, /^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/);
  assert.match(binding.installationId, /^gid:\/\/shopify\/AppInstallation\/[1-9][0-9]*$/);
  assert.ok(typeof binding.tenantShopId === 'string' && binding.tenantShopId.length > 0);
  assert.match(binding.installationGeneration, /^[1-9][0-9]*$/);
  assert.match(binding.authorizationGeneration, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.ok(Number.isSafeInteger(binding.authorizationEpoch) && binding.authorizationEpoch >= 0);
  assert.deepEqual(Object.keys(config.ring).sort(), ['currentKeyId', 'keys']);
  assert.ok(Object.keys(config.ring.keys).length > 0 && Object.keys(config.ring.keys).length <= 8);
  for (const [id, key] of Object.entries(config.ring.keys)) {
    assert.match(id, /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/);
    assert.ok(Buffer.isBuffer(key) && key.length === 32);
  }
  assert.ok(Object.hasOwn(config.ring.keys, config.ring.currentKeyId));
  const ring = {
    currentKeyId: config.ring.currentKeyId,
    keys: Object.fromEntries(Object.entries(config.ring.keys).map(([id, key]) => [id, Buffer.from(key)])),
  };
  const directory = config.directory;
  const expectedReceipt = {
    version: 'm5-signing-owner-binding-v1',
    binding,
    plan,
    activeAppVersionRef: '1162611916801',
  };
  let execution: Promise<void> | undefined;
  let running = false,
    startedAt = 0;
  const now = ports.now ?? (() => new Date());
  function actorBound(actor: AdminActor) {
    assert.ok(
      actor?.canRead && actor.canEdit && actor.expiresAtMs > now().getTime() && actor.staffId && actor.sessionId,
      'Signing action unavailable',
    );
    for (const field of ['shop', 'shopId', 'installationId', 'tenantShopId', 'installationGeneration'] as const)
      assert.equal(actor[field], binding[field], 'Signing action unavailable');
  }
  async function current() {
    const managed = await ports.core.tenants.getManagedInstallationState(binding.shop);
    assert.ok(
      managed?.active &&
        managed.shopId === binding.tenantShopId &&
        managed.currentGeneration === binding.installationGeneration &&
        managed.externalInstallationId === binding.installationId &&
        managed.shopifyShopId === binding.shopId.slice('gid://shopify/Shop/'.length),
    );
    const scope = await ports.core.tenants.getActiveAuthorizationScope({
      shopId: binding.tenantShopId,
      installationGeneration: binding.installationGeneration,
    });
    assert.ok(scope);
    for (const [field, value] of Object.entries({
      shopId: binding.tenantShopId,
      installationGeneration: binding.installationGeneration,
      authorizationGeneration: binding.authorizationGeneration,
      authorizationEpoch: binding.authorizationEpoch,
      shopDomain: binding.shop,
      shopifyShopId: binding.shopId.slice('gid://shopify/Shop/'.length),
    }))
      assert.equal(scope[field as keyof typeof scope], value);
    return scope;
  }
  async function status(actor: AdminActor) {
    actorBound(actor);
    await current();
    try {
      const stat = await lstat(directory);
      assert.ok(
        stat.isDirectory() &&
          !stat.isSymbolicLink() &&
          stat.uid === process.getuid?.() &&
          (stat.mode & 0o777) === 0o700,
      );
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        const time = now();
        const trusted = await ports.core.trustedReleaseRecords.read({
          scope: {
            shopId: binding.tenantShopId,
            installationGeneration: binding.installationGeneration,
            appClientId: runtimeIdentity.appClientId,
          },
          expectedActiveAppVersionRef: '1162611916801',
          now: time,
        });
        const attestation = trusted?.record?.attestation;
        if (
          trusted?.expectedBuild?.appVersionRef !== '1162611916801' ||
          trusted.expectedBuild?.sourceCommit !== '9b94149272d1b62c34f44dda3bde209e80b4ae22' ||
          !(
            Date.parse(attestation?.observedAt ?? '') <= time.getTime() &&
            Date.parse(attestation?.expiresAt ?? '') > time.getTime()
          )
        )
          return reply('WAITING_FOR_VERIFICATION');
        await current();
        return reply('READY');
      }
      return reply('UNCERTAIN');
    }
    try {
      assert.deepEqual(await privateJson(join(directory, 'owner-binding.json')), expectedReceipt);
      const result = await privateJson(join(directory, 'owner-result.json'));
      assert.ok(['PROVISIONED', 'STOPPED', 'UNCERTAIN'].includes(result.state));
      assert.deepEqual(result, reply(result.state));
      return reply(result.state);
    } catch {
      return reply(running && now().getTime() < startedAt + 30000 ? 'PENDING' : 'UNCERTAIN');
    }
  }
  async function start(actor: AdminActor, idToken: string) {
    actorBound(actor);
    assert.ok(typeof idToken === 'string' && /^[^\s]{1,8192}$/.test(idToken), 'Signing action unavailable');
    await current();
    const available = await status(actor);
    if (available.state !== 'READY') return available;
    let journal: SigningProvisionJournal;
    try {
      journal = await reserveSigningProvisionRun(directory, plan);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') return status(actor);
      throw new Error('Signing action unavailable');
    }
    await persist(directory, 'owner-binding.json', expectedReceipt);
    running = true;
    startedAt = now().getTime();
    const identity = {
      async verify(token: string) {
        const verified = await ports.identity.verify(token);
        for (const field of ['shop', 'staffId', 'sessionId'] as const) assert.equal(verified[field], actor[field]);
        return verified;
      },
      exchangeOnline: (token: string, verified: Parameters<SigningProvisionPorts['identity']['exchangeOnline']>[1]) =>
        ports.identity.exchangeOnline(token, verified),
      async readInstallation(grant: Parameters<SigningProvisionPorts['identity']['readInstallation']>[0]) {
        const observed = await ports.identity.readInstallation(grant);
        for (const field of ['shop', 'shopId', 'installationId'] as const)
          assert.equal(observed[field], binding[field]);
        return observed;
      },
    };
    const core = {
      ...ports.core,
      tenants: {
        ...ports.core.tenants,
        getActiveAuthorizationScope: async (
          input: Parameters<SigningProvisionPorts['core']['tenants']['getActiveAuthorizationScope']>[0],
        ) => {
          assert.equal(input.shopId, binding.tenantShopId);
          assert.equal(input.installationGeneration, binding.installationGeneration);
          return current();
        },
        async getManagedInstallationState(shop: string) {
          assert.equal(shop, binding.shop);
          const managed = await ports.core.tenants.getManagedInstallationState(shop);
          assert.ok(managed?.active);
          assert.equal(managed.shopId, binding.tenantShopId);
          assert.equal(managed.currentGeneration, binding.installationGeneration);
          assert.equal(managed.externalInstallationId, binding.installationId);
          assert.equal(managed.shopifyShopId, binding.shopId.slice('gid://shopify/Shop/'.length));
          return managed;
        },
      },
    };
    // The durable run remains occupied after disconnect, restart, failure or expiry.
    // No recovered status can dispatch another attempt.
    execution = provisionSigningKey(plan, idToken, { ...ports, core, identity, ring, journal, now })
      .then((result) => persist(directory, 'owner-result.json', completedReply(result, plan.keyId)))
      .catch(() => {})
      .finally(() => {
        running = false;
        for (const key of Object.values(ring.keys)) key.fill(0);
      });
    return reply('PENDING');
  }
  async function prepare(actor: AdminActor, idToken: string): Promise<SigningOwnerStatus> {
    const initial = await start(actor, idToken);
    if (initial.state !== 'PENDING') return initial;
    await execution;
    return status(actor);
  }
  return Object.freeze({ start, status, prepare });
}
