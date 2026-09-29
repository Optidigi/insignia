import { createServer } from 'node:http';
import type { Observability } from '@insignia/observability';

/** Binds only loopback; network-facing metrics authorization belongs to deployment. */
export function createWorkerHealthServer(input: {
  observability: Observability;
  isDurableReady: () => boolean;
  probeDurableReady?: () => Promise<boolean>;
}) {
  const server = createServer((request, response) => {
    response.setHeader('cache-control', 'no-store');
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

  return {
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
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
