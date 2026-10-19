import assert from 'node:assert/strict';
import { acquireFileLock } from './backup-lock.mts';

const path = process.argv[2];
assert(path);
const lock = acquireFileLock(path);
process.stdout.write('LOCKED');
process.once('SIGTERM', () => {
  lock.close();
  process.exit(0);
});
setInterval(() => {}, 1000);
