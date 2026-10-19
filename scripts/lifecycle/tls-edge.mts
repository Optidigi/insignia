import childProcess from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import type { Socket } from 'node:net';
import net from 'node:net';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { denyFunctions } from './process-guard.mts';
import { required } from './types.mts';

const fixedRequest = http.request.bind(http);
const fixedConnect = net.createConnection.bind(net);
const self = fileURLToPath(import.meta.url);

export async function openTlsEdge(options: {
  publicHost: string;
  key: Buffer;
  cert: Buffer;
  upstreamPort: number;
  port?: number;
}) {
  if (
    !options ||
    typeof options !== 'object' ||
    Object.keys(options).some((k) => !['publicHost', 'key', 'cert', 'upstreamPort', 'port'].includes(k))
  )
    throw Error('REFUSED');
  const { publicHost, key, cert, upstreamPort, port = 0 } = options;
  if (
    !Number.isSafeInteger(upstreamPort) ||
    upstreamPort < 1 ||
    upstreamPort > 65535 ||
    !Number.isSafeInteger(port) ||
    port < 0 ||
    port > 65535
  )
    throw Error('REFUSED');
  let context: tls.SecureContext, ownedKey: Buffer | undefined;
  let stopping = false,
    closing: Promise<void> | undefined;
  const sockets = new Set<Socket>(),
    handlers = new Set<Promise<undefined | Socket>>(),
    upstreams = new Set<http.ClientRequest>(),
    headerTimers = new Map<Socket, NodeJS.Timeout>();
  const admittedSockets = new WeakSet<Socket>();
  try {
    if (
      typeof publicHost !== 'string' ||
      publicHost.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(publicHost) ||
      !Buffer.isBuffer(key) ||
      !Buffer.isBuffer(cert) ||
      !key.length ||
      !cert.length ||
      key.length > 65536 ||
      cert.length > 65536
    )
      throw Error('REFUSED');
    const leaf = new X509Certificate(cert);
    if (
      leaf.checkHost(publicHost, { subject: 'never', wildcards: false }) !== publicHost ||
      Date.now() < Date.parse(leaf.validFrom) ||
      Date.now() >= Date.parse(leaf.validTo)
    )
      throw Error('REFUSED');
    ownedKey = Buffer.from(key);
    context = tls.createSecureContext({ key: ownedKey, cert, minVersion: 'TLSv1.2' });
  } catch {
    ownedKey?.fill(0);
    throw Error('REFUSED');
  }
  const agent = new http.Agent({ keepAlive: false, maxSockets: 4, maxTotalSockets: 4 });
  agent.createConnection = () => fixedConnect({ host: '127.0.0.1', port: upstreamPort });
  const serve = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    for (const [socket, timer] of headerTimers)
      if (socket.remotePort === req.socket.remotePort) {
        clearTimeout(timer);
        headerTimers.delete(socket);
      }
    if (stopping) {
      req.destroy();
      return;
    }
    if (admittedSockets.has(req.socket)) {
      req.socket.destroy();
      return;
    }
    admittedSockets.add(req.socket);
    if (req.rawHeaders.length > 80) {
      res.writeHead(431, { connection: 'close' });
      res.end('REFUSED');
      req.resume();
      return;
    }
    const hosts: string[] = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      if (required(req.rawHeaders[i]).toLowerCase() === 'host') hosts.push(required(req.rawHeaders[i + 1]));
    if (
      ('servername' in req.socket ? req.socket.servername : undefined) !== publicHost ||
      hosts.length !== 1 ||
      hosts[0] !== publicHost
    ) {
      res.writeHead(421, { connection: 'close' });
      res.end('REFUSED');
      req.resume();
      return;
    }
    if (req.method !== 'POST' || !req.url?.startsWith('/') || req.url.startsWith('//') || /[\s#]/.test(req.url)) {
      res.writeHead(400, { connection: 'close' });
      res.end('REFUSED');
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    const bodyTimer = setTimeout(() => req.destroy(), 1000);
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 65536) {
          req.destroy();
          return;
        }
        chunks.push(chunk);
      }
    } catch {
      req.destroy();
      return;
    } finally {
      clearTimeout(bodyTimer);
    }
    const raw = Buffer.concat(chunks);
    const headers: string[] = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      if (required(req.rawHeaders[i]).toLowerCase().startsWith('x-shopify-'))
        headers.push(required(req.rawHeaders[i]), required(req.rawHeaders[i + 1]));
    headers.push('host', '127.0.0.1', 'content-length', String(raw.length), 'connection', 'close');
    const code = await new Promise<number>((resolve) => {
      let completed = false,
        timer: NodeJS.Timeout | undefined;
      const finish = (code: number) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        resolve(code);
      };
      const upstream = fixedRequest(
        { host: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers, agent },
        (response) => {
          const received: Buffer[] = [];
          let bytes = 0;
          response.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > 32) {
              finish(502);
              upstream.destroy();
            } else received.push(chunk);
          });
          response.once('end', () =>
            finish(
              response.statusCode === 200
                ? Buffer.concat(received).equals(Buffer.from('RECEIVED'))
                  ? 200
                  : 502
                : [400, 404, 503].includes(response.statusCode ?? 0)
                  ? required(response.statusCode)
                  : 502,
            ),
          );
          response.once('error', () => finish(502));
          response.once('aborted', () => finish(502));
        },
      );
      upstreams.add(upstream);
      upstream.once('close', () => upstreams.delete(upstream));
      timer = setTimeout(() => {
        finish(502);
        upstream.destroy();
      }, 1500);
      upstream.once('error', () => finish(502));
      res.once('close', () => {
        finish(502);
        upstream.destroy();
      });
      upstream.end(raw);
    });
    raw.fill(0);
    if (!res.destroyed && !res.writableEnded) {
      res.writeHead(code, { 'content-type': 'text/plain', connection: 'close' });
      res.end(code === 200 ? 'RECEIVED' : 'REFUSED');
    }
  };
  const server = https.createServer(
    {
      key: ownedKey,
      cert,
      maxHeaderSize: 16384,
      minVersion: 'TLSv1.2',
      handshakeTimeout: 5000,
      SNICallback(name, callback) {
        callback(name === publicHost ? null : Error('REFUSED'), name === publicHost ? context : undefined);
      },
    },
    (req, res) => {
      const handler = serve(req, res).catch(() => req.socket.destroy());
      handlers.add(handler);
      handler.finally(() => handlers.delete(handler));
    },
  );
  server.on('connection', (socket) => {
    if (!(socket instanceof net.Socket)) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    headerTimers.set(
      socket,
      setTimeout(() => socket.destroy(), 5000),
    );
    socket.once('close', () => {
      sockets.delete(socket);
      clearTimeout(headerTimers.get(socket));
      headerTimers.delete(socket);
    });
    if (stopping) socket.destroy();
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  Reflect.set(server, 'handshakeTimeout', 5000);
  server.maxConnections = 4;
  server.maxHeadersCount = 41; // Observe at least one excess pair, then refuse instead of silently truncating.
  server.on('clientError', (_, socket) => socket.destroy());
  server.on('secureConnection', (socket) => {
    if (!('servername' in socket) || socket.servername !== publicHost) socket.destroy();
  });
  server.on('tlsClientError', (_, socket) => socket.destroy());
  const close = () =>
    (closing ??= (async () => {
      stopping = true;
      const stopped = new Promise<void>((resolve) => server.close(() => resolve()));
      for (const socket of sockets) socket.destroy();
      for (const upstream of upstreams) upstream.destroy();
      agent.destroy();
      await stopped;
      await Promise.allSettled([...handlers]);
      required(ownedKey).fill(0);
    })());
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  } catch {
    await close();
    throw Error('REFUSED');
  }
  return { port: (required(server.address()) as import('node:net').AddressInfo).port, close };
}

// CLI process guard. The only saved outbound factory is closed over literal loopback.
function guardProcess() {
  const deny = () => {
    throw Error('NETWORK_DISABLED');
  };
  globalThis.fetch = deny;
  for (const module of [http, https]) {
    module.request = deny;
    module.get = deny;
  }
  net.connect = deny;
  net.createConnection = deny;
  tls.connect = deny;
  for (const module of [dns, childProcess]) denyFunctions(module, deny);
  // Preserve loopback-only listen lookup while every other DNS operation refuses.
  const lookup = (host: string, options: unknown, callback?: unknown) => {
    const cb = typeof options === 'function' ? options : callback;
    if (host !== '127.0.0.1' || typeof cb !== 'function') throw Error('NETWORK_DISABLED');
    const all = options !== null && typeof options === 'object' && 'all' in options && options.all;
    queueMicrotask(() => (all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)));
  };
  dns.lookup = lookup as typeof dns.lookup;
  denyFunctions(dns.promises, deny);
  syncBuiltinESMExports();
}
function readInherited(fd: number) {
  const raw = Buffer.alloc(65537);
  let size = 0;
  try {
    while (size < raw.length) {
      const count = fs.readSync(fd, raw, size, raw.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size > 65536 || size === 0) throw Error('REFUSED');
    return Buffer.from(raw.subarray(0, size));
  } finally {
    raw.fill(0);
  }
}
if (process.argv[1] === self) {
  const emit = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  for (const name of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir'] as const) console[name] = () => {};
  const fail = () => {
    emit('{"status":"REFUSED"}\n');
    process.exit(20);
  };
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);
  let key: Buffer | undefined, cert: Buffer | undefined, edge: Awaited<ReturnType<typeof openTlsEdge>> | undefined;
  try {
    if (process.version !== 'v24.21.0' || process.argv.length !== 3) throw Error('REFUSED');
    key = readInherited(3);
    cert = readInherited(4);
    guardProcess();
    edge = await openTlsEdge({ publicHost: required(process.argv[2]), key, cert, upstreamPort: 43127, port: 43129 });
    key.fill(0);
    cert.fill(0);
    emit('{"status":"READY","port":43129}\n');
    let closing = false;
    for (const signal of ['SIGTERM', 'SIGINT'])
      process.once(signal, async () => {
        if (closing) return;
        closing = true;
        await required(edge).close();
        process.exit(0);
      });
  } catch {
    key?.fill(0);
    cert?.fill(0);
    await edge?.close();
    fail();
  }
}
