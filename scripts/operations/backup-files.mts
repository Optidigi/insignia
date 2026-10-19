import assert from 'node:assert/strict';
import { type ExecFileSyncOptions, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export const HOLD = 'HOLD_STORAGE_ERASURE_AND_AUTHORITY_REQUALIFICATION';
export const root = new URL('../../', import.meta.url).pathname;
export function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
}
export function record(value: unknown): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Object required');
  return Object.fromEntries(Object.entries(value));
}
export function text(value: unknown): string {
  check(typeof value === 'string', 'String required');
  return value;
}
export function number(value: unknown): number {
  check(typeof value === 'number' && Number.isFinite(value), 'Number required');
  return value;
}
export function array(value: unknown): unknown[] {
  check(Array.isArray(value), 'Array required');
  return value;
}
export function timestamp(value: unknown): number {
  const input = text(value);
  check(/(?:Z|[+-]\d\d:\d\d)$/.test(input), 'timezone required');
  const result = Date.parse(input);
  check(Number.isFinite(result), 'Invalid timestamp');
  return result;
}
export function digest(path: string): string {
  const fd = openSync(path, constants.O_RDONLY);
  try {
    const hash = createHash('sha256'),
      chunk = Buffer.alloc(1024 * 1024);
    while (true) {
      const length = readSync(fd, chunk);
      if (length === 0) break;
      hash.update(chunk.subarray(0, length));
    }
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}
export function jsonFile(path: string): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path)));
}
export function privateDirectory(path: string, create = false): string {
  if (create) mkdirSync(path, { recursive: true, mode: 0o700 });
  const info = lstatSync(path);
  check(
    !info.isSymbolicLink() && info.isDirectory() && info.uid === process.getuid?.() && (info.mode & 0o077) === 0,
    'private owned directory required',
  );
  return path;
}
export function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function remove(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}
export function durable(path: string, value: unknown): void {
  const temporary = join(dirname(path), `.receipt-${randomUUID()}.tmp`);
  const fd = openSync(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    try {
      writeFileSync(fd, JSON.stringify(value));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    linkSync(temporary, path);
    syncDirectory(dirname(path));
  } finally {
    remove(temporary);
    syncDirectory(dirname(path));
  }
}
export function run(argv: readonly string[], options: ExecFileSyncOptions = {}): void {
  const [command, ...args] = argv;
  check(command, 'Command required');
  execFileSync(command, args, { ...options, stdio: 'ignore' });
}
export function output(argv: readonly string[], options: ExecFileSyncOptions = {}): string {
  const [command, ...args] = argv;
  check(command, 'Command required');
  return execFileSync(command, args, { ...options, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).toString();
}
export function requireTmpfs(path: string): void {
  check(output(['stat', '-f', '-c', '%T', path]).trim() === 'tmpfs', 'ephemeral tmpfs required');
}
export function sourceEnvironment(environment: NodeJS.ProcessEnv = process.env): void {
  check(
    !['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'PGOPTIONS', 'DATABASE_URL'].some((name) => environment[name]) &&
      !environment.PGHOST?.includes(',') &&
      !environment.PGPORT?.includes(',') &&
      !environment.PGDATABASE?.includes('://') &&
      !environment.PGDATABASE?.includes('='),
    'alternate source database authority forbidden',
  );
}
export function exists(path: string): boolean {
  return existsSync(path);
}
