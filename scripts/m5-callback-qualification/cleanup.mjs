import { readSync } from 'node:fs';
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

// Runs only in the fixed owned worker. Expected identity arrives over a private
// inherited pipe; neither that descriptor nor a runtime clock is an argv option.
async function eraseWorker(directory) {
  let mutationStarted = false;
  try {
    const raw = Buffer.alloc(66);
    let size = 0;
    while (size < raw.length) {
      const count = readSync(3, raw, size, raw.length - size, null);
      if (count === 0) break;
      size += count;
    }
    const value = raw.subarray(0, size).toString();
    raw.fill(0);
    if (!/^[a-f0-9]{64}\n$/.test(value)) return blocked();
    await inspectOwnedExperiment(directory);
    const { eraseExpiredExperiment } = await import('./operator.mjs');
    const { Refusal } = await import('./store.mjs');
    mutationStarted = true;
    try {
      return await eraseExpiredExperiment(directory, value.slice(0, 64));
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
    if (mapping.status === 'STOP_UNCONFIRMED') return { status: 'UNCERTAIN' };
    if (mapping.status !== 'MAPPING') return blocked();
    const observedNow = now();
    if (!Number.isSafeInteger(observedNow)) return blocked();
    if (observedNow < mapping.eraseBy) return { status: 'NOT_DUE' };
    if (supervisor !== undefined) {
      const stopped = await stopSupervisedExperiment(supervisor, directory);
      if (stopped.status === 'STOP_UNCONFIRMED') return { status: 'UNCERTAIN' };
      if (stopped.status !== 'STOPPED') return blocked();
    }
    const remaining = Math.floor(deadlineMs - (performance.now() - started));
    if (remaining < 1) return { status: 'UNCERTAIN' };
    // The worker independently checks actual Date.now against original authenticated eraseBy.
    return await runErasureChild(directory, remaining, mapping.identity);
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
