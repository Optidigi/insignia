import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { constants, fstatSync, writeSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { errorCode, required } from './types.mts';

const self = fileURLToPath(import.meta.url);
const fixedService = fileURLToPath(new URL('./service.mts', import.meta.url));
const pins = new Map([
  ['process-guard.mts', '5768193dda5685b137875fe4e55fe95f92f2ed86ac4f2e9545e47ba54b95c514'],
  ['types.mts', 'fd29c0ca402a2de1f2905db13e3b5265c0fcf1a027956a99654841847032e385'],
  ['service.mts', '652c009598575d6dbb99769c4fe94a210d439d651ab631335c54229506fb4085'],
  ['receiver.mts', '47714e60f802961d2e5add54d4b92fe8a77251a7d6f26e559ee158e70c6d4418'],
  ['operator.mts', '3419488807121867e37f382a63d6c7364e8a89550aa51a7108f02eedb306e657'],
  ['store.mts', '64de057ab6f6c34a2b7e0c425862a13567d8d46dbccd2d9acdde37e2ead83826'],
  ['network-guard.mts', '529da450dbe0cdaf8109632f581cebfdc4fb505e900724650c409cdccc622220'],
  ['../../packages/shopify/src/webhook.ts', 'c44d188a2c6db0a023f5ed42f989c1757faf8c1b7cb45aa8c46a3ab5410a8f3f'],
]);
type Refused = { status: 'REFUSED' };
export type StopResult = { status: 'STOPPED' | 'STOP_UNCONFIRMED' };
type ExitResult = Refused | { code: number | null; signal: NodeJS.Signals | null };
type Ready = { status: 'READY'; port: number };
export interface SupervisorOptions {
  directory: string;
  signingFd: number;
  port?: number;
  deadlineMs?: number;
  expectedIdentity?: string;
}
export interface SupervisorHandle extends Ready {
  stop: () => Promise<StopResult>;
  done: Promise<{ status: string }>;
}
const refused = (): Refused => ({ status: 'REFUSED' });
const activeChildren = new Set<ReturnType<typeof ownedChild>>();
const supervised = new WeakMap<object, { directory: string; stop: () => Promise<{ status: string }> }>();
let interrupted = false;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Pure protocol boundary: never spawns or signals a caller-selected process.
export function observeReadyProtocol(stdout: Readable, stderr: Readable, { port = 0, deadlineMs = 10000 } = {}) {
  let text = '',
    bytes = 0,
    readySeen = false,
    settled = false;
  let resolveReady: (value: Ready | Refused) => void = () => {},
    resolveViolation: (value: Refused) => void = () => {};
  const ready = new Promise<Ready | Refused>((resolve) => {
    resolveReady = resolve;
  });
  const violation = new Promise<Refused>((resolve) => {
    resolveViolation = resolve;
  });
  const fail = () => {
    if (!settled) {
      settled = true;
      resolveReady(refused());
      resolveViolation(refused());
    }
  };
  const timer = setTimeout(fail, deadlineMs);
  const onData = (chunk: Buffer) => {
    bytes += chunk.length;
    if (readySeen || bytes > 128) {
      fail();
      return;
    }
    text += chunk.toString('utf8');
    if (!text.includes('\n')) return;
    const match = /^\{"status":"READY","port":([1-9][0-9]{0,4})\}\n$/.exec(text);
    const observed = match ? Number(match[1]) : 0;
    text = '';
    if (!match || observed > 65535 || (port !== 0 && port !== observed)) {
      fail();
      return;
    }
    readySeen = true;
    clearTimeout(timer);
    resolveReady({ status: 'READY', port: observed });
  };
  stdout.on('data', onData);
  stderr.on('data', fail);
  stdout.on('error', fail);
  stderr.on('error', fail);
  stdout.on('end', () => {
    if (!readySeen) fail();
  });
  return {
    ready,
    violation,
    close() {
      settled = true;
      clearTimeout(timer);
      stdout.off('data', onData);
      stderr.off('data', fail);
      text = '';
    },
  };
}

function ownedChild(script: string, args: string[], signingFd?: number, privatePipe = false, boundService = false) {
  const child = spawn(process.execPath, [script, ...args], {
    detached: true,
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
    stdio: boundService
      ? ['ignore', 'pipe', 'pipe', signingFd, 'pipe']
      : privatePipe
        ? ['ignore', 'pipe', 'pipe', 'pipe']
        : signingFd === undefined
          ? ['ignore', 'pipe', 'pipe']
          : ['ignore', 'pipe', 'pipe', signingFd],
  });
  let exited = false,
    result: ExitResult | undefined;
  const exit = new Promise<ExitResult>((resolve) => {
    child.once('error', () => {
      exited = true;
      result = refused();
      resolve(result);
    });
    child.once('close', (code, signal) => {
      exited = true;
      result = { code, signal };
      resolve(result);
    });
  });
  let stopping: Promise<StopResult> | undefined;
  const stop = (budget = 5000): Promise<StopResult> =>
    (stopping ??= (async () => {
      const start = performance.now();
      const signal = (value: NodeJS.Signals) => {
        if (!child.pid) return;
        try {
          process.kill(-child.pid, value);
        } catch (error) {
          if (errorCode(error) !== 'ESRCH') return false;
        }
        return true;
      };
      const alive = () => {
        if (!child.pid) return false;
        try {
          process.kill(-child.pid, 0);
          return true;
        } catch (error) {
          return errorCode(error) !== 'ESRCH';
        }
      };
      if (alive() && !signal('SIGTERM')) return { status: 'STOP_UNCONFIRMED' as const } as const;
      await Promise.race([exit, wait(Math.min(1000, Math.floor(budget / 2)))]);
      if (alive()) signal('SIGKILL');
      while ((!exited || alive()) && performance.now() - start < budget) await wait(10);
      return exited && !alive() ? { status: 'STOPPED' } : { status: 'STOP_UNCONFIRMED' as const };
    })());
  const owned = {
    child,
    exit,
    stop,
    get exited() {
      return exited;
    },
    get result() {
      return result;
    },
  };
  activeChildren.add(owned);
  exit.then(() => activeChildren.delete(owned));
  return owned;
}

async function checkedFile(file: string, pin: string, maximum: number) {
  const f = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await f.stat();
    if (!stat.isFile() || stat.size > maximum) throw Error('REFUSED');
    if (
      crypto
        .createHash('sha256')
        .update(await f.readFile())
        .digest('hex') !== pin
    )
      throw Error('REFUSED');
  } finally {
    await f.close();
  }
}

export async function inspectOwnedExperiment(directory: string) {
  if (
    typeof directory !== 'string' ||
    !path.isAbsolute(directory) ||
    path.resolve(directory) !== directory ||
    (await fs.realpath(directory)) !== directory
  )
    throw Error('REFUSED');
  for (const [file, pin] of pins) await checkedFile(fileURLToPath(new URL(file, import.meta.url)), pin, 128 * 1024);
  if (process.version !== 'v24.21.0') throw Error('REFUSED');
  await checkedFile(
    process.execPath,
    '7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c',
    256 * 1024 * 1024,
  );
  const { aad, load, privateDirectory } = await import('./store.mts');
  await privateDirectory(path.dirname(directory));
  const { m, key } = await load(directory);
  key.fill(0);
  if (path.basename(directory) !== m.binding.experiment) throw Error('REFUSED');
  return {
    acceptUntil: m.acceptUntil,
    eraseBy: m.eraseBy,
    identity: crypto.createHash('sha256').update(aad(m)).digest('hex'),
  };
}

// Metadata work runs in an owned child, so a blocked private filesystem cannot stall the parent event loop.
export async function boundedInspection(directory: string, deadlineMs = 10000) {
  const owned = ownedChild(self, ['--inspect', directory], undefined, true);
  let text = '',
    identityText = '',
    invalid = false;
  required(owned.child.stdio[3]).on('data', (c) => {
    if (identityText.length + c.length > 65) invalid = true;
    else identityText += c;
  });
  required(owned.child.stdio[3]).on('error', () => {
    invalid = true;
  });
  required(owned.child.stdout).on('data', (c) => {
    if (text.length + c.length > 128) invalid = true;
    else text += c;
  });
  required(owned.child.stderr).on('data', () => {
    invalid = true;
  });
  let timer: NodeJS.Timeout | undefined;
  const finished = await Promise.race([
    owned.exit,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), deadlineMs);
    }),
  ]);
  clearTimeout(timer);
  const stopped = await owned.stop();
  if (stopped.status !== 'STOPPED') return { status: 'STOP_UNCONFIRMED' as const } as const;
  if (!finished || invalid || !('code' in finished) || finished.code !== 0) {
    return refused();
  }
  const match = /^\{"status":"MAPPING","acceptUntil":([1-9][0-9]{0,15}),"eraseBy":([1-9][0-9]{0,15})\}\n$/.exec(text);
  text = '';
  if (
    !match ||
    !/^[a-f0-9]{64}\n$/.test(identityText) ||
    !Number.isSafeInteger(Number(match[1])) ||
    !Number.isSafeInteger(Number(match[2])) ||
    Number(match[2]) <= Number(match[1])
  )
    return refused();
  return {
    status: 'MAPPING' as const,
    acceptUntil: Number(match[1]),
    eraseBy: Number(match[2]),
    identity: identityText.slice(0, 64),
  };
}

export async function startSupervisor(options: SupervisorOptions) {
  const started = performance.now();
  try {
    if (
      interrupted ||
      !options ||
      Object.keys(options).some(
        (k) => !['directory', 'signingFd', 'port', 'deadlineMs', 'expectedIdentity'].includes(k),
      )
    )
      return refused();
    const { directory, signingFd, port = 0, deadlineMs = 10000, expectedIdentity } = options;
    const callerBound = Object.hasOwn(options, 'expectedIdentity');
    if (
      !Number.isSafeInteger(signingFd) ||
      signingFd < 3 ||
      !Number.isSafeInteger(port) ||
      port < 0 ||
      port > 65535 ||
      !Number.isSafeInteger(deadlineMs) ||
      deadlineMs < 1 ||
      deadlineMs > 10000
    )
      return refused();
    if (callerBound && (typeof expectedIdentity !== 'string' || !/^[a-f0-9]{64}$/.test(expectedIdentity)))
      return refused();
    fstatSync(signingFd); // Descriptor metadata only; signing bytes pass directly to the fixed child FD3.
    const mapping = await boundedInspection(directory, deadlineMs);
    if (mapping.status === 'STOP_UNCONFIRMED') return mapping;
    if (
      interrupted ||
      mapping.status !== 'MAPPING' ||
      Date.now() >= mapping.acceptUntil ||
      (callerBound && expectedIdentity !== mapping.identity)
    )
      return refused();
    const remaining = deadlineMs - (performance.now() - started);
    if (remaining <= 0) return refused();
    const owned = ownedChild(fixedService, ['--bound', directory, String(port)], signingFd, false, true);
    required(owned.child.stdio[4]).on('error', () => {});
    (required(owned.child.stdio[4]) as Writable).end(mapping.identity + '\n');
    const protocol = observeReadyProtocol(required(owned.child.stdout), required(owned.child.stderr), {
      port,
      deadlineMs: remaining,
    });
    const ready = await Promise.race([protocol.ready, owned.exit.then(refused)]);
    if (ready.status !== 'READY' || Date.now() >= mapping.acceptUntil) {
      protocol.close();
      const stop = await owned.stop();
      return stop.status === 'STOPPED' ? refused() : { status: 'STOP_UNCONFIRMED' as const };
    }
    let resolveDone: (value: { status: string }) => void = () => {};
    let stopping: Promise<{ status: string }> | undefined;
    const done = new Promise<{ status: string }>((resolve) => {
      resolveDone = resolve;
    });
    let expiry: NodeJS.Timeout | undefined;
    const stop = (reason = 'STOPPED') =>
      (stopping ??= (async () => {
        clearTimeout(expiry);
        protocol.close();
        const result = await owned.stop();
        const value = result.status === 'STOPPED' ? { status: reason } : result;
        resolveDone(value);
        return value;
      })());
    expiry = setTimeout(
      () => {
        stop('EXPIRED');
      },
      Math.max(1, mapping.acceptUntil - Date.now()),
    );
    protocol.violation.then(() => stop('REFUSED'));
    owned.exit.then(() => stop('REFUSED'));
    const handle = { status: 'READY' as const, port: ready.port, stop: () => stop(), done };
    supervised.set(handle, { directory, stop: handle.stop });
    return handle;
  } catch {
    return refused();
  }
}

export async function stopSupervisedExperiment(handle: object, directory: string) {
  const owned = supervised.get(handle);
  if (!owned || owned.directory !== directory) return refused();
  return owned.stop();
}

export async function interruptOwnedControls() {
  interrupted = true;
  return Promise.all([...activeChildren].map((owned) => owned.stop()));
}

// Fixed eraser only; no executable/module or fake runtime clock parameter.
export async function runErasureChild(directory: string, deadlineMs = 10000, identity?: string) {
  if (interrupted || !Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 10000)
    return { status: 'BLOCKED' as const };
  if (typeof identity !== 'string' || !/^[a-f0-9]{64}$/.test(identity)) return { status: 'BLOCKED' as const };
  const owned = ownedChild(
    fileURLToPath(new URL('./cleanup.mts', import.meta.url)),
    ['--erase', directory],
    undefined,
    true,
  );
  required(owned.child.stdio[3]).on('error', () => {});
  (required(owned.child.stdio[3]) as Writable).end(identity + '\n');
  let text = '',
    bytes = 0,
    invalid = false,
    timer: NodeJS.Timeout | undefined;
  required(owned.child.stdout).on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > 128) invalid = true;
    else text += chunk;
  });
  required(owned.child.stderr).on('data', () => {
    invalid = true;
  });
  const finished = await Promise.race([
    owned.exit,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), deadlineMs);
    }),
  ]);
  clearTimeout(timer);
  const stopped = await owned.stop();
  if (stopped.status !== 'STOPPED') return { status: 'UNCERTAIN' as const };
  if (!finished) {
    return { status: 'UNCERTAIN' as const };
  }
  const match = /^\{"status":"(NOT_DUE|BLOCKED|UNCERTAIN|LOCAL_FILES_REMOVED_EXTERNAL_COPIES_UNQUALIFIED)"\}\n$/.exec(
    text,
  );
  text = '';
  if (invalid || !match) return { status: 'UNCERTAIN' as const };
  const status = match[1];
  if (!('code' in finished) || finished.code !== (status === 'BLOCKED' ? 20 : status === 'UNCERTAIN' ? 21 : 0))
    return { status: 'UNCERTAIN' as const };
  return { status };
}

if (process.argv[1] === self) {
  const emit = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  for (const key of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir'] as const) console[key] = () => {};
  if (process.argv[2] === '--inspect') {
    try {
      const m = await inspectOwnedExperiment(required(process.argv[3]));
      writeSync(3, m.identity + '\n');
      emit(`${JSON.stringify({ status: 'MAPPING', acceptUntil: m.acceptUntil, eraseBy: m.eraseBy })}\n`);
    } catch {
      emit('{"status":"REFUSED"}\n');
      process.exitCode = 20;
    }
  } else {
    let cliRunning: Awaited<ReturnType<typeof startSupervisor>> | undefined;
    for (const signal of ['SIGTERM', 'SIGINT'])
      process.once(signal, () => {
        interrupted = true;
        if (cliRunning && 'stop' in cliRunning) cliRunning.stop();
        else Promise.all([...activeChildren].map((owned) => owned.stop()));
      });
    const running = await startSupervisor({
      directory: required(process.argv[2]),
      signingFd: 3,
      port: Number(process.argv[3] ?? 0),
    });
    cliRunning = running;
    if (running.status !== 'READY') {
      const uncertain = running.status === 'STOP_UNCONFIRMED';
      emit(JSON.stringify({ status: uncertain ? 'STOP_UNCONFIRMED' : 'REFUSED' }) + '\n');
      process.exitCode = uncertain ? 21 : 20;
    } else {
      emit(`${JSON.stringify({ status: 'READY', port: running.port })}\n`);
      const stopped = await running.done;
      if (!['STOPPED', 'EXPIRED'].includes(stopped.status)) {
        const uncertain = stopped.status === 'STOP_UNCONFIRMED';
        emit(JSON.stringify({ status: uncertain ? 'STOP_UNCONFIRMED' : 'REFUSED' }) + '\n');
        process.exitCode = uncertain ? 21 : 20;
      }
    }
  }
}
