/** Private owner workflow only. Native entry fixes all IO; injectable ports are
 * for offline boundary controls. This does not grant online staff authority. */
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { qualifyReleaseAppendInput } from './release-append.mjs';
import { releaseProfile } from './release-profile.mjs';

const APP = '1443cf6d03d39edae7c101a943c5c684';
const SHOP = 'insignia-rewrite-dev.myshopify.com';
const bindingFields = [
  'shop',
  'tenantShopId',
  'installationGeneration',
  'shopId',
  'externalInstallationId',
  'authorizationGeneration',
  'authorizationEpoch',
];
/** Fresh owner records use canonical UUIDv4, never a caller path. */
export function recordPhaseName(recordId) {
  assert.match(recordId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  return `m5-trusted-release-collector-native-run-20261011-${recordId}`;
}
function keys(value, fields) {
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype);
  assert.deepEqual(Object.keys(value).sort(), [...fields].sort());
}
function binding(value) {
  keys(value, bindingFields);
  assert.equal(value.shop, SHOP);
  assert.match(value.tenantShopId, /^[A-Za-z0-9_-]{1,128}$/);
  assert.match(value.installationGeneration, /^[1-9][0-9]*$/);
  assert.match(value.shopId, /^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/);
  assert.match(value.externalInstallationId, /^gid:\/\/shopify\/AppInstallation\/[1-9][0-9]*$/);
  assert.match(value.authorizationGeneration, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.ok(Number.isSafeInteger(value.authorizationEpoch) && value.authorizationEpoch >= 0);
  return { ...value };
}
function installation(value, expected, profile) {
  const GRANTS = profile.grants;
  keys(value, ['shop', 'shopId', 'installationId', 'appId', 'appClientId', 'grants']);
  assert.equal(value.shop, expected.shop);
  assert.equal(value.shopId, expected.shopId);
  assert.equal(value.installationId, expected.externalInstallationId);
  assert.equal(value.appId, '429028933633');
  assert.equal(value.appClientId, APP);
  assert.ok(Array.isArray(value.grants) && value.grants.length === GRANTS.length);
  assert.deepEqual([...value.grants].sort(), [...GRANTS].sort());
}
function managementOpening(value, profile) {
  const VERSION_IDS = profile.versionIds;
  keys(value, ['versions', 'totalResults', 'moduleObservation']);
  assert.equal(value.totalResults, VERSION_IDS.length);
  assert.ok(Array.isArray(value.versions) && value.versions.length === VERSION_IDS.length);
  assert.deepEqual(
    new Set(value.versions.map((v) => v.versionId)),
    new Set(VERSION_IDS.map((v) => `gid://shopify/Version/${v}`)),
  );
  for (const v of value.versions) {
    keys(v, ['versionId', 'versionTag', 'status']);
    assert.equal(v.status, v.versionId === `gid://shopify/Version/${profile.versionId}` ? 'active' : 'inactive');
    assert.equal(typeof v.versionTag, 'string');
  }
  assert.equal(value.versions.find((v) => v.status === 'active').versionTag, profile.versionTag);
  const modules = value.moduleObservation;
  keys(modules, ['appId', 'appClientId', 'versionId', 'versionTag', 'observedAt', 'modules']);
  assert.equal(modules.appId, '429028933633');
  assert.equal(modules.appClientId, APP);
  assert.equal(modules.versionId, profile.versionId);
  assert.equal(modules.versionTag, profile.versionTag);
  assert.ok(Array.isArray(modules.modules) && modules.modules.length === profile.modules.length);
  assert.deepEqual(
    [...modules.modules].sort((a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0)),
    profile.modules,
  );
}
async function persist(directory, name, value) {
  const file = await open(join(directory, name), 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}
const reply = (classification, appendAttempted = false, appendAcknowledged = false, ambiguousWrite = false) => ({
  version: 'm5-owner-trusted-release-collector-v1',
  classification,
  appendAttempted,
  appendAcknowledged,
  ambiguousWrite,
  retryAuthorized: false,
  signingAttempted: false,
  staffAuthorityGranted: false,
  sdkInternalHttpAttempts: 'NOT_ASSERTED',
  deployedWasmServerDigest: 'UNAVAILABLE_NOT_ASSERTED',
});

export async function collectFreshTrustedRelease(config, ports, profileName) {
  const profile = releaseProfile(profileName);
  let directory,
    phaseOwned = false,
    attempted = false,
    acknowledged = false,
    uncertain = false,
    ordinal = 0,
    accessToken;
  try {
    keys(config, ['directory', 'recordId', 'operator']);
    directory = config.directory;
    assert.ok(isAbsolute(directory));
    assert.equal(basename(directory), recordPhaseName(config.recordId));
    const parent = await lstat(dirname(directory));
    assert.ok(
      parent.isDirectory() &&
        !parent.isSymbolicLink() &&
        parent.uid === process.getuid() &&
        (parent.mode & 0o777) === 0o700,
    );
    assert.equal(await realpath(dirname(directory)), dirname(directory));
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (error?.code === 'EEXIST') return reply('TRUSTED_RELEASE_COLLECT_NOT_RESUMABLE');
      throw error;
    }
    phaseOwned = true;
    const parentHandle = await open(dirname(directory), constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      await parentHandle.sync();
    } finally {
      await parentHandle.close();
    }
    await persist(directory, 'invocation.json', {
      version: 'm5-owner-collector-invocation-v1',
      recordId: config.recordId,
      sdkReadMethods: 4,
      ownerOAuthPosts: 1,
      ownerAdminSelectedReads: 3,
      appendCalls: 1,
      maximumDurationMs: 300000,
      sdkInternalHttpAttempts: 'NOT_ASSERTED',
      retryAuthorized: false,
    });
    const startedAt = ports.now();
    assert.ok(Number.isFinite(startedAt));
    const live = () => {
      const now = ports.now();
      assert.ok(Number.isFinite(now) && now >= startedAt && now - startedAt < 300000);
      return now;
    };
    const sdkSequence = ['ActiveAppReleaseFromApiKey', 'AppVersions', 'AppVersionByTag', 'AppVersions'];
    let sdkOrdinal = 0;
    const reserve = async (operation, extra = {}) => {
      live();
      const receipt = {
        version: 'm5-owner-collector-reservation-v1',
        ordinal: ++ordinal,
        operation,
        reservedAt: new Date(ports.now()).toISOString(),
        ...extra,
      };
      await persist(directory, `reservation-${String(ordinal).padStart(2, '0')}.json`, receipt);
      return { durable: true };
    };
    const sdkReserve = async (operation) => {
      assert.equal(operation, sdkSequence[sdkOrdinal++]);
      return reserve(operation);
    };
    async function operation(name, action) {
      assert.equal((await reserve(name)).durable, true);
      const result = await action();
      live();
      return result;
    }
    const before = binding(await operation('READ_DURABLE_TENANT_OPEN', ports.readTenant));
    await operation('AUTHENTICATE_EXISTING_MANAGEMENT_SESSION', () => ports.management.authenticate());
    const opening = await ports.management.open(sdkReserve);
    managementOpening(opening, profile);
    assert.equal(sdkOrdinal, 3);
    accessToken = await operation('CLIENT_CREDENTIALS_ONCE', ports.acquireToken);
    assert.ok(typeof accessToken === 'string' && /^[^\s]{1,4096}$/.test(accessToken));
    installation(
      await operation('READ_NATIVE_INSTALLATION_OPEN', () => ports.readInstallation(accessToken)),
      before,
      profile,
    );
    const functions = await operation('READ_ORIGINAL_FUNCTION_OWNERSHIP', () =>
      ports.readFunctions(accessToken, before),
    );
    keys(functions, ['transform', 'validation', 'runtimeIdentity', 'readiness', 'observation']);
    assert.equal(functions.transform, 'present');
    assert.equal(functions.validation, 'present');
    assert.equal(functions.runtimeIdentity, 'unverifiable');
    assert.equal(functions.readiness, 'unknown');
    assert.ok(functions.observation);
    installation(
      await operation('READ_NATIVE_INSTALLATION_CLOSE', () => ports.readInstallation(accessToken)),
      before,
      profile,
    );
    const closing = await ports.management.close(sdkReserve);
    keys(closing, ['versions', 'totalResults', 'observedAt']);
    assert.equal(sdkOrdinal, 4);
    assert.equal(closing.totalResults, profile.versionIds.length);
    assert.deepEqual(closing.versions, opening.versions);
    assert.deepEqual(binding(await operation('READ_DURABLE_TENANT_CLOSE', ports.readTenant)), before, profile);
    const input = {
      recordId: config.recordId,
      operator: config.operator,
      activeObservation: { observedAt: closing.observedAt, versions: closing.versions },
      moduleObservation: opening.moduleObservation,
      readiness: {
        version: 'm5-admin-technical-readiness-v1',
        shop: before.shop,
        tenantShopId: before.tenantShopId,
        installationGeneration: before.installationGeneration,
        shopId: before.shopId,
        externalInstallationId: before.externalInstallationId,
        functions,
      },
    };
    const q = qualifyReleaseAppendInput(input, live(), profileName);
    // Only original selected observations; no credential or raw provider object.
    await persist(directory, 'observations.json', {
      recordId: input.recordId,
      inputDigest: q.digest,
      activeObservation: input.activeObservation,
      moduleObservation: input.moduleObservation,
      readiness: input.readiness,
    });
    assert.equal(
      (await reserve('APPEND_TRUSTED_RELEASE_ONCE', { recordId: config.recordId, inputDigest: q.digest })).durable,
      true,
    );
    qualifyReleaseAppendInput(input, live(), profileName);
    attempted = true;
    uncertain = true;
    const result = await ports.append(input);
    assert.ok(
      result &&
        result.recordId === config.recordId &&
        typeof result.writeAttempted === 'boolean' &&
        typeof result.writeAcknowledged === 'boolean',
    );
    acknowledged = result.writeAcknowledged;
    if (result.classification === 'TRUSTED_RELEASE_APPEND_ACK_RUNTIME_QUALIFIED') {
      assert.ok(result.writeAttempted && acknowledged);
      uncertain = false;
      const receipt = reply('TRUSTED_RELEASE_COLLECT_APPEND_ACK', true, true, false);
      await persist(directory, 'receipt.json', receipt);
      return receipt;
    }
    assert.equal(result.classification, 'TRUSTED_RELEASE_APPEND_STOPPED');
    assert.equal(result.retryAuthorized, false);
    assert.ok(typeof result.ambiguousWrite === 'boolean');
    uncertain = result.ambiguousWrite;
    const receipt = reply('TRUSTED_RELEASE_COLLECT_STOPPED', attempted, acknowledged, uncertain);
    await persist(directory, 'receipt.json', receipt);
    return receipt;
  } catch {
    const receipt = reply('TRUSTED_RELEASE_COLLECT_STOPPED', attempted, acknowledged, uncertain);
    try {
      if (phaseOwned) await persist(directory, 'receipt.json', receipt);
    } catch {
      /* Never retry or override uncertainty. */
    }
    return receipt;
  } finally {
    accessToken = undefined;
  }
}
