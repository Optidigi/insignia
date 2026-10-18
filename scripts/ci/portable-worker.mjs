import assert from 'node:assert/strict';
import { cp, lstat, readdir, readFile, readlink, realpath } from 'node:fs/promises';
import { join } from 'node:path';

const privateName =
  /(?:^\.env(?:\.|$)|\.env$|^(?:auth|session|context|credentials|inspection|m6-r2)\.json$|\.pem$|\.key$)/i;

/** Validate the existing pnpm portable worker before copying any runtime files. */
export async function validatePortableWorker(workerPackage) {
  const worker = await realpath(workerPackage);
  assert.equal(JSON.parse(await readFile(join(worker, 'package.json'))).name, '@insignia/worker');
  async function validate(directory) {
    for (const name of await readdir(directory)) {
      assert.ok(!privateName.test(name), 'Private file cannot enter runtime artifact');
      const path = join(directory, name),
        info = await lstat(path);
      if (info.isSymbolicLink()) {
        assert.ok((await realpath(path)).startsWith(`${worker}/`), 'Worker dependency escaped portable package');
        assert.ok(!(await readlink(path)).startsWith('/'), 'Absolute worker dependency escaped relocation');
      } else if (info.isDirectory()) await validate(path);
      else assert.ok(info.isFile(), 'Only regular runtime files are supported');
    }
  }
  for (const item of ['dist', 'node_modules']) await validate(join(worker, item));
  return worker;
}

/** Copy only the allowlisted closure of a previously validated portable worker. */
export async function copyPortableWorker(worker, destination) {
  for (const name of ['dist', 'node_modules', 'package.json'])
    await cp(join(worker, name), join(destination, name), {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      force: false,
      errorOnExist: true,
    });
}
