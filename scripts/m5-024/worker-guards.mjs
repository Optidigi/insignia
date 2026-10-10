import { createHash } from 'node:crypto';
import { loadCredentialKeys } from '../../apps/worker/dist/config.js';
import { workerInventoryMatches } from '../../docs/delivery/evidence/m5-023/operators/worker-inventory.mjs';

const ENV_KEYS = [
  'DATABASE_URL',
  'SHOPIFY_CLIENT_ID',
  'SHOPIFY_CLIENT_SECRET',
  'SHOPIFY_WEBHOOK_SECRET',
  'SHOPIFY_WEBHOOK_PREVIOUS_SECRET',
  'INSIGNIA_CREDENTIAL_KEY_ID',
  'INSIGNIA_CREDENTIAL_KEY_BASE64',
  'INSIGNIA_CREDENTIAL_PREVIOUS_KEYS_JSON',
  'NODE_ENV',
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const webOverrides = /^(?:PG|NODE_(?!ENV$)|SSL_|OPENSSL_|LD_|DYLD_)/;

function workerNetworksMatch(rendered, worker) {
  const attached = worker.networks;
  const names = Array.isArray(attached) ? attached : Object.keys(attached ?? {});
  if (!Array.isArray(attached) && Object.values(attached ?? {}).some((value) => value !== null)) return false;
  const legacy = JSON.stringify(names) === JSON.stringify(['private']);
  const outbound = names.length === 2 && names.includes('private') && names.includes('egress');
  if (!legacy && !outbound) return false;
  // Preserve the original reviewed private-only array profile used by legacy controls.
  if (legacy && Array.isArray(attached) && rendered.networks === undefined) return true;
  const definitions = rendered.networks;
  if (!definitions || Object.keys(definitions).length !== names.length) return false;
  const privateNetwork = definitions.private;
  if (
    !privateNetwork ||
    Object.keys(privateNetwork).length !== 2 ||
    privateNetwork.external !== true ||
    privateNetwork.name !== 'insignia-rewrite-m5-019_private'
  )
    return false;
  if (legacy) return true;
  const egress = definitions.egress;
  return (
    rendered.name === 'insignia-uninstall-m5-024' &&
    egress &&
    Object.keys(egress).length === 3 &&
    egress.name === 'insignia-uninstall-m5-024_egress' &&
    egress.driver === 'bridge' &&
    egress.internal === false
  );
}

function matchesDatabaseUrl(value, endpoint) {
  const url = new URL(value);
  return (
    ['postgres:', 'postgresql:'].includes(url.protocol) &&
    url.hostname === endpoint.hostname &&
    url.port !== '' &&
    Number(url.port) === endpoint.port &&
    decodeURIComponent(url.pathname.slice(1)) === endpoint.database &&
    decodeURIComponent(url.username) === endpoint.role &&
    !url.hash &&
    url.searchParams.getAll('sslmode').length === 1 &&
    [...url.searchParams.keys()].every((key) => key === 'sslmode') &&
    url.searchParams.get('sslmode') === endpoint.sslmode
  );
}

// Pure qualification of privately gathered observations. No network/DB/provider/write operation.
// Expected Compose is the independently reviewed fully rendered JSON, not an editable template.
export function qualifyWorkerCandidate({
  composeBytes,
  composeSha256,
  rendered,
  expectedRendered,
  environment,
  webEnvironment,
  endpoint,
  expectedEndpoint,
  webEndpoint,
  expectedWebEndpoint,
  entry,
  inventory,
  writablePaths,
  image,
  expectedImage,
}) {
  try {
    if (hash(composeBytes) !== composeSha256 || JSON.stringify(rendered) !== JSON.stringify(expectedRendered))
      return false;
    if (Object.keys(rendered ?? {}).some((key) => !['name', 'services', 'networks'].includes(key))) return false;
    const worker = rendered?.services?.worker;
    const allowed = [
      'image',
      'pull_policy',
      'restart',
      'read_only',
      'user',
      'command',
      'cap_drop',
      'security_opt',
      'env_file',
      'environment',
      'networks',
      'healthcheck',
      'stop_grace_period',
    ];
    if (
      !worker ||
      Object.keys(rendered.services).length !== 1 ||
      Object.keys(worker).some((key) => !allowed.includes(key)) ||
      worker.image !== image ||
      worker.read_only !== true ||
      worker.user !== 'node' ||
      JSON.stringify(worker.command) !== JSON.stringify(['/usr/local/bin/node', '/srv/insignia/worker/dist/main.js']) ||
      JSON.stringify(worker.cap_drop) !== JSON.stringify(['ALL']) ||
      JSON.stringify(worker.security_opt) !== JSON.stringify(['no-new-privileges:true']) ||
      !workerNetworksMatch(rendered, worker)
    )
      return false;
    // Registry manifests and loaded local image config IDs are distinct immutable
    // identities. An export receipt's imageId must match exactly, never a tag.
    const registryDigest = /^.+@sha256:[a-f0-9]{64}$/.test(image);
    const localImageId = /^sha256:[a-f0-9]{64}$/.test(image);
    if ((!registryDigest && !localImageId) || image !== expectedImage) return false;
    if (
      !endpoint ||
      JSON.stringify(endpoint) !== JSON.stringify(expectedEndpoint) ||
      endpoint.major !== 18 ||
      endpoint.schemaVersion !== 43 ||
      !webEndpoint ||
      JSON.stringify(webEndpoint) !== JSON.stringify(expectedWebEndpoint) ||
      ['hostname', 'port', 'database', 'address', 'major', 'schemaVersion', 'sslmode'].some(
        (key) => webEndpoint[key] !== endpoint[key],
      )
    )
      return false;
    if (Object.keys(environment).some((key) => !ENV_KEYS.includes(key)) || environment.NODE_ENV !== 'production')
      return false;
    if (Object.keys(webEnvironment).some((key) => webOverrides.test(key))) return false;
    for (const key of ENV_KEYS.filter(
      (key) => !['INSIGNIA_CREDENTIAL_PREVIOUS_KEYS_JSON', 'SHOPIFY_WEBHOOK_PREVIOUS_SECRET'].includes(key),
    ))
      if (!environment[key]) return false;
    if (environment.SHOPIFY_CLIENT_SECRET !== environment.SHOPIFY_WEBHOOK_SECRET) return false;
    for (const key of [
      'SHOPIFY_CLIENT_ID',
      'SHOPIFY_CLIENT_SECRET',
      'SHOPIFY_WEBHOOK_SECRET',
      'SHOPIFY_WEBHOOK_PREVIOUS_SECRET',
      'INSIGNIA_CREDENTIAL_KEY_ID',
      'INSIGNIA_CREDENTIAL_KEY_BASE64',
      'INSIGNIA_CREDENTIAL_PREVIOUS_KEYS_JSON',
    ])
      if (environment[key] !== webEnvironment[key]) return false;
    if (
      !matchesDatabaseUrl(environment.DATABASE_URL, endpoint) ||
      !matchesDatabaseUrl(webEnvironment.DATABASE_URL, webEndpoint)
    )
      return false;
    loadCredentialKeys(environment);
    return workerInventoryMatches(entry, inventory, writablePaths);
  } catch {
    return false;
  }
}
