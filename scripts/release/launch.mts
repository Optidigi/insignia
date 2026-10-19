import type { ChildProcess } from 'node:child_process';
import { Writable } from 'node:stream';
import type { ReleaseVerificationRequest } from '../../apps/web/src/server/admin/release-verification.ts';
import { boolean, object, required, text } from './validation.mts';
export interface CollectorReceipt {
  version: string;
  classification: string;
  appendAttempted: boolean;
  appendAcknowledged: boolean;
  ambiguousWrite: boolean;
  retryAuthorized: boolean;
  signingAttempted: boolean;
  staffAuthorityGranted: boolean;
  sdkInternalHttpAttempts: string;
  deployedWasmServerDigest: string;
}
export interface LauncherReceipt {
  version: string;
  classification: string;
  appendAttempted: boolean;
  appendAcknowledged: boolean;
  ambiguousWrite: boolean;
  retryAuthorized: boolean;
}

/** Owner-only outer boundary. This source is NOT native qualification. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rmdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { qualifyVerifierArtifact } from '../../deployment/release-verifier/artifact.mts';
import {
  SESSION_CLIENT_SHA256,
  VERIFIER_AUTH_HOME,
  VERIFIER_CODE,
  VERIFIER_NODE,
  VERIFIER_SDK,
  VERIFIER_STATE,
} from './paths.mts';
import { readPrivatePacket } from './private-pipe.mts';
import { releaseProfile } from './profiles.mts';

export { readPrivatePacket } from './private-pipe.mts';

import { parseReleaseVerificationRequest } from '../../apps/web/src/server/admin/release-verification.ts';
import { recordPhaseName } from './collector.mts';
import { ownerPhaseForRecord, parseOwnerPrivatePacket } from './collector-native.mts';

const ROOT = VERIFIER_STATE;
const PREFIX = 'm5-trusted-release-collector-native-run-20261011';
const REPOSITORY = VERIFIER_CODE;
const SCRIPT = fileURLToPath(new URL('./collector-native.mts', import.meta.url));
const EXECUTABLE = VERIFIER_NODE;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const replyKeys = [
  'version',
  'classification',
  'appendAttempted',
  'appendAcknowledged',
  'ambiguousWrite',
  'retryAuthorized',
  'signingAttempted',
  'staffAuthorityGranted',
  'sdkInternalHttpAttempts',
  'deployedWasmServerDigest',
].sort();

async function privateDirectory(path: string) {
  const stat = await lstat(path);
  assert.ok(
    stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o700 && stat.uid === process.getuid?.(),
    'private_directory_required',
  );
  assert.equal(await realpath(path), resolve(path), 'private_directory_required');
}
async function privateJson(path: string, maximumBytes = 16384, canonical = false) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    assert.ok(
      stat.isFile() && (stat.mode & 0o777) === 0o600 && stat.uid === process.getuid?.() && stat.size <= maximumBytes,
      'private_record_required',
    );
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await handle.readFile());
    const value = object(JSON.parse(text));
    if (canonical) assert.equal(JSON.stringify(value), text, 'collector_record_not_canonical');
    return value;
  } finally {
    await handle.close();
  }
}
async function durable(path: string, value: unknown) {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const parent = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}
export function qualifyCollectorReceipt(input: unknown): CollectorReceipt {
  const value = object(input);
  assert.deepEqual(Object.keys(value).sort(), replyKeys, 'closed_receipt_required');
  assert.equal(value.version, 'm5-owner-trusted-release-collector-v1');
  assert.ok(
    ['TRUSTED_RELEASE_COLLECT_APPEND_ACK', 'TRUSTED_RELEASE_COLLECT_STOPPED'].includes(text(value.classification)),
  );
  for (const key of ['appendAttempted', 'appendAcknowledged', 'ambiguousWrite'])
    assert.equal(typeof value[key], 'boolean');
  assert.equal(value.retryAuthorized, false);
  assert.equal(value.signingAttempted, false);
  assert.equal(value.staffAuthorityGranted, false);
  assert.equal(value.sdkInternalHttpAttempts, 'NOT_ASSERTED');
  assert.equal(value.deployedWasmServerDigest, 'UNAVAILABLE_NOT_ASSERTED');
  assert.ok(!value.appendAcknowledged || value.appendAttempted);
  if (value.classification === 'TRUSTED_RELEASE_COLLECT_APPEND_ACK')
    assert.ok(value.appendAttempted && value.appendAcknowledged && !value.ambiguousWrite);
  return {
    version: text(value.version),
    classification: text(value.classification),
    appendAttempted: boolean(value.appendAttempted),
    appendAcknowledged: boolean(value.appendAcknowledged),
    ambiguousWrite: boolean(value.ambiguousWrite),
    retryAuthorized: boolean(value.retryAuthorized),
    signingAttempted: boolean(value.signingAttempted),
    staffAuthorityGranted: boolean(value.staffAuthorityGranted),
    sdkInternalHttpAttempts: text(value.sdkInternalHttpAttempts),
    deployedWasmServerDigest: text(value.deployedWasmServerDigest),
  };
}
const operations = [
  'READ_DURABLE_TENANT_OPEN',
  'AUTHENTICATE_EXISTING_MANAGEMENT_SESSION',
  'ActiveAppReleaseFromApiKey',
  'AppVersions',
  'AppVersionByTag',
  'CLIENT_CREDENTIALS_ONCE',
  'READ_NATIVE_INSTALLATION_OPEN',
  'READ_ORIGINAL_FUNCTION_OWNERSHIP',
  'READ_NATIVE_INSTALLATION_CLOSE',
  'AppVersions',
  'READ_DURABLE_TENANT_CLOSE',
  'APPEND_TRUSTED_RELEASE_ONCE',
];
async function inspectPhase(path: string) {
  try {
    await privateDirectory(path);
    const invocation = await privateJson(join(path, 'invocation.json'), 16384, true);
    assert.match(text(invocation.recordId), UUID);
    assert.ok(basename(path) === PREFIX || basename(path) === recordPhaseName(text(invocation.recordId)));
    assert.deepEqual(invocation, {
      version: 'm5-owner-collector-invocation-v1',
      recordId: invocation.recordId,
      sdkReadMethods: 4,
      ownerOAuthPosts: 1,
      ownerAdminSelectedReads: 3,
      appendCalls: 1,
      maximumDurationMs: 300000,
      sdkInternalHttpAttempts: 'NOT_ASSERTED',
      retryAuthorized: false,
    });
    const names = (await readdir(path)).filter((name) => name.startsWith('reservation-')).sort();
    assert.ok(names.length <= operations.length);
    let appendReserved = false;
    for (let index = 0; index < names.length; index++) {
      assert.equal(names[index], `reservation-${String(index + 1).padStart(2, '0')}.json`);
      const reservation = await privateJson(join(path, required(names[index])), 16384, true);
      const expectedKeys = ['version', 'ordinal', 'operation', 'reservedAt'];
      if (index === 11) expectedKeys.push('recordId', 'inputDigest');
      assert.deepEqual(Object.keys(reservation).sort(), expectedKeys.sort());
      assert.equal(reservation.version, 'm5-owner-collector-reservation-v1');
      assert.equal(reservation.ordinal, index + 1);
      assert.equal(reservation.operation, operations[index]);
      assert.equal(new Date(text(reservation.reservedAt)).toISOString(), reservation.reservedAt);
      if (index === 11) {
        assert.equal(reservation.recordId, invocation.recordId);
        assert.match(text(reservation.inputDigest), /^[0-9a-f]{64}$/);
        const observations = await privateJson(join(path, 'observations.json'), 1048576, true);
        assert.deepEqual(Object.keys(observations).sort(), [
          'activeObservation',
          'inputDigest',
          'moduleObservation',
          'readiness',
          'recordId',
        ]);
        assert.equal(observations.recordId, reservation.recordId);
        assert.equal(observations.inputDigest, reservation.inputDigest);
        appendReserved = true;
      }
    }
    let receipt: CollectorReceipt | undefined;
    try {
      receipt = qualifyCollectorReceipt(await privateJson(join(path, 'receipt.json'), 16384, true));
    } catch (error) {
      if (appendReserved || !(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    assert.ok(!receipt?.ambiguousWrite);
    assert.ok(!receipt?.appendAttempted || appendReserved);
    // A freshness failure after reservation but before the append is settled
    // no-write only when the collector's complete closed STOP receipt proves it.
    assert.ok(!appendReserved || receipt);
    return { phase: basename(path), appendReserved, settled: Boolean(receipt) };
  } catch {
    throw new Error('prior_settlement_unknown');
  }
}
/** Only own phase names are inspected; no unrelated captures are opened. */
export async function inspectPriorCollectorSettlement(parent: string) {
  await privateDirectory(parent);
  const phases = [];
  for (const name of await readdir(parent)) {
    if (name !== PREFIX && !name.startsWith(`${PREFIX}-`)) continue;
    if (name !== PREFIX && !UUID.test(name.slice(PREFIX.length + 1))) throw new Error('prior_settlement_unknown');
    phases.push(await inspectPhase(join(parent, name)));
  }
  return phases;
}

function launcherReceiptForCollector(collector: CollectorReceipt): LauncherReceipt {
  return {
    version: 'm5-owner-trusted-release-launch-v1',
    classification: collector.classification,
    ambiguousWrite: collector.ambiguousWrite,
    appendAttempted: collector.appendAttempted,
    appendAcknowledged: collector.appendAcknowledged,
    retryAuthorized: false,
  };
}
function qualifyLauncherReceipt(input: unknown): LauncherReceipt {
  const value = object(input);
  assert.deepEqual(Object.keys(value).sort(), [
    'ambiguousWrite',
    'appendAcknowledged',
    'appendAttempted',
    'classification',
    'retryAuthorized',
    'version',
  ]);
  assert.equal(value.version, 'm5-owner-trusted-release-launch-v1');
  assert.ok(
    ['TRUSTED_RELEASE_COLLECT_APPEND_ACK', 'TRUSTED_RELEASE_COLLECT_STOPPED', 'OWNER_PROCESS_TIMEOUT'].includes(
      text(value.classification),
    ),
  );
  for (const key of ['appendAttempted', 'appendAcknowledged', 'ambiguousWrite'])
    assert.equal(typeof value[key], 'boolean');
  assert.equal(value.retryAuthorized, false);
  assert.ok(!value.ambiguousWrite);
  assert.ok(!value.appendAcknowledged || value.appendAttempted);
  if (value.classification === 'TRUSTED_RELEASE_COLLECT_APPEND_ACK')
    assert.ok(value.appendAttempted && value.appendAcknowledged);
  if (value.classification === 'OWNER_PROCESS_TIMEOUT') assert.ok(!value.appendAttempted && !value.appendAcknowledged);
  return {
    version: text(value.version),
    classification: text(value.classification),
    appendAttempted: boolean(value.appendAttempted),
    appendAcknowledged: boolean(value.appendAcknowledged),
    ambiguousWrite: boolean(value.ambiguousWrite),
    retryAuthorized: boolean(value.retryAuthorized),
  };
}

/** Stopped bridge transition only. Caller holds the existing exclusive launch
 * fence; every prior collector and launcher must have an unambiguous receipt. */
export async function inspectPriorBridgeHandoverSettlement(parent: string) {
  try {
    const phases = await inspectPriorCollectorSettlement(parent);
    assert.ok(phases.every((phase) => phase.settled));
    const prefix = 'm5-trusted-release-launch-intent-';
    for (const name of await readdir(parent)) {
      if (!name.startsWith(prefix)) continue;
      const recordId = name.slice(prefix.length);
      assert.match(recordId, UUID);
      const path = join(parent, name);
      await privateDirectory(path);
      const intent = await privateJson(join(path, 'intent.json'), 1048576);
      assert.equal(intent.version, 'm5-owner-trusted-release-launch-intent-v1');
      assert.equal(intent.recordId, recordId);
      assert.equal(intent.retryAuthorized, false);
      assert.equal(intent.childPhase, recordPhaseName(recordId));
      assert.ok(phases.some((phase) => phase.phase === intent.childPhase));
      const receipt = qualifyLauncherReceipt(await privateJson(join(path, 'receipt.json')));
      const collector = qualifyCollectorReceipt(
        await privateJson(join(parent, text(intent.childPhase), 'receipt.json'), 16384, true),
      );
      if (receipt.classification === 'OWNER_PROCESS_TIMEOUT') {
        // The wrapper can time out after the child has durably closed without
        // appending. Its timeout remains history; only that proven no-effect
        // settlement permits handover, never replay of an unresolved append.
        assert.equal(collector.classification, 'TRUSTED_RELEASE_COLLECT_STOPPED');
        assert.ok(!collector.appendAttempted && !collector.appendAcknowledged && !collector.ambiguousWrite);
        assert.ok(phases.some((phase) => phase.phase === intent.childPhase && !phase.appendReserved));
      } else assert.deepEqual(receipt, launcherReceiptForCollector(collector));
    }
    return phases;
  } catch {
    throw new Error('prior_settlement_unknown');
  }
}

/** Real process seam; the production caller supplies only its fixed child.
 * Test ports may spawn synthetic processes, never used by executable main. */
export async function runBoundedCollectorProcess({
  verificationRequest,
  packet,
  phaseRoot,
  recordId,
  spawnChild,
  timeoutMs = 300000,
  maximumBytes = 1048576,
  profileName,
}: {
  verificationRequest?: ReleaseVerificationRequest;
  packet: Buffer;
  phaseRoot: string;
  recordId: string;
  spawnChild?: (options: {
    executable: string;
    script: string;
    env: NodeJS.ProcessEnv;
    profileName?: string;
  }) => ChildProcess;
  timeoutMs?: number;
  maximumBytes?: number;
  profileName?: string;
}): Promise<LauncherReceipt> {
  releaseProfile(profileName);
  assert.ok(timeoutMs > 0 && timeoutMs <= 300000 && maximumBytes > 0 && maximumBytes <= 1048576);
  recordPhaseName(recordId);
  if (verificationRequest)
    verificationRequest = parseReleaseVerificationRequest(verificationRequest, releaseProfile(profileName).versionId);
  const childPhase = join(phaseRoot, recordPhaseName(recordId));
  const env = {
    HOME: VERIFIER_AUTH_HOME,
    PATH: `${dirname(EXECUTABLE)}:/usr/bin:/bin`,
    LANG: 'C.UTF-8',
    TERM: 'dumb',
    ...(verificationRequest ? { INSIGNIA_RELEASE_VERIFICATION_FD: '3' } : {}),
  };
  const child = spawnChild
    ? spawnChild({ executable: EXECUTABLE, script: SCRIPT, env, ...(profileName ? { profileName } : {}) })
    : spawn(EXECUTABLE, [SCRIPT, ...(profileName ? [profileName] : [])], {
        cwd: REPOSITORY,
        env,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe', ...(verificationRequest ? ['pipe' as const] : [])],
      });
  const input = required(child.stdin),
    output = required(child.stdout),
    errors = required(child.stderr);
  let total = 0;
  const chunks: Buffer[] = [];
  let stopped = false,
    reason = 'PRIVATE_OWNER_COLLECTION_UNQUALIFIED';
  const kill = () => {
    try {
      process.kill(-required(child.pid), 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {}
    }
  };
  const stop = (why: string) => {
    if (stopped) return;
    stopped = true;
    reason = why;
    kill();
  };
  const timer = setTimeout(() => stop('OWNER_PROCESS_TIMEOUT'), timeoutMs);
  const consume = (chunk: unknown, stdout: boolean) => {
    if (!Buffer.isBuffer(chunk)) {
      stop('OWNER_PROCESS_UNQUALIFIED');
      return;
    }
    total += chunk.length;
    if (total > maximumBytes) {
      stop('OWNER_PROCESS_OUTPUT_LIMIT');
      return;
    }
    if (stdout) chunks.push(Buffer.from(chunk));
  };
  output.on('data', (chunk: unknown) => consume(chunk, true));
  errors.on('data', (chunk: unknown) => consume(chunk, false));
  input.on('error', () => stop('OWNER_PROCESS_UNQUALIFIED'));
  let code: number | null;
  try {
    const exited = new Promise<number | null>((resolveExit) => {
      child.once('error', () => {
        stop('OWNER_PROCESS_UNQUALIFIED');
        resolveExit(null);
      });
      child.once('close', (exitCode: number | null) => resolveExit(exitCode));
    });
    if (verificationRequest) {
      const requestPipe = child.stdio[3];
      assert.ok(requestPipe instanceof Writable);
      requestPipe.on('error', () => stop('OWNER_PROCESS_UNQUALIFIED'));
      requestPipe.end(JSON.stringify(verificationRequest));
    }
    input.end(packet);
    code = await exited;
  } finally {
    clearTimeout(timer);
    // A successful leader may still leave descendants; kill the group always.
    kill();
  }
  let selected: CollectorReceipt | undefined;
  if (!stopped) {
    try {
      const bytes = Buffer.concat(chunks);
      try {
        selected = qualifyCollectorReceipt(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()));
      } finally {
        bytes.fill(0);
      }
      assert.equal(code, selected.classification === 'TRUSTED_RELEASE_COLLECT_APPEND_ACK' ? 0 : 1);
      const durableReceipt = qualifyCollectorReceipt(await privateJson(join(childPhase, 'receipt.json')));
      assert.deepEqual(selected, durableReceipt);
      await inspectPhase(childPhase);
    } catch {
      selected = undefined;
    }
  }
  for (const chunk of chunks) chunk.fill(0);
  packet.fill(0);
  if (selected) return launcherReceiptForCollector(selected);
  let appendReserved = false;
  try {
    for (const name of await readdir(childPhase))
      if (/^reservation-[0-9]{2}\.json$/.test(name)) {
        const value = await privateJson(join(childPhase, name));
        if (value.operation === 'APPEND_TRUSTED_RELEASE_ONCE') appendReserved = true;
      }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) appendReserved = true;
  }
  return {
    version: 'm5-owner-trusted-release-launch-v1',
    classification: reason,
    ambiguousWrite: appendReserved,
    appendAttempted: appendReserved,
    appendAcknowledged: false,
    retryAuthorized: false,
  };
}

const ORIGINAL_SDK = VERIFIER_SDK;
export const SOURCE_PATHS = [
  'scripts/release/launch.mts',
  'scripts/release/launch.test.mts',
  'scripts/release/private-pipe.mts',
  'scripts/release/paths.mts',
  'scripts/release/validation.mts',
  'scripts/release/collector-fixture.mts',
  'scripts/release/boundary-fixture.mts',
  'scripts/release/serve.mts',
  'scripts/release/server.mts',
  'apps/web/src/server/admin/release-verification.ts',
  ...[
    'collector-native',
    'collector',
    'collector.test',
    'management-process',
    'management-worker',
    'owner-https',
    'owner-boundaries.test',
  ].map((name) => `scripts/release/${name}.mts`),
  'scripts/release/append.mts',
  'scripts/release/profiles.mts',
  'deployment/m8-journey/release-module-baseline.json',
  'deployment/m8-journey/release-binding.json',
  'deployment/m8-journey/app-proxy-module-baseline.json',
  'deployment/m8-journey/app-proxy-release-binding.json',
  'deployment/m8-journey/theme-module-baseline.json',
  'deployment/m8-journey/theme-release-binding.json',
  'deployment/m8-journey/cookie-theme-module-baseline.json',
  'deployment/m8-journey/cookie-theme-release-binding.json',
  'deployment/m8-journey/preview-theme-module-baseline.json',
  'deployment/m8-journey/preview-theme-release-binding.json',
  'deployment/m8-journey/lean-markets-module-baseline.json',
  'deployment/m8-journey/lean-markets-release-binding.json',
  'deployment/m8-journey/lean-privacy-module-baseline.json',
  'deployment/m8-journey/lean-privacy-release-binding.json',
  'deployment/m5-runtime/native-function-module-baseline.json',
  'deployment/m5-runtime/native-function-module-binding.json',
  'apps/web/package.json',
  'pnpm-lock.yaml',
];
const sdkPins = new Map([
  [
    `${ORIGINAL_SDK}/package/dist/chunk-MJ3WNVMQ.js`,
    '29df2593b46ba4b7162ef703dfdbea2175e2e55d6824df2ade708eff35432fea',
  ],
  [
    `${ORIGINAL_SDK}/package/dist/chunk-NYHGIWKZ.js`,
    'a89873a128c3044b0870f2a82788a7e4d8f8642e9bb4bfcb0c0f0d4abc380d7a',
  ],
  [`${ORIGINAL_SDK}/existing-session-qualification/client.mjs`, SESSION_CLIENT_SHA256],
]);
export function qualifyCodeInputPath(path: string) {
  assert.equal(resolve(path), path, 'input_path_unqualified');
  assert.ok(
    path === EXECUTABLE || path.startsWith(`${REPOSITORY}/`) || path.startsWith(`${ORIGINAL_SDK}/`),
    'input_path_unqualified',
  );
  assert.ok(path === EXECUTABLE || /\.(?:mjs|cjs|js|ts|mts|cts|json|node|yaml)$/.test(path), 'code_input_required');
  assert.ok(
    !/^(?:\.env.*|auth\.json|session\.json|context\.json)$/.test(basename(path)),
    'private_auth_input_forbidden',
  );
}
/** The fixed private qualification is owner-frozen AFTER source/build review.
 * No caller executable/path is accepted by the production stdin protocol. */
export async function qualifyLaunchInputs(input: unknown) {
  const qualification = object(input);
  assert.deepEqual(Object.keys(qualification).sort(), ['manifestSha256', 'version']);
  assert.equal(qualification.version, 'insignia-release-verifier-identity-v1');
  const manifest = await qualifyVerifierArtifact(REPOSITORY, text(qualification.manifestSha256));
  for (const path of SOURCE_PATHS) assert.ok(Object.hasOwn(manifest.files, path), 'required_source_input_missing');
  for (const [path, expected] of sdkPins) {
    const relativePath = path.slice(REPOSITORY.length + 1);
    const entry = manifest.files[relativePath];
    assert.ok(entry?.kind === 'file', 'original_sdk_changed');
    assert.equal(entry.sha256, expected, 'original_sdk_changed');
  }
  assert.ok(manifest.files['bin/node'], 'fixed_runtime_missing');
  const require = createRequire(new URL('../../worker/package.json', import.meta.url));
  for (const name of ['database', 'shopify']) {
    const entry = await realpath(require.resolve(`@insignia/${name}`));
    assert.ok(
      entry.startsWith(`${REPOSITORY}/`) && manifest.files[entry.slice(REPOSITORY.length + 1)],
      'built_runtime_missing',
    );
  }
  return {
    reviewedHead: manifest.sourceHead,
    reviewedTree: manifest.sourceTree,
    inputInventoryDigest: qualification.manifestSha256,
  };
}

export async function launchQualifiedTrustedRelease(
  packetBytes: Buffer,
  verificationRequest?: ReleaseVerificationRequest,
  profileName?: string,
) {
  releaseProfile(profileName);
  if (verificationRequest) {
    verificationRequest = parseReleaseVerificationRequest(verificationRequest, releaseProfile(profileName).versionId);
    assert.ok(verificationRequest.deadlineMs > Date.now() && verificationRequest.deadlineMs <= Date.now() + 300000);
  }
  assert.equal(process.execPath, EXECUTABLE, 'fixed_runtime_required');
  assert.equal(process.version, 'v24.21.0', 'fixed_runtime_required');
  await privateDirectory(ROOT);
  const packet = parseOwnerPrivatePacket(new TextDecoder('utf-8', { fatal: true }).decode(packetBytes));
  const recordId = packet.recordId;
  for (const name of ['databaseUrl', 'clientSecret', 'appendPassword']) Reflect.set(packet, name, undefined);
  const lock = join(ROOT, 'm5-trusted-release-launch-exclusive');
  await mkdir(lock, { mode: 0o700 }); // Crashed/active launcher never silently reclaimed.
  try {
    await inspectPriorCollectorSettlement(ROOT);
    try {
      await lstat(ownerPhaseForRecord(recordId));
      throw new Error('fresh_intent_required');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const qualified = await qualifyLaunchInputs(await privateJson(join(REPOSITORY, 'identity.json'), 16384));
    const intent = join(ROOT, `m5-trusted-release-launch-intent-${recordId}`);
    await mkdir(intent, { mode: 0o700 });
    await durable(join(intent, 'intent.json'), {
      version: 'm5-owner-trusted-release-launch-intent-v1',
      recordId,
      ...qualified,
      childPhase: basename(ownerPhaseForRecord(recordId)),
      ...(verificationRequest ? { verificationRequest } : {}),
      maximumSeconds: 300,
      maximumOutputBytes: 1048576,
      at: new Date().toISOString(),
      retryAuthorized: false,
    });
    const receipt = await runBoundedCollectorProcess({
      packet: packetBytes,
      phaseRoot: ROOT,
      recordId,
      verificationRequest,
      profileName,
      timeoutMs: verificationRequest
        ? Math.max(1, Math.min(300000, verificationRequest.deadlineMs - Date.now()))
        : 300000,
    });
    await durable(join(intent, 'receipt.json'), receipt);
    return receipt;
  } finally {
    packetBytes.fill(0);
    // Receipt/child settlement remain durably fenced. A killed owner retains
    // this exclusive directory, requiring explicit offline reconciliation.
    await rmdir(lock);
  }
}

async function main() {
  const emit = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  for (const name of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir'] as const) console[name] = () => {};
  let packet: Buffer | undefined;
  try {
    assert.ok(process.argv.length <= 3, 'stdin_and_reviewed_profile_only');
    const profileName = process.argv[2];
    releaseProfile(profileName);
    packet = await readPrivatePacket(process.stdin);
    const receipt = await launchQualifiedTrustedRelease(packet, undefined, profileName);
    emit(`${JSON.stringify(receipt)}\n`);
    if (receipt.classification !== 'TRUSTED_RELEASE_COLLECT_APPEND_ACK') process.exitCode = 1;
  } catch {
    emit(
      '{"version":"m5-owner-trusted-release-launch-v1","classification":"OWNER_PREFLIGHT_UNQUALIFIED","retryAuthorized":false}\n',
    );
    process.exitCode = 1;
  } finally {
    packet?.fill(0);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
