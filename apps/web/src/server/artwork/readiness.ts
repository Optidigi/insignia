import { lstat, realpath } from 'node:fs/promises';
import { request } from 'node:http';
import { dirname, isAbsolute } from 'node:path';

/** Deployment-owned socket or existing loopback endpoint; never buyer input. */
export async function ensureArtworkInspectionReady(input: { socketPath?: string; url?: string }): Promise<void> {
  let body: string;
  if (input.socketPath) {
    if (input.url || !isAbsolute(input.socketPath)) throw new Error('Artwork inspection configuration invalid');
    const directory = dirname(input.socketPath);
    const parent = await lstat(directory);
    const socket = await lstat(input.socketPath);
    if (
      !parent.isDirectory() ||
      parent.uid !== process.getuid?.() ||
      (parent.mode & 0o777) !== 0o700 ||
      (await realpath(directory)) !== directory ||
      !socket.isSocket() ||
      socket.uid !== parent.uid ||
      (socket.mode & 0o777) !== 0o600
    )
      throw new Error('Artwork inspection configuration invalid');
    body = await new Promise<string>((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      const req = request(
        { socketPath: input.socketPath, path: '/artwork-ready', method: 'GET', agent: false },
        (res) => {
          if (res.statusCode !== 200) {
            reject(new Error('Artwork inspection unavailable'));
            res.destroy();
            req.destroy();
            return;
          }
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 4096) req.destroy(new Error('Artwork inspection unavailable'));
            else chunks.push(chunk);
          });
          res.once('error', reject);
          res.once('aborted', () => reject(new Error('Artwork inspection unavailable')));
          res.once('end', () => {
            try {
              if (!res.complete) throw new Error('Artwork inspection unavailable');
              resolve(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
            } catch {
              reject(new Error('Artwork inspection unavailable'));
            }
          });
        },
      );
      const timer = setTimeout(() => req.destroy(new Error('Artwork inspection unavailable')), 3000);
      req.once('close', () => {
        clearTimeout(timer);
        reject(new Error('Artwork inspection unavailable'));
      });
      req.once('error', reject);
      req.end();
    });
  } else {
    const target = new URL(input.url ?? '');
    if (
      target.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]'].includes(target.hostname) ||
      target.pathname !== '/artwork-ready' ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    )
      throw new Error('Artwork inspection configuration invalid');
    const response = await fetch(target, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('Artwork inspection unavailable');
    if (!response.body) throw new Error('Artwork inspection unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) throw new Error('Artwork inspection unavailable');
        chunks.push(value);
      }
      body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  if (body.length > 4096 || JSON.parse(body)?.ready !== true) throw new Error('Artwork inspection unavailable');
}
