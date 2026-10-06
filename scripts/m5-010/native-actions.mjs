// Local receipts only. Browser interaction remains owned by the sole operator.
import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const actions = ['release', 'request', 'approval'];
function requireValue(value) {
  if (!value) throw new Error('native_action_guard');
}
function privateDirectory(directory) {
  const d = lstatSync(directory);
  requireValue(d.isDirectory() && !d.isSymbolicLink() && d.uid === process.getuid() && (d.mode & 0o077) === 0);
}
export function initializeNative(directory, binding) {
  privateDirectory(directory);
  const fd = openSync(resolve(directory, 'native-actions.json'), 'wx', 0o600);
  try {
    writeFileSync(
      fd,
      `${JSON.stringify({ version: 1, bindingDigest: hash(binding), state: 'OPEN', counts: { release: 0, request: 0, approval: 0 }, events: [] }, null, 2)}\n`,
    );
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function change(directory, binding, callback) {
  privateDirectory(directory);
  const lock = resolve(directory, 'native-actions.lock');
  const fd = openSync(lock, 'wx', 0o600);
  try {
    const path = resolve(directory, 'native-actions.json');
    const info = lstatSync(path);
    requireValue(info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid() && (info.mode & 0o077) === 0);
    const state = JSON.parse(readFileSync(path));
    requireValue(state.version === 1 && state.bindingDigest === hash(binding) && state.state === 'OPEN');
    requireValue(Array.isArray(state.events) && state.events.length <= 6);
    requireValue(Object.keys(state.counts).sort().join(',') === [...actions].sort().join(','));
    for (const action of actions) {
      const reservations = state.events.filter((x) => x.action === action && x.result === 'RESERVED');
      const settlements = state.events.filter((x) => x.action === action && x.result !== 'RESERVED');
      requireValue(
        reservations.length <= 1 &&
          state.counts[action] === reservations.length &&
          settlements.length <= reservations.length,
      );
    }
    requireValue(
      state.events.every(
        (x, i) =>
          x.action === actions[Math.floor(i / 2)] && (i % 2 === 0 ? x.result === 'RESERVED' : x.result === 'VERIFIED'),
      ),
    );

    callback(state);
    const temporary = `${path}.tmp`;
    const file = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    renameSync(temporary, path);
    const dir = openSync(directory, 'r');
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}
export function reserveNative(directory, binding, action) {
  change(directory, binding, (state) => {
    const i = actions.indexOf(action);
    requireValue(
      i >= 0 &&
        state.counts[action] === 0 &&
        !state.events.some(
          (x) => x.result === 'RESERVED' && !state.events.some((y) => y.action === x.action && y.result !== 'RESERVED'),
        ),
    );
    requireValue(i === 0 || state.events.some((x) => x.action === actions[i - 1] && x.result === 'VERIFIED'));
    state.counts[action] = 1;
    state.events.push({ action, result: 'RESERVED', at: new Date().toISOString() });
  });
}
export function settleNative(directory, binding, action, result, publicReceipt) {
  change(directory, binding, (state) => {
    requireValue(actions.includes(action) && ['VERIFIED', 'UNKNOWN', 'REFUSED'].includes(result));
    requireValue(state.events.at(-1)?.action === action && state.events.at(-1)?.result === 'RESERVED');
    // Store only a digest here. The separate sanitized receipt is reviewed before export.
    state.events.push({ action, result, at: new Date().toISOString(), receiptDigest: hash(publicReceipt) });
    if (result !== 'VERIFIED') state.state = 'STOPPED';
    else if (action === 'approval') state.state = 'CLOSED_VERIFIED';
  });
}
