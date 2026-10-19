import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, openSync } from 'node:fs';

/** Linux flock belongs to the open-file description shared with the helper.
 * Keep our descriptor open after that helper exits; no pathname sentinel substitutes for a lock.
 * Ordinary subprocesses do not inherit this descriptor. */
export function acquireFileLock(path: string): { close(): void } {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
  try {
    const info = fstatSync(fd);
    assert(
      info.isFile() && info.uid === process.getuid?.() && (info.mode & 0o077) === 0 && info.nlink === 1,
      'Private owned regular lock required',
    );
    execFileSync('/usr/bin/flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'ignore', fd] });
  } catch {
    closeSync(fd);
    throw new Error('Writer exclusion lock unavailable');
  }
  let open = true;
  return {
    close() {
      if (open) {
        closeSync(fd);
        open = false;
      }
    },
  };
}
