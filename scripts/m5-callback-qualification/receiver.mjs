import http from 'node:http';
import path from 'node:path';
import { verifyShopifyWebhook } from '../../packages/shopify/src/webhook.ts';
import { aad, acquire, durable, inventory, load, name, refuse, release, seal } from './store.mjs';
export async function openReceiver({ directory, clientSecrets, now = Date.now, port = 0 }) {
  const { m, key } = await load(directory);
  if (
    now() >= m.acceptUntil ||
    !Array.isArray(clientSecrets) ||
    clientSecrets.length < 1 ||
    clientSecrets.length > 4 ||
    clientSecrets.some((v) => typeof v !== 'string' || !v)
  )
    refuse();
  await acquire(directory);
  let counter = (await inventory(directory)).length,
    failed = false;
  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, async (req, res) => {
    const answer = (code) => {
      if (!res.destroyed) {
        res.writeHead(code, { 'content-type': 'text/plain', connection: 'close' });
        res.end(code === 200 ? 'RECEIVED' : 'REFUSED');
      }
    };
    try {
      if (failed || now() >= m.acceptUntil || now() >= m.eraseBy || counter >= m.maxArrivals) {
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
      if (req.method !== 'POST' || req.url !== '/callback/' + m.capability) {
        answer(404);
        req.resume();
        return;
      }
      const chunks = [];
      let bytes = 0;
      const raw = await new Promise((resolve, reject) => {
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
      if (now() >= m.acceptUntil || now() >= m.eraseBy) {
        answer(503);
        return;
      }
      // Duplicate/case-clashing Shopify headers remain visible to the accepted verifier.
      const headers = {};
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i].toLowerCase();
        if (!k.startsWith('x-shopify-')) continue;
        headers[k] = k in headers ? [].concat(headers[k], req.rawHeaders[i + 1]) : req.rawHeaders[i + 1];
      }
      let acceptedVerifierSucceeded = false,
        signedShopMatches = false,
        topicEligible = false;
      try {
        const observed = verifyShopifyWebhook(raw, headers, clientSecrets);
        acceptedVerifierSucceeded = true;
        topicEligible = observed.topic === 'app/uninstalled';
        const shop = JSON.parse(raw.toString('utf8'));
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
        key,
        Buffer.concat([aad(m), Buffer.from('\0receipt:' + id)]),
        Buffer.from(JSON.stringify(evidence)),
      );
      await durable(path.join(directory, 'spool', label + '.bin'), encrypted);
      await durable(path.join(directory, 'commits', label + '.json'), JSON.stringify({ receipt: id }));
      if (now() >= m.acceptUntil || now() >= m.eraseBy) {
        answer(503);
        return;
      }
      answer(acceptedVerifierSucceeded && signedShopMatches && topicEligible ? 200 : 400);
    } catch {
      failed = true;
      answer(503);
    }
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  server.maxHeadersCount = 40;
  server.maxConnections = 4;
  server.on('clientError', (_, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  let closing;
  let timer;
  const close = () =>
    (closing ??= (async () => {
      clearTimeout(timer);
      await new Promise((resolve) => server.close(resolve));
      key.fill(0);
      await release(directory);
    })());
  timer = setTimeout(
    () => {
      close().catch(() => {});
    },
    Math.max(1, m.acceptUntil - now()),
  );
  timer.unref();
  return { port: server.address().port, close };
}
