import { lstat, realpath } from 'node:fs/promises';
import { request } from 'node:http';
import { dirname, isAbsolute } from 'node:path';
import { ArtworkInspectionError } from './errors.js';
import type { ArtworkInspection } from './inspection.js';
import { decodeInspectionResult, INSPECTION_INPUT_LIMIT, INSPECTION_OUTPUT_LIMIT } from './inspection-wire.js';

/** Server-configured private endpoint only. Never accepts a URL or retries a request. */
export async function inspectArtworkPrivately(
  socketPath: string,
  bytes: Uint8Array,
  options: { signal?: AbortSignal } = {},
): Promise<ArtworkInspection> {
  if (!bytes.length || bytes.length > INSPECTION_INPUT_LIMIT)
    throw new ArtworkInspectionError('REJECTED', 'Artwork size limit');
  const original = Buffer.from(bytes);
  try {
    if (!isAbsolute(socketPath) || options.signal?.aborted) throw new Error('Invalid inspection configuration');
    const directory = dirname(socketPath);
    const parent = await lstat(directory);
    const socket = await lstat(socketPath);
    if (
      !parent.isDirectory() ||
      parent.uid !== process.getuid?.() ||
      (parent.mode & 0o777) !== 0o700 ||
      (await realpath(directory)) !== directory ||
      !socket.isSocket() ||
      socket.uid !== parent.uid ||
      (socket.mode & 0o777) !== 0o600
    )
      throw new Error('Invalid inspection configuration');
    return await new Promise<ArtworkInspection>((resolve, reject) => {
      const req = request(
        {
          socketPath,
          method: 'POST',
          path: '/merchant-preview-inspect',
          agent: false,
          signal: options.signal,
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': original.length,
            connection: 'close',
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            reject(
              new ArtworkInspectionError(
                res.statusCode === 422 ? 'REJECTED' : 'UNAVAILABLE',
                'Private inspection unavailable',
              ),
            );
            res.destroy();
            req.destroy();
            return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > INSPECTION_OUTPUT_LIMIT) req.destroy(new Error('Invalid inspection response'));
            else chunks.push(chunk);
          });
          res.once('aborted', () => reject(new Error('Incomplete inspection response')));
          res.once('error', reject);
          res.once('end', () => {
            try {
              if (!res.complete || res.headers['content-type'] !== 'application/json')
                throw new Error('Invalid inspection response');
              resolve(
                decodeInspectionResult(
                  JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))),
                  original,
                ),
              );
            } catch {
              reject(new Error('Invalid inspection response'));
            }
          });
        },
      );
      const timer = setTimeout(() => req.destroy(new Error('Private inspection deadline')), 13_000);
      req.once('close', () => {
        clearTimeout(timer);
        reject(new Error('Private inspection disconnected'));
      });
      req.once('error', reject);
      req.end(original);
    });
  } catch (error) {
    if (error instanceof ArtworkInspectionError) throw error;
    throw new ArtworkInspectionError(
      options.signal?.aborted ? 'ABORTED' : 'UNAVAILABLE',
      'Private inspection unavailable',
    );
  }
}
