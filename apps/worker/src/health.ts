import { chmod, lstat, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, isAbsolute } from 'node:path';
import type { Observability } from '@insignia/observability';
import type { inspectArtwork } from './artwork/inspection.js';
import { createPrivateInspectionHandler } from './artwork/inspection-transport.js';

/** Binds only loopback; network-facing metrics authorization belongs to deployment. */
export function createWorkerHealthServer(input: {
  observability: Observability;
  isDurableReady: () => boolean;
  probeDurableReady?: () => Promise<boolean>;
  artworkReadiness?: () => { ready: boolean };
  inspectMerchantPreview?: typeof inspectArtwork;
}) {
  const server = createServer((request, response) => {
    response.setHeader('cache-control', 'no-store');
    if (request.method === 'GET' && request.url === '/artwork-ready') {
      const artwork = input.artworkReadiness?.() ?? { ready: false };
      response.writeHead(artwork.ready ? 200 : 503, { 'content-type': 'application/json' });
      response.end(JSON.stringify(artwork));
      return;
    }
    if (request.method === 'GET' && request.url === '/live') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'live', durableReady: input.isDurableReady() }));
      return;
    }
    if (request.method === 'GET' && request.url === '/ready') {
      void (input.probeDurableReady?.() ?? Promise.resolve(input.isDurableReady()))
        .catch(() => false)
        .then((ready) => {
          response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ status: ready ? 'ready' : 'not_ready', durableReady: ready }));
        });
      return;
    }
    if (request.method === 'GET' && request.url === '/metrics') {
      void input.observability.registry
        .metrics()
        .then((body) => {
          response.writeHead(200, { 'content-type': input.observability.registry.contentType });
          response.end(body);
        })
        .catch(() => {
          response.writeHead(503).end();
        });
      return;
    }
    response.writeHead(404).end();
  });

  const inspection = createPrivateInspectionHandler({
    inspect: input.inspectMerchantPreview,
    ready: () => input.artworkReadiness?.().ready === true,
  });
  // Only inspection readiness and bounded image bytes cross the private mounted socket. Metrics and
  // generic worker health remain on the existing loopback listener.
  const artworkServer = createServer((request, response) => {
    response.setHeader('cache-control', 'no-store');
    if (request.method !== 'GET' || request.url !== '/artwork-ready') {
      inspection.handle(request, response);
      return;
    }
    const artwork = input.artworkReadiness?.() ?? { ready: false };
    response.writeHead(artwork.ready ? 200 : 503, { 'content-type': 'application/json' });
    response.end(JSON.stringify(artwork));
  });
  artworkServer.maxConnections = 8;
  artworkServer.headersTimeout = 3000;
  artworkServer.requestTimeout = 12_000;
  artworkServer.setTimeout(12_000, (socket) => socket.destroy());
  return {
    async listenArtworkSocket(socketPath: string): Promise<void> {
      if (!isAbsolute(socketPath)) throw new Error('Private artwork socket required');
      const directory = dirname(socketPath);
      const parent = await lstat(directory);
      if (
        !parent.isDirectory() ||
        parent.uid !== process.getuid?.() ||
        (parent.mode & 0o777) !== 0o700 ||
        (await realpath(directory)) !== directory
      )
        throw new Error('Private artwork socket required');
      // Never unlink or reclaim an existing endpoint, even when it looks stale.
      try {
        await lstat(socketPath);
        throw new Error('Artwork socket already exists');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await new Promise<void>((resolve, reject) => {
        artworkServer.once('error', reject);
        artworkServer.listen(socketPath, () => {
          artworkServer.off('error', reject);
          resolve();
        });
      });
      try {
        await chmod(socketPath, 0o600);
      } catch (error) {
        await new Promise<void>((resolve) => artworkServer.close(() => resolve()));
        throw error;
      }
    },
    async listen(port: number): Promise<string> {
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local port');
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected loopback TCP address');
      return `http://127.0.0.1:${address.port}`;
    },
    async close(): Promise<void> {
      await inspection.stop();
      for (const listener of [server, artworkServer]) {
        if (listener.listening)
          await new Promise<void>((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())));
      }
    },
  };
}
