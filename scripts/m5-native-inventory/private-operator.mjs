import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, lstat, mkdir, open, readFile, realpath, rename } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';

const privateHttpsRequest = https.request;

import { dirname, join, resolve } from 'node:path';
import { collectInventory } from './collector.mjs';
import { privateResponseCategory } from './private-response.mjs';

const DOMAIN = 'insignia-rewrite-dev.myshopify.com';
const CLIENT = '1443cf6d03d39edae7c101a943c5c684';
const ORIGIN = `https://${DOMAIN}`;
const ADMIN = '/admin/api/2026-07/graphql.json';
const OAUTH = '/admin/oauth/access_token';
const HOME = '/home/serveradmin/insignia-milestone-autonomy-handoff';
const GRANT = join(HOME, 'owner-token-inventory-allocation-20261010.json');
const NATIVE_PHASE = join(HOME, 'native-token-inventory-20261010');
const KEY = '/home/serveradmin/.ssh/id_t3_prod';
const KNOWN = join(HOME, 'native-readonly-access-20261009/known_hosts');
const FINGERPRINT = 'vttVPAISQypNdyfjFElTJ6ef8Q5S2YlC+XoUn599uq4';
const IMAGE = 'sha256:8aa439cb733160ce6b99165e8401cfbc60f612851aeef0d76735db92917dc3f5';
const SOURCES = ['private-operator.mjs', 'private-response.mjs', 'collector.mjs', 'private-cli.mjs'];
const QUALIFICATION = 'STOP_PRE_INSTALL_DESTINATION_EFFECTS_UNQUALIFIED';
const DOCKER_TEMPLATE =
  '[{{json .Image}}{{range .Config.Env}}{{if or (eq (index (split . "=") 0) "SHOPIFY_CLIENT_SECRET") (eq (index (split . "=") 0) "SHOPIFY_CLIENT_ID") (eq (index (split . "=") 0) "APP_URL")}},{{json .}}{{end}}{{end}}]';
export const PRIVATE_DOCKER_COMMAND = `/usr/bin/env -i /usr/bin/docker --host unix:///var/run/docker.sock --config /nonexistent inspect --format '${DOCKER_TEMPLATE}' insignia-rewrite-m5-019-web`;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (category) => {
  throw new Error(category);
};
const result = (outcome, state) => ({
  outcome,
  oauthAttempts: state?.attempts.filter((a) => a.kind === 'OAUTH').length ?? 0,
  requests: state?.attempts.filter((a) => a.kind === 'ADMIN').length ?? 0,
  qualification: QUALIFICATION,
});
// Never supply a native transport through a mutable global fetch fallback.
const denied = () => {
  throw new Error('network_escape_denied');
};
globalThis.fetch = () => Promise.reject(new Error('network_escape_denied'));
http.request = denied;
http.get = denied;
https.request = denied;
https.get = denied;
syncBuiltinESMExports();

async function privateFile(path, maximum = 65536) {
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await f.stat();
    if (!s.isFile() || s.uid !== process.getuid() || s.mode & 0o077 || s.size > maximum) fail('STOP_PRIVATE_INPUT');
    const bytes = await f.readFile();
    if (bytes.length > maximum) fail('STOP_PRIVATE_INPUT');
    return bytes;
  } finally {
    await f.close();
  }
}
async function privateParent(path) {
  if (resolve(path) !== path) fail('STOP_PRIVATE_PATH');
  const s = await lstat(path);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    s.uid !== process.getuid() ||
    (s.mode & 0o777) !== 0o700 ||
    (await realpath(path)) !== path
  )
    fail('STOP_PRIVATE_PATH');
}
async function durable(path, value) {
  const f = await open(path, 'wx', 0o600);
  try {
    await f.writeFile(JSON.stringify(value));
    await f.sync();
  } finally {
    await f.close();
  }
  const d = await open(dirname(path), 'r');
  try {
    await d.sync();
  } finally {
    await d.close();
  }
}
async function journal(path, state) {
  const pending = join(path, 'phase.pending');
  await durable(pending, state);
  await rename(pending, join(path, 'phase.json'));
  const d = await open(path, 'r');
  try {
    await d.sync();
  } finally {
    await d.close();
  }
}
async function childBytes(executable, args, timeout, cap) {
  const child = spawn(executable, args, { env: {}, stdio: ['ignore', 'pipe', 'ignore'] });
  let bytes = Buffer.alloc(0),
    invalid = false;
  const timer = setTimeout(() => {
    invalid = true;
    child.kill('SIGKILL');
  }, timeout);
  child.stdout.on('data', (chunk) => {
    if (bytes.length + chunk.length > cap) {
      invalid = true;
      child.kill('SIGKILL');
    } else bytes = Buffer.concat([bytes, chunk]);
  });
  try {
    const exit = await new Promise((r, j) => {
      child.once('error', j);
      child.once('close', (code, signal) => r({ code, signal }));
    });
    if (invalid || exit.code !== 0 || exit.signal) {
      bytes.fill(0);
      fail('STOP_PRIVATE_PRODUCER_UNCERTAIN');
    }
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}
async function pinnedProducer(timeout) {
  // Public host key pinned independently of DNS. No TOFU, forwarding or agent use.
  const bytes = await privateFile(KNOWN);
  const lines = bytes.toString('utf8').trim().split('\n');
  const fields = lines[0]?.split(/\s+/);
  if (
    lines.length !== 1 ||
    fields.length !== 3 ||
    fields[0] !== '65.109.22.104' ||
    fields[1] !== 'ssh-ed25519' ||
    createHash('sha256').update(Buffer.from(fields[2], 'base64')).digest('base64').replace(/=+$/, '') !== FINGERPRINT
  )
    fail('STOP_HOST_PIN');
  const key = await lstat(KEY);
  if (!key.isFile() || key.isSymbolicLink() || key.uid !== process.getuid() || key.mode & 0o077)
    fail('STOP_PRIVATE_KEY_PERMISSION');
  return childBytes(
    '/usr/bin/ssh',
    [
      '-F',
      '/dev/null',
      '-i',
      KEY,
      '-p',
      '22',
      '-o',
      'BatchMode=yes',
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'IdentityAgent=none',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      `UserKnownHostsFile=${KNOWN}`,
      '-o',
      'GlobalKnownHostsFile=/dev/null',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'ConnectionAttempts=1',
      '-o',
      'ForwardAgent=no',
      '-o',
      'ClearAllForwardings=yes',
      '-o',
      'RequestTTY=no',
      'serveradmin@65.109.22.104',
      PRIVATE_DOCKER_COMMAND,
    ],
    timeout,
    16384,
  );
}
function httpsBytes({ endpoint, body, headers, limit, timeout, ca }) {
  return new Promise((resolveRequest) => {
    let response,
      size = 0,
      chunks = [],
      done = false,
      timer;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const bytes = Buffer.concat(chunks);
      chunks = [];
      resolveRequest({ status: response?.statusCode ?? null, headers: response?.headers ?? {}, body: bytes, error });
      if (error) {
        response?.destroy();
        req.destroy();
      }
    };
    const req = privateHttpsRequest(
      endpoint,
      {
        method: 'POST',
        agent: false,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        maxHeaderSize: 16384,
        ...(ca ? { ca } : {}),
        headers: { ...headers, 'content-length': body.length },
      },
      (res) => {
        response = res;
        if (Number(res.headers['content-length']) > limit) {
          finish('STOP_RESPONSE_TOO_LARGE');
          return;
        }
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > limit) finish('STOP_RESPONSE_TOO_LARGE');
          else chunks.push(chunk);
        });
        res.once('error', () => finish('STOP_TRANSPORT_UNCERTAIN'));
        res.once('aborted', () => finish('STOP_TRANSPORT_UNCERTAIN'));
        res.once('end', () => finish(res.complete ? undefined : 'STOP_TRANSPORT_UNCERTAIN'));
      },
    );
    req.once('error', () => finish('STOP_TRANSPORT_UNCERTAIN'));
    timer = setTimeout(() => finish('STOP_RESPONSE_TIMEOUT'), timeout);
    req.end(body);
  });
}
function same(a, b) {
  return Array.isArray(a) && new Set(a).size === a.length && a.length === b.length && a.every((x) => b.includes(x));
}
async function gateInput(gatePath, testFixture) {
  await privateParent(dirname(gatePath));
  const gate = JSON.parse(await privateFile(gatePath));
  if (
    gate.schema !== 'insignia-private-inventory-gate-v1' ||
    gate.tokenOperationalQualification !== 'SUPPORTED_EXACT_STORE_ISSUANCE_OWNER_ALLOCATED' ||
    gate.tokenLifecycleGuarantee !== 'UNKNOWN_NOT_ASSERTED' ||
    !same(gate.expectedGrants, ['write_products', 'read_publications', 'read_product_listings']) ||
    !Number.isFinite(Date.parse(gate.validUntil)) ||
    Date.parse(gate.validUntil) <= Date.now() ||
    !Number.isFinite(Date.parse(gate.retentionDeleteBy)) ||
    Date.parse(gate.retentionDeleteBy) <= Date.now() ||
    Date.parse(gate.retentionDeleteBy) > Date.now() + 7 * 86400000
  )
    fail('STOP_GATE');
  if (testFixture) {
    if (gate.status !== 'LOOPBACK_TEST') fail('STOP_GATE');
    const u = new URL(testFixture.origin);
    if (
      u.protocol !== 'https:' ||
      u.hostname !== '127.0.0.1' ||
      !u.port ||
      u.pathname !== '/' ||
      u.search ||
      u.hash ||
      u.username ||
      u.password ||
      !testFixture.ca ||
      !Array.isArray(testFixture.producer) ||
      testFixture.producer[0] !== process.execPath
    )
      fail('STOP_LOCAL_FIXTURE');
    return {
      gate,
      path: testFixture.phaseDirectory,
      origin: u.origin,
      producer: () => childBytes(process.execPath, testFixture.producer.slice(1), 5000, 16384),
      ca: testFixture.ca,
    };
  }
  if (
    gate.status !== 'FROZEN_NATIVE_GATE' ||
    gate.ownerGrantSha256 !== sha(await privateFile(GRANT)) ||
    gate.appId !== '429028933633' ||
    gate.clientId !== CLIENT ||
    gate.shopDomain !== DOMAIN ||
    gate.currentActiveVersion !== '1158986629121' ||
    gate.currentSameOrganization !== true ||
    gate.currentDesignatedInstallationPresent !== true ||
    gate.specReview !== 'CLEAR' ||
    gate.securityReview !== 'CLEAR' ||
    gate.exactSourceCI !== 'ATTEMPT_1_SUCCESS'
  )
    fail('STOP_NATIVE_PREMISES_UNQUALIFIED');
  const grant = JSON.parse(await privateFile(GRANT));
  if (
    grant.status !== 'OWNER_GRANTED_CONDITIONAL_ONE_TOKEN_PLUS_THREE_READS' ||
    grant.resource.clientId !== CLIENT ||
    grant.resource.shopDomain !== DOMAIN ||
    grant.ceilings.tokenAcquisitionAttempts !== 1 ||
    grant.ceilings.adminRequests !== 3 ||
    grant.ceilings.retries !== 0
  )
    fail('STOP_OWNER_ALLOCATION');
  for (const name of SOURCES)
    if (gate.sourceSha256?.[name] !== sha(await readFile(join(import.meta.dirname, name)))) fail('STOP_SOURCE_FREEZE');
  return { gate, path: NATIVE_PHASE, origin: ORIGIN, producer: pinnedProducer };
}

export async function runPrivateInventory({ gatePath, testFixture }) {
  let state, phase, secret, token;
  try {
    const input = await gateInput(gatePath, testFixture);
    phase = input.path;
    await privateParent(dirname(phase));
    try {
      await mkdir(phase, { mode: 0o700 });
    } catch (error) {
      if (error.code === 'EEXIST') return { ...(await inspectPrivatePhase(phase)), outcome: 'STOP_PHASE_ALREADY_USED' };
      throw error;
    }
    const phaseParent = await open(dirname(phase), 'r');
    try {
      await phaseParent.sync();
    } finally {
      await phaseParent.close();
    }
    state = {
      schema: 'insignia-private-inventory-phase-v1',
      pid: process.pid,
      ownerGrant: '20261010_ONE_TOKEN_THREE_READS',
      startedAt: new Date().toISOString(),
      sealed: false,
      attempts: [],
    };
    await journal(phase, state);
    const deadline = Math.min(
      Date.parse(input.gate.validUntil),
      Date.parse(input.gate.retentionDeleteBy),
      Date.now() + 1800000,
    );
    const remaining = () => {
      const ms = Math.min(30000, deadline - Date.now());
      if (ms <= 0) fail('STOP_PHASE_DEADLINE');
      return ms;
    };
    const reserve = async (kind, operation) => {
      remaining();
      const maximum = kind === 'ADMIN' ? 3 : 1;
      if (state.attempts.filter((a) => a.kind === kind).length >= maximum) fail('STOP_PHASE_CEILING');
      const attempt = { number: state.attempts.length + 1, kind, operation, status: 'RESERVED' };
      state.attempts.push(attempt);
      await journal(phase, state);
      remaining();
      return attempt;
    };
    const complete = async (attempt, status) => {
      attempt.status = status;
      await journal(phase, state);
    };
    const producer = await reserve('SSH', 'EXACT_CONTAINER_SECRET_PROJECTION');
    const raw = await input.producer(remaining());
    let packet;
    try {
      const projection = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
      if (
        !Array.isArray(projection) ||
        projection.length !== 4 ||
        projection.some((value) => typeof value !== 'string')
      )
        fail('STOP_PRODUCER_IDENTITY_OR_SHAPE');
      const selected = {};
      for (const value of projection.slice(1)) {
        const index = value.indexOf('=');
        const name = value.slice(0, index);
        if (
          index < 1 ||
          !['SHOPIFY_CLIENT_SECRET', 'SHOPIFY_CLIENT_ID', 'APP_URL'].includes(name) ||
          Object.hasOwn(selected, name)
        )
          fail('STOP_PRODUCER_IDENTITY_OR_SHAPE');
        selected[name] = value.slice(index + 1);
      }
      packet = {
        image: projection[0],
        secret: selected.SHOPIFY_CLIENT_SECRET,
        clientId: selected.SHOPIFY_CLIENT_ID,
        appUrl: selected.APP_URL,
      };
    } finally {
      raw.fill(0);
    }
    if (
      Object.keys(packet).length !== 4 ||
      packet.clientId !== CLIENT ||
      packet.appUrl !== 'https://insignia-app.optidigi.nl' ||
      packet.image !== IMAGE ||
      typeof packet.secret !== 'string' ||
      !packet.secret ||
      packet.secret.length > 4096 ||
      /[\r\n\0]/.test(packet.secret)
    )
      fail('STOP_PRODUCER_IDENTITY_OR_SHAPE');
    secret = packet.secret;
    packet.secret = undefined;
    await complete(producer, 'RECEIVED_EPHEMERAL');
    const attempt = await reserve('OAUTH', 'EXISTING_APP_CLIENT_CREDENTIALS');
    const body = Buffer.from(
      new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT, client_secret: secret }).toString(),
    );
    let response;
    try {
      response = await httpsBytes({
        endpoint: `${input.origin}${OAUTH}`,
        body,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        limit: 16384,
        timeout: remaining(),
        ca: input.ca,
      });
    } finally {
      body.fill(0);
    }
    await complete(attempt, response.error ? 'UNCERTAIN' : 'RECEIVED_EPHEMERAL');
    let acquired;
    try {
      if (response.error) fail(response.error);
      if (
        response.status !== 200 ||
        !/^application\/json(?:\s*;.*)?$/i.test(response.headers['content-type'] ?? '') ||
        ![undefined, 'identity'].includes(response.headers['content-encoding'])
      )
        fail('STOP_OAUTH_HTTP_OR_CONTRACT');
      if (privateResponseCategory(response.body, [secret])) fail('STOP_OAUTH_RESPONSE_WITHHELD');
      acquired = JSON.parse(response.body);
      if (
        Object.keys(acquired).length !== 3 ||
        !['access_token', 'scope', 'expires_in'].every((key) => Object.hasOwn(acquired, key)) ||
        typeof acquired.access_token !== 'string' ||
        !acquired.access_token ||
        acquired.access_token.length > 4096 ||
        /[\r\n\0]/.test(acquired.access_token) ||
        typeof acquired.scope !== 'string' ||
        !Number.isInteger(acquired.expires_in) ||
        acquired.expires_in < Math.ceil((deadline - Date.now()) / 1000) + 5 ||
        acquired.expires_in > 86400
      )
        fail('STOP_OAUTH_RESPONSE_CONTRACT');
      const scopes = acquired.scope.split(',').map((scope) => scope.trim());
      if (!same(scopes, input.gate.expectedGrants)) fail('STOP_OAUTH_SCOPE_DRIFT');
      token = acquired.access_token;
      acquired.access_token = undefined;
    } finally {
      response.body.fill(0);
    }
    const allocation = {
      schema: 'insignia-native-inventory-allocation-v2',
      status: 'OWNER_ALLOCATED',
      ownerApprovalReference: 'OWNER_GRANTED_20261010_ONE_TOKEN_THREE_READS',
      purpose: 'M5-027 existing shop subscription read',
      endpoint: `${ORIGIN}${ADMIN}`,
      expectedShopId: null,
      expectedInstallationId: null,
      expectedGrants: input.gate.expectedGrants,
      requiredScopes: [],
      optionalScopes: ['write_products', 'read_publications', 'read_product_listings'],
      allowedOperations: ['M5027WebhookInventory', 'M5027InstallationBoundary'],
      allowedMutations: [],
      incidentalEffects: ['provider-access-audit'],
      privateCredentialChannel: 'private-process-pipe-and-memory',
      credentialCapability: 'EXISTING_SUPPORTED_EXACT_APP_ADMIN_TOKEN',
      privateEvidenceDirectory: join(phase, 'admin'),
      retentionOwner: 'Insignia owner/local orchestrator',
      retentionDeleteBy: input.gate.retentionDeleteBy,
      validUntil: new Date(deadline).toISOString(),
      ceilings: {
        requests: 3,
        pages: 2,
        records: 500,
        responseBytes: 1048576,
        durationMs: deadline - Date.now(),
        responseTimeoutMs: 30000,
      },
    };
    const inventory = await collectInventory({
      allocation,
      token,
      privateDirectory: allocation.privateEvidenceDirectory,
      transport: async (endpoint, suppliedToken, document, limit, timeout) => {
        if (
          endpoint !== `${ORIGIN}${ADMIN}` ||
          suppliedToken !== token ||
          !['M5027WebhookInventory', 'M5027InstallationBoundary'].includes(document.operationName)
        )
          fail('STOP_PRIVATE_TRANSPORT_BOUNDARY');
        const reserved = await reserve('ADMIN', document.operationName);
        const adminResponse = await httpsBytes({
          endpoint: `${input.origin}${ADMIN}`,
          body: Buffer.from(JSON.stringify(document)),
          headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
          limit,
          timeout: Math.min(timeout, remaining()),
          ca: input.ca,
        });
        await complete(reserved, adminResponse.error ? 'UNCERTAIN' : 'RECEIVED');
        const category = privateResponseCategory(adminResponse.body, [secret, token]);
        if (category || adminResponse.error) {
          adminResponse.body.fill(0);
          adminResponse.body = Buffer.alloc(0);
          adminResponse.error =
            category === 'SECRET_REFLECTION'
              ? 'STOP_SECRET_REFLECTION'
              : (adminResponse.error ?? 'STOP_RESPONSE_CONTRACT');
        }
        return adminResponse;
      },
    });
    state.sealed = true;
    state.outcome = inventory.outcome;
    await journal(phase, state);
    return { ...inventory, ...result(inventory.outcome, state), requestAccounting: 'SHARED_DURABLE_RESERVED_ATTEMPTS' };
  } catch (error) {
    const outcome = /^STOP_[A-Z_]+$/.test(error.message) ? error.message : 'STOP_PRIVATE_PHASE_UNCERTAIN';
    if (!state) {
      const existingPhase = testFixture ? testFixture.phaseDirectory : NATIVE_PHASE;
      if (typeof existingPhase === 'string' && resolve(existingPhase) === existingPhase) {
        try {
          await lstat(existingPhase);
          return { ...(await inspectPrivatePhase(existingPhase)), outcome };
        } catch (inspectionError) {
          if (inspectionError.code !== 'ENOENT')
            return {
              outcome,
              oauthAttempts: null,
              requests: null,
              requestAccounting: 'UNKNOWN',
              qualification: QUALIFICATION,
            };
        }
      }
    }
    if (state) {
      for (const attempt of state.attempts) if (attempt.status === 'RESERVED') attempt.status = 'UNCERTAIN';
      state.sealed = true;
      state.outcome = outcome;
      await journal(phase, state).catch(() => {});
    }
    return {
      ...result(outcome, state),
      requestAccounting: state ? 'SHARED_DURABLE_RESERVED_ATTEMPTS' : 'NO_PHASE_STARTED',
    };
  } finally {
    secret = undefined;
    token = undefined;
  }
}

export async function inspectPrivatePhase(path) {
  try {
    await privateParent(path);
    const state = JSON.parse(await privateFile(join(path, 'phase.json')));
    if (
      state.schema !== 'insignia-private-inventory-phase-v1' ||
      !Number.isInteger(state.pid) ||
      state.pid < 1 ||
      typeof state.sealed !== 'boolean' ||
      !Array.isArray(state.attempts) ||
      state.attempts.length > 5 ||
      state.attempts.some(
        (a, i) =>
          a.number !== i + 1 ||
          !['SSH', 'OAUTH', 'ADMIN'].includes(a.kind) ||
          !['RESERVED', 'UNCERTAIN', 'RECEIVED', 'RECEIVED_EPHEMERAL'].includes(a.status),
      ) ||
      ['SSH', 'OAUTH', 'ADMIN'].some(
        (kind) => state.attempts.filter((a) => a.kind === kind).length > (kind === 'ADMIN' ? 3 : 1),
      )
    )
      fail('STOP_INVALID_JOURNAL');
    return { ...result('STOP_PHASE_NOT_RESUMABLE', state), requestAccounting: 'SHARED_DURABLE_RESERVED_ATTEMPTS' };
  } catch {
    return {
      outcome: 'STOP_ACCOUNTING_UNKNOWN_NO_RETRY',
      oauthAttempts: null,
      requests: null,
      requestAccounting: 'UNKNOWN',
      qualification: QUALIFICATION,
    };
  }
}
