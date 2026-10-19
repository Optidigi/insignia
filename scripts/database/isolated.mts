/** Owned PostgreSQL18 fixture. Never reads an ambient database endpoint. */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
if (args[0] === '--help') {
  console.log(
    'node scripts/database/isolated.mts [-- command args...]\nRequires PostgreSQL18 initdb, pg_ctl and createdb on PATH or INSIGNIA_PG_BIN. Default: corepack pnpm check:database.',
  );
} else {
  if (args.length && args[0] !== '--') throw new Error('Use -- before the fixture command');
  const command = args.length ? args.slice(1) : ['corepack', 'pnpm', 'check:database'];
  const executable = command[0];
  if (!executable) throw new Error('Missing fixture command');
  const binary = (name: string) =>
    process.env.INSIGNIA_PG_BIN ? join(resolve(process.env.INSIGNIA_PG_BIN), name) : name;
  const root = await mkdtemp(join(tmpdir(), 'insignia-isolated-pg-'));
  const socket = join(root, 'socket');
  const data = join(root, 'data');
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  // Ignore every ambient connection selector, including libpq service/options.
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('PG') && key !== 'DATABASE_URL'),
  );
  Object.assign(env, { PGHOST: socket, PGPORT: '5432', PGUSER: 'insignia_local', PGDATABASE: 'insignia_local' });
  let interrupted = false;
  let fixtureCommand: ChildProcess | undefined;
  const interrupt = () => {
    interrupted = true;
    if (fixtureCommand?.pid) {
      try {
        process.kill(-fixtureCommand.pid, 'SIGTERM');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
      }
    }
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  async function run(file: string, argv: string[], capture = false): Promise<string> {
    return new Promise((accept, reject) => {
      let output = '';
      const child = spawn(file, argv, { env, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.once('error', reject);
      child.once('exit', (code, signal) =>
        code === 0 ? accept(output) : reject(new Error(`${file} failed (${signal ?? code})`)),
      );
    });
  }
  async function cleanup() {
    try {
      if (existsSync(join(data, 'postmaster.pid')))
        await run(binary('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']);
    } catch (error) {
      console.error(`Fixture shutdown failed; retained ${root}`);
      throw error;
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
    }
    await rm(root, { recursive: true, force: true });
  }
  try {
    const version = await run(binary('initdb'), ['--version'], true);
    if (!/\(PostgreSQL\) 18\./.test(version)) throw new Error('PostgreSQL18 tools required');
    await mkdir(socket, { mode: 0o700 });
    const init = ['-D', data, '-A', 'trust', '-U', 'insignia_local', '--no-locale', '-E', 'UTF8'];
    if (process.env.INSIGNIA_PG_SHARE) init.push('-L', resolve(process.env.INSIGNIA_PG_SHARE));
    await run(binary('initdb'), init);
    await run(binary('pg_ctl'), [
      '-D',
      data,
      '-l',
      join(root, 'postgres.log'),
      '-o',
      `-k ${quote(socket)} -h '' -p 5432`,
      '-w',
      'start',
    ]);
    await run(binary('createdb'), ['insignia_local']);
    if (interrupted) throw new Error('Fixture interrupted before command');
    const address = new URL('postgresql://insignia_local@localhost/insignia_local');
    address.searchParams.set('host', socket);
    env.DATABASE_URL = address.href;
    console.log('Owned PostgreSQL18 fixture ready; private Unix socket, TCP disabled.');
    await new Promise<void>((accept, reject) => {
      fixtureCommand = spawn(executable, command.slice(1), { env, stdio: 'inherit', detached: true });
      fixtureCommand.once('error', reject);
      fixtureCommand.once('exit', (code, signal) =>
        code === 0 ? accept() : reject(new Error(`Fixture command failed (${signal ?? code})`)),
      );
    });
  } finally {
    await cleanup();
  }
}
