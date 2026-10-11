import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import {
  provisionSigningKey,
  qualifySigningProvisionPlan,
  qualifySigningRuntimeIdentity,
  reserveSigningProvisionRun,
} from '../../../../../scripts/m5-runtime/signing-provision-core.mjs';

const bindingFields = [
  'shop',
  'shopId',
  'installationId',
  'tenantShopId',
  'installationGeneration',
  'authorizationGeneration',
  'authorizationEpoch',
];
const reply = (state) =>
  Object.freeze({
    version: 'm5-signing-owner-action-v1',
    state,
    actionAvailable: state === 'READY',
    retryAuthorized: false,
    quoteIssuanceAuthorized: false,
  });
function completedReply(result, keyId) {
  const flags = [
    'pendingCreateAttempted',
    'pendingCreateAcknowledged',
    'publicConfigWriteAttempted',
    'publicConfigWriteAcknowledged',
    'ambiguousPublicationSettledByRead',
    'activationAttempted',
    'activationAcknowledged',
  ];
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
async function privateJson(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    assert.ok(stat.isFile() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o600 && stat.size <= 32000);
    const bytes = Buffer.alloc(32001);
    const read = await file.read(bytes, 0, bytes.length, 0);
    assert.ok(read.bytesRead <= 32000);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, read.bytesRead)));
  } finally {
    await file.close();
  }
}
async function persist(directory, name, value) {
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
export function createSigningOwnerAction(config, ports) {
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
    assert.match(id, /^[A-Za-z0-9_-]{1,128}$/);
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
  let running = false,
    startedAt = 0;
  const now = ports.now ?? (() => new Date());
  function actorBound(actor) {
    assert.ok(
      actor?.canRead && actor.canEdit && actor.expiresAtMs > now().getTime() && actor.staffId && actor.sessionId,
      'Signing action unavailable',
    );
    for (const field of ['shop', 'shopId', 'installationId', 'tenantShopId', 'installationGeneration'])
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
      assert.equal(scope[field], value);
    return scope;
  }
  async function status(actor) {
    actorBound(actor);
    await current();
    try {
      const stat = await lstat(directory);
      assert.ok(
        stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o700,
      );
    } catch (error) {
      if (error?.code === 'ENOENT') {
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
            Date.parse(attestation?.observedAt) <= time.getTime() && Date.parse(attestation?.expiresAt) > time.getTime()
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
  async function start(actor, idToken) {
    actorBound(actor);
    assert.ok(typeof idToken === 'string' && /^[^\s]{1,8192}$/.test(idToken), 'Signing action unavailable');
    await current();
    const available = await status(actor);
    if (available.state !== 'READY') return available;
    let journal;
    try {
      journal = await reserveSigningProvisionRun(directory, plan);
    } catch (error) {
      if (error?.code === 'EEXIST') return status(actor);
      throw new Error('Signing action unavailable');
    }
    await persist(directory, 'owner-binding.json', expectedReceipt);
    running = true;
    startedAt = now().getTime();
    const identity = {
      async verify(token) {
        const verified = await ports.identity.verify(token);
        for (const field of ['shop', 'staffId', 'sessionId']) assert.equal(verified[field], actor[field]);
        return verified;
      },
      exchangeOnline: (token, verified) => ports.identity.exchangeOnline(token, verified),
      async readInstallation(grant) {
        const observed = await ports.identity.readInstallation(grant);
        for (const field of ['shop', 'shopId', 'installationId']) assert.equal(observed[field], binding[field]);
        return observed;
      },
    };
    const core = {
      ...ports.core,
      tenants: {
        ...ports.core.tenants,
        getActiveAuthorizationScope: async (input) => {
          assert.equal(input.shopId, binding.tenantShopId);
          assert.equal(input.installationGeneration, binding.installationGeneration);
          return current();
        },
        async getManagedInstallationState(shop) {
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
    void provisionSigningKey(plan, idToken, { ...ports, core, identity, ring, journal, now })
      .then((result) => persist(directory, 'owner-result.json', completedReply(result, plan.keyId)))
      .catch(() => {})
      .finally(() => {
        running = false;
        for (const key of Object.values(ring.keys)) key.fill(0);
      });
    return reply('PENDING');
  }
  return Object.freeze({ start, status });
}
