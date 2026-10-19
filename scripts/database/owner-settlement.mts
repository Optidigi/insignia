import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { sha256CanonicalJson } from '../../packages/database/dist/index.js';

const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
function object(value: unknown): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'invalid_private_record');
  return Object.fromEntries(Object.entries(value));
}
async function privateRead(path: string): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    assert(
      info.isFile() &&
        info.uid === process.getuid?.() &&
        info.nlink === 1 &&
        (info.mode & 0o077) === 0 &&
        info.size <= 1048576,
      'private_input_required',
    );
    return await file.readFile();
  } finally {
    await file.close();
  }
}

export interface SettlementLookup {
  identity(): Promise<{ role: string; database: string }>;
  decision(id: string): Promise<{ requestSha256: string; result: unknown } | undefined>;
  close(): Promise<void>;
}

/** Historical acknowledgment only. There is deliberately no reserve/execute/retry operation.
 * Old source hashes remain evidence in the sealed plan, not a requirement to execute old code. */
export async function readOwnerLifecycleSettlement(
  directory: string,
  connect: (url: string) => Promise<SettlementLookup> = connectReadOnly,
) {
  assert(isAbsolute(directory) && resolve(directory) === directory, 'absolute_private_directory_required');
  assert.equal(await realpath(directory), directory, 'private_directory_symlink');
  const info = await stat(directory);
  assert(
    info.isDirectory() && info.uid === process.getuid?.() && (info.mode & 0o077) === 0,
    'private_directory_required',
  );
  const plan = object(JSON.parse((await privateRead(join(directory, 'plan.json'))).toString()) as unknown);
  assert.equal(plan.version, 'm5-private-owner-lifecycle-v1');
  assert(
    typeof plan.expectedDatabase === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(plan.expectedDatabase),
    'invalid_database_identity',
  );
  assert(typeof plan.inputSha256 === 'string' && /^[a-f0-9]{64}$/.test(plan.inputSha256), 'invalid_input_digest');
  const raw = await privateRead(join(directory, 'private-input.json'));
  assert.equal(hash(raw), plan.inputSha256, 'private_input_changed');
  const input = object(JSON.parse(raw.toString()) as unknown);
  const decision = object(input.decision);
  assert(
    typeof decision.decisionId === 'string' &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(decision.decisionId),
    'invalid_decision_identity',
  );
  assert.equal(decision.version, 'm5-owner-lifecycle-v1');
  assert.equal(decision.appClientId, '1443cf6d03d39edae7c101a943c5c684');
  assert.equal(decision.shopDomain, 'stitchs-vat-verification-20261004.myshopify.com');
  assert(typeof input.ownerConnectionString === 'string', 'owner_endpoint_required');
  const url = new URL(input.ownerConnectionString);
  assert(
    ['postgres:', 'postgresql:'].includes(url.protocol) &&
      url.username === 'insignia_rewrite' &&
      url.password &&
      url.pathname === `/${plan.expectedDatabase}`,
    'owner_endpoint_required',
  );
  const lookup = await connect(input.ownerConnectionString);
  try {
    assert.deepEqual(
      await lookup.identity(),
      { role: 'insignia_rewrite', database: plan.expectedDatabase },
      'database_identity_changed',
    );
    const row = await lookup.decision(decision.decisionId);
    if (!row) return { status: 'NOT_ACKNOWLEDGED_NO_RETRY', providerWrites: 0 } as const;
    assert.equal(row.requestSha256, sha256CanonicalJson(input.decision), 'decision_digest_changed');
    const result = object(row.result);
    assert(
      typeof result.outcome === 'string' &&
        [
          'OWNER_DEACTIVATED',
          'OWNER_ALREADY_INACTIVE',
          'OWNER_NO_DURABLE_INSTALLATION',
          'OWNER_RECEIPTS_ERASED',
        ].includes(result.outcome),
      'invalid_settlement_outcome',
    );
    return {
      status: 'SETTLED_READ_ONLY',
      outcome: result.outcome,
      providerWrites: 0,
      fullPrivacyOrUnattendedUninstallQualified: false,
    } as const;
  } finally {
    await lookup.close();
  }
}

async function connectReadOnly(connectionString: string): Promise<SettlementLookup> {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000, query_timeout: 10000 });
  const client = await pool.connect().catch(async (error: unknown) => {
    await pool.end();
    throw error;
  });
  try {
    await client.query('BEGIN READ ONLY');
  } catch (error) {
    client.release();
    await pool.end();
    throw error;
  }
  return {
    async identity() {
      const result = await client.query<{ role: unknown; database: unknown }>(
        'select current_user as role,current_database() as database',
      );
      const row = result.rows[0];
      assert(
        result.rows.length === 1 && row && typeof row.role === 'string' && typeof row.database === 'string',
        'invalid_database_identity',
      );
      return { role: row.role, database: row.database };
    },
    async decision(id) {
      const result = await client.query<{ request_sha256: unknown; result: unknown }>(
        'select request_sha256,result from owner_lifecycle_decisions where decision_id=$1',
        [id],
      );
      assert(result.rows.length <= 1, 'ambiguous_decision');
      const row = result.rows[0];
      if (!row) return undefined;
      assert(typeof row.request_sha256 === 'string', 'invalid_decision_digest');
      return { requestSha256: row.request_sha256, result: row.result };
    },
    async close() {
      try {
        await client.query('ROLLBACK');
      } finally {
        client.release();
        await pool.end();
      }
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assert(
      process.argv.length === 3 && process.argv[2],
      'usage: owner-settlement.mts /absolute/private/plan-directory',
    );
    const result = await readOwnerLifecycleSettlement(process.argv[2]);
    console.log(JSON.stringify(result));
    if (result.status !== 'SETTLED_READ_ONLY') process.exitCode = 1;
  } catch {
    // Connection strings and sealed plan contents never appear in diagnostics.
    console.error('Historical owner settlement read failed; no redispatch is permitted.');
    process.exitCode = 1;
  }
}
