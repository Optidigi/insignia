import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { required } from './validation.mts';

const { Pool }: typeof import('pg') = createRequire(new URL('../../apps/worker/package.json', import.meta.url))('pg');
const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = new URL('../../docs/delivery/evidence/m8-context-runtime/', import.meta.url);

export function qualificationTarget(value: unknown, suffix = randomUUID().replaceAll('-', '')) {
  if (typeof value !== 'string' || !value) throw new Error('local_owner_database_url_required');
  const owner = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(owner.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(owner.hostname) ||
    !/^[a-zA-Z0-9_]+$/.test(owner.username) ||
    [...owner.searchParams.keys()].some((key) => key !== 'sslmode') ||
    !/^\/(?:insignia_test|synthetic_[a-z0-9_]+)$/.test(owner.pathname) ||
    !/^[a-f0-9]{32}$/.test(suffix)
  )
    throw new Error('isolated_loopback_owner_required');
  const database = `synthetic_m8_runtime_${suffix}`;
  const target = new URL(owner);
  target.pathname = `/${database}`;
  return { owner, target, database };
}

export async function qualifyRuntime(ownerValue: string | undefined) {
  // Replace any prior invocation's evidence before parsing configuration or connecting.
  await mkdir(evidence, { recursive: true });
  await writeFile(
    new URL('runtime-role-ci.json', evidence),
    `${JSON.stringify({ database: null, migrations: [], status: 'FAIL', databaseRemoved: false }, null, 2)}\n`,
  );
  await writeFile(new URL('runtime-role-ci.log', evidence), 'M8 actual runtime qualification has not completed.\n');
  const { owner, target, database } = qualificationTarget(ownerValue);
  const ownerPool = new Pool({
    connectionString: owner.toString(),
    max: 1,
    connectionTimeoutMillis: 10000,
    query_timeout: 30000,
    statement_timeout: 30000,
    idleTimeoutMillis: 1000,
  });
  const secrets = [
    ownerValue,
    owner.toString(),
    target.toString(),
    owner.password,
    decodeURIComponent(owner.password),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  const safe = (value: string) =>
    secrets.reduce((text, secret) => text.replaceAll(secret, '[private-database-configuration]'), value);
  let transcript = '',
    created = false;
  const result: {
    database: string;
    migrations: { name: string; sha256: string }[];
    status: string;
    databaseRemoved: boolean;
  } = {
    database,
    migrations: [],
    status: 'FAIL',
    databaseRemoved: false,
  };
  async function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env, PGCONNECT_TIMEOUT: '10', PGOPTIONS: '-c statement_timeout=30000' },
      stdio: ['ignore', 'pipe', 'pipe'],
      // An owned process group lets a deadline kill dbmate/pnpm descendants before SQL cleanup.
      detached: true,
    });
    let output = '',
      outputBytes = 0,
      limited = false;
    function terminate() {
      if (limited) return;
      limited = true;
      output = ''; // Never emit a cut-off credential fragment after an output limit.
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    }
    function collect(chunk: unknown) {
      if (limited) return;
      if (!Buffer.isBuffer(chunk)) throw new Error('runtime_qualification_output_invalid');
      outputBytes += chunk.length;
      if (outputBytes > 1024 * 1024) {
        terminate();
        return;
      }
      output += chunk.toString();
    }
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const deadline = setTimeout(terminate, 5 * 60 * 1000);
    let code: number | null;
    try {
      code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', () => reject(new Error('runtime_qualification_command_failed')));
        child.once('close', resolve);
      });
    } finally {
      clearTimeout(deadline);
    }
    if (limited) {
      transcript += 'Owned qualification command exceeded its lifetime/output limit and was terminated.\n';
      throw new Error('runtime_qualification_command_limit');
    }
    const sanitized = safe(output);
    transcript += sanitized;
    process.stdout.write(sanitized);
    if (code !== 0) throw new Error('runtime_qualification_command_failed');
    return sanitized;
  }
  try {
    const version = required(
      (await ownerPool.query<{ server_version_num: string }>('SHOW server_version_num')).rows[0],
    ).server_version_num;
    if (Math.floor(Number(version) / 10000) !== 18) throw new Error('postgresql18_required');
    const migrationDirectory = new URL('../../packages/database/migrations/', import.meta.url);
    for (const name of (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort()) {
      result.migrations.push({
        name,
        sha256: createHash('sha256')
          .update(await readFile(new URL(name, migrationDirectory)))
          .digest('hex'),
      });
    }
    await ownerPool.query(`CREATE DATABASE ${database}`);
    created = true;
    await run('corepack', ['pnpm', 'db:migrate'], { DATABASE_URL: target.toString() });
    const output = await run(process.execPath, ['--test', 'apps/worker/test/purchase-runtime-role.test.mts'], {
      M8_RUNTIME_DATABASE_URL: target.toString(),
      M8_RUNTIME_EXPECT_RED: '',
    });
    if (!/tests 1/.test(output) || !/pass 1/.test(output) || !/skipped 0/.test(output))
      throw new Error('actual_runtime_test_required');
    result.status = 'PASS';
  } catch {
    result.status = 'FAIL';
    transcript += 'M8 actual runtime qualification failed; inspect the sanitized test transcript.\n';
  } finally {
    try {
      if (created) {
        // This identifier was newly created here, never supplied by the caller.
        await ownerPool.query(`DROP DATABASE ${database} WITH (FORCE)`);
        result.databaseRemoved = true;
      }
    } catch {
      result.status = 'FAIL';
      transcript += 'Owned runtime qualification database cleanup failed.\n';
    }
    await ownerPool.end();
    await mkdir(evidence, { recursive: true });
    await writeFile(new URL('runtime-role-ci.log', evidence), transcript);
    await writeFile(new URL('runtime-role-ci.json', evidence), `${JSON.stringify(result, null, 2)}\n`);
  }
  if (result.status !== 'PASS') throw new Error('m8_actual_runtime_qualification_failed');
  process.stdout.write(`M8 actual runtime PASS; owned test database removed: ${result.databaseRemoved}\n`);
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await qualifyRuntime(process.env.DATABASE_URL);
  } catch {
    process.stderr.write('M8 actual runtime qualification failed.\n');
    process.exitCode = 1;
  }
}
