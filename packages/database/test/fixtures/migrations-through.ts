import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Rehearse a historical migration's own down/up against unchanged real files,
 * even after later migrations become the live latest version. */
export async function migrationsThrough(source: string, version: string, expectedCount: number) {
  const files = (await readdir(source))
    .filter((file) => /^\d{14}_[a-z0-9_]+\.sql$/.test(file) && file.slice(0, 14) <= version)
    .sort();
  assert.equal(files.length, expectedCount);
  assert.equal(files.at(-1)?.slice(0, 14), version);
  const directory = await mkdtemp(join(tmpdir(), 'insignia-migration-rehearsal-'));
  for (const file of files) await copyFile(join(source, file), join(directory, file));
  return directory;
}
