/** Secret-free local composition preview. Never imported or packaged by the application. */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { jsonRecord } from './support/fixtures.mts';
import { draft, response } from './support/product-fixture.mts';

const state = process.env.INSIGNIA_PREVIEW_STATE ?? 'normal';
if (!['normal', 'empty', 'denied', 'unavailable', 'loading'].includes(state))
  throw new Error('INSIGNIA_PREVIEW_STATE must be normal, empty, denied, unavailable or loading');
const fixtures = jsonRecord(await readFile(new URL('./support/preview-fixtures.json', import.meta.url), 'utf8'));
const config = response(draft());
config.product.title = 'Cotton crewneck — local sample';
config.config.draft.labels = {
  methods: { print: 'Screen printing' },
  placements: { front: 'Front chest' },
  steps: { small: 'Small', large: 'Large' },
};
fixtures['/api/admin/products'] = { products: [config.product], nextCursor: null };
fixtures['/api/admin/products/111/config'] = config;
const child = spawn(process.execPath, [new URL('../../dist/server/entry.mjs', import.meta.url).pathname], {
  // Deliberately exclude ambient credentials, DATABASE_URL and production configuration.
  env: { PATH: process.env.PATH, HOST: '127.0.0.1', PORT: '0', SHOPIFY_CLIENT_ID: '11111111111111111111111111111111' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk: Buffer) => {
  output += chunk.toString();
});
child.stderr.on('data', (chunk: Buffer) => {
  output += chunk.toString();
});
let upstream: string | undefined;
for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) {
  upstream = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  if (upstream) break;
  await new Promise((resolve) => setTimeout(resolve, 50));
}
if (!upstream) {
  child.kill();
  throw new Error('Build the web app first; local SSR preview could not start.');
}
const origin = upstream;
const server = createServer(async (request, reply) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    reply.setHeader('cache-control', 'no-store');
    if (url.pathname === '/__preview/bridge.js') {
      reply.setHeader('content-type', 'text/javascript');
      reply.end('window.shopify={idToken:async()=>"LOCAL-SYNTHETIC-PREVIEW",loading:()=>{}};');
      return;
    }
    if (url.pathname === '/__preview/polaris.js') {
      reply.setHeader('content-type', 'text/javascript');
      reply.end(await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url)));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      reply.setHeader('content-type', 'application/json');
      if (request.method !== 'GET') {
        reply.statusCode = 405;
        reply.end(
          JSON.stringify({
            error: 'Local preview is read-only. Use browser regression fixtures for command outcomes.',
          }),
        );
        return;
      }
      if (state === 'loading') await new Promise((resolve) => setTimeout(resolve, 3000));
      if (state === 'denied' || state === 'unavailable') {
        reply.statusCode = state === 'denied' ? 403 : 503;
        reply.end(
          JSON.stringify({
            error: state === 'denied' ? 'Local preview: access denied' : 'Local preview: service unavailable',
          }),
        );
        return;
      }
      const data =
        state === 'empty'
          ? url.pathname === '/api/admin/products'
            ? { products: [], nextCursor: null }
            : url.pathname === '/api/admin/methods'
              ? { methods: [] }
              : url.pathname === '/api/purchases/v1'
                ? { version: 'm8-purchase-list-v1', items: [], nextCursor: null }
                : url.pathname === '/api/purchases/v1/privacy'
                  ? { items: [] }
                  : fixtures[url.pathname]
          : fixtures[url.pathname];
      reply.statusCode = data ? 200 : 404;
      reply.end(JSON.stringify(data ?? { error: 'No synthetic fixture for this resource' }));
      return;
    }
    // No webhook, proxy, upload, release or other command route reaches the real SSR server.
    if (
      request.method !== 'GET' ||
      (!url.pathname.startsWith('/admin') && !url.pathname.startsWith('/_astro/') && url.pathname !== '/live')
    ) {
      reply.statusCode = 404;
      reply.end('Local preview route unavailable');
      return;
    }
    const result = await fetch(origin + url.pathname + url.search, { redirect: 'manual' });
    const type = result.headers.get('content-type') ?? '';
    reply.statusCode = result.status;
    reply.setHeader('content-type', type);
    if (type.includes('text/html')) {
      const html = (await result.text())
        .replace('https://cdn.shopify.com/shopifycloud/app-bridge.js', '/__preview/bridge.js')
        .replace('https://cdn.shopify.com/shopifycloud/polaris-1.1.js', '/__preview/polaris.js');
      reply.end(html);
    } else reply.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    reply.statusCode = 500;
    reply.end('Local preview failed');
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Local socket unavailable');
console.log(`Synthetic, read-only merchant preview (${state}): http://127.0.0.1:${address.port}/admin/products`);
console.log('No native authentication or provider acceptance is established. Ctrl-C stops both owned processes.');
function stop() {
  server.close();
  server.closeAllConnections();
  child.kill('SIGTERM');
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
child.once('exit', () => {
  server.close();
  server.closeAllConnections();
});
