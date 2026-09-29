import { createServer } from 'node:http';
import { runLocalDiagnostic } from './diagnostic.js';

if (process.argv.includes('--diagnostic')) {
  console.log(JSON.stringify(await runLocalDiagnostic()));
} else {
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/live') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ status: 'live', durableReady: false }));
      return;
    }
    response.writeHead(404).end();
  });
  const portArgument = process.argv.find(value => value.startsWith('--port='));
  const port = portArgument ? Number(portArgument.slice('--port='.length)) : 4301;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local port');
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    console.log(JSON.stringify({ url: `http://127.0.0.1:${address.port}`, durableReady: false }));
  });
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      server.close(error => { process.exitCode = error ? 1 : 0; });
    });
  }
}
