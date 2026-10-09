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
      JSON.stringify(worker.networks) !== JSON.stringify(['private'])
    )
      return false;
    if (!/^.+@sha256:[a-f0-9]{64}$/.test(image) || image !== expectedImage) return false;
    if (
      !endpoint ||
      JSON.stringify(endpoint) !== JSON.stringify(expectedEndpoint) ||
      endpoint.major !== 18 ||
      endpoint.schemaVersion !== 43
    )
      return false;
    if (Object.keys(environment).some((key) => !ENV_KEYS.includes(key)) || environment.NODE_ENV !== 'production')
      return false;
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
    const url = new URL(environment.DATABASE_URL);
    if (
      url.hostname !== endpoint.hostname ||
      Number(url.port || 5432) !== endpoint.port ||
      decodeURIComponent(url.pathname.slice(1)) !== endpoint.database ||
      decodeURIComponent(url.username) !== endpoint.role ||
      url.hash ||
      [...url.searchParams.keys()].some((key) => key !== 'sslmode')
    )
      return false;
    if (url.searchParams.get('sslmode') !== endpoint.sslmode) return false;
    loadCredentialKeys(environment);
    return workerInventoryMatches(entry, inventory, writablePaths);
  } catch {
    return false;
  }
}
