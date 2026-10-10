import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import https from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createExperiment, privateEnrollment, privateReceipt, status } from './operator.mjs';
import { openReceiver } from './receiver.mjs';
import { openTlsEdge } from './tls-edge.mjs';

const publicHost = 'edge.example.invalid';
const secret = 'SYNTHETIC_SIGNING_SENTINEL';
const body = Buffer.from('{ "id":123,"myshopify_domain":"fixture.myshopify.com","name":"BODY_SECRET_SENTINEL é"}\n');
const binding = {
  experiment: 'tls-fixture',
  era: 'OLD',
  appId: 'gid://shopify/App/1',
  providerShopId: 'gid://shopify/Shop/123',
  providerShopDomain: 'fixture.myshopify.com',
  appInstallationId: 'gid://shopify/AppInstallation/456',
  capabilityLabel: 'OLD_IMMUTABLE',
};
function headers(raw = body) {
  return {
    host: publicHost,
    'x-shopify-hmac-sha256': crypto.createHmac('sha256', secret).update(raw).digest('base64'),
    'x-shopify-shop-domain': 'fixture.myshopify.com',
    'x-shopify-topic': 'app/uninstalled',
    'x-shopify-api-version': '2026-07',
    'x-shopify-webhook-id': 'HEADER_SECRET_SENTINEL',
    'x-shopify-triggered-at': '2026-10-10T12:00:00Z',
  };
}
async function setup() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'insignia-tls-edge-'));
  await fs.chmod(root, 0o700);
  const keyFile = path.join(root, 'synthetic-key.pem'),
    certFile = path.join(root, 'synthetic-cert.pem');
  assert.equal(
    spawnSync(
      '/usr/bin/openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyFile,
        '-out',
        certFile,
        '-days',
        '1',
        '-subj',
        '/CN=' + publicHost,
        '-addext',
        'subjectAltName=DNS:' + publicHost,
      ],
      { stdio: 'ignore' },
    ).status,
    0,
  );
  await fs.chmod(keyFile, 0o600);
  await fs.chmod(certFile, 0o600);
  const key = await fs.readFile(keyFile),
    cert = await fs.readFile(certFile);
  const parent = path.join(root, 'owned');
  await fs.mkdir(parent, { mode: 0o700 });
  const directory = path.join(parent, binding.experiment);
  await createExperiment({ directory, binding, acceptUntil: Date.now() + 60000, eraseBy: Date.now() + 120000 });
  const enrollment = await privateEnrollment(directory);
  const receiver = await openReceiver({ directory, clientSecrets: [secret] });
  return { root, key, cert, directory, enrollment, receiver };
}
function send(edge, s, target = s.enrollment.callbackPath, raw = body, h = headers(), options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: '127.0.0.1',
        port: edge.port,
        servername: publicHost,
        ca: s.cert,
        path: target,
        method: 'POST',
        headers: h,
        agent: false,
        timeout: 3500,
        ...options,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ code: res.statusCode, text: Buffer.concat(chunks).toString(), headers: res.headers }),
        );
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(Error('TEST_LOCAL_TIMEOUT')));
    req.end(raw);
  });
}
test('real HTTPS preserves exact signed bytes and metadata; success follows accepted receiver durable commit', async () => {
  const s = await setup();
  let edge;
  try {
    edge = await openTlsEdge({ publicHost, key: s.key, cert: s.cert, upstreamPort: s.receiver.port });
    const response = await send(edge, s);
    assert.equal(response.code, 200);
    assert.equal(response.text, 'RECEIVED');
    assert.equal(response.headers.location, undefined);
    const receipt = await privateReceipt(s.directory, 1);
    assert.deepEqual(Buffer.from(receipt.rawBody, 'base64'), body);
    assert.equal(receipt.headers['x-shopify-hmac-sha256'], headers()['x-shopify-hmac-sha256']);
    assert.equal(receipt.headers['x-shopify-topic'], 'app/uninstalled');
    assert.equal(receipt.headers['x-shopify-shop-domain'], 'fixture.myshopify.com');
    assert.equal(receipt.capabilityLabel, 'OLD_IMMUTABLE');
    assert.deepEqual(await status(s.directory), { status: 'OPEN', reserved: 1, committed: 1, uncertain: 0 });
  } finally {
    await edge?.close();
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});

test('exact certificate hostname, SNI and Host are required before forwarding to the receiver', async () => {
  const s = await setup();
  let edge, wrong;
  try {
    await assert.rejects(async () => {
      wrong = await openTlsEdge({
        publicHost: 'other.example.invalid',
        key: s.key,
        cert: s.cert,
        upstreamPort: s.receiver.port,
      });
    }, /REFUSED/);
    edge = await openTlsEdge({ publicHost, key: s.key, cert: s.cert, upstreamPort: s.receiver.port });
    await assert.rejects(() =>
      send(edge, s, undefined, body, headers(), { servername: 'wrong.example.invalid', rejectUnauthorized: false }),
    );
    await assert.rejects(() =>
      send(edge, s, undefined, body, headers(), { servername: '', rejectUnauthorized: false }),
    );
    assert.equal((await send(edge, s, undefined, body, { ...headers(), host: 'wrong.example.invalid' })).code, 421);
    assert.deepEqual(await status(s.directory), { status: 'OPEN', reserved: 0, committed: 0, uncertain: 0 });
  } finally {
    await wrong?.close();
    await edge?.close();
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});

test('origin-form target is forwarded byte-for-byte; absolute URL refuses without upstream admission', async () => {
  const s = await setup();
  let edge;
  try {
    edge = await openTlsEdge({ publicHost, key: s.key, cert: s.cert, upstreamPort: s.receiver.port });
    assert.equal((await send(edge, s, 'http://never-resolve.example.invalid' + s.enrollment.callbackPath)).code, 400);
    assert.deepEqual(await status(s.directory), { status: 'OPEN', reserved: 0, committed: 0, uncertain: 0 });
    assert.equal((await send(edge, s, s.enrollment.callbackPath + '?QUERY_SECRET_SENTINEL')).code, 404);
    assert.equal((await send(edge, s, s.enrollment.callbackPath.replace('/callback/', '/callback%2F'))).code, 404);
    assert.deepEqual(await status(s.directory), { status: 'OPEN', reserved: 2, committed: 0, uncertain: 2 });
  } finally {
    await edge?.close();
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});

import http from 'node:http';

test('upstream redirect/error bodies never redirect or reflect and are never reforwarded', async () => {
  const s = await setup();
  let edge,
    count = 0;
  const upstream = http.createServer((req, res) => {
    count++;
    req.resume();
    res.writeHead(302, { location: 'https://never-resolve.example.invalid/LOCATION_SECRET_SENTINEL' });
    res.end('ERROR_SECRET_SENTINEL');
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  try {
    edge = await openTlsEdge({ publicHost, key: s.key, cert: s.cert, upstreamPort: upstream.address().port });
    const response = await send(edge, s);
    assert.equal(response.code, 502);
    assert.equal(response.text, 'REFUSED');
    assert.equal(response.headers.location, undefined);
    assert.equal(count, 1);
  } finally {
    await edge?.close();
    await new Promise((r) => upstream.close(r));
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
test('HTTPS negative HMAC/body/topic remains private old-label evidence, never generation authority', async () => {
  const s = await setup();
  let edge;
  try {
    edge = await openTlsEdge({ publicHost, key: s.key, cert: s.cert, upstreamPort: s.receiver.port });
    assert.equal(
      (await send(edge, s, undefined, body, { ...headers(), 'x-shopify-hmac-sha256': 'A'.repeat(43) + '=' })).code,
      400,
    );
    assert.equal((await send(edge, s, undefined, Buffer.concat([body, Buffer.from(' ')]), headers())).code, 400);
    assert.equal(
      (
        await send(edge, s, undefined, body, {
          ...headers(),
          'x-shopify-topic': 'customers/redact',
          'x-shopify-shop-domain': 'unsigned.myshopify.com',
          'x-shopify-triggered-at': '2026-10-10T15:00:00Z',
        })
      ).code,
      400,
    );
    const receipt = await privateReceipt(s.directory, 3);
    assert.equal(receipt.capabilityLabel, 'OLD_IMMUTABLE');
    assert.equal(receipt.acceptedVerifierSucceeded, true);
    assert.equal(receipt.topicEligible, false);
    assert.equal(receipt.headers['x-shopify-shop-domain'], 'unsigned.myshopify.com');
    assert.deepEqual(Buffer.from(receipt.rawBody, 'base64'), body);
    assert.deepEqual(await status(s.directory), { status: 'OPEN', reserved: 3, committed: 3, uncertain: 0 });
  } finally {
    await edge?.close();
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
test('64KiB ingress body ceiling prevents upstream admission and exact boundary remains supported', async () => {
  const s = await setup();
  let edge;
  try {
    edge = await openTlsEdge({ publicHost, key: s.key, cert: s.cert, upstreamPort: s.receiver.port });
    const at = Buffer.concat([body, Buffer.alloc(65536 - body.length, 32)]);
    assert.equal((await send(edge, s, undefined, at, headers(at))).code, 200);
    await assert.rejects(() => send(edge, s, undefined, Buffer.alloc(65537, 32), headers(Buffer.alloc(65537, 32))));
    assert.deepEqual(await status(s.directory), { status: 'OPEN', reserved: 1, committed: 1, uncertain: 0 });
  } finally {
    await edge?.close();
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
test('header count and byte bounds reject before any upstream delivery', async () => {
  const s = await setup();
  let edge;
  try {
    edge = await openTlsEdge({ publicHost, key: s.key, cert: s.cert, upstreamPort: s.receiver.port });
    const oversized = await send(edge, s, undefined, body, {
      ...headers(),
      'x-private-large': 'HEADER_SECRET_SENTINEL'.repeat(1000),
    }).catch(() => ({ code: 0 }));
    assert.ok([0, 431].includes(oversized.code));
    const many = { ...headers() };
    for (let i = 0; i < 41; i++) many['x-extra-' + i] = 'SYNTHETIC';
    const excess = await send(edge, s, undefined, body, many).catch(() => ({ code: 0 }));
    assert.ok([0, 431].includes(excess.code));
    assert.deepEqual(await status(s.directory), { status: 'OPEN', reserved: 0, committed: 0, uncertain: 0 });
    const at = { ...headers(), 'content-length': String(body.length), connection: 'close' };
    for (let i = 0; i < 31; i++) at['x-boundary-' + i] = 'SYNTHETIC';
    assert.equal((await send(edge, s, undefined, body, at)).code, 200);
  } finally {
    await edge?.close();
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
test('one total upstream deadline refuses a hung backend without retry or success ACK', async () => {
  const s = await setup();
  let edge,
    count = 0;
  const sockets = new Set();
  const upstream = http.createServer((req) => {
    count++;
    req.resume();
  });
  upstream.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  try {
    edge = await openTlsEdge({ publicHost, key: s.key, cert: s.cert, upstreamPort: upstream.address().port });
    const start = performance.now();
    const response = await Promise.race([send(edge, s), new Promise((r) => setTimeout(() => r('TEST_TIMEOUT'), 2300))]);
    assert.notEqual(response, 'TEST_TIMEOUT');
    assert.equal(response.code, 502);
    assert.equal(response.text, 'REFUSED');
    assert.ok(performance.now() - start < 2200);
    assert.equal(count, 1);
  } finally {
    for (const socket of sockets) socket.destroy();
    await edge?.close();
    await new Promise((r) => upstream.close(r));
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});

import { once } from 'node:events';
import tls from 'node:tls';

test('close destroys an unfinished TLS HTTP header and stops listening within a bounded interval', async () => {
  const s = await setup();
  let edge, socket, closing;
  try {
    edge = await openTlsEdge({ publicHost, key: s.key, cert: s.cert, upstreamPort: s.receiver.port });
    socket = tls.connect({ host: '127.0.0.1', port: edge.port, servername: publicHost, ca: s.cert });
    socket.on('error', () => {});
    await once(socket, 'secureConnect');
    socket.write('POST /PATH_SECRET_SENTINEL HTTP/1.1\r\nHost: ' + publicHost + '\r\n');
    closing = edge.close();
    const result = await Promise.race([closing.then(() => true), new Promise((r) => setTimeout(() => r(false), 500))]);
    assert.equal(result, true);
    await assert.rejects(() => send(edge, s));
  } finally {
    socket?.destroy();
    await closing;
    await edge?.close();
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
test('incomplete body times out in one second without upstream reservation', async () => {
  const s = await setup();
  let edge, q;
  try {
    edge = await openTlsEdge({ publicHost, key: s.key, cert: s.cert, upstreamPort: s.receiver.port });
    q = https.request({
      host: '127.0.0.1',
      port: edge.port,
      servername: publicHost,
      ca: s.cert,
      path: s.enrollment.callbackPath,
      method: 'POST',
      headers: headers(),
      agent: false,
    });
    const failed = new Promise((r) => q.once('error', () => r(true)));
    const start = performance.now();
    q.flushHeaders();
    q.write('BODY_SECRET_SENTINEL');
    assert.equal(await Promise.race([failed, new Promise((r) => setTimeout(() => r(false), 1800))]), true);
    assert.ok(performance.now() - start < 1600);
    assert.deepEqual(await status(s.directory), { status: 'OPEN', reserved: 0, committed: 0, uncertain: 0 });
  } finally {
    q?.destroy();
    await edge?.close();
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
test('TLS/header startup deadline closes stalled headers even when bytes keep arriving', async () => {
  const s = await setup();
  let edge, socket, ticker;
  try {
    edge = await openTlsEdge({ publicHost, key: s.key, cert: s.cert, upstreamPort: s.receiver.port });
    socket = tls.connect({ host: '127.0.0.1', port: edge.port, servername: publicHost, ca: s.cert });
    socket.on('error', () => {});
    await once(socket, 'secureConnect');
    const closed = once(socket, 'close');
    const start = performance.now();
    socket.write('POST /PATH_SECRET_SENTINEL HTTP/1.1\r\nHost: ' + publicHost + '\r\nX-Test: ');
    ticker = setInterval(() => socket.write('x'), 200);
    const timed = await Promise.race([closed.then(() => true), new Promise((r) => setTimeout(() => r(false), 5700))]);
    assert.equal(timed, true);
    assert.ok(performance.now() - start < 5500);
    assert.deepEqual(await status(s.directory), { status: 'OPEN', reserved: 0, committed: 0, uncertain: 0 });
  } finally {
    clearInterval(ticker);
    socket?.destroy();
    await edge?.close();
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
test('at most four inbound TLS connections are owned; an excess connection cannot reach upstream', async () => {
  const s = await setup();
  let edge;
  const sockets = [];
  try {
    edge = await openTlsEdge({ publicHost, key: s.key, cert: s.cert, upstreamPort: s.receiver.port });
    for (let i = 0; i < 4; i++) {
      const socket = tls.connect({ host: '127.0.0.1', port: edge.port, servername: publicHost, ca: s.cert });
      sockets.push(socket);
      socket.on('error', () => {});
      await once(socket, 'secureConnect');
    }
    const fifth = tls.connect({ host: '127.0.0.1', port: edge.port, servername: publicHost, ca: s.cert });
    sockets.push(fifth);
    fifth.on('error', () => {});
    const refused = await new Promise((r) => {
      fifth.once('close', () => r(true));
      fifth.once('secureConnect', () => r(false));
    });
    assert.equal(refused, true);
    assert.deepEqual(await status(s.directory), { status: 'OPEN', reserved: 0, committed: 0, uncertain: 0 });
  } finally {
    for (const socket of sockets) socket.destroy();
    await edge?.close();
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
test('operator options are closed and cannot select non-loopback destinations or invalid ports', async () => {
  const s = await setup();
  let accidental;
  try {
    for (const extra of [
      { upstreamHost: 'never-resolve.example.invalid' },
      { upstreamPort: 'http://never-resolve.example.invalid' },
      { upstreamPort: 0 },
      { port: 65536 },
    ])
      await assert.rejects(async () => {
        accidental = await openTlsEdge({
          publicHost,
          key: s.key,
          cert: s.cert,
          upstreamPort: s.receiver.port,
          ...extra,
        });
      }, /REFUSED/);
  } finally {
    await accidental?.close();
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});

import { spawn } from 'node:child_process';

async function childLine(child, milliseconds = 2000) {
  let text = '',
    timer;
  return new Promise((resolve) => {
    const finish = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    child.stdout.on('data', (chunk) => {
      text += chunk;
      if (text.includes('\n')) finish(text);
    });
    child.once('exit', () => finish(text));
    timer = setTimeout(() => finish('TEST_TIMEOUT'), milliseconds);
  });
}
test('fresh CLI inherits only TLS key/certificate FDs, uses fixed ports and silent sanitized output', async () => {
  const s = await setup();
  let child, keyFd, certFd;
  try {
    await s.receiver.close();
    s.receiver = await openReceiver({ directory: s.directory, clientSecrets: [secret], port: 43127 });
    keyFd = await fs.open(path.join(s.root, 'synthetic-key.pem'), 'r');
    certFd = await fs.open(path.join(s.root, 'synthetic-cert.pem'), 'r');
    child = spawn(process.execPath, [new URL('./tls-edge.mjs', import.meta.url).pathname, publicHost], {
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
      stdio: ['ignore', 'pipe', 'pipe', keyFd.fd, certFd.fd],
    });
    let err = '',
      out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    const ready = await childLine(child);
    assert.equal(ready, '{"status":"READY","port":43129}\n');
    assert.equal((await send({ port: 43129 }, s)).code, 200);
    assert.deepEqual(await status(s.directory), { status: 'OPEN', reserved: 1, committed: 1, uncertain: 0 });
    assert.equal((await send({ port: 43129 }, s, s.enrollment.callbackPath + '?QUERY_SECRET_SENTINEL')).code, 404);
    assert.equal((await send({ port: 43129 }, s, undefined, Buffer.from('BODY_SECRET_SENTINEL'))).code, 400);
    assert.equal(
      (await send({ port: 43129 }, s, undefined, body, { ...headers(), host: 'wrong.example.invalid' })).code,
      421,
    );
    await assert.rejects(() =>
      send({ port: 43129 }, s, undefined, body, headers(), {
        servername: 'SNI_SECRET_SENTINEL',
        rejectUnauthorized: false,
      }),
    );
    await s.receiver.close();
    assert.equal((await send({ port: 43129 }, s)).code, 502);
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    assert.equal((await exited)[0], 0);
    assert.equal(err, '');
    assert.equal(out, '{"status":"READY","port":43129}\n');
    await assert.rejects(() => send({ port: 43129 }, s));
  } finally {
    if (child?.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
    await keyFd?.close();
    await certFd?.close();
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
test('FD3/FD4 sizes and missing descriptors refuse with one fixed line and empty stderr', async () => {
  const s = await setup();
  const huge = path.join(s.root, 'synthetic-overlimit');
  await fs.writeFile(huge, Buffer.alloc(65537, 65), { mode: 0o600 });
  let keyFd, certFd, large;
  try {
    keyFd = await fs.open(path.join(s.root, 'synthetic-key.pem'), 'r');
    certFd = await fs.open(path.join(s.root, 'synthetic-cert.pem'), 'r');
    large = await fs.open(huge, 'r');
    for (const fds of [[large.fd, certFd.fd], [keyFd.fd, large.fd], []]) {
      const child = spawn(process.execPath, [new URL('./tls-edge.mjs', import.meta.url).pathname, publicHost], {
        env: { PATH: '/usr/bin:/bin' },
        stdio: ['ignore', 'pipe', 'pipe', ...fds],
      });
      let out = '',
        err = '';
      child.stdout.on('data', (c) => (out += c));
      child.stderr.on('data', (c) => (err += c));
      assert.equal((await once(child, 'exit'))[0], 20);
      assert.equal(out, '{"status":"REFUSED"}\n');
      assert.equal(err, '');
    }
  } finally {
    await keyFd?.close();
    await certFd?.close();
    await large?.close();
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
test('200 ACK requires exact fixed upstream bytes rather than an ASCII-masked body', async () => {
  const s = await setup();
  let edge;
  const altered = Buffer.from('RECEIVED');
  altered[0] |= 128;
  const upstream = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200);
    res.end(altered);
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  try {
    edge = await openTlsEdge({ publicHost, key: s.key, cert: s.cert, upstreamPort: upstream.address().port });
    const response = await send(edge, s);
    assert.equal(response.code, 502);
    assert.equal(response.text, 'REFUSED');
  } finally {
    await edge?.close();
    await new Promise((r) => upstream.close(r));
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
test('ambiguous duplicate Host refuses before upstream admission', async () => {
  const s = await setup();
  let edge;
  try {
    edge = await openTlsEdge({ publicHost, key: s.key, cert: s.cert, upstreamPort: s.receiver.port });
    const h = Object.entries(headers()).flat();
    h.push('Host', 'wrong.example.invalid');
    assert.equal((await send(edge, s, undefined, body, h)).code, 421);
    assert.deepEqual(await status(s.directory), { status: 'OPEN', reserved: 0, committed: 0, uncertain: 0 });
  } finally {
    await edge?.close();
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
test('duplicate Shopify HMAC fields stay duplicated and produce a private negative receipt', async () => {
  const s = await setup();
  let edge;
  try {
    edge = await openTlsEdge({ publicHost, key: s.key, cert: s.cert, upstreamPort: s.receiver.port });
    const h = Object.entries(headers()).flat();
    h.push('X-Shopify-Hmac-Sha256', headers()['x-shopify-hmac-sha256']);
    assert.equal((await send(edge, s, undefined, body, h)).code, 400);
    const receipt = await privateReceipt(s.directory, 1);
    assert.deepEqual(receipt.headers['x-shopify-hmac-sha256'], [
      headers()['x-shopify-hmac-sha256'],
      headers()['x-shopify-hmac-sha256'],
    ]);
    assert.equal(receipt.acceptedVerifierSucceeded, false);
    assert.equal(receipt.capabilityLabel, 'OLD_IMMUTABLE');
  } finally {
    await edge?.close();
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
test('client abort and edge close after upstream admission destroy owned HTTP sockets without retry', async () => {
  const s = await setup();
  try {
    for (const action of ['ABORT', 'CLOSE']) {
      let edge,
        q,
        count = 0,
        admit,
        closed;
      const admitted = new Promise((r) => (admit = r)),
        ended = new Promise((r) => (closed = r));
      const upstream = http.createServer((req) => {
        count++;
        req.resume();
        admit();
      });
      upstream.on('connection', (socket) => socket.once('close', closed));
      await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
      try {
        edge = await openTlsEdge({ publicHost, key: s.key, cert: s.cert, upstreamPort: upstream.address().port });
        q = https.request({
          host: '127.0.0.1',
          port: edge.port,
          servername: publicHost,
          ca: s.cert,
          path: s.enrollment.callbackPath,
          method: 'POST',
          headers: headers(),
          agent: false,
        });
        q.on('error', () => {});
        q.end(body);
        await admitted;
        const start = performance.now();
        if (action === 'ABORT') q.destroy();
        else await edge.close();
        assert.equal(
          await Promise.race([ended.then(() => true), new Promise((r) => setTimeout(() => r(false), 600))]),
          true,
        );
        assert.ok(performance.now() - start < 550);
        await new Promise((r) => setTimeout(r, 100));
        assert.equal(count, 1);
      } finally {
        q?.destroy();
        await edge?.close();
        await new Promise((r) => upstream.close(r));
      }
    }
  } finally {
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
test('trusted inherited FD EOF stalls remain unready until an external owned-process kill', async () => {
  const s = await setup();
  const fifo = path.join(s.root, 'synthetic-fifo');
  assert.equal(spawnSync('/usr/bin/mkfifo', ['-m', '600', fifo]).status, 0);
  let fifoFd, keyFd, certFd;
  try {
    fifoFd = await fs.open(fifo, 2);
    keyFd = await fs.open(path.join(s.root, 'synthetic-key.pem'), 'r');
    certFd = await fs.open(path.join(s.root, 'synthetic-cert.pem'), 'r');
    for (const fds of [
      [fifoFd.fd, certFd.fd],
      [keyFd.fd, fifoFd.fd],
    ]) {
      const child = spawn(process.execPath, [new URL('./tls-edge.mjs', import.meta.url).pathname, publicHost], {
        env: { PATH: '/usr/bin:/bin' },
        stdio: ['ignore', 'pipe', 'pipe', ...fds],
      });
      let out = '',
        err = '';
      child.stdout.on('data', (c) => (out += c));
      child.stderr.on('data', (c) => (err += c));
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(out, '');
      assert.equal(err, '');
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      assert.equal((await exited)[1], 'SIGKILL');
    }
  } finally {
    await fifoFd?.close();
    await keyFd?.close();
    await certFd?.close();
    await s.receiver.close();
    s.key.fill(0);
    await fs.rm(s.root, { recursive: true, force: true });
  }
});

test('one TLS connection cannot pipeline a second upstream request while its first ACK is pending', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'insignia-tls-pipeline-'));
  await fs.chmod(root, 0o700);
  const publicHost = 'edge.example.invalid';
  const keyFile = path.join(root, 'synthetic-key.pem');
  const certFile = path.join(root, 'synthetic-cert.pem');
  assert.equal(
    spawnSync(
      '/usr/bin/openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyFile,
        '-out',
        certFile,
        '-days',
        '1',
        '-subj',
        `/CN=${publicHost}`,
        '-addext',
        `subjectAltName=DNS:${publicHost}`,
      ],
      { stdio: 'ignore' },
    ).status,
    0,
  );
  await fs.chmod(keyFile, 0o600);
  await fs.chmod(certFile, 0o600);
  const key = await fs.readFile(keyFile);
  const cert = await fs.readFile(certFile);
  let count = 0;
  let admit;
  const admitted = new Promise((resolve) => {
    admit = resolve;
  });
  const sockets = new Set();
  const upstream = http.createServer((req) => {
    count++;
    req.resume();
    admit();
  });
  upstream.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  let edge, client;
  try {
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    edge = await openTlsEdge({ publicHost, key, cert, upstreamPort: upstream.address().port });
    client = tls.connect({ host: '127.0.0.1', port: edge.port, servername: publicHost, ca: cert });
    client.on('error', () => {});
    await once(client, 'secureConnect');
    client.write(`POST /PIPELINE_SECRET_SENTINEL HTTP/1.1\r\nHost: ${publicHost}\r\nContent-Length: 1\r\n\r\nx`);
    assert.equal(
      await Promise.race([admitted.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 1000))]),
      true,
    );
    client.write(`POST /PIPELINE_SECRET_SENTINEL HTTP/1.1\r\nHost: ${publicHost}\r\nContent-Length: 1\r\n\r\ny`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(count, 1);
  } finally {
    client?.destroy();
    await edge?.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => upstream.close(resolve));
    key.fill(0);
    await fs.rm(root, { recursive: true, force: true });
  }
});
