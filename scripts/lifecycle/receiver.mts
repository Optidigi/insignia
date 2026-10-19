import crypto from 'node:crypto';
import http from 'node:http';
import type { Socket } from 'node:net';
import path from 'node:path';
import { verifyShopifyWebhook } from '../../packages/shopify/src/webhook.ts';
import { aad, acquire, durable, inventory, load, name, refuse, release, seal, withLifecycle } from './store.mts';
import { json, type Ownership, record, required } from './types.mts';
export interface ReceiverOptions {
  directory: string;
  clientSecrets: string[];
  now?: () => number;
  port?: number;
  expectedIdentity?: string;
}
export async function openReceiver(options: ReceiverOptions) {
  return Object.hasOwn(options, 'expectedIdentity') ? openBoundReceiver(options) : startReceiver(options);
}
export async function openBoundReceiver(options: ReceiverOptions) {
  const expectedIdentity = options?.expectedIdentity;
  if (typeof expectedIdentity !== 'string' || !/^[a-f0-9]{64}$/.test(expectedIdentity)) refuse();
  return startReceiver(options, expectedIdentity);
}
async function startReceiver(
  { directory, clientSecrets, now = Date.now, port = 0 }: ReceiverOptions,
  expectedIdentity?: string,
) {
  let startupClose: (() => Promise<void>) | undefined, armTimer: (() => void) | undefined;
  try {
    const receiver = await withLifecycle(directory, async (guard) => {
      let key: Buffer | undefined, ownership: Ownership | undefined;
      try {
        const loaded = await load(directory);
        key = loaded.key;
        const m = loaded.m;
        if (
          expectedIdentity !== undefined &&
          crypto.createHash('sha256').update(aad(m)).digest('hex') !== expectedIdentity
        )
          refuse();
        if (
          now() >= m.acceptUntil ||
          !Array.isArray(clientSecrets) ||
          clientSecrets.length < 1 ||
          clientSecrets.length > 4 ||
          clientSecrets.some((v) => typeof v !== 'string' || !v)
        )
          refuse();
        ownership = await acquire(directory, guard);
        let counter = (await inventory(directory)).length,
          failed = false;
        let stopping = false;
        const sockets = new Set<Socket>(),
          handlers = new Set<Promise<void>>();
        const serve = async (req: http.IncomingMessage, res: http.ServerResponse) => {
          const answer = (code: number) => {
            if (!res.destroyed) {
              res.writeHead(code, { 'content-type': 'text/plain', connection: 'close' });
              res.end(code === 200 ? 'RECEIVED' : 'REFUSED');
            }
          };
          try {
            if (stopping || failed || now() >= m.acceptUntil || now() >= m.eraseBy || counter >= m.maxArrivals) {
              answer(503);
              req.resume();
              return;
            }
            const id = ++counter,
              label = name(id);
            await durable(
              path.join(directory, 'reservations', label + '.json'),
              JSON.stringify({ receipt: id, at: now(), capabilityLabel: m.binding.capabilityLabel }),
            );
            if (stopping || req.destroyed) return;
            if (req.method !== 'POST' || req.url !== '/callback/' + m.capability) {
              answer(404);
              req.resume();
              return;
            }
            const chunks: Buffer[] = [];
            let bytes = 0;
            const raw = await new Promise<Buffer>((resolve, reject) => {
              if (req.destroyed) return reject(Error('BODY_ABORTED'));
              const timer = setTimeout(() => {
                reject(Error('BODY_DEADLINE'));
                req.destroy();
              }, m.bodyDeadlineMs);
              req.on('data', (chunk) => {
                bytes += chunk.length;
                if (bytes > m.maxBytes) {
                  clearTimeout(timer);
                  reject(Error('BODY_SIZE'));
                  req.destroy();
                } else chunks.push(chunk);
              });
              req.on('end', () => {
                clearTimeout(timer);
                resolve(Buffer.concat(chunks));
              });
              req.on('error', () => {
                clearTimeout(timer);
                reject(Error('BODY_ABORTED'));
              });
              req.on('aborted', () => {
                clearTimeout(timer);
                reject(Error('BODY_ABORTED'));
              });
            });
            if (stopping || now() >= m.acceptUntil || now() >= m.eraseBy) {
              answer(503);
              return;
            }
            // Duplicate/case-clashing Shopify headers remain visible to the accepted verifier.
            const headers: Record<string, string | string[]> = {};
            for (let i = 0; i < req.rawHeaders.length; i += 2) {
              const k = required(req.rawHeaders[i]).toLowerCase();
              if (!k.startsWith('x-shopify-')) continue;
              const value = required(req.rawHeaders[i + 1]);
              const previous = headers[k];
              headers[k] =
                previous === undefined ? value : [...(typeof previous === 'string' ? [previous] : previous), value];
            }
            let acceptedVerifierSucceeded = false,
              signedShopMatches = false,
              topicEligible = false;
            try {
              const observed = verifyShopifyWebhook(raw, headers, clientSecrets);
              acceptedVerifierSucceeded = true;
              topicEligible = observed.topic === 'app/uninstalled';
              const shop = record(json(raw.toString('utf8')));
              const id = shop.id;
              signedShopMatches =
                ((typeof id === 'number' && Number.isSafeInteger(id) && id > 0) ||
                  (typeof id === 'string' && /^[1-9][0-9]*$/.test(id))) &&
                'gid://shopify/Shop/' + String(id) === m.binding.providerShopId &&
                shop.myshopify_domain === m.binding.providerShopDomain;
            } catch {
              /* Fixed negative evidence only; provider data never becomes an exception message. */
            }
            const evidence = {
              receipt: id,
              at: now(),
              capabilityLabel: m.binding.capabilityLabel,
              binding: { ...m.binding },
              acceptedVerifierSucceeded,
              signedShopMatches,
              topicEligible,
              rawBody: raw.toString('base64'),
              headers,
            };
            const encrypted = seal(
              required(key),
              Buffer.concat([aad(m), Buffer.from('\0receipt:' + id)]),
              Buffer.from(JSON.stringify(evidence)),
            );
            await durable(path.join(directory, 'spool', label + '.bin'), encrypted);
            await durable(path.join(directory, 'commits', label + '.json'), JSON.stringify({ receipt: id }));
            if (stopping || now() >= m.acceptUntil || now() >= m.eraseBy) {
              answer(503);
              return;
            }
            answer(acceptedVerifierSucceeded && signedShopMatches && topicEligible ? 200 : 400);
          } catch {
            failed = true;
            answer(503);
          }
        };
        const server = http.createServer({ maxHeaderSize: 16 * 1024 }, (req, res) => {
          const handler = serve(req, res);
          handlers.add(handler);
          handler.then(
            () => handlers.delete(handler),
            () => handlers.delete(handler),
          );
        });
        server.on('connection', (socket) => {
          sockets.add(socket);
          socket.once('close', () => sockets.delete(socket));
          if (stopping) socket.destroy();
        });
        server.headersTimeout = 5000;
        server.requestTimeout = 5000;
        server.maxHeadersCount = 40;
        server.maxConnections = 4;
        server.on('clientError', (_, socket) => socket.destroy());
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(port, '127.0.0.1', resolve);
        });
        let closing: Promise<void> | undefined;
        let timer: NodeJS.Timeout | undefined;
        const close = () =>
          (closing ??= (async () => {
            clearTimeout(timer);
            stopping = true;
            try {
              const stopped = new Promise<void>((resolve) => server.close(() => resolve()));
              for (const socket of sockets) socket.destroy();
              await stopped;
              await Promise.allSettled([...handlers]);
            } finally {
              required(key).fill(0);
              await release(directory, required(ownership));
            }
          })());
        startupClose = close;
        armTimer = () => {
          timer = setTimeout(
            () => {
              close().catch(() => {});
            },
            Math.max(1, m.acceptUntil - now()),
          );
          timer.unref();
        };
        return { port: (required(server.address()) as import('node:net').AddressInfo).port, close };
      } catch (error) {
        key?.fill(0);
        if (ownership) await release(directory, ownership, guard);
        throw error;
      }
    });
    required(armTimer)();
    return receiver;
  } catch (error) {
    if (startupClose) await startupClose();
    throw error;
  }
}
