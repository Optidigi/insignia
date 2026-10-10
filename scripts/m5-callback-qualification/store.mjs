// Private experimental storage only. No production repository/runtime imports.

import crypto from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
export class Refusal extends Error {
  constructor() {
    super('EXPERIMENT_REFUSED');
  }
}
export const refuse = () => {
  throw new Refusal();
};
export async function syncDirectory(p) {
  const f = await fs.open(p, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    await f.sync();
  } finally {
    await f.close();
  }
}
export async function privateDirectory(p) {
  const s = await fs.lstat(p);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o777) !== 0o700) refuse();
}
export const spoolReadBound = (m) => 4 * Math.ceil(m.maxBytes / 3) + 128 * 1024 + 28;
export async function readPrivate(p, { maxBytes = 64 * 1024 } = {}) {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 4 * Math.ceil((8 * 1024 * 1024) / 3) + 128 * 1024 + 28
  )
    refuse();
  const f = await fs.open(p, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await f.stat();
    if (!s.isFile() || (s.mode & 0o777) !== 0o600 || s.size > maxBytes) refuse();
    return await f.readFile();
  } finally {
    await f.close();
  }
}
export async function durable(p, data) {
  const f = await fs.open(p, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await f.writeFile(data);
    await f.sync();
  } finally {
    await f.close();
  }
  await syncDirectory(path.dirname(p));
}
export function seal(key, aad, data) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(aad);
  return Buffer.concat([iv, c.update(data), c.final(), c.getAuthTag()]);
}
export function unseal(key, aad, data) {
  if (data.length < 28) refuse();
  const d = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  d.setAAD(aad);
  d.setAuthTag(data.subarray(-16));
  return Buffer.concat([d.update(data.subarray(12, -16)), d.final()]);
}
export const aad = (m) => Buffer.from('InsigniaCallbackExperiment\0v1\0' + JSON.stringify(m));
export function validate(m) {
  const fields = [
    'version',
    'binding',
    'capability',
    'acceptUntil',
    'eraseBy',
    'maxArrivals',
    'maxBytes',
    'bodyDeadlineMs',
  ];
  if (
    !m ||
    typeof m !== 'object' ||
    Object.keys(m).sort().join() !== fields.sort().join() ||
    m.version !== 1 ||
    !/^\w{43}$/.test(m.capability.replaceAll('-', '_'))
  )
    refuse();
  const b = m.binding,
    keys = [
      'experiment',
      'era',
      'appId',
      'providerShopId',
      'providerShopDomain',
      'appInstallationId',
      'capabilityLabel',
    ];
  if (
    !b ||
    typeof b !== 'object' ||
    Object.keys(b).sort().join() !== keys.sort().join() ||
    Object.values(b).some((v) => typeof v !== 'string' || v.length > 255)
  )
    refuse();
  for (const k of ['experiment', 'era', 'capabilityLabel']) if (!/^[A-Za-z0-9_-]{1,64}$/.test(b[k])) refuse();
  if (
    !/^gid:\/\/shopify\/App\/[1-9][0-9]*$/.test(b.appId) ||
    !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(b.providerShopId) ||
    !/^gid:\/\/shopify\/AppInstallation\/[1-9][0-9]*$/.test(b.appInstallationId) ||
    !/^[a-z0-9-]+\.myshopify\.com$/.test(b.providerShopDomain)
  )
    refuse();
  for (const k of ['acceptUntil', 'eraseBy', 'maxArrivals', 'maxBytes', 'bodyDeadlineMs'])
    if (!Number.isSafeInteger(m[k])) refuse();
  if (
    m.eraseBy <= m.acceptUntil ||
    m.maxArrivals < 1 ||
    m.maxArrivals > 45 ||
    m.maxBytes < 1 ||
    m.maxBytes > 8 * 1024 * 1024 ||
    m.bodyDeadlineMs < 1 ||
    m.bodyDeadlineMs > 5000
  )
    refuse();
  return m;
}
export async function load(directory) {
  await privateDirectory(directory);
  for (const child of ['reservations', 'spool', 'commits']) await privateDirectory(path.join(directory, child));
  const m = validate(JSON.parse((await readPrivate(path.join(directory, 'mapping.json'))).toString()));
  const key = await readPrivate(path.join(directory, 'key.bin'), { maxBytes: 32 });
  if (key.length !== 32) refuse();
  unseal(key, aad(m), await readPrivate(path.join(directory, 'mapping.seal'), { maxBytes: 28 }));
  return { m, key };
}
export const name = (id) => {
  if (!Number.isSafeInteger(id) || id < 1 || id > 45) refuse();
  return String(id).padStart(6, '0');
};
export async function inventory(directory) {
  const files = await fs.readdir(path.join(directory, 'reservations'));
  if (files.some((f) => !/^0000(?:0[1-9]|[1-3][0-9]|4[0-5])\.json$/.test(f))) refuse();
  const ids = files.map((f) => Number(f.slice(0, 6))).sort((a, b) => a - b);
  if (ids.some((v, i) => v !== i + 1)) refuse();
  return ids;
}
export async function acquire(directory) {
  await durable(path.join(directory, 'receiver.lock'), JSON.stringify({ pid: process.pid }));
}
export async function release(directory) {
  await fs.unlink(path.join(directory, 'receiver.lock'));
  await syncDirectory(directory);
}
