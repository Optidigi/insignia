import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCatalogReader,
  createCatalogTransport,
  createShopifyAvailabilityHoldPort,
} from '../../packages/shopify/dist/index.js';
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
  const info = lstatSync(FILE),
    dir = lstatSync(dirname(FILE));
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
  const contents = readFileSync(FILE, 'utf8');
  requireValue(contents.length <= 32 * 1024, 'credential_bound');
  function variable(name) {
    const matches = contents.split('\n').filter((line) => line.startsWith(`${name}=`));
    requireValue(matches.length === 1, 'credential_variable');
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
export async function qualify({ root = ROOT, directory = LIVE_DIRECTORY, binding, gate }) {
  requireValue(root === ROOT, 'executing_root');
  requireValue(resolve(directory) === LIVE_DIRECTORY, 'canonical_register');
  verifyGate(ROOT, gate, binding);
  const operator = createOperator({ directory });
  return runQualification({ operator, directory, binding, credentialLoader: protectedCredentials });
}
// Explicit offline seam: no default credentials/transport, no live source-attestation claim.
export async function qualifySynthetic({ directory, binding, credentialLoader, fetchImpl }) {
  requireValue(
    typeof fetchImpl === 'function' &&
      fetchImpl !== globalThis.fetch &&
      typeof credentialLoader === 'function' &&
      credentialLoader !== protectedCredentials &&
      resolve(directory) !== LIVE_DIRECTORY,
    'synthetic_boundaries',
  );
  const operator = createOperator({ directory, fetchImpl });
  return runQualification({
    operator,
    directory,
    binding,
    synthetic: true,
    credentialLoader: () => {
      const value = credentialLoader();
      requireValue(value.secret?.startsWith('synthetic-'), 'synthetic_credential');
      return value;
    },
  });
}
async function runQualification({ operator, directory, binding, credentialLoader, synthetic = false }) {
  try {
    requireValue(JSON.stringify(operator.state().binding) === JSON.stringify(binding), 'register_source_binding');
  } catch (error) {
    operator.close();
    throw error;
  }
  const evidence = {
    version: 1,
    executionMode: synthetic ? 'SYNTHETIC_OFF_STORE' : 'LIVE_FROZEN_OPERATOR',
    binding,
    plan: REQUEST_PLAN,
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
    const result = await response.json();
    requireValue(response.ok && !result.errors && result.data, 'graphql_contract');
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
    const auth = await response.json();
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
      Object.assign(attempt, { adapterMutations: mutations, outcome: 'PASS' });
      persist();
      if (original === 'UNLISTED') {
        const catalog = createCatalogReader(
          createCatalogTransport({ shop: TARGET.domain, accessToken: token.value, fetchImpl: operator.fetch }),
        );
        const detail = await catalog.get(operator.state().fixture);
        const list = await catalog.list({ search: `handle:${marker}`, first: 1 });
        requireValue(
          detail?.status === 'UNLISTED' &&
            list.products.length === 1 &&
            list.products[0].id === operator.state().fixture &&
            list.products[0].status === 'UNLISTED',
          'catalog_contract',
        );
        evidence.catalog = { detail, list };
        persist();
      }
    }
    await setup('ACTIVE', 'drift-setup');
    const before = await port.snapshot(scope, operator.state().fixture);
    operator.step('drift-acquire', 'DRAFT', ADAPTER_UPDATE);
    const acquired = await port.acquire(scope, {
      version: 'm5-availability-hold-v1',
      operationId: `${marker}-drift`,
      before,
      held: null,
    });
    requireValue(acquired.kind === 'HELD', 'drift_acquisition');
    const hold = reload(acquired.hold, 'drift');
    await setup('ARCHIVED', 'known-drift');
    const observation = await port.observe(scope, hold);
    const count = operator.state().counts.update;
    operator.step('drift-restore', 'ACTIVE', ADAPTER_UPDATE);
    const restored = await port.restore(scope, hold, hold.held, () => operator.permittedRestore(hold.before.productId));
    requireValue(
      observation.kind === 'CONFLICT' && restored.kind === 'CONFLICT' && operator.state().counts.update === count,
      'drift_contract',
    );
    const raw = await owned();
    requireValue(raw.status === 'ARCHIVED', 'drift_preserved');
    evidence.cases.push({
      case: 'observed-drift',
      observation,
      restored,
      outcome: 'PASS',
      additionalRestoreMutations: 0,
    });
    evidence.outcome = 'TESTED_MATRIX_PASS';
    persist();
  } catch (error) {
    const kind =
      error instanceof Stop
        ? error.kind
        : typeof error?.kind === 'string'
          ? error.kind
          : 'provider_contract_or_local_exception';
    for (const attempt of evidence.cases) if (attempt.outcome === 'IN_PROGRESS') attempt.outcome = 'STOPPED';
    evidence.outcome = 'STOPPED';
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
