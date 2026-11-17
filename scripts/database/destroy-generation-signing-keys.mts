/**
 * Operator command: destroy the signing keys of ONE named, already deactivated installation
 * generation. Since migration 71 every deactivation destroys its generation's keys itself; this
 * covers a generation deactivated before that. It never sweeps: the operator names the shop and
 * the generation, and it refuses a generation that is still active.
 *
 *   DATABASE_URL=<schema owner> node scripts/database/destroy-generation-signing-keys.mts \
 *     --shop <tenant shop uuid> --generation <n> [--apply]
 *
 * Without --apply it is a dry run: it prints the generation's keys (id, state, whether a private
 * half remains) and the ids it would destroy. With --apply it destroys them through the existing
 * lifecycle operation (SigningKeyLifecycle.destroyInactiveInstallationKeys), which re-checks the
 * deactivation under row locks. Public keys stay, so the generation's recorded orders still verify.
 * Output is one JSON line; no key material or connection string is ever printed. It imports
 * packages/database/dist: build that package first (corepack pnpm --filter @insignia/database build).
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { createDurableCore } from '../../packages/database/dist/index.js';

export type GenerationKeyInspection = {
  deactivatedAt: string | null;
  keys: { keyId: number; state: string; holdsPrivateHalf: boolean }[];
};
export interface GenerationSigningKeyPort {
  /** Null when the shop has no such generation. */
  inspect(shopId: string, generation: string): Promise<GenerationKeyInspection | null>;
  destroy(shopId: string, generation: string): Promise<number>;
  close(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const USAGE = 'usage: destroy-generation-signing-keys.mts --shop <shop uuid> --generation <n> [--apply]';

function parse(args: readonly string[]) {
  const named = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === '--apply' && !apply) apply = true;
    else if ((arg === '--shop' || arg === '--generation') && !named.has(arg) && value !== undefined) {
      named.set(arg, value);
      index++;
    } else return null;
  }
  const shopId = named.get('--shop');
  const generation = named.get('--generation');
  if (!shopId || !UUID.test(shopId) || !generation || !/^[1-9][0-9]{0,18}$/.test(generation)) return null;
  return { shopId, generation, apply };
}

export async function destroyGenerationSigningKeys(
  args: readonly string[],
  io: { connect(): Promise<GenerationSigningKeyPort>; write(line: string): void },
): Promise<number> {
  const request = parse(args);
  if (!request) {
    io.write(JSON.stringify({ refused: 'USAGE', usage: USAGE }));
    return 2;
  }
  const { shopId, generation, apply } = request;
  const port = await io.connect();
  try {
    const inspection = await port.inspect(shopId, generation);
    if (!inspection) {
      io.write(JSON.stringify({ refused: 'GENERATION_NOT_FOUND', shopId, generation }));
      return 1;
    }
    if (inspection.deactivatedAt === null) {
      io.write(JSON.stringify({ refused: 'GENERATION_ACTIVE', shopId, generation }));
      return 1;
    }
    if (!apply) {
      io.write(
        JSON.stringify({
          mode: 'dry-run',
          shopId,
          generation,
          deactivatedAt: inspection.deactivatedAt,
          keys: inspection.keys,
          wouldDestroy: inspection.keys.filter((key) => key.state !== 'destroyed').map((key) => key.keyId),
        }),
      );
      return 0;
    }
    const destroyed = await port.destroy(shopId, generation);
    io.write(JSON.stringify({ mode: 'apply', shopId, generation, destroyed }));
    return 0;
  } finally {
    await port.close();
  }
}

async function connect(connectionString: string): Promise<GenerationSigningKeyPort> {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000, query_timeout: 15000 });
  const core = createDurableCore(pool);
  return {
    async inspect(shopId, generation) {
      const installation = await pool.query<{ deactivated_at: Date | null }>(
        'SELECT deactivated_at FROM installation_generations WHERE shop_id=$1 AND generation=$2::bigint',
        [shopId, generation],
      );
      const row = installation.rows[0];
      if (!row) return null;
      // Only whether a private half remains; its contents are never selected.
      const keys = await pool.query<{ key_id: number; state: string; holds_private_half: boolean }>(
        `SELECT key_id, state, private_envelope IS NOT NULL AS holds_private_half FROM signing_keys
         WHERE shop_id=$1 AND installation_generation=$2::bigint ORDER BY key_id`,
        [shopId, generation],
      );
      return {
        deactivatedAt: row.deactivated_at?.toISOString() ?? null,
        keys: keys.rows.map((key) => ({
          keyId: key.key_id,
          state: key.state,
          holdsPrivateHalf: key.holds_private_half,
        })),
      };
    },
    destroy: (shopId, generation) => core.signingKeys.destroyInactiveInstallationKeys(shopId, generation),
    async close() {
      // The durable core ends the pool only once it has run a query itself.
      await core.close();
      if (!pool.ended) await pool.end();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    process.exitCode = await destroyGenerationSigningKeys(process.argv.slice(2), {
      connect: () => connect(url),
      write: (line) => console.log(line),
    });
  } catch {
    // Connection strings and database errors never appear in diagnostics.
    console.error('Signing key destruction failed; nothing is reported as destroyed.');
    process.exitCode = 1;
  }
}
