import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  boundedInspection,
  inspectOwnedExperiment,
  interruptOwnedControls,
  runErasureChild,
  stopSupervisedExperiment,
} from './supervisor.mjs';

const self = fileURLToPath(import.meta.url);
const blocked = () => ({ status: 'BLOCKED' });

async function exactLocalTree(directory) {
  const parent = path.dirname(directory);
  if ((await fs.readdir(parent)).some((name) => name !== path.basename(directory))) throw Error('BLOCKED');
  const roots = ['mapping.json', 'mapping.seal', 'key.bin', 'receiver.lock', 'reservations', 'spool', 'commits'];
  if ((await fs.readdir(directory)).some((name) => !roots.includes(name))) throw Error('BLOCKED');
  for (const entry of await fs.readdir(directory)) {
    const file = path.join(directory, entry),
      stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw Error('BLOCKED');
    if (['reservations', 'spool', 'commits'].includes(entry)) {
      if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700) throw Error('BLOCKED');
      const files = await fs.readdir(file);
      if (files.length > 45) throw Error('BLOCKED');
      for (const name of files) {
        if (!/^0000(?:0[1-9]|[1-3][0-9]|4[0-5])\.(?:json|bin)$/.test(name)) throw Error('BLOCKED');
        const info = await fs.lstat(path.join(file, name));
        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          info.nlink !== 1 ||
          (info.mode & 0o777) !== 0o600 ||
          info.size > 4 * Math.ceil((8 * 1024 * 1024) / 3) + 128 * 1024 + 28
        )
          throw Error('BLOCKED');
      }
    } else if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > 65536)
      throw Error('BLOCKED');
  }
}

// Runs only in the fixed owned worker; the runtime clock cannot be overridden through argv/env.
async function eraseWorker(directory) {
  let mutationStarted = false;
  try {
    const mapping = await inspectOwnedExperiment(directory);
    if (Date.now() < mapping.eraseBy) return { status: 'NOT_DUE' };
    await exactLocalTree(directory);
    const { recoverDeadReceiver, eraseExperiment } = await import('./operator.mjs');
    const { Refusal } = await import('./store.mjs');
    let lockExists = false;
    try {
      await fs.lstat(path.join(directory, 'receiver.lock'));
      lockExists = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (lockExists) {
      // Accepted recovery requires the recorded PID to be absent under its shared lifecycle guard.
      mutationStarted = true;
      try {
        await recoverDeadReceiver(directory);
      } catch (error) {
        return error instanceof Refusal ? blocked() : { status: 'UNCERTAIN' };
      }
    }
    // Accepted erase owns its lifecycle guard and refuses startup/active/reused/ambiguous ownership.
    mutationStarted = true;
    try {
      return await eraseExperiment(directory);
    } catch (error) {
      if (error instanceof Refusal) return blocked();
      throw error;
    }
  } catch {
    return mutationStarted ? { status: 'UNCERTAIN' } : blocked();
  }
}

export async function eraseAtDeadline(options) {
  const started = performance.now();
  try {
    if (
      !options ||
      Object.keys(options).some(
        (key) => !['parent', 'experiment', 'supervisor', 'exports', 'now', 'deadlineMs'].includes(key),
      )
    )
      return blocked();
    const { parent, experiment, supervisor, exports: copies = [], now = Date.now, deadlineMs = 10000 } = options;
    if (
      typeof parent !== 'string' ||
      !path.isAbsolute(parent) ||
      path.resolve(parent) !== parent ||
      typeof experiment !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(experiment) ||
      !Array.isArray(copies) ||
      copies.length !== 0 ||
      typeof now !== 'function' ||
      !Number.isSafeInteger(deadlineMs) ||
      deadlineMs < 1 ||
      deadlineMs > 10000
    )
      return blocked();
    const directory = path.join(parent, experiment);
    const mapping = await boundedInspection(directory, deadlineMs);
    if (mapping.status !== 'MAPPING') return blocked();
    const observedNow = now();
    if (!Number.isSafeInteger(observedNow)) return blocked();
    if (observedNow < mapping.eraseBy) return { status: 'NOT_DUE' };
    if (supervisor !== undefined) {
      const stopped = await stopSupervisedExperiment(supervisor, directory);
      if (stopped.status !== 'STOPPED') return blocked();
    }
    const remaining = Math.floor(deadlineMs - (performance.now() - started));
    if (remaining < 1) return { status: 'UNCERTAIN' };
    // The worker independently checks actual Date.now against original authenticated eraseBy.
    return await runErasureChild(directory, remaining);
  } catch {
    return blocked();
  }
}

if (process.argv[1] === self) {
  const emit = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  for (const key of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir']) console[key] = () => {};
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      interruptOwnedControls();
    });
  const result =
    process.argv[2] === '--erase'
      ? await eraseWorker(process.argv[3])
      : await eraseAtDeadline({ parent: process.argv[2], experiment: process.argv[3] });
  emit(`${JSON.stringify(result)}\n`);
  process.exitCode = result.status === 'BLOCKED' ? 20 : result.status === 'UNCERTAIN' ? 21 : 0;
}
