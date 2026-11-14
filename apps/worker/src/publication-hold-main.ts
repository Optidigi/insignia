import { createAdminReadCredentialSource } from '@insignia/application';
import { createDurableCore } from '@insignia/database';
import {
  createPublicationAdminAdapter,
  createPublicationAdminHttpTransport,
  createShopifyAvailabilityHoldV3Port,
  createShopifyOfflineRefreshTransport,
} from '@insignia/shopify';
import { Pool } from 'pg';
import { loadCredentialKeys } from './config.js';
import { credentialLifecycle } from './handlers.js';
import { runPublicationHoldCommand } from './publication-hold.js';

/**
 * #466 part A: the owner-run publication hold command, in the worker image, run over SSH on the
 * host (deployment/m5-runtime/publication-hold.sh). It connects only as its own database identity
 * (`INSIGNIA_PUBLICATION_HOLD_DATABASE_URL`), never as the worker, and refuses to run as any other.
 *   node dist/publication-hold-main.js inspect|restore|resolve ...
 */
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
let pool: Pool | undefined;
let core: ReturnType<typeof createDurableCore> | undefined;
process.exitCode = await runPublicationHoldCommand(process.argv.slice(2), {
  write: (line) => process.stdout.write(line),
  async operator() {
    const clientId = required('SHOPIFY_CLIENT_ID');
    const clientSecret = required('SHOPIFY_CLIENT_SECRET');
    const appId = required('INSIGNIA_SHOPIFY_APP_ID');
    const keys = loadCredentialKeys(process.env);
    pool = new Pool({
      connectionString: required('INSIGNIA_PUBLICATION_HOLD_DATABASE_URL'),
      max: 2,
      connectionTimeoutMillis: 5000,
      options: '-c statement_timeout=15000ms -c lock_timeout=10000ms',
    });
    // Only the dedicated command identity: a member of the operator role, not a superuser and not
    // a runtime capability (worker, web, signer, queue, artwork).
    const identity = await pool.query<{ operator: boolean; privileged: boolean; runtime: boolean }>(
      `SELECT pg_has_role(current_user,'insignia_publication_operator','MEMBER') AS operator,
        (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS privileged,
        EXISTS (SELECT FROM pg_roles r WHERE r.rolname IN ('insignia_runtime','insignia_worker','insignia_signer',
          'insignia_queue_consume','insignia_queue_enqueue','insignia_artwork_worker','insignia_artwork_inspect')
          AND pg_has_role(current_user, r.oid, 'MEMBER')) AS runtime`,
    );
    const row = identity.rows[0];
    if (!row?.operator || row.privileged || row.runtime)
      throw new Error('The publication hold command must run as its own operator identity');
    core = createDurableCore(pool, { credentialKeys: keys });
    const offline = createAdminReadCredentialSource({
      tenants: core.tenants,
      credentials: credentialLifecycle(core),
      refresh: createShopifyOfflineRefreshTransport({ clientId, clientSecret }),
    });
    return core.publicationHoldOperator.create({
      appId,
      appClientId: clientId,
      acquireToken: (scope) => offline.acquire(scope),
      availability: ({ credentials, isCurrent }) =>
        createShopifyAvailabilityHoldV3Port({ credentials, isCurrent, fetchImpl: globalThis.fetch.bind(globalThis) }),
      fields: ({ credentials }) =>
        createPublicationAdminAdapter({ transport: createPublicationAdminHttpTransport({ credentials }) }),
    });
  },
});
if (core) await core.close();
else await pool?.end();
