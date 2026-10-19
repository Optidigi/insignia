import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { isIP } from 'node:net';
import { array, errorCode, errorMessage, object, required, text } from '../runtime/validation.mts';

export interface ImageCommandOptions {
  input?: string | Buffer;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeout?: number;
}
export interface ImageCommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  aborted: boolean;
  timedOut: boolean;
}
export type ImageRunner = (args: string[], options?: ImageCommandOptions) => Promise<unknown>;
export async function runImageCommand(
  command: string,
  args: string[],
  { input, cwd, env = process.env, signal, timeout = 60_000 }: ImageCommandOptions = {},
): Promise<ImageCommandResult> {
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
        if (errorCode(error) !== 'ESRCH') stderr += errorMessage(error);
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

export async function finalizeImageFixture({
  containerNames,
  cleanupCommands,
  run,
  timeoutScale = 1,
}: {
  containerNames: string[];
  cleanupCommands: string[][];
  run: ImageRunner;
  timeoutScale?: number;
}) {
  assert.ok(Number.isFinite(timeoutScale) && timeoutScale > 0 && timeoutScale <= 1);
  // Each operation owns a fresh budget, including the runner's raw-log write.
  // An earlier timeout must never prevent a later owned removal from launching.
  const operationOptions = (timeout: number) => ({
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
      logs.push({ name, status: 'FAIL', error: errorMessage(error) });
    }
  }
  for (const args of cleanupCommands) {
    try {
      await run(args, operationOptions(10_000));
      cleanup.push({ args, status: 'PASS' });
    } catch (error) {
      cleanup.push({ args, status: 'FAIL', error: errorMessage(error) });
    }
  }
  return { status: [...logs, ...cleanup].every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL', logs, cleanup };
}

export function assembleImageInventoryProbe(source: string) {
  source = stripTypeScriptTypes(source, { mode: 'strip' });
  return `${source}\nconsole.log(JSON.stringify(collectWorkerInventory('/srv/insignia/worker/dist/main.js')));`;
}

export function assembleImageProcessProbe() {
  return stripTypeScriptTypes(readFileSync(new URL('./process-probe.mts', import.meta.url), 'utf8'), { mode: 'strip' });
}

export function assembleDatabaseFixtureProbe() {
  return stripTypeScriptTypes(readFileSync(new URL('./database-fixture-probe.mts', import.meta.url), 'utf8'), {
    mode: 'strip',
  });
}

export function qualifyFixtureDatabase({
  container: containerInput,
  network: networkInput,
  expectedContainerId,
  expectedName,
  expectedNetworkId,
  expectedNetworkName,
}: {
  container: unknown;
  network: unknown;
  expectedContainerId: string;
  expectedName: string;
  expectedNetworkId: string;
  expectedNetworkName: string;
}) {
  const container = object(containerInput),
    network = object(networkInput);
  assert.match(expectedContainerId, /^[a-f0-9]{64}$/);
  assert.match(expectedNetworkId, /^[a-f0-9]{64}$/);
  assert.equal(container.Id, expectedContainerId);
  assert.equal(container.Name, `/${expectedName}`);
  assert.equal(network.Id, expectedNetworkId);
  assert.equal(network.Name, expectedNetworkName);
  assert.equal(network.Driver, 'bridge');
  assert.equal(network.Internal, true);
  assert.equal(network.EnableIPv6, false);
  assert.deepEqual(object(container.HostConfig).PortBindings ?? {}, {}, 'no requested fixture publication');
  assert.equal(object(container.HostConfig).PublishAllPorts, false);
  assert.ok(
    Object.values(object(object(container.NetworkSettings).Ports)).every((value) => value === null),
    'no actual fixture publication',
  );
  assert.deepEqual(Object.keys(object(object(container.NetworkSettings).Networks)), [expectedNetworkName]);
  const endpoint = object(object(object(container.NetworkSettings).Networks)[expectedNetworkName]);
  assert.equal(endpoint.NetworkID, expectedNetworkId);
  const address = text(endpoint.IPAddress);
  assert.equal(isIP(address), 4, 'literal IPv4 fixture address required');
  const privateRange = (value: string) => {
    const [first, second] = value.split('.').map(Number);
    if (first === 10) return '10';
    if (first === 172 && required(second) >= 16 && required(second) <= 31) return '172';
    if (first === 192 && second === 168) return '192';
    return null;
  };
  assert.ok(privateRange(address), 'RFC1918 fixture address required');
  assert.equal(array(object(network.IPAM).Config).length, 1);
  const subnet = object(required(array(object(network.IPAM).Config)[0]));
  const Subnet = text(subnet.Subnet),
    Gateway = subnet.Gateway;
  assert.equal(Subnet.split('/').length, 2);
  const parts = Subnet.split('/');
  const base = required(parts[0]),
    bits = required(parts[1]);
  assert.equal(isIP(base), 4);
  assert.match(bits, /^(?:[1-9]|[12][0-9]|3[0-2])$/);
  const prefix = Number(bits);
  const ipv4Number = (value: string) => value.split('.').reduce((sum, octet) => sum * 256 + Number(octet), 0);
  const size = 2 ** (32 - prefix);
  const start = ipv4Number(base);
  assert.equal(start % size, 0, 'canonical owned subnet required');
  const last = start + size - 1;
  const lastAddress = [24, 16, 8, 0].map((shift) => (last >>> shift) & 255).join('.');
  assert.ok(privateRange(base));
  assert.equal(privateRange(base), privateRange(lastAddress), 'entire owned subnet must be RFC1918');
  assert.ok(ipv4Number(address) > start && ipv4Number(address) < last, 'fixture address must be inside owned subnet');
  assert.notEqual(address, Gateway, 'fixture address cannot be bridge gateway');
  assert.equal(endpoint.IPPrefixLen, prefix);
  assert.equal(object(object(network.Containers)[text(container.Id)]).Name, expectedName);
  assert.equal(object(object(network.Containers)[text(container.Id)]).IPv4Address, `${address}/${prefix}`);
  return `postgres://insignia_test:synthetic-owner@${address}:5432/insignia_image_test?sslmode=disable`;
}

export function qualifyImageConfiguration(value: unknown) {
  const image = object(value);
  assert.deepEqual(object(image.Config).Cmd, ['/usr/local/bin/node', '/srv/insignia/worker/dist/main.js']);
  assert.deepEqual(object(image.Config).Entrypoint ?? [], [], 'direct Node launcher requires no inherited entrypoint');
  assert.equal(object(image.Config).User, 'node');
}

// Qualification of native Docker/Linux observations, never a substitute for collecting them.
export function qualifyImageRuntime({
  imageId,
  container: containerInput,
  network: networkInput,
  process: processInput,
  inventory: inventoryInput,
  expectedInventory,
}: {
  imageId: string;
  container: unknown;
  network: unknown;
  process: unknown;
  inventory: unknown;
  expectedInventory: unknown;
}) {
  const container = object(containerInput),
    network = object(networkInput),
    process = object(processInput),
    inventory = object(inventoryInput);
  const command = ['/usr/local/bin/node', '/srv/insignia/worker/dist/main.js'];
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(container.Image, imageId, 'built image identity');
  assert.deepEqual(inventory, expectedInventory, 'frozen package and Node inventory');
  assert.equal(inventory.node, 'v24.21.0');
  assert.equal(process.nodeExecutableSha256, inventory.nodeExecutableSha256, 'PID1 executable identity');
  assert.equal(object(container.Config).User, 'node');
  assert.equal(container.Path, command[0]);
  assert.deepEqual(container.Args, command.slice(1));
  assert.deepEqual(process.argv, command, 'direct Node PID1');
  assert.deepEqual(process.uid, [1000, 1000, 1000, 1000], 'nonroot PID1');
  assert.deepEqual(process.gid, [1000, 1000, 1000, 1000]);
  assert.equal(object(container.HostConfig).ReadonlyRootfs, true, 'read-only root filesystem required');
  assert.equal(process.rootWriteError, 'EROFS', 'actual root filesystem write denial');
  assert.equal(object(container.HostConfig).Privileged, false);
  assert.deepEqual(object(container.HostConfig).CapDrop, ['ALL']);
  assert.deepEqual(object(container.HostConfig).CapAdd ?? [], []);
  assert.deepEqual(object(container.HostConfig).SecurityOpt, ['no-new-privileges:true']);
  assert.deepEqual(process.capabilities, Array(5).fill('0000000000000000'), 'PID1 capability sets');
  assert.equal(process.noNewPrivileges, 1);
  assert.deepEqual(container.Mounts, [], 'no executable or writable mounts');
  assert.deepEqual(object(container.HostConfig).PortBindings ?? {}, {}, 'no published worker ports');
  assert.equal(network.Internal, true);
  assert.equal(network.EnableIPv6, false, 'this qualification requires IPv4-only network');
  const networks = Object.values(object(object(container.NetworkSettings).Networks));
  assert.equal(networks.length, 1);
  assert.equal(object(required(networks[0])).NetworkID, network.Id);
  assert.equal(process.defaultRoute, false);
  assert.equal(process.externalConnect, false);
}
