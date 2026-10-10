import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function exportWorkerImage({ directory, sourceHead, sourceTree, imageId, run, signal }) {
  await mkdir(directory);
  try {
    const file = 'worker-image.tar';
    const path = join(directory, file);
    await run(['image', 'save', '--output', path, imageId], { timeout: 60_000, signal });
    const hash = createHash('sha256');
    let sizeBytes = 0;
    for await (const bytes of createReadStream(path, { signal })) {
      hash.update(bytes);
      sizeBytes += bytes.length;
    }
    const receipt = { sourceHead, sourceTree, imageId, file, sha256: hash.digest('hex'), sizeBytes };
    await writeFile(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2), { signal });
    return receipt;
  } catch (error) {
    // Only the fresh directory owned by this export may be removed.
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
