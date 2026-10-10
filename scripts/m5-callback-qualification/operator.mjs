import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  aad,
  durable,
  inventory,
  load,
  name,
  privateDirectory,
  readPrivate,
  refuse,
  seal,
  spoolReadBound,
  syncDirectory,
  unseal,
  validate,
  withLifecycle,
} from './store.mjs';
export async function createExperiment({
  directory,
  binding,
  acceptUntil,
  eraseBy,
  maxArrivals = 45,
  maxBytes = 65536,
  bodyDeadlineMs = 1000,
  now = Date.now(),
}) {
  return withLifecycle(directory, async () => {
    if (acceptUntil <= now || acceptUntil > now + 6 * 3600000 || eraseBy > now + 7 * 86400000) refuse();
    const m = validate({
      version: 1,
      binding: { ...binding },
      capability: crypto.randomBytes(32).toString('base64url'),
      acceptUntil,
      eraseBy,
      maxArrivals,
      maxBytes,
      bodyDeadlineMs,
    });
    await privateDirectory(path.dirname(directory));
    await fs.mkdir(directory, { mode: 0o700 });
    await syncDirectory(path.dirname(directory));
    for (const child of ['reservations', 'spool', 'commits'])
      await fs.mkdir(path.join(directory, child), { mode: 0o700 });
    await syncDirectory(directory);
    const key = crypto.randomBytes(32);
    try {
      await durable(path.join(directory, 'key.bin'), key);
      await durable(path.join(directory, 'mapping.json'), JSON.stringify(m));
      await durable(path.join(directory, 'mapping.seal'), seal(key, aad(m), Buffer.alloc(0)));
      return { status: 'EXPERIMENT_CREATED' };
    } finally {
      key.fill(0);
    }
  });
}
export async function privateEnrollment(directory, { now = Date.now() } = {}) {
  const { m, key } = await load(directory);
  key.fill(0);
  if (now >= m.acceptUntil) refuse();
  return { callbackPath: '/callback/' + m.capability, binding: { ...m.binding } };
}
export async function privateReceipt(directory, id, { now = Date.now() } = {}) {
  const { m, key } = await load(directory);
  try {
    if (now >= m.eraseBy) refuse();
    const label = name(id);
    if (
      (await readPrivate(path.join(directory, 'commits', label + '.json'), { maxBytes: 32 })).toString() !==
      JSON.stringify({ receipt: id })
    )
      refuse();
    return JSON.parse(
      unseal(
        key,
        Buffer.concat([aad(m), Buffer.from('\0receipt:' + id)]),
        await readPrivate(path.join(directory, 'spool', label + '.bin'), { maxBytes: spoolReadBound(m) }),
      ).toString(),
    );
  } finally {
    key.fill(0);
  }
}
export async function status(directory, { now = Date.now() } = {}) {
  const { m, key } = await load(directory);
  key.fill(0);
  const ids = await inventory(directory);
  if (now >= m.eraseBy) return { status: 'RETENTION_EXPIRED', reserved: ids.length, committed: null, uncertain: null };
  let committed = 0;
  for (const id of ids) {
    try {
      await privateReceipt(directory, id, { now: Math.min(now, m.eraseBy - 1) });
      committed++;
    } catch {
      /* Expose uncertainty, never invented durability. */
    }
  }
  return {
    status: now >= m.eraseBy ? 'RETENTION_EXPIRED' : now >= m.acceptUntil ? 'CLOSED' : 'OPEN',
    reserved: ids.length,
    committed,
    uncertain: ids.length - committed,
  };
}
export async function exportReceipt(directory, id, destination, options) {
  const value = await privateReceipt(directory, id, options);
  await privateDirectory(path.dirname(destination));
  await durable(destination, JSON.stringify(value));
  return { status: 'PRIVATE_EXPORT_CREATED_EXTERNAL_COPY_REQUIRES_ERASURE' };
}
export async function recoverDeadReceiver(directory) {
  return withLifecycle(directory, async () => {
    await privateDirectory(directory);
    const lock = JSON.parse((await readPrivate(path.join(directory, 'receiver.lock'))).toString());
    if (!Number.isSafeInteger(lock.pid) || lock.pid < 1) refuse();
    try {
      process.kill(lock.pid, 0);
      refuse();
    } catch (e) {
      if (e.code !== 'ESRCH') refuse();
    }
    await fs.unlink(path.join(directory, 'receiver.lock'));
    await syncDirectory(directory);
    return { status: 'DEAD_RECEIVER_LOCK_REMOVED' };
  });
}
export async function eraseExperiment(directory) {
  return withLifecycle(directory, async () => {
    const { key } = await load(directory);
    key.fill(0);
    try {
      await fs.lstat(path.join(directory, 'receiver.lock'));
      refuse();
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    await fs.rm(directory, { recursive: true });
    await syncDirectory(path.dirname(directory));
    return { status: 'LOCAL_FILES_REMOVED_EXTERNAL_COPIES_UNQUALIFIED' };
  });
}
