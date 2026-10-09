import { constants, lstat, mkdir, open, realpath, rename } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const INVENTORY = `query M5027WebhookInventory($after: String) {
  shop { id myshopifyDomain }
  currentAppInstallation { id app { id apiKey } accessScopes { handle } }
  webhookSubscriptions(first: 250, after: $after) {
    nodes { id topic uri format apiVersion { handle } }
    pageInfo { hasNextPage endCursor }
  }
}`;
const BOUNDARY = `query M5027InstallationBoundary {
  shop { id myshopifyDomain }
  currentAppInstallation { id app { id apiKey } accessScopes { handle } }
}`;
const PUBLIC_TOPICS = new Set([
  'APP_UNINSTALLED',
  'APP_SCOPES_UPDATE',
  'CUSTOMERS_DATA_REQUEST',
  'CUSTOMERS_REDACT',
  'SHOP_REDACT',
  'ORDERS_CREATE',
  'ORDERS_PAID',
  'ORDERS_UPDATED',
  'REFUNDS_CREATE',
  'PRODUCTS_CREATE',
  'PRODUCTS_UPDATE',
  'PRODUCTS_DELETE',
  'SHOP_UPDATE',
]);
const QUALIFICATION = 'STOP_PRE_INSTALL_DESTINATION_EFFECTS_UNQUALIFIED';

const ENDPOINT = 'https://insignia-rewrite-dev.myshopify.com/admin/api/2026-07/graphql.json';
const OPTIONAL = ['write_products', 'read_publications', 'read_product_listings'];
const sameSet = (a, b) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  new Set(a).size === a.length &&
  a.length === b.length &&
  a.every((value) => b.includes(value));
const nonempty = (value) => typeof value === 'string' && value.length > 0 && value.length <= 4096;
function validInput(a, token, directory, testEndpoint) {
  const fields = [
    'schema',
    'status',
    'ownerApprovalReference',
    'purpose',
    'endpoint',
    'expectedShopId',
    'expectedInstallationId',
    'expectedGrants',
    'requiredScopes',
    'optionalScopes',
    'allowedOperations',
    'allowedMutations',
    'incidentalEffects',
    'privateCredentialChannel',
    'credentialCapability',
    'privateEvidenceDirectory',
    'retentionOwner',
    'retentionDeleteBy',
    'validUntil',
    'ceilings',
  ];
  if (!a || Object.keys(a).some((field) => !fields.includes(field))) return false;
  if (
    a.schema !== 'insignia-native-inventory-allocation-v1' ||
    !['OWNER_ALLOCATED', 'LOOPBACK_TEST'].includes(a.status) ||
    !nonempty(a.ownerApprovalReference) ||
    a.purpose !== 'M5-027 existing shop subscription read' ||
    a.endpoint !== ENDPOINT ||
    !/^gid:\/\/shopify\/Shop\/[0-9]+$/.test(a.expectedShopId) ||
    !/^gid:\/\/shopify\/AppInstallation\/[0-9]+$/.test(a.expectedInstallationId) ||
    !sameSet(a.requiredScopes, []) ||
    !sameSet(a.optionalScopes, OPTIONAL) ||
    !sameSet(a.allowedOperations, ['M5027WebhookInventory', 'M5027InstallationBoundary']) ||
    !sameSet(a.allowedMutations, []) ||
    !sameSet(a.incidentalEffects, ['provider-access-audit']) ||
    !Array.isArray(a.expectedGrants) ||
    !sameSet(a.expectedGrants, [...new Set(a.expectedGrants)]) ||
    !a.expectedGrants.every((grant) => OPTIONAL.includes(grant)) ||
    a.privateCredentialChannel !== 'inherited-file-descriptor' ||
    a.credentialCapability !== 'EXISTING_SUPPORTED_EXACT_APP_ADMIN_TOKEN' ||
    !nonempty(a.retentionOwner) ||
    !nonempty(directory) ||
    !isAbsolute(directory) ||
    resolve(directory) !== directory ||
    a.privateEvidenceDirectory !== directory ||
    !nonempty(token) ||
    /[\r\n\0]/.test(token)
  )
    return false;
  const now = Date.now(),
    expiration = Date.parse(a.validUntil),
    deletion = Date.parse(a.retentionDeleteBy);
  if (!(expiration > now && deletion > now && deletion <= now + 7 * 86400000)) return false;
  const maxima = {
    requests: 3,
    pages: 2,
    records: 500,
    responseBytes: 1048576,
    durationMs: 1800000,
    responseTimeoutMs: 30000,
  };
  if (
    !a.ceilings ||
    Object.keys(a.ceilings).some((key) => !(key in maxima)) ||
    Object.entries(maxima).some(
      ([key, max]) => !Number.isInteger(a.ceilings[key]) || a.ceilings[key] < 1 || a.ceilings[key] > max,
    )
  )
    return false;
  if (JSON.stringify(a).includes(token)) return false;
  if (testEndpoint !== undefined) {
    if (a.status !== 'LOOPBACK_TEST') return false;
    const url = new URL(testEndpoint);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      !url.port ||
      url.username ||
      url.password ||
      url.pathname !== '/admin/api/2026-07/graphql.json' ||
      url.search ||
      url.hash
    )
      return false;
  } else if (a.status !== 'OWNER_ALLOCATED') return false;
  return true;
}
function stopped(outcome, requests = 0, pages = 0, records = 0) {
  return { outcome, requests, pages, records, qualification: QUALIFICATION };
}

class Stop extends Error {
  constructor(outcome) {
    super(outcome);
    this.outcome = outcome;
  }
}
const halt = (outcome) => {
  throw new Stop(outcome);
};
function rejectExtra(object, allowed) {
  if (
    object &&
    (typeof object !== 'object' || Array.isArray(object) || Object.keys(object).some((key) => !allowed.includes(key)))
  )
    halt('STOP_RESPONSE_CONTRACT');
}
function validateShape(document, operationName) {
  rejectExtra(document, ['data', 'errors', 'extensions']);
  const data = document?.data;
  rejectExtra(
    data,
    operationName === 'M5027WebhookInventory'
      ? ['shop', 'currentAppInstallation', 'webhookSubscriptions']
      : ['shop', 'currentAppInstallation'],
  );
  rejectExtra(data?.shop, ['id', 'myshopifyDomain']);
  const installation = data?.currentAppInstallation;
  rejectExtra(installation, ['id', 'app', 'accessScopes']);
  rejectExtra(installation?.app, ['id', 'apiKey']);
  if (Array.isArray(installation?.accessScopes))
    for (const scope of installation.accessScopes) rejectExtra(scope, ['handle']);
  if (operationName === 'M5027WebhookInventory') {
    const connection = data?.webhookSubscriptions;
    rejectExtra(connection, ['nodes', 'pageInfo']);
    rejectExtra(connection?.pageInfo, ['hasNextPage', 'endCursor']);
    if (Array.isArray(connection?.nodes))
      for (const node of connection.nodes) {
        rejectExtra(node, ['id', 'topic', 'uri', 'format', 'apiVersion']);
        rejectExtra(node?.apiVersion, ['handle']);
      }
  }
}
function validateIdentity(data, allocation) {
  const installation = data?.currentAppInstallation;
  if (
    data?.shop?.id !== allocation.expectedShopId ||
    data?.shop?.myshopifyDomain !== 'insignia-rewrite-dev.myshopify.com' ||
    installation?.id !== allocation.expectedInstallationId ||
    installation?.app?.id !== 'gid://shopify/App/429028933633' ||
    installation?.app?.apiKey !== '1443cf6d03d39edae7c101a943c5c684' ||
    !Array.isArray(installation?.accessScopes) ||
    !sameSet(
      installation.accessScopes.map((scope) => scope?.handle),
      allocation.expectedGrants,
    )
  )
    halt('STOP_IDENTITY_OR_GRANT_DRIFT');
}
function transportClass(uri) {
  if (!nonempty(uri)) halt('STOP_INCOMPLETE_CONNECTION');
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === 'https:' && parsed.hostname && !parsed.username && !parsed.password && !parsed.hash)
      return 'HTTPS';
    if (parsed.protocol === 'pubsub:' && /^pubsub:\/\/[^/]+\/[^/]+$/.test(uri)) return 'PUBSUB';
    if (parsed.protocol === 'arn:' && /^arn:aws:events:[^:]+:[^:]+:event-bus\/.+/.test(uri)) return 'EVENTBRIDGE';
  } catch {
    /* Only the sanitized failure class is returned. */
  }
  halt('STOP_INCOMPLETE_CONNECTION');
}
function validatePage(data, allocation, nodes, cursors) {
  const connection = data.webhookSubscriptions;
  const info = connection?.pageInfo;
  if (
    !Array.isArray(connection?.nodes) ||
    typeof info?.hasNextPage !== 'boolean' ||
    !(info.endCursor === null || nonempty(info.endCursor)) ||
    (info.hasNextPage && (!nonempty(info.endCursor) || connection.nodes.length === 0))
  )
    halt('STOP_INCOMPLETE_CONNECTION');
  if (connection.nodes.length > 250 || nodes.length + connection.nodes.length > allocation.ceilings.records)
    halt('STOP_CEILING_EXHAUSTED');
  if (info.endCursor !== null) {
    if (cursors.has(info.endCursor)) halt('STOP_CURSOR_CYCLE');
    cursors.add(info.endCursor);
  }
  for (const node of connection.nodes) {
    if (
      !/^gid:\/\/shopify\/WebhookSubscription\/[0-9]+$/.test(node?.id) ||
      typeof node?.topic !== 'string' ||
      !/^[A-Z][A-Z0-9_]{0,127}$/.test(node.topic) ||
      node?.format !== 'JSON' ||
      node?.apiVersion?.handle !== '2026-07'
    )
      halt('STOP_INCOMPLETE_CONNECTION');
    transportClass(node.uri);
    if (
      nodes.some((existing) => existing.id === node.id || (existing.uri === node.uri && existing.topic === node.topic))
    )
      halt('STOP_DUPLICATE_OR_CONFLICT');
    nodes.push(node);
  }
  return info;
}

async function durableFile(path, contents) {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(contents);
    await file.sync();
  } finally {
    await file.close();
  }
}
async function saveJournal(directory, state) {
  const pending = join(directory, 'journal.pending');
  await durableFile(pending, JSON.stringify(state));
  await rename(pending, join(directory, 'journal.json'));
  const dir = await open(directory, 'r');
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}
async function send(endpoint, token, body, byteLimit, timeoutMs) {
  return new Promise((resolve) => {
    const target = new URL(endpoint);
    const chunks = [];
    let bytes = 0,
      response,
      timer,
      finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        status: response?.statusCode ?? null,
        headers: response?.headers ?? {},
        body: Buffer.concat(chunks),
        error,
      });
      if (error) {
        response?.destroy();
        req.destroy();
      }
    };
    const req = (target.protocol === 'https:' ? httpsRequest : httpRequest)(
      target,
      {
        method: 'POST',
        agent: false,
        maxHeaderSize: 16384,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
      },
      (res) => {
        response = res;
        res.on('data', (chunk) => {
          const remaining = byteLimit - bytes;
          if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
          bytes += chunk.length;
          if (bytes > byteLimit) finish('STOP_RESPONSE_TOO_LARGE');
        });
        res.on('end', () => finish(res.complete ? undefined : 'STOP_TRANSPORT_UNCERTAIN'));
        res.on('error', () => finish('STOP_TRANSPORT_UNCERTAIN'));
        res.on('aborted', () => finish('STOP_TRANSPORT_UNCERTAIN'));
        if (Number(res.headers['content-length']) > byteLimit) finish('STOP_RESPONSE_TOO_LARGE');
      },
    );
    req.on('error', () => finish('STOP_TRANSPORT_UNCERTAIN'));
    timer = setTimeout(() => finish('STOP_RESPONSE_TIMEOUT'), timeoutMs);
    req.end(JSON.stringify(body));
  });
}
export async function collectInventory({ allocation, token, privateDirectory, testEndpoint }) {
  const started = performance.now();
  try {
    allocation = structuredClone(allocation);
    if (!validInput(allocation, token, privateDirectory, testEndpoint)) return stopped('STOP_INPUT_NOT_ALLOCATED');
  } catch {
    return stopped('STOP_INPUT_NOT_ALLOCATED');
  }
  try {
    const parent = await lstat(dirname(privateDirectory));
    if ((await realpath(dirname(privateDirectory))) !== dirname(privateDirectory))
      return stopped('STOP_EVIDENCE_UNAVAILABLE');
    if (
      !parent.isDirectory() ||
      parent.isSymbolicLink() ||
      (parent.mode & 0o777) !== 0o700 ||
      parent.uid !== process.getuid()
    )
      return stopped('STOP_EVIDENCE_UNAVAILABLE');
    await mkdir(privateDirectory, { mode: 0o700 });
    const parentHandle = await open(dirname(privateDirectory), 'r');
    try {
      await parentHandle.sync();
    } finally {
      await parentHandle.close();
    }
  } catch {
    return stopped('STOP_EVIDENCE_UNAVAILABLE');
  }
  const state = {
    schema: 'insignia-native-inventory-run-v1',
    pid: process.pid,
    startedAt: new Date().toISOString(),
    retentionOwner: allocation.retentionOwner,
    retentionDeleteBy: allocation.retentionDeleteBy,
    sealed: false,
    attempts: [],
  };
  let pages = 0;
  const nodes = [],
    cursors = new Set();
  try {
    await durableFile(join(privateDirectory, 'allocation.json'), JSON.stringify(allocation));
    await saveJournal(privateDirectory, state);
    const remainingMs = () =>
      Math.min(
        allocation.ceilings.durationMs - (performance.now() - started),
        Date.parse(allocation.validUntil) - Date.now(),
        Date.parse(allocation.retentionDeleteBy) - Date.now(),
      );
    const perform = async (operationName, query, variables) => {
      if (remainingMs() <= 0) halt('STOP_RUN_DEADLINE');
      if (state.attempts.length >= allocation.ceilings.requests) halt('STOP_CEILING_EXHAUSTED');
      const attempt = { number: state.attempts.length + 1, operationName, status: 'RESERVED' };
      state.attempts.push(attempt);
      await saveJournal(privateDirectory, state);
      if (remainingMs() <= 0) halt('STOP_RUN_DEADLINE');
      const response = await send(
        testEndpoint ?? allocation.endpoint,
        token,
        { operationName, query, variables },
        allocation.ceilings.responseBytes,
        Math.max(1, Math.min(allocation.ceilings.responseTimeoutMs, remainingMs())),
      );
      const reflected = response.body.includes(Buffer.from(token));
      await durableFile(
        join(privateDirectory, `response-${attempt.number}.body`),
        reflected ? Buffer.alloc(0) : response.body,
      );
      if (reflected) attempt.bodyWithheld = 'SECRET_REFLECTION';
      attempt.status = response.error ? 'UNCERTAIN' : 'RECEIVED';
      attempt.httpStatus = response.status;
      await saveJournal(privateDirectory, state);
      if (reflected) halt('STOP_SECRET_REFLECTION');
      if (remainingMs() <= 0) halt('STOP_RUN_DEADLINE');
      if (response.error) halt(response.error);
      if (response.status !== 200) halt('STOP_HTTP_STATUS');
      if (
        response.headers['x-shopify-api-version'] !== '2026-07' ||
        !/^application\/json(?:\s*;.*)?$/i.test(response.headers['content-type'] ?? '') ||
        ![undefined, 'identity'].includes(response.headers['content-encoding'])
      )
        halt('STOP_RESPONSE_CONTRACT');
      let document;
      try {
        document = JSON.parse(response.body);
      } catch {
        halt('STOP_PROVIDER_ERROR');
      }
      if (!document || typeof document !== 'object' || Array.isArray(document)) halt('STOP_PROVIDER_ERROR');
      if (document.errors !== undefined && (!Array.isArray(document.errors) || document.errors.length > 0))
        halt('STOP_PROVIDER_ERROR');
      validateShape(document, operationName);
      validateIdentity(document?.data, allocation);
      return document.data;
    };
    let after = null;
    while (true) {
      if (pages >= allocation.ceilings.pages) halt('STOP_CEILING_EXHAUSTED');
      const data = await perform('M5027WebhookInventory', INVENTORY, { after });
      const info = validatePage(data, allocation, nodes, cursors);
      pages += 1;
      if (!info.hasNextPage) break;
      after = info.endCursor;
    }
    await perform('M5027InstallationBoundary', BOUNDARY, {});
    state.sealed = true;
    state.outcome = 'COLLECTION_COMPLETE_NATIVE_SAFETY_UNQUALIFIED';
    await saveJournal(privateDirectory, state);
    return {
      outcome: state.outcome,
      requests: state.attempts.length,
      pages,
      records: nodes.length,
      destinations: nodes.map((node, i) => ({
        label: `destination-${String(i + 1).padStart(3, '0')}`,
        topic: PUBLIC_TOPICS.has(node.topic) ? node.topic : 'OTHER_TOPIC',
        transport: transportClass(node.uri),
        format: node.format,
        apiVersion: node.apiVersion.handle,
      })),
      qualification: QUALIFICATION,
    };
  } catch (error) {
    for (const attempt of state.attempts) if (attempt.status === 'RESERVED') attempt.status = 'UNCERTAIN';
    state.sealed = true;
    state.outcome = error instanceof Stop ? error.outcome : 'STOP_EVIDENCE_OR_TRANSPORT_UNCERTAIN';
    try {
      await saveJournal(privateDirectory, state);
    } catch {
      /* Reservation remains conservatively consumed. */
    }
    return stopped(state.outcome, state.attempts.length, pages, nodes.length);
  }
}

export async function sealAbandonedRun({ privateDirectory }) {
  try {
    if (!isAbsolute(privateDirectory) || resolve(privateDirectory) !== privateDirectory)
      return stopped('STOP_EVIDENCE_UNAVAILABLE');
    const directory = await lstat(privateDirectory);
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      (directory.mode & 0o777) !== 0o700 ||
      directory.uid !== process.getuid()
    )
      return stopped('STOP_EVIDENCE_UNAVAILABLE');
    const file = await open(join(privateDirectory, 'journal.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
    let state;
    try {
      const info = await file.stat();
      if (!info.isFile() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid() || info.size > 65536)
        return stopped('STOP_EVIDENCE_UNAVAILABLE');
      state = JSON.parse(await file.readFile('utf8'));
    } finally {
      await file.close();
    }
    if (
      state.schema !== 'insignia-native-inventory-run-v1' ||
      !Number.isInteger(state.pid) ||
      state.pid < 1 ||
      typeof state.sealed !== 'boolean' ||
      !Array.isArray(state.attempts) ||
      state.attempts.length > 3 ||
      state.attempts.some(
        (attempt, i) =>
          attempt.number !== i + 1 ||
          !['M5027WebhookInventory', 'M5027InstallationBoundary'].includes(attempt.operationName) ||
          !['RESERVED', 'RECEIVED', 'UNCERTAIN'].includes(attempt.status),
      )
    )
      return stopped('STOP_EVIDENCE_UNAVAILABLE');
    if (state.sealed) return stopped('STOP_RUN_ALREADY_SEALED', state.attempts.length);
    try {
      process.kill(state.pid, 0);
      return stopped('STOP_RUN_PROCESS_MAY_BE_ACTIVE', state.attempts.length);
    } catch (error) {
      if (error.code !== 'ESRCH') return stopped('STOP_RUN_PROCESS_MAY_BE_ACTIVE', state.attempts.length);
    }
    for (const attempt of state.attempts) if (attempt.status === 'RESERVED') attempt.status = 'UNCERTAIN';
    state.sealed = true;
    state.outcome = 'STOP_ABANDONED_RUN_UNCERTAIN';
    await saveJournal(privateDirectory, state);
    return stopped(state.outcome, state.attempts.length);
  } catch {
    return stopped('STOP_EVIDENCE_UNAVAILABLE');
  }
}
