/** Temporary owner input transport, never installation or Function authority. */
import assert from 'node:assert/strict';
import { fstatSync } from 'node:fs';
import http, { createServer } from 'node:http';
import https from 'node:https';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ORIGIN = 'https://insignia-app.optidigi.nl';
const SHOP = 'insignia-rewrite-dev.myshopify.com';
const CLIENT = '1443cf6d03d39edae7c101a943c5c684';

/** HTTPS is terminated by the qualified private Traefik route. This broker checks
 * only the original SDK signature/shop/time; the original operator independently
 * exchanges the staff grant and checks install/generation/release before writes.
 * receive must deliver to a private memory pipe, never a log or stored receipt. */
export function createOwnerSessionInput({ nonce, identity, receive, deadline, now = Date.now }) {
  assert.match(nonce, /^[a-f0-9]{64}$/);
  assert.ok(typeof receive === 'function' && typeof identity.verify === 'function');
  assert.ok(Number.isFinite(deadline) && deadline > now() && deadline <= now() + 600000);
  let claimed = false;
  const server = createServer({ maxHeaderSize: 12000 }, async (request, response) => {
    const reply = (status, result) => {
      response.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'private, no-store',
        connection: 'close',
      });
      response.end(JSON.stringify({ result }));
    };
    if (now() >= deadline) return reply(408, 'INPUT_CLOSED');
    if (request.url !== `/__m5/owner-input/${nonce}`) return reply(404, 'INPUT_UNAVAILABLE');
    if (request.method !== 'POST') return reply(405, 'METHOD_DENIED');
    if (
      request.headers.origin !== ORIGIN ||
      ![new URL(ORIGIN).host, `${new URL(ORIGIN).host}:443`].includes(request.headers.host)
    )
      return reply(403, 'ORIGIN_DENIED');
    if (request.headers['transfer-encoding'] || ![undefined, '0'].includes(request.headers['content-length']))
      return reply(422, 'BODY_DENIED');
    if (claimed) return reply(409, 'INPUT_ALREADY_CONSUMED');
    const bearer = request.headers.authorization;
    if (typeof bearer !== 'string' || bearer.length > 8199 || !/^Bearer [A-Za-z0-9_.-]+$/.test(bearer))
      return reply(401, 'SESSION_REJECTED');
    let token = bearer.slice(7);
    try {
      const staff = await identity.verify(token);
      assert.ok(staff.shop === SHOP && staff.staffId && staff.sessionId && staff.expiresAtMs > now() + 30000);
    } catch {
      token = undefined;
      return reply(401, 'SESSION_REJECTED');
    }
    // Concurrent verified requests cannot deliver a second session.
    if (claimed || now() >= deadline) return reply(409, 'INPUT_ALREADY_CONSUMED');
    claimed = true;
    try {
      await receive(token);
      reply(202, 'SESSION_RECEIVED_NOT_SETUP_SUCCESS');
    } catch {
      reply(503, 'INPUT_DELIVERY_UNCERTAIN_NO_RETRY');
    } finally {
      token = undefined;
      request.headers.authorization = undefined;
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  return server;
}

async function main() {
  // Refuse terminal/file output. The qualified launcher additionally requires
  // Docker log-driver=none and a private SSH memory consumer for this pipe.
  assert.ok(fstatSync(process.stdout.fd).isFIFO());
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    assert.ok(size <= 4096);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const packet = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  bytes.fill(0);
  for (const chunk of chunks) chunk.fill(0);
  assert.deepEqual(Object.keys(packet).sort(), ['clientSecret', 'nonce']);
  assert.ok(
    typeof packet.clientSecret === 'string' && packet.clientSecret.length > 0 && packet.clientSecret.length <= 256,
  );
  const deny = () => {
    throw new Error('network_escape_denied');
  };
  globalThis.fetch = async () => deny();
  for (const module of [http, https]) module.request = module.get = deny;
  syncBuiltinESMExports();
  // Main is container-only, in the already qualified portable web package.
  const require = createRequire('/srv/insignia/web/package.json');
  const { createAdminOnlineIdentity } = await import(pathToFileURL(require.resolve('@insignia/shopify')));
  const identity = createAdminOnlineIdentity({
    apiKey: CLIENT,
    apiSecret: packet.clientSecret,
    hostName: new URL(ORIGIN).host,
    fetchImpl: async () => deny(),
  });
  packet.clientSecret = undefined;
  const server = createOwnerSessionInput({
    nonce: packet.nonce,
    identity,
    deadline: Date.now() + 600000,
    receive: (token) =>
      new Promise((resolve, reject) => {
        process.stdout.write(`${JSON.stringify({ kind: 'PRIVATE_SESSION_INPUT', idToken: token })}\n`, (error) =>
          error ? reject(error) : resolve(),
        );
      }),
  });
  await new Promise((resolve) => server.listen(18080, '0.0.0.0', resolve));
  process.stdout.write(`${JSON.stringify({ kind: 'INPUT_READY' })}\n`);
  const timer = setTimeout(() => server.close(), 600000);
  server.on('close', () => clearTimeout(timer));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch {
    process.exitCode = 1;
  }
}
