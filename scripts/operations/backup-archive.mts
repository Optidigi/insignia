import { constants, createReadStream, createWriteStream, lstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import tar from 'tar-stream';
import { check } from './backup-files.mts';

function safeName(name: string): boolean {
  return (
    Boolean(name) &&
    !name.startsWith('/') &&
    !name.split('/').some((part) => ['', '.', '..'].includes(part)) &&
    (name === 'database.dump' || name === 'objects.json' || name.startsWith('objects/'))
  );
}
export async function packArchive(path: string, files: readonly { path: string; name: string }[]): Promise<void> {
  const pack = tar.pack();
  const completion = pipeline(pack, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
  try {
    for (const file of files) {
      const info = lstatSync(file.path);
      check(info.isFile() && !info.isSymbolicLink() && safeName(file.name), 'unsafe archive source');
      const entry = pack.entry({ name: file.name, type: 'file', size: info.size, mode: 0o600, mtime: info.mtime });
      await pipeline(createReadStream(file.path), entry);
    }
    pack.finalize();
    await completion;
  } catch (error) {
    pack.destroy(error instanceof Error ? error : new Error('Archive failed'));
    await completion.catch(() => {});
    throw error;
  }
}
/** Scan the entire tar before extracting any payload; tar-stream consumes Python PAX metadata.
 * Links, directories, duplicate identities and traversal are rejected as in the original operator. */
export async function unpackArchive(path: string, destination?: string): Promise<Set<string>> {
  const names = new Set<string>();
  const extract = tar.extract();
  const completion = pipeline(createReadStream(path), extract);
  try {
    for await (const entry of extract) {
      const header = entry.header;
      check(header.type === 'file' && safeName(header.name) && !names.has(header.name), 'unsafe archive');
      names.add(header.name);
      if (destination) {
        const target = join(destination, header.name);
        mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
        await pipeline(
          entry,
          createWriteStream(target, {
            fd: openSync(
              target,
              constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
              0o600,
            ),
            autoClose: true,
          }),
        );
      } else {
        for await (const chunk of entry) {
          check(Buffer.isBuffer(chunk), 'Invalid archive stream');
        }
      }
    }
    await completion;
    return names;
  } catch (error) {
    extract.destroy(error instanceof Error ? error : new Error('Archive failed'));
    await completion.catch(() => {});
    throw error;
  }
}
