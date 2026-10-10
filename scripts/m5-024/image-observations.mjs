import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { isIP } from 'node:net';

export async function runImageCommand(command, args, { input, cwd, env = process.env, signal, timeout = 60_000 } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve) => {
    // Linux process groups include the installer and any child tools. Await close
    // after SIGKILL rather than racing a still-running database operation.
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let aborted = false;
    let timedOut = false;
    const kill = () => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') stderr += error.message;
      }
    };
    const abort = () => {
      aborted = true;
      kill();
    };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeout);
    child.stdout.on('data', (bytes) => {
      stdout += bytes;
    });
    child.stderr.on('data', (bytes) => {
      stderr += bytes;
    });
    child.once('error', (error) => {
      stderr += error.message;
    });
    child.once('close', (code, exitSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve({ code, signal: exitSignal, stdout, stderr, aborted, timedOut });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    if (signal?.aborted) abort();
  });
}

export async function finalizeImageFixture({ containerNames, cleanupCommands, run, timeoutScale = 1 }) {
  assert.ok(Number.isFinite(timeoutScale) && timeoutScale > 0 && timeoutScale <= 1);
  // Each operation owns a fresh budget, including the runner's raw-log write.
  // An earlier timeout must never prevent a later owned removal from launching.
  const operationOptions = (timeout) => ({
    signal: AbortSignal.timeout(Math.ceil((timeout + 5000) * timeoutScale)),
    timeout: Math.ceil(timeout * timeoutScale),
  });
  const logs = [];
  const cleanup = [];
  for (const name of containerNames) {
    try {
      await run(['logs', name], operationOptions(5000));
      logs.push({ name, status: 'PASS' });
    } catch (error) {
      logs.push({ name, status: 'FAIL', error: error.message });
    }
  }
  for (const args of cleanupCommands) {
    try {
      await run(args, operationOptions(10_000));
      cleanup.push({ args, status: 'PASS' });
    } catch (error) {
      cleanup.push({ args, status: 'FAIL', error: error.message });
    }
  }
  return { status: [...logs, ...cleanup].every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL', logs, cleanup };
}

export function assembleImageInventoryProbe(source) {
  return `${source}\nconsole.log(JSON.stringify(collectWorkerInventory('/srv/insignia/worker/dist/main.js')));`;
}

export function assembleDatabaseFixtureProbe() {
  return `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const { Pool } = createRequire(resolve('apps/worker/package.json'))('pg');
const options = { connectionTimeoutMillis: 3000, query_timeout: 5000, statement_timeout: 4000 };
const ownerUrl = process.env.DATABASE_URL;
const pool = new Pool({ ...options, connectionString: ownerUrl });
let login;
try {
  const serverVersion = (await pool.query('show server_version_num')).rows[0].server_version_num;
  assert.equal(Math.floor(Number(serverVersion) / 10000), 18);
  await pool.query(await readFile('scripts/m5-024/queue-roles.sql', 'utf8'));
  await pool.query("create role image_worker login password 'synthetic-worker' nosuperuser nocreatedb nocreaterole noreplication nobypassrls; grant insignia_queue_consume to image_worker");
  login = new Pool({ ...options, connectionString: ownerUrl.replace('insignia_test:synthetic-owner', 'image_worker:synthetic-worker') });
  const currentUser = (await login.query('select current_user')).rows[0].current_user;
  assert.equal(currentUser, 'image_worker');
  const roleFlags = (await login.query('select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user')).rows[0];
  assert.deepEqual(roleFlags, { rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false });
  const memberships = (await login.query('select r.rolname from pg_auth_members m join pg_roles r on r.oid=m.roleid where m.member=(select oid from pg_roles where rolname=current_user) order by r.rolname')).rows.map(row => row.rolname);
  assert.deepEqual(memberships, ['insignia_queue_consume']);
  const denied = [];
  for (const sql of ['create table pgboss.escape(id int)', 'create schema escape', 'truncate pgboss.job', 'update pgboss.version set version=42']) {
    await assert.rejects(login.query(sql), { code: '42501' });
    denied.push({ sql, sqlstate: '42501' });
  }
  assert.equal((await login.query('select version from pgboss.version')).rows[0].version, 43);
  console.log(JSON.stringify({ serverVersion, currentUser, roleFlags, memberships, denied, schemaVersion: 43 }));
} finally {
  // The parent bounds the entire child lifetime, including both pool.end waits.
  try { await login?.end(); } finally { await pool.end(); }
}
`;
}

export function qualifyFixtureDatabase({
  container,
  network,
  expectedContainerId,
  expectedName,
  expectedNetworkId,
  expectedNetworkName,
}) {
  assert.match(expectedContainerId, /^[a-f0-9]{64}$/);
  assert.match(expectedNetworkId, /^[a-f0-9]{64}$/);
  assert.equal(container.Id, expectedContainerId);
  assert.equal(container.Name, `/${expectedName}`);
  assert.equal(network.Id, expectedNetworkId);
  assert.equal(network.Name, expectedNetworkName);
  assert.equal(network.Driver, 'bridge');
  assert.equal(network.Internal, true);
  assert.equal(network.EnableIPv6, false);
  assert.deepEqual(container.HostConfig.PortBindings ?? {}, {}, 'no requested fixture publication');
  assert.equal(container.HostConfig.PublishAllPorts, false);
  assert.ok(
    Object.values(container.NetworkSettings.Ports).every((value) => value === null),
    'no actual fixture publication',
  );
  assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [expectedNetworkName]);
  const endpoint = container.NetworkSettings.Networks[expectedNetworkName];
  assert.equal(endpoint.NetworkID, expectedNetworkId);
  const address = endpoint.IPAddress;
  assert.equal(isIP(address), 4, 'literal IPv4 fixture address required');
  const privateRange = (value) => {
    const [first, second] = value.split('.').map(Number);
    if (first === 10) return '10';
    if (first === 172 && second >= 16 && second <= 31) return '172';
    if (first === 192 && second === 168) return '192';
    return null;
  };
  assert.ok(privateRange(address), 'RFC1918 fixture address required');
  assert.equal(network.IPAM.Config.length, 1);
  const { Subnet, Gateway } = network.IPAM.Config[0];
  assert.equal(Subnet.split('/').length, 2);
  const [base, bits] = Subnet.split('/');
  assert.equal(isIP(base), 4);
  assert.match(bits, /^(?:[1-9]|[12][0-9]|3[0-2])$/);
  const prefix = Number(bits);
  const number = (value) => value.split('.').reduce((sum, octet) => sum * 256 + Number(octet), 0);
  const size = 2 ** (32 - prefix);
  const start = number(base);
  assert.equal(start % size, 0, 'canonical owned subnet required');
  const last = start + size - 1;
  const lastAddress = [24, 16, 8, 0].map((shift) => (last >>> shift) & 255).join('.');
  assert.ok(privateRange(base));
  assert.equal(privateRange(base), privateRange(lastAddress), 'entire owned subnet must be RFC1918');
  assert.ok(number(address) > start && number(address) < last, 'fixture address must be inside owned subnet');
  assert.notEqual(address, Gateway, 'fixture address cannot be bridge gateway');
  assert.equal(endpoint.IPPrefixLen, prefix);
  assert.equal(network.Containers[container.Id].Name, expectedName);
  assert.equal(network.Containers[container.Id].IPv4Address, `${address}/${prefix}`);
  return `postgres://insignia_test:synthetic-owner@${address}:5432/insignia_image_test?sslmode=disable`;
}

export function qualifyImageConfiguration(image) {
  assert.deepEqual(image.Config.Cmd, ['/usr/local/bin/node', '/srv/insignia/worker/dist/main.js']);
  assert.deepEqual(image.Config.Entrypoint ?? [], [], 'direct Node launcher requires no inherited entrypoint');
  assert.equal(image.Config.User, 'node');
}

// Qualification of native Docker/Linux observations, never a substitute for collecting them.
export function qualifyImageRuntime({ imageId, container, network, process, inventory, expectedInventory }) {
  const command = ['/usr/local/bin/node', '/srv/insignia/worker/dist/main.js'];
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(container.Image, imageId, 'built image identity');
  assert.deepEqual(inventory, expectedInventory, 'frozen package and Node inventory');
  assert.equal(inventory.node, 'v24.21.0');
  assert.equal(process.nodeExecutableSha256, inventory.nodeExecutableSha256, 'PID1 executable identity');
  assert.equal(container.Config.User, 'node');
  assert.equal(container.Path, command[0]);
  assert.deepEqual(container.Args, command.slice(1));
  assert.deepEqual(process.argv, command, 'direct Node PID1');
  assert.deepEqual(process.uid, [1000, 1000, 1000, 1000], 'nonroot PID1');
  assert.deepEqual(process.gid, [1000, 1000, 1000, 1000]);
  assert.equal(container.HostConfig.ReadonlyRootfs, true, 'read-only root filesystem required');
  assert.equal(process.rootWriteError, 'EROFS', 'actual root filesystem write denial');
  assert.equal(container.HostConfig.Privileged, false);
  assert.deepEqual(container.HostConfig.CapDrop, ['ALL']);
  assert.deepEqual(container.HostConfig.CapAdd ?? [], []);
  assert.deepEqual(container.HostConfig.SecurityOpt, ['no-new-privileges:true']);
  assert.deepEqual(process.capabilities, Array(5).fill('0000000000000000'), 'PID1 capability sets');
  assert.equal(process.noNewPrivileges, 1);
  assert.deepEqual(container.Mounts, [], 'no executable or writable mounts');
  assert.deepEqual(container.HostConfig.PortBindings ?? {}, {}, 'no published worker ports');
  assert.equal(network.Internal, true);
  assert.equal(network.EnableIPv6, false, 'this qualification requires IPv4-only network');
  const networks = Object.values(container.NetworkSettings.Networks);
  assert.equal(networks.length, 1);
  assert.equal(networks[0].NetworkID, network.Id);
  assert.equal(process.defaultRoute, false);
  assert.equal(process.externalConnect, false);
}
