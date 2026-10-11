/** Explicit owner-request operation. Not HTTP admission, worker startup or provider IO. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerRequire = createRequire(new URL('../../apps/worker/package.json', import.meta.url));
const { Pool } = workerRequire('pg');
const databaseEntry = workerRequire.resolve('@insignia/database');
const { applyOwnerLifecycleDecision } = await import(pathToFileURL(databaseEntry).href);
assert.equal(typeof applyOwnerLifecycleDecision, 'function', 'reviewed_owner_operation_missing');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const poolFor = (url) =>
  new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000, query_timeout: 10000 });
export const OWNER_APP_CLIENT_ID = '1443cf6d03d39edae7c101a943c5c684';
const version = 'm5-private-owner-lifecycle-v1';
async function directoryGuard(directory) {
  assert.ok(isAbsolute(directory) && resolve(directory) === directory);
  assert.equal(await realpath(directory), directory);
  const s = await stat(directory);
  assert.ok(s.isDirectory() && s.uid === process.getuid() && (s.mode & 0o077) === 0, 'private_directory_required');
}
async function privateRead(path) {
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await f.stat();
    assert.ok(
      s.isFile() && s.uid === process.getuid() && s.nlink === 1 && (s.mode & 0o077) === 0 && s.size <= 1048576,
      'private_input_required',
    );
    return await f.readFile();
  } finally {
    await f.close();
  }
}
async function durable(path, value) {
  const f = await open(path, 'wx', 0o600);
  try {
    await f.writeFile(`${JSON.stringify(value)}\n`);
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
async function sources() {
  const base = dirname(databaseEntry);
  const paths = [
    fileURLToPath(import.meta.url),
    databaseEntry,
    join(base, 'repositories/owner-lifecycle.js'),
    join(base, 'repositories/tenant.js'),
    join(base, 'client/database.js'),
    join(base, 'hash/canonical.js'),
  ];
  return Object.fromEntries(await Promise.all(paths.map(async (p) => [p, hash(await readFile(p))])));
}
async function snapshot(pool, db, decision) {
  const identity = (
    await pool.query(
      "select current_user as role,current_database() as database,current_setting('server_version_num')::int/10000 as major,(pg_control_system()).system_identifier::text as system_identifier,pg_get_userbyid(datdba) as owner from pg_database where datname=current_database()",
    )
  ).rows[0];
  assert.equal(identity.role, 'insignia_rewrite');
  assert.equal(identity.owner, 'insignia_rewrite');
  assert.equal(identity.major, 18);
  assert.equal(identity.database, db);
  const migrations = (await pool.query('select version from schema_migrations order by version')).rows.map(
    (r) => r.version,
  );
  assert.equal(migrations.length, 20);
  assert.deepEqual(migrations.slice(-2), ['20261011000100', '20261011000200']);
  const shops = (
    await pool.query(
      'select shop_id,shop_domain,shopify_shop_id,current_generation from shops where shop_domain=$1 or shopify_shop_id=$2 order by shop_id',
      [decision.shopDomain, decision.providerShopId],
    )
  ).rows;
  const installations = (
    await pool.query(
      'select shop_id,generation,external_installation_id,activated_at::text,deactivated_at::text from installation_generations where shop_id=any($1) order by shop_id,generation',
      [shops.map((s) => s.shop_id)],
    )
  ).rows;
  return { identity, migrations, shops, installations };
}
async function originalBodyEvidence(decision, files) {
  const bindings = (decision.privacy?.receipts ?? []).filter((r) => r.originalBodyShopBinding);
  assert.deepEqual(
    Object.keys(files).sort(),
    bindings.map((r) => r.id).sort(),
    'original_body_evidence_files_required',
  );
  for (const receipt of bindings) {
    const binding = receipt.originalBodyShopBinding;
    assert.ok(
      binding.providerShopId === decision.providerShopId &&
        binding.bodySha256 === receipt.bodySha256 &&
        /^[a-f0-9]{64}$/.test(binding.evidenceSha256),
      'original_body_shop_binding_required',
    );
    assert.equal(hash(await privateRead(files[receipt.id])), binding.evidenceSha256, 'original_body_evidence_changed');
  }
}
export async function reserveOwnerLifecycle({
  directory,
  ownerConnectionString,
  expectedDatabase,
  decision,
  nativeEvidenceFile,
  ownerRequestFile,
  preInstallationInventoryFile,
  originalBodyEvidenceFiles = {},
}) {
  assert.match(expectedDatabase, /^[a-z][a-z0-9_]{0,62}$/);
  const url = new URL(ownerConnectionString);
  assert.ok(
    ['postgres:', 'postgresql:'].includes(url.protocol) &&
      url.username === 'insignia_rewrite' &&
      url.password &&
      url.pathname === `/${expectedDatabase}`,
    'owner_endpoint_required',
  );
  assert.equal(decision.appClientId, OWNER_APP_CLIENT_ID);
  assert.equal(decision.shopDomain, 'stitchs-vat-verification-20261004.myshopify.com');
  assert.equal(hash(await privateRead(nativeEvidenceFile)), decision.native.evidenceSha256, 'native_receipt_changed');
  assert.equal(
    hash(await privateRead(ownerRequestFile)),
    decision.authority.requestEvidenceSha256,
    'owner_request_changed',
  );
  assert.equal(
    hash(await privateRead(preInstallationInventoryFile)),
    decision.native.preInstallationInventorySha256,
    'pre_installation_gate_changed',
  );
  await originalBodyEvidence(decision, originalBodyEvidenceFiles);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await directoryGuard(directory);
  assert.equal((await readdir(directory)).length, 0, 'empty_private_directory_required');
  const pool = poolFor(ownerConnectionString);
  try {
    const frozen = await snapshot(pool, expectedDatabase, decision);
    await durable(join(directory, 'private-input.json'), {
      ownerConnectionString,
      decision,
      originalBodyEvidenceFiles,
    });
    await durable(join(directory, 'plan.json'), {
      version,
      expectedDatabase,
      frozen,
      sources: await sources(),
      inputSha256: hash(await privateRead(join(directory, 'private-input.json'))),
      attempts: 1,
    });
    return { status: 'FROZEN', providerWrites: 0, ownerOperation: decision.operation };
  } finally {
    await pool.end();
  }
}
export async function executeOwnerLifecycle(directory) {
  await directoryGuard(directory);
  assert.ok(!(await readdir(directory)).includes('attempt.json'), 'owner_attempt_already_reserved');
  const plan = JSON.parse(await privateRead(join(directory, 'plan.json')));
  assert.equal(plan.version, version);
  assert.equal(plan.attempts, 1);
  assert.deepEqual(await sources(), plan.sources, 'frozen_source_changed');
  const raw = await privateRead(join(directory, 'private-input.json'));
  assert.equal(hash(raw), plan.inputSha256, 'frozen_input_changed');
  const input = JSON.parse(raw);
  await originalBodyEvidence(input.decision, input.originalBodyEvidenceFiles ?? {});
  await durable(join(directory, 'attempt.json'), {
    status: 'RESERVED',
    planSha256: hash(await privateRead(join(directory, 'plan.json'))),
    providerWrites: 0,
  });
  const pool = poolFor(input.ownerConnectionString);
  let phase = 'DATABASE_CAS';
  try {
    assert.deepEqual(
      await snapshot(pool, plan.expectedDatabase, input.decision),
      plan.frozen,
      'frozen_installation_changed',
    );
    phase = 'OWNER_OPERATION';
    const result = await applyOwnerLifecycleDecision(pool, input.decision);
    phase = 'DURABLE_RECEIPT';
    await durable(join(directory, 'result.json'), { status: 'ACKNOWLEDGED', result });
    return {
      status: 'ACKNOWLEDGED',
      outcome: result.outcome,
      providerWrites: 0,
      fullPrivacyOrUnattendedUninstallQualified: false,
    };
  } catch {
    await durable(join(directory, 'stopped.json'), { status: 'STOP_OWNER_OPERATION_UNCERTAIN', phase }).catch(() => {});
    return { status: 'STOP_OWNER_OPERATION_UNCERTAIN', phase, providerWrites: 0 };
  } finally {
    await pool.end().catch(() => {});
  }
}
/** Read-only ambiguity resolution; never redispatch the consumed mutation. */
export async function readOwnerLifecycleSettlement(directory) {
  await directoryGuard(directory);
  const plan = JSON.parse(await privateRead(join(directory, 'plan.json')));
  assert.equal(plan.version, version);
  assert.deepEqual(await sources(), plan.sources, 'frozen_source_changed');
  const raw = await privateRead(join(directory, 'private-input.json'));
  assert.equal(hash(raw), plan.inputSha256);
  const input = JSON.parse(raw);
  const pool = poolFor(input.ownerConnectionString);
  try {
    const identity = (await pool.query('select current_user as role,current_database() as database')).rows[0];
    assert.deepEqual(identity, { role: 'insignia_rewrite', database: plan.expectedDatabase });
    const row = (
      await pool.query('select request_sha256,result from owner_lifecycle_decisions where decision_id=$1', [
        input.decision.decisionId,
      ])
    ).rows[0];
    if (!row) return { status: 'NOT_ACKNOWLEDGED_NO_RETRY', providerWrites: 0 };
    const { sha256CanonicalJson } = await import(pathToFileURL(databaseEntry).href);
    assert.equal(row.request_sha256, sha256CanonicalJson(input.decision));
    return {
      status: 'SETTLED_READ_ONLY',
      outcome: row.result.outcome,
      providerWrites: 0,
      fullPrivacyOrUnattendedUninstallQualified: false,
    };
  } finally {
    await pool.end();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 4);
    const operation = process.argv[2],
      directory = process.argv[3];
    let result;
    if (operation === 'reserve') {
      assert.notEqual(process.stdin.isTTY, true);
      const chunks = [];
      let size = 0;
      for await (const c of process.stdin) {
        size += c.length;
        assert.ok(size <= 1048576);
        chunks.push(c);
      }
      result = await reserveOwnerLifecycle({ directory, ...JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    } else if (operation === 'readback') {
      result = await readOwnerLifecycleSettlement(directory);
    } else {
      assert.equal(operation, 'execute');
      result = await executeOwnerLifecycle(directory);
    }
    console.log(JSON.stringify(result));
    if (!['FROZEN', 'ACKNOWLEDGED', 'SETTLED_READ_ONLY'].includes(result.status)) process.exitCode = 1;
  } catch {
    console.error('owner_lifecycle_stopped');
    process.exitCode = 1;
  }
}
