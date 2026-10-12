import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArtworkStorageError, createR2ArtworkStorage } from './index.js';

/** Credential custody stays outside source, logs, browser responses and environment dumps. */
export async function loadArtworkStorageProfile(
  file: string,
  input: { endpoint: string; bucket: string; prefix: string },
) {
  const repository = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
  if (!isAbsolute(file) || resolve(file).startsWith(repository + sep)) throw new ArtworkStorageError('INVALID_INPUT');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
      throw new ArtworkStorageError('INVALID_INPUT');
    const value: unknown = JSON.parse(await handle.readFile('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ArtworkStorageError('INVALID_INPUT');
    const keys = value as Record<string, unknown>;
    if (
      typeof keys.accessKeyId !== 'string' ||
      typeof keys.secretAccessKey !== 'string' ||
      !keys.accessKeyId ||
      !keys.secretAccessKey
    )
      throw new ArtworkStorageError('INVALID_INPUT');
    return createR2ArtworkStorage({ ...input, accessKeyId: keys.accessKeyId, secretAccessKey: keys.secretAccessKey });
  } catch {
    throw new ArtworkStorageError('INVALID_INPUT');
  } finally {
    await handle.close();
  }
}
