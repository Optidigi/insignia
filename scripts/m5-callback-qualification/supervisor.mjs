import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { constants, fstatSync, writeSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const fixedService = fileURLToPath(new URL('./service.mjs', import.meta.url));
const pins = new Map([
  ['service.mjs', '3bb15248eb1a100e12795b3bcf3c17f727bc41bc54f42942b071aa081d910c21'],
  ['receiver.mjs', '4d7d38619271d5250437eb707cdac863c0f4455b9b70a85fb758db5a972185e4'],
  ['operator.mjs', '7f346a74dca05cb41c50cc90815599cdd4699b8191a4ead4ee10b72e0945de77'],
  ['store.mjs', 'b1c185a465b5a57eded64de0d1491fcdfa0135514bd589db6cffa19400f1666c'],
  ['network-guard.mjs', 'f8b411bca1d1f6c50c401ae5bed08328058826ebaf1eda0be5e7f2a635af958a'],
  ['../../packages/shopify/src/webhook.ts', 'c44d188a2c6db0a023f5ed42f989c1757faf8c1b7cb45aa8c46a3ab5410a8f3f'],
]);
const refused = () => ({ status: 'REFUSED' });
const activeChildren = new Set();
const supervised = new WeakMap();
let interrupted = false;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Pure protocol boundary: never spawns or signals a caller-selected process.
export function observeReadyProtocol(stdout, stderr, { port = 0, deadlineMs = 10000 } = {}) {
  let text = '',
    bytes = 0,
    readySeen = false,
    settled = false;
  let resolveReady, resolveViolation;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const violation = new Promise((resolve) => {
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
  const onData = (chunk) => {
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

function ownedChild(script, args, signingFd, privatePipe = false, boundService = false) {
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
    result;
  const exit = new Promise((resolve) => {
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
  let stopping;
  const stop = (budget = 5000) =>
    (stopping ??= (async () => {
      const start = performance.now();
      const signal = (value) => {
        if (!child.pid) return;
        try {
          process.kill(-child.pid, value);
        } catch (error) {
          if (error.code !== 'ESRCH') return false;
        }
        return true;
      };
      const alive = () => {
        if (!child.pid) return false;
        try {
          process.kill(-child.pid, 0);
          return true;
        } catch (error) {
          return error.code !== 'ESRCH';
        }
      };
      if (alive() && !signal('SIGTERM')) return { status: 'STOP_UNCONFIRMED' };
      await Promise.race([exit, wait(Math.min(1000, Math.floor(budget / 2)))]);
      if (alive()) signal('SIGKILL');
      while ((!exited || alive()) && performance.now() - start < budget) await wait(10);
      return exited && !alive() ? { status: 'STOPPED' } : { status: 'STOP_UNCONFIRMED' };
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

async function checkedFile(file, pin, maximum) {
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

export async function inspectOwnedExperiment(directory) {
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
  const { aad, load, privateDirectory } = await import('./store.mjs');
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
export async function boundedInspection(directory, deadlineMs = 10000) {
  const owned = ownedChild(self, ['--inspect', directory], undefined, true);
  let text = '',
    identityText = '',
    invalid = false;
  owned.child.stdio[3].on('data', (c) => {
    if (identityText.length + c.length > 65) invalid = true;
    else identityText += c;
  });
  owned.child.stdio[3].on('error', () => {
    invalid = true;
  });
  owned.child.stdout.on('data', (c) => {
    if (text.length + c.length > 128) invalid = true;
    else text += c;
  });
  owned.child.stderr.on('data', () => {
    invalid = true;
  });
  let timer;
  const finished = await Promise.race([
    owned.exit,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), deadlineMs);
    }),
  ]);
  clearTimeout(timer);
  const stopped = await owned.stop();
  if (stopped.status !== 'STOPPED') return { status: 'STOP_UNCONFIRMED' };
  if (!finished || invalid || finished.code !== 0) {
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
    status: 'MAPPING',
    acceptUntil: Number(match[1]),
    eraseBy: Number(match[2]),
    identity: identityText.slice(0, 64),
  };
}

export async function startSupervisor(options) {
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
    owned.child.stdio[4].on('error', () => {});
    owned.child.stdio[4].end(mapping.identity + '\n');
    const protocol = observeReadyProtocol(owned.child.stdout, owned.child.stderr, { port, deadlineMs: remaining });
    const ready = await Promise.race([protocol.ready, owned.exit.then(refused)]);
    if (ready.status !== 'READY' || Date.now() >= mapping.acceptUntil) {
      protocol.close();
      const stop = await owned.stop();
      return stop.status === 'STOPPED' ? refused() : { status: 'STOP_UNCONFIRMED' };
    }
    let resolveDone, stopping;
    const done = new Promise((resolve) => {
      resolveDone = resolve;
    });
    let expiry;
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
    const handle = { status: 'READY', port: ready.port, stop: () => stop(), done };
    supervised.set(handle, { directory, stop: handle.stop });
    return handle;
  } catch {
    return refused();
  }
}

export async function stopSupervisedExperiment(handle, directory) {
  const owned = supervised.get(handle);
  if (!owned || owned.directory !== directory) return refused();
  return owned.stop();
}

export async function interruptOwnedControls() {
  interrupted = true;
  return Promise.all([...activeChildren].map((owned) => owned.stop()));
}

// Fixed eraser only; no executable/module or fake runtime clock parameter.
export async function runErasureChild(directory, deadlineMs = 10000, identity) {
  if (interrupted || !Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 10000)
    return { status: 'BLOCKED' };
  if (typeof identity !== 'string' || !/^[a-f0-9]{64}$/.test(identity)) return { status: 'BLOCKED' };
  const owned = ownedChild(
    fileURLToPath(new URL('./cleanup.mjs', import.meta.url)),
    ['--erase', directory],
    undefined,
    true,
  );
  owned.child.stdio[3].on('error', () => {});
  owned.child.stdio[3].end(identity + '\n');
  let text = '',
    bytes = 0,
    invalid = false,
    timer;
  owned.child.stdout.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > 128) invalid = true;
    else text += chunk;
  });
  owned.child.stderr.on('data', () => {
    invalid = true;
  });
  const finished = await Promise.race([
    owned.exit,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), deadlineMs);
    }),
  ]);
  clearTimeout(timer);
  const stopped = await owned.stop();
  if (stopped.status !== 'STOPPED') return { status: 'UNCERTAIN' };
  if (!finished) {
    return { status: 'UNCERTAIN' };
  }
  const match = /^\{"status":"(NOT_DUE|BLOCKED|UNCERTAIN|LOCAL_FILES_REMOVED_EXTERNAL_COPIES_UNQUALIFIED)"\}\n$/.exec(
    text,
  );
  text = '';
  if (invalid || !match) return { status: 'UNCERTAIN' };
  const status = match[1];
  if (finished.code !== (status === 'BLOCKED' ? 20 : status === 'UNCERTAIN' ? 21 : 0)) return { status: 'UNCERTAIN' };
  return { status };
}

if (process.argv[1] === self) {
  const emit = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  for (const key of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir']) console[key] = () => {};
  if (process.argv[2] === '--inspect') {
    try {
      const m = await inspectOwnedExperiment(process.argv[3]);
      writeSync(3, m.identity + '\n');
      emit(`${JSON.stringify({ status: 'MAPPING', acceptUntil: m.acceptUntil, eraseBy: m.eraseBy })}\n`);
    } catch {
      emit('{"status":"REFUSED"}\n');
      process.exitCode = 20;
    }
  } else {
    let cliRunning;
    for (const signal of ['SIGTERM', 'SIGINT'])
      process.once(signal, () => {
        interrupted = true;
        if (cliRunning?.stop) cliRunning.stop();
        else Promise.all([...activeChildren].map((owned) => owned.stop()));
      });
    const running = await startSupervisor({
      directory: process.argv[2],
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
