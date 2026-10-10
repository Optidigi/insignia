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
async function recoverLocked(directory) {
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
}
export async function recoverDeadReceiver(directory) {
  return withLifecycle(directory, () => recoverLocked(directory));
}
async function eraseLocked(directory) {
  try {
    await fs.lstat(path.join(directory, 'receiver.lock'));
    refuse();
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  await fs.rm(directory, { recursive: true });
  await syncDirectory(path.dirname(directory));
  return { status: 'LOCAL_FILES_REMOVED_EXTERNAL_COPIES_UNQUALIFIED' };
}
export async function eraseExperiment(directory) {
  return withLifecycle(directory, async () => {
    const { key } = await load(directory);
    key.fill(0);
    return eraseLocked(directory);
  });
}
async function exactLocalTree(directory, guard) {
  const parent = path.dirname(directory);
  if (
    (await fs.readdir(parent)).some((name) => name !== path.basename(directory) && name !== path.basename(guard.path))
  )
    refuse();
  const roots = ['mapping.json', 'mapping.seal', 'key.bin', 'receiver.lock', 'reservations', 'spool', 'commits'];
  if ((await fs.readdir(directory)).some((name) => !roots.includes(name))) refuse();
  for (const entry of await fs.readdir(directory)) {
    const file = path.join(directory, entry),
      stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) refuse();
    if (['reservations', 'spool', 'commits'].includes(entry)) {
      if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700) refuse();
      const files = await fs.readdir(file);
      if (files.length > 45) refuse();
      for (const name of files) {
        if (
          !/^0000(?:0[1-9]|[1-3][0-9]|4[0-5])\.(?:json|bin)$/.test(name) ||
          !name.endsWith(entry === 'spool' ? '.bin' : '.json')
        )
          refuse();
        const info = await fs.lstat(path.join(file, name));
        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          info.nlink !== 1 ||
          (info.mode & 0o777) !== 0o600 ||
          info.size > 4 * Math.ceil((8 * 1024 * 1024) / 3) + 128 * 1024 + 28
        )
          refuse();
      }
    } else if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > 65536) refuse();
  }
}
// Deadline authorization is bound to the authenticated immutable mapping inspected
// by the owned supervisor. Identity never becomes a public receipt or argv value.
export async function eraseExpiredExperiment(directory, expectedIdentity) {
  if (typeof expectedIdentity !== 'string' || !/^[a-f0-9]{64}$/.test(expectedIdentity)) refuse();
  return withLifecycle(directory, async (guard) => {
    const { m, key } = await load(directory);
    key.fill(0);
    const identity = crypto.createHash('sha256').update(aad(m)).digest('hex');
    if (identity !== expectedIdentity || path.basename(directory) !== m.binding.experiment) refuse();
    if (Date.now() < m.eraseBy) return { status: 'NOT_DUE' };
    await exactLocalTree(directory, guard);
    let lockExists = false;
    try {
      await fs.lstat(path.join(directory, 'receiver.lock'));
      lockExists = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (lockExists) await recoverLocked(directory);
    return eraseLocked(directory);
  });
}
