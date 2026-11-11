import { sql } from 'kysely';
import type { Pool } from 'pg';
import { createDatabase } from './client/database.js';
import { PgSigningKeyRepository } from './repositories/signing-keys.js';

/**
 * Signing-key store for the separate signer process only: it alone reads private envelopes
 * (its database role has SELECT on `private_envelope`; the web runtime's does not).
 */
export function createSignerKeyStore(pool: Pool) {
  const database = createDatabase(pool);
  return {
    store: new PgSigningKeyRepository(database, { privateHalves: true }),
    /** Installations that still hold a private half (pending or active key), for KEK re-wrap. */
    async privateHalfScopes(): Promise<{ shopId: string; installationGeneration: string }[]> {
      const result = await sql<{ shop_id: string; installation_generation: string }>`
        SELECT DISTINCT shop_id, installation_generation::text AS installation_generation FROM signing_keys
        WHERE state IN ('pending', 'active') ORDER BY shop_id, installation_generation`.execute(database);
      return result.rows.map((row) => ({ shopId: row.shop_id, installationGeneration: row.installation_generation }));
    },
    close: () => database.destroy(),
  };
}
