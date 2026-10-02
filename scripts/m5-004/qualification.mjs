import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCatalogReader,
  createCatalogTransport,
  createShopifyAvailabilityHoldPort,
} from '../../packages/shopify/dist/index.js';
import { resolvePredecessor } from '../m5-010/recovery.mjs';
import { digest, verifyGate } from './binding.mjs';
import {
  ADAPTER_UPDATE,
  assertOwned,
  assertUnpublished,
  CREATE,
  createOperator,
  FIND,
  FIXTURE,
  IDENTITY,
  LIVE_DIRECTORY,
  profileDirectory,
  requireValue,
  SETUP,
  Stop,
  TARGET,
} from './operator.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = '/home/serveradmin/.local/share/insignia-public-app/server.env';
const hasControl = (value) => [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const scope = Object.freeze({
  shopId: 'm5_004_fixture_only',
  installationGeneration: '1',
  shopifyShopId: TARGET.shop,
  appClientId: TARGET.client,
});
export const REQUEST_PLAN = Object.freeze({
  auth: 1,
  create: 1,
  updates: 13,
  finalUpdatesReserved: 3,
  // Nominal: 59 normal reads +3 final reads; 12 status mutations.
  // Additional conservative capacity remains below84/13 normal limits.
  normalReadsMaximum: 70,
  finalReadsReserved: 12,
  cases: ['DRAFT', 'ACTIVE', 'UNLISTED', 'ARCHIVED', 'observed-drift'],
});
export function protectedCredentials() {
  let info, dir;
  try {
    info = lstatSync(FILE);
    dir = lstatSync(dirname(FILE));
  } catch (error) {
    throw new Stop(
      error.code === 'ENOENT'
        ? 'credential_route_missing'
        : error.code === 'EACCES'
          ? 'credential_route_unreadable'
          : 'credential_route_io_error',
    );
  }
  requireValue(
    info.isFile() &&
      !info.isSymbolicLink() &&
      info.uid === process.getuid() &&
      (info.mode & 0o077) === 0 &&
      dir.isDirectory() &&
      !dir.isSymbolicLink() &&
      dir.uid === process.getuid() &&
      (dir.mode & 0o077) === 0,
    'credential_permissions',
  );
  let contents;
  try {
    contents = readFileSync(FILE, 'utf8');
  } catch {
    throw new Stop('credential_route_unreadable');
  }
  requireValue(contents.length <= 32 * 1024, 'credential_bound');
  function variable(name) {
    const matches = contents.split('\n').filter((line) => line.startsWith(`${name}=`));
    requireValue(matches.length === 1, `credential_variable_${name}`);
    let value = matches[0].slice(name.length + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    requireValue(value.length > 0 && value.length <= 4096 && !hasControl(value), 'credential_value');
    return value;
  }
  requireValue(variable('SHOPIFY_API_KEY') === TARGET.client, 'credential_client');
  return {
    secret: variable('SHOPIFY_API_SECRET'),
    ownership: {
      uid: info.uid,
      mode: (info.mode & 0o777).toString(8),
      route: 'existing own-organization Admin client_credentials; server.env',
    },
  };
}
export async function qualify({
  root = ROOT,
  profile = 'm5-004',
  directory = profileDirectory(profile),
  binding,
  gate,
}) {
  requireValue(root === ROOT, 'executing_root');
  requireValue(resolve(directory) === profileDirectory(profile), 'canonical_register');
  verifyGate(ROOT, gate, binding, { profile });
  const operator = createOperator({ directory, profile });
  return runQualification({ operator, directory, binding, credentialLoader: protectedCredentials, profile });
}
// Explicit offline seam: no default credentials/transport, no live source-attestation claim.
export async function qualifySynthetic({ directory, binding, credentialLoader, fetchImpl, profile = 'm5-004' }) {
  requireValue(
    typeof fetchImpl === 'function' &&
      fetchImpl !== globalThis.fetch &&
      typeof credentialLoader === 'function' &&
      credentialLoader !== protectedCredentials &&
      resolve(directory) !== LIVE_DIRECTORY &&
      resolve(directory) !== profileDirectory('m5-009') &&
      resolve(directory) !== profileDirectory('m5-010'),
    'synthetic_boundaries',
  );
  const operator = createOperator({ directory, fetchImpl, profile });
  return runQualification({
    operator,
    directory,
    binding,
    profile,
    synthetic: true,
    credentialLoader: () => {
      const value = credentialLoader();
      requireValue(value.secret?.startsWith('synthetic-'), 'synthetic_credential');
      return value;
    },
  });
}
async function runQualification({
  operator,
  directory,
  binding,
  credentialLoader,
  synthetic = false,
  profile = 'm5-004',
}) {
  try {
    requireValue(JSON.stringify(operator.state().binding) === JSON.stringify(binding), 'register_source_binding');
    requireValue(
      operator.state().events.length === 0 && !existsSync(resolve(directory, 'qualification.json')),
      'qualification_reentry_refused',
    );
  } catch (error) {
    operator.close();
    throw error;
  }
  const evidence = {
    version: 1,
    executionMode: synthetic ? 'SYNTHETIC_OFF_STORE' : 'LIVE_FROZEN_OPERATOR',
    binding,
    plan: profile === 'm5-010' ? { ...REQUEST_PLAN, predecessorArchive: 1 } : REQUEST_PLAN,
    provider: [],
    normalized: [],
    cases: [],
    permission: 'experiment-only fixture status; not production release/recovery',
    outcome: 'NOT_RUN',
  };
  const persist = () =>
    writeFileSync(resolve(directory, 'qualification.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  let token;
  async function graph(query, variables = {}) {
    requireValue(token && Date.now() + 30_000 < token.expiresAt, 'expired_credential');
    const response = await operator.fetch(`https://${TARGET.domain}/admin/api/2026-07/graphql.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': token.value },
      body: JSON.stringify({ query, variables }),
    });
    requireValue(response.status === 200, `admin_graphql_http_${response.status}`);
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Stop('admin_graphql_response_json');
    }
    requireValue(!result.errors && result.data, 'graphql_contract');
    return result.data;
  }
  async function identity() {
    const data = await graph(IDENTITY);
    operator.identity(data);
  }
  async function owned() {
    const state = operator.state();
    const data = await graph(FIXTURE, { id: state.fixture });
    assertOwned(data.product, state);
    requireValue(data.product.id === state.fixture, 'fixture');
    evidence.provider.push({ at: new Date().toISOString(), product: data.product });
    persist();
    return data.product;
  }
  async function setup(status, name) {
    await identity();
    await owned();
    operator.step(name, status, SETUP);
    const result = await graph(SETUP, { product: { id: operator.state().fixture, status } });
    requireValue(
      result.productUpdate?.userErrors?.length === 0 && result.productUpdate.product?.status === status,
      'setup_ack',
    );
    await owned();
  }
  function reload(hold, name) {
    const path = resolve(directory, `${name}.hold.json`);
    const bytes = JSON.stringify(hold, null, 2) + '\n';
    writeFileSync(path, bytes, { mode: 0o600 });
    const returned = execFileSync(
      process.execPath,
      [resolve(ROOT, 'scripts/m5-004/reload-hold.mjs'), path, digest(bytes)],
      { env: { PATH: process.env.PATH, TZ: 'UTC' }, maxBuffer: 32 * 1024 },
    );
    requireValue(returned.equals(Buffer.from(bytes)), 'hold_reload');
    evidence.normalized.push({ name, persistedDigest: digest(bytes), reloadedDigest: digest(returned), hold });
    persist();
    return JSON.parse(returned);
  }
  let port;
  try {
    const credentials = credentialLoader();
    evidence.credentialMetadata = credentials.ownership;
    persist();
    const response = await operator.fetch(`https://${TARGET.domain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: TARGET.client,
        client_secret: credentials.secret,
        grant_type: 'client_credentials',
      }),
    });
    requireValue(response.status === 200, `admin_auth_http_${response.status}`);
    let auth;
    try {
      auth = await response.json();
    } catch {
      throw new Stop('admin_auth_response_json');
    }
    requireValue(
      response.ok &&
        typeof auth.access_token === 'string' &&
        auth.access_token.length > 0 &&
        auth.access_token.length <= 8192 &&
        !hasControl(auth.access_token) &&
        Number.isInteger(auth.expires_in) &&
        auth.expires_in > 60 &&
        auth.expires_in <= 86400,
      'admin_auth_contract',
    );
    requireValue(!synthetic || auth.access_token.startsWith('synthetic-'), 'synthetic_bearer');
    token = { value: auth.access_token, expiresAt: Date.now() + auth.expires_in * 1000 };
    await identity();
    if (profile === 'm5-010') {
      evidence.predecessor = await resolvePredecessor(operator, graph);
      persist();
    }
    requireValue(
      operator.state().counts.create === 0 && operator.state().fixture === null,
      'creation_already_attempted',
    );
    const marker = operator.state().run;
    const created = await graph(CREATE, {
      product: { title: marker, handle: marker, tags: [marker], status: 'DRAFT' },
    });
    requireValue(created.productCreate?.userErrors?.length === 0 && operator.state().owned, 'creation_ack');
    await owned();
    // Label1 is experiment-local, not a claim about M3's current installation generation.
    port = createShopifyAvailabilityHoldPort({
      credentials: {
        acquire: async (input) => {
          requireValue(
            input.shopId === scope.shopId &&
              input.installationGeneration === '1' &&
              Date.now() + 30_000 < token.expiresAt &&
              operator.state().identity?.currentAppInstallation.id === TARGET.installation,
            'credential_fence',
          );
          return {
            kind: 'usable',
            shopDomain: TARGET.domain,
            accessToken: token.value,
            accessExpiresAt: new Date(token.expiresAt),
          };
        },
      },
      isCurrent: async (input) => Object.keys(scope).every((key) => input[key] === scope[key]),
      fetchImpl: operator.fetch,
    });
    for (const original of ['DRAFT', 'ACTIVE', 'UNLISTED', 'ARCHIVED']) {
      if (original !== 'DRAFT') await setup(original, `setup-${original}`);
      await identity();
      const beforeCounts = operator.state().counts.update;
      const before = await port.snapshot(scope, operator.state().fixture);
      const attempt = { case: original, before, outcome: 'IN_PROGRESS' };
      evidence.cases.push(attempt);
      persist();
      const intent = { version: 'm5-availability-hold-v1', operationId: `${marker}-${original}`, before, held: null };
      operator.step(`acquire-${original}`, 'DRAFT', ADAPTER_UPDATE);
      const acquired = await port.acquire(scope, intent);
      attempt.acquired = acquired;
      persist();
      requireValue(acquired.kind === 'HELD', 'acquisition_contract');
      const hold = reload(acquired.hold, original);
      const observation = await port.observe(scope, hold);
      attempt.observation = observation;
      persist();
      requireValue(observation.kind === 'HELD', 'hold_observation');
      await identity();
      operator.step(`restore-${original}`, original, ADAPTER_UPDATE);
      const restored = await port.restore(scope, hold, observation.current, () =>
        operator.permittedRestore(hold.before.productId),
      );
      attempt.restored = restored;
      persist();
      requireValue(restored.kind === 'RESTORED', 'restoration_contract');
      const raw = await owned();
      requireValue(raw.status === original, 'restoration_status');
      const mutations = operator.state().counts.update - beforeCounts;
      requireValue(mutations === (original === 'DRAFT' ? 0 : 2), 'adapter_mutation_count');
      Object.assign(attempt, { adapterMutations: mutations, restorationOutcome: 'PASS' });
      persist();
      if (original === 'UNLISTED') {
        const catalog = createCatalogReader(
          createCatalogTransport({ shop: TARGET.domain, accessToken: token.value, fetchImpl: operator.fetch }),
        );
        evidence.catalog = { outcome: 'IN_PROGRESS' };
        persist();
        evidence.catalog.operation = 'detail';
        persist();
        const detail = await catalog.get(operator.state().fixture);
        evidence.catalog.detail = detail;
        persist();
        evidence.catalog.operation = 'list';
        persist();
        const list = await catalog.list({ search: `handle:${marker}`, first: 1 });
        evidence.catalog.list = list;
        persist();
        requireValue(
          detail?.status === 'UNLISTED' &&
            list.products.length === 1 &&
            list.products[0].id === operator.state().fixture &&
            list.products[0].status === 'UNLISTED',
          'catalog_contract',
        );
        evidence.catalog.outcome = 'PASS';
        persist();
      }
      attempt.outcome = 'PASS';
      persist();
    }
    const drift = { case: 'observed-drift', outcome: 'IN_PROGRESS' };
    evidence.cases.push(drift);
    persist();
    await setup('ACTIVE', 'drift-setup');
    const before = await port.snapshot(scope, operator.state().fixture);
    drift.before = before;
    persist();
    operator.step('drift-acquire', 'DRAFT', ADAPTER_UPDATE);
    const acquired = await port.acquire(scope, {
      version: 'm5-availability-hold-v1',
      operationId: `${marker}-drift`,
      before,
      held: null,
    });
    drift.acquired = acquired;
    persist();
    requireValue(acquired.kind === 'HELD', 'drift_acquisition');
    const hold = reload(acquired.hold, 'drift');
    await setup('ARCHIVED', 'known-drift');
    const observation = await port.observe(scope, hold);
    drift.observation = observation;
    persist();
    requireValue(observation.kind === 'CONFLICT', 'drift_observation_contract');
    const count = operator.state().counts.update;
    // Known drift grants ZERO restoration writes: the prior SETUP step is consumed.
    const restored = await port.restore(scope, hold, hold.held, () => operator.permittedRestore(hold.before.productId));
    drift.restored = restored;
    drift.additionalRestoreMutations = operator.state().counts.update - count;
    persist();
    requireValue(
      observation.kind === 'CONFLICT' && restored.kind === 'CONFLICT' && operator.state().counts.update === count,
      'drift_contract',
    );
    const raw = await owned();
    drift.readback = raw;
    persist();
    requireValue(raw.status === 'ARCHIVED', 'drift_preserved');
    drift.outcome = 'PASS';
    persist();
    evidence.outcome = 'TESTED_MATRIX_PASS';
    persist();
  } catch (error) {
    const kind =
      error instanceof Stop
        ? error.kind
        : typeof error?.kind === 'string'
          ? error.kind
          : 'provider_contract_or_local_exception';
    const normalizedFailure = {
      kind,
      class: ['Error', 'Stop', 'ShopifyAvailabilityHoldError', 'TypeError', 'SyntaxError'].includes(error?.name)
        ? error.name
        : 'unknown',
      message: [
        'Invalid catalog image',
        'Invalid catalog product',
        'Duplicate catalog variant identity',
        'Invalid catalog variant',
        'Invalid catalog variant options',
        'Invalid shop currency',
        'Invalid catalog pagination',
        'Invalid catalog response',
        'Duplicate catalog product identity',
        'Invalid product ID',
        'Catalog product disappeared during pagination',
        'Catalog product identity mismatch',
        'Invalid variant pagination',
        'Catalog product missing',
        'Invalid catalog transport scope',
        'Catalog read failed',
        'Catalog response body missing',
        'Catalog response too large',
        'Catalog JSON response invalid',
        'Catalog GraphQL response invalid',
      ].includes(error?.message)
        ? error.message
        : '<message not retained>',
    };
    for (const attempt of evidence.cases)
      if (attempt.outcome === 'IN_PROGRESS') {
        attempt.outcome = 'STOPPED';
        attempt.failure = normalizedFailure;
      }
    if (evidence.catalog?.outcome === 'IN_PROGRESS') {
      evidence.catalog.outcome = 'STOPPED';
      evidence.catalog.failure = normalizedFailure;
    }
    evidence.outcome = 'STOPPED';
    if (profile === 'm5-010') evidence.predecessor = operator.state().predecessor;
    evidence.stop = kind;
    operator.block(kind);
    persist();
    if (!operator.state().fixture && operator.state().counts.create === 1) {
      try {
        const lookup = await graph(FIND, { search: `handle:${operator.state().run}` });
        requireValue(
          Array.isArray(lookup.products?.nodes) &&
            lookup.products.nodes.length <= 1 &&
            lookup.products.pageInfo?.hasNextPage === false &&
            lookup.products.pageInfo.hasPreviousPage === false,
          'creation_lookup_ambiguous',
        );
        for (const product of lookup.products.nodes) assertOwned(product, operator.state());
        evidence.creationLookup = {
          ...lookup,
          qualification: 'ownership candidate only; write settlement remains unknown; no more mutations',
        };
      } catch {
        evidence.creationLookup = { outcome: 'UNAVAILABLE' };
      }
    }
  }
  try {
    const state = operator.state();
    if (state.fixture && state.owned) {
      operator.finalize();
      await identity();
      const product = await owned();
      assertUnpublished(product);
      if (product.status !== 'ARCHIVED') await setup('ARCHIVED', 'safe-finalize');
      const final = await owned();
      requireValue(final.status === 'ARCHIVED', 'final_state');
      evidence.final = {
        outcome: 'ARCHIVED_UNPUBLISHED_RETAINED',
        product: final,
        identity: operator.state().identity,
      };
    } else
      evidence.final = {
        outcome: state.counts.create ? 'OWNERSHIP_UNRESOLVED_NO_MORE_MUTATIONS' : 'NO_FIXTURE_CREATED',
      };
  } catch (error) {
    evidence.final = {
      outcome: 'UNRESOLVED_NO_MORE_MUTATIONS',
      reason: error instanceof Stop ? error.kind : 'provider_contract',
    };
  }
  persist();
  operator.close();
  return evidence;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.argv.length === 2 || resolve(process.argv[2]) === LIVE_DIRECTORY, 'canonical_register');
    const directory = LIVE_DIRECTORY;
    const binding = JSON.parse(readFileSync(resolve(directory, 'binding.json')));
    const gate = JSON.parse(readFileSync(resolve(directory, 'gate.json')));
    const result = await qualify({ directory, binding, gate });
    process.stdout.write(
      JSON.stringify({ outcome: result.outcome, stop: result.stop ?? null, final: result.final?.outcome }) + '\n',
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        outcome: 'LOCAL_OR_AUTH_GATE_STOP',
        kind: error instanceof Stop ? error.kind : 'unclassified_local_error',
      }) + '\n',
    );
    process.exitCode = 1;
  }
}
