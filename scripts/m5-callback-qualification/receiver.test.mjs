import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { createExperiment, privateEnrollment, privateReceipt, status } from './operator.mjs';
import { openReceiver } from './receiver.mjs';

const privateParents = [];
after(async () => {
  for (const parent of privateParents) await fs.rm(parent, { recursive: true, force: true });
});
export const body = Buffer.from('{"id":123,"myshopify_domain":"fixture.myshopify.com","name":"RAW_SECRET_SENTINEL"}');
export const secret = 'SYNTHETIC_SIGNING_SECRET_SENTINEL';
export const binding = {
  experiment: 'fixture-experiment',
  era: 'B',
  appId: 'gid://shopify/App/1',
  providerShopId: 'gid://shopify/Shop/123',
  providerShopDomain: 'fixture.myshopify.com',
  appInstallationId: 'gid://shopify/AppInstallation/456',
  capabilityLabel: 'B_PRIMARY',
};
export function headers(raw = body) {
  return {
    'x-shopify-hmac-sha256': crypto.createHmac('sha256', secret).update(raw).digest('base64'),
    'x-shopify-shop-domain': 'fixture.myshopify.com',
    'x-shopify-topic': 'app/uninstalled',
    'x-shopify-api-version': '2026-07',
    'x-shopify-webhook-id': 'HEADER_SECRET_SENTINEL',
    'x-shopify-triggered-at': '2026-10-10T12:00:00Z',
  };
}
export function send(port, path, raw = body, h = headers(), method = 'POST') {
  return new Promise((resolve, reject) => {
    const q = http.request({ host: '127.0.0.1', port, path, method, headers: h }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve({ code: r.statusCode, text: Buffer.concat(chunks).toString() }));
    });
    q.on('error', reject);
    q.end(raw);
  });
}
export async function setup(options = {}) {
  const parent = await fs.mkdtemp(path.join(tmpdir(), 'insignia-callback-fixture-'));
  await fs.chmod(parent, 0o700);
  privateParents.push(parent);
  const directory = path.join(parent, 'experiment');
  await createExperiment({
    directory,
    binding,
    acceptUntil: Date.now() + 60000,
    eraseBy: Date.now() + 120000,
    ...options,
  });
  return { parent, directory, enrollment: await privateEnrollment(directory) };
}
test('real HTTP ACK has an encrypted durable receipt extractable through the private operator', async () => {
  const s = await setup();
  const r = await openReceiver({ directory: s.directory, clientSecrets: [secret] });
  try {
    assert.equal((await send(r.port, s.enrollment.callbackPath)).code, 200);
    assert.equal((await fs.stat(s.parent)).mode & 0o777, 0o700);
    const report = await status(s.directory);
    assert.deepEqual(report, { status: 'OPEN', reserved: 1, committed: 1, uncertain: 0 });
    const receipt = await privateReceipt(s.directory, 1);
    assert.equal(receipt.acceptedVerifierSucceeded, true);
    assert.equal(receipt.signedShopMatches, true);
    assert.equal(receipt.capabilityLabel, 'B_PRIMARY');
    assert.deepEqual(Buffer.from(receipt.rawBody, 'base64'), body);
    assert.equal(receipt.binding.appInstallationId, binding.appInstallationId);
    const spool = await fs.readFile(s.directory + '/spool/000001.bin');
    assert.equal(spool.includes(Buffer.from('RAW_SECRET_SENTINEL')), false);
    assert.equal(spool.includes(Buffer.from(headers()['x-shopify-hmac-sha256'])), false);
  } finally {
    await r.close();
  }
});
test('invalid HMAC, changed raw body and signed other Shop reject; unsigned headers cannot change the era', async () => {
  const s = await setup();
  const r = await openReceiver({ directory: s.directory, clientSecrets: [secret] });
  try {
    assert.equal(
      (
        await send(r.port, s.enrollment.callbackPath, body, {
          ...headers(),
          'x-shopify-hmac-sha256': 'A'.repeat(43) + '=',
        })
      ).code,
      400,
    );
    assert.equal(
      (await send(r.port, s.enrollment.callbackPath, Buffer.from(body.toString() + ' '), headers())).code,
      400,
    );
    const other = Buffer.from('{"id":999,"myshopify_domain":"other.myshopify.com"}');
    assert.equal((await send(r.port, s.enrollment.callbackPath, other, headers(other))).code, 400);
    const changed = {
      ...headers(),
      'x-shopify-shop-domain': 'unsigned.myshopify.com',
      'x-shopify-topic': 'app/uninstalled',
      'x-shopify-webhook-id': 'UNSIGNED_SECRET_SENTINEL',
      'x-shopify-triggered-at': '2026-10-10T15:00:00Z',
      'x-installation-generation': '999',
    };
    assert.equal((await send(r.port, s.enrollment.callbackPath, body, changed)).code, 200);
    assert.equal((await privateReceipt(s.directory, 4)).binding.appInstallationId, binding.appInstallationId);
    assert.equal((await privateReceipt(s.directory, 4)).capabilityLabel, 'B_PRIMARY');
  } finally {
    await r.close();
  }
});
test('old callback is not rebound to new era; current-capability theft remains a replay limit', async () => {
  const old = await setup();
  const next = await setup({
    binding: {
      ...binding,
      era: 'C',
      appInstallationId: 'gid://shopify/AppInstallation/789',
      capabilityLabel: 'C_PRIMARY',
    },
  });
  const a = await openReceiver({ directory: old.directory, clientSecrets: [secret] }),
    b = await openReceiver({ directory: next.directory, clientSecrets: [secret] });
  try {
    assert.notEqual(old.enrollment.callbackPath, next.enrollment.callbackPath);
    assert.equal((await send(b.port, old.enrollment.callbackPath)).code, 404);
    assert.equal((await send(a.port, old.enrollment.callbackPath)).code, 200);
    assert.equal((await privateReceipt(old.directory, 1)).binding.era, 'B');
    // Captured signed Shop bytes + possession of the current capability cannot prove freshness.
    assert.equal((await send(b.port, next.enrollment.callbackPath)).code, 200);
    assert.equal((await privateReceipt(next.directory, 2)).binding.era, 'C');
  } finally {
    await a.close();
    await b.close();
  }
});
test('HTTP has no remote status surface and exact path excludes queries; arrivals are bounded', async () => {
  const s = await setup({ maxArrivals: 2 });
  const r = await openReceiver({ directory: s.directory, clientSecrets: [secret] });
  try {
    assert.equal((await send(r.port, '/private-status', Buffer.alloc(0), {}, 'GET')).code, 404);
    assert.equal((await send(r.port, s.enrollment.callbackPath + '?PATH_SECRET_SENTINEL')).code, 404);
    assert.equal((await send(r.port, s.enrollment.callbackPath)).code, 503);
    assert.deepEqual(await status(s.directory), { status: 'OPEN', reserved: 2, committed: 0, uncertain: 2 });
  } finally {
    await r.close();
  }
});
test('filesystem commit failure gives no success ACK and preserves uncertain reservation across restart', async () => {
  const s = await setup();
  await fs.mkdir(s.directory + '/commits/000001.json', { mode: 0o700 });
  let r = await openReceiver({ directory: s.directory, clientSecrets: [secret] });
  assert.equal((await send(r.port, s.enrollment.callbackPath)).code, 503);
  assert.equal((await status(s.directory)).uncertain, 1);
  await r.close();
  await fs.rmdir(s.directory + '/commits/000001.json');
  r = await openReceiver({ directory: s.directory, clientSecrets: [secret] });
  try {
    assert.equal((await send(r.port, s.enrollment.callbackPath)).code, 200);
    assert.equal((await privateReceipt(s.directory, 2)).receipt, 2);
    assert.equal((await status(s.directory)).uncertain, 1);
  } finally {
    await r.close();
  }
});
test('bounded reader prevents oversized/late body ACK; observation expiry closes admission and private exports', async () => {
  const s = await setup({ maxBytes: 16, bodyDeadlineMs: 40 });
  let r = await openReceiver({ directory: s.directory, clientSecrets: [secret] });
  try {
    await assert.rejects(() => send(r.port, s.enrollment.callbackPath));
    assert.equal((await status(s.directory)).committed, 0);
  } finally {
    await r.close();
  }
  const slow = await setup({ bodyDeadlineMs: 40 });
  r = await openReceiver({ directory: slow.directory, clientSecrets: [secret] });
  try {
    await new Promise((resolve) => {
      const q = http.request({
        host: '127.0.0.1',
        port: r.port,
        path: slow.enrollment.callbackPath,
        method: 'POST',
        headers: headers(),
      });
      q.on('response', () => assert.fail('slow body was acknowledged'));
      q.on('error', resolve);
      q.flushHeaders();
      q.write(body.subarray(0, 2));
    });
    assert.equal((await status(slow.directory)).committed, 0);
  } finally {
    await r.close();
  }
  const fresh = await setup();
  const { exportReceipt, eraseExperiment } = await import('./operator.mjs');
  let clock = Date.now();
  r = await openReceiver({ directory: fresh.directory, clientSecrets: [secret], now: () => clock });
  try {
    assert.equal((await send(r.port, fresh.enrollment.callbackPath)).code, 200);
    clock += 180000;
    assert.equal((await send(r.port, fresh.enrollment.callbackPath)).code, 503);
    await assert.rejects(() => privateReceipt(fresh.directory, 1, { now: clock }));
    await assert.rejects(() =>
      exportReceipt(fresh.directory, 1, fresh.parent + '/expired-export.json', { now: clock }),
    );
  } finally {
    await r.close();
  }
  await assert.rejects(() => fs.stat(fresh.parent + '/expired-export.json'));
  assert.equal((await eraseExperiment(fresh.directory)).status, 'LOCAL_FILES_REMOVED_EXTERNAL_COPIES_UNQUALIFIED');
});

import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function startChild(directory) {
  const child = spawn(process.execPath, [new URL('./service.mjs', import.meta.url).pathname, directory], {
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  });
  let out = '',
    err = '';
  child.stderr.on('data', (c) => {
    err += c;
  });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (c) => {
      out += c;
      if (out.includes('\n')) {
        try {
          const value = JSON.parse(out.trim());
          if (value.status !== 'READY') reject(Error('CHILD_REFUSED'));
          else resolve(value.port);
        } catch {
          reject(Error('CHILD_OUTPUT_INVALID'));
        }
      }
    });
    child.on('error', reject);
    child.on('exit', () => reject(Error('CHILD_EXIT')));
  });
  child.stdio[3].end(JSON.stringify([secret]));
  return { child, port: await ready, streams: () => out + err };
}
test('fresh-process crash/restart preserves immutable evidence, duplicate arrivals and private stdout', async () => {
  const s = await setup();
  let processState = await startChild(s.directory);
  // Simulated lost local ACK consumption: discard the HTTP response after server completion.
  await send(processState.port, s.enrollment.callbackPath);
  const first = await privateReceipt(s.directory, 1);
  const exit = once(processState.child, 'exit');
  processState.child.kill('SIGKILL');
  await exit;
  assert.equal(processState.streams().includes('SECRET_SENTINEL'), false);
  assert.equal(processState.streams().includes(s.enrollment.callbackPath), false);
  const { recoverDeadReceiver } = await import('./operator.mjs');
  await recoverDeadReceiver(s.directory);
  processState = await startChild(s.directory);
  try {
    assert.equal((await send(processState.port, s.enrollment.callbackPath)).code, 200);
    assert.deepEqual(await privateReceipt(s.directory, 1), first);
    assert.equal((await privateReceipt(s.directory, 2)).binding.era, 'B');
    assert.equal((await status(s.directory)).committed, 2);
    assert.equal(processState.streams().includes('SECRET_SENTINEL'), false);
  } finally {
    const stopped = once(processState.child, 'exit');
    processState.child.kill('SIGTERM');
    await stopped;
  }
});
test('reservation survives killed process before body completion without manufactured receipt', async () => {
  const s = await setup({ bodyDeadlineMs: 5000 });
  const processState = await startChild(s.directory);
  const q = http.request({
    host: '127.0.0.1',
    port: processState.port,
    path: s.enrollment.callbackPath,
    method: 'POST',
    headers: headers(),
  });
  q.on('error', () => {});
  q.flushHeaders();
  q.write(body.subarray(0, 2));
  for (let i = 0; i < 100 && (await status(s.directory)).reserved === 0; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await status(s.directory)).reserved, 1);
  const exit = once(processState.child, 'exit');
  processState.child.kill('SIGKILL');
  await exit;
  q.destroy();
  const { recoverDeadReceiver } = await import('./operator.mjs');
  await recoverDeadReceiver(s.directory);
  const restarted = await startChild(s.directory);
  try {
    assert.equal((await status(s.directory)).uncertain, 1);
    assert.equal((await send(restarted.port, s.enrollment.callbackPath)).code, 200);
    assert.equal((await privateReceipt(s.directory, 2)).receipt, 2);
    await assert.rejects(() => privateReceipt(s.directory, 1));
  } finally {
    const stopped = once(restarted.child, 'exit');
    restarted.child.kill('SIGTERM');
    await stopped;
  }
});
test('local private export, authenticated spool tampering and immutable mapping edits fail safely', async () => {
  const s = await setup();
  const r = await openReceiver({ directory: s.directory, clientSecrets: [secret] });
  await send(r.port, s.enrollment.callbackPath);
  await r.close();
  const { exportReceipt } = await import('./operator.mjs');
  const destination = s.parent + '/private-export.json';
  assert.equal(
    (await exportReceipt(s.directory, 1, destination)).status,
    'PRIVATE_EXPORT_CREATED_EXTERNAL_COPY_REQUIRES_ERASURE',
  );
  assert.equal((await fs.stat(destination)).mode & 0o777, 0o600);
  const spool = await fs.readFile(s.directory + '/spool/000001.bin');
  spool[15] ^= 1;
  await fs.writeFile(s.directory + '/spool/000001.bin', spool);
  await assert.rejects(() => privateReceipt(s.directory, 1));
  const mapping = JSON.parse((await fs.readFile(s.directory + '/mapping.json')).toString());
  mapping.binding.era = 'C';
  mapping.binding.appInstallationId = 'gid://shopify/AppInstallation/789';
  await fs.writeFile(s.directory + '/mapping.json', JSON.stringify(mapping));
  await assert.rejects(() => openReceiver({ directory: s.directory, clientSecrets: [secret] }));
  await assert.rejects(() => privateEnrollment(s.directory));
});
test('process outbound guard denies fetch/socket/HTTP/DNS/process escape without provider requests', async () => {
  const code = `await import(${JSON.stringify(new URL('./network-guard.mjs', import.meta.url).href)});const assert=await import('node:assert/strict');for(const [module,method,args]of [['node:http','request',['http://127.0.0.1:1/']],['node:https','get',['https://127.0.0.1:1/']],['node:net','connect',[1,'127.0.0.1']],['node:tls','connect',[1,'127.0.0.1']],['node:dns','lookup',['synthetic.invalid',()=>{}]],['node:child_process','exec',['SYNTHETIC_COMMAND']]]){const api=await import(module);assert.throws(()=>api[method](...args),/OUTBOUND_DISABLED/);}await assert.rejects(()=>fetch('http://127.0.0.1:1/'),/OUTBOUND_DISABLED/);console.log('LOCAL_GUARD_PASS');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    env: { PATH: '/usr/bin:/bin' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '',
    err = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (err += c));
  const [result] = await once(child, 'exit');
  assert.equal(result, 0);
  assert.equal(out.trim(), 'LOCAL_GUARD_PASS');
  assert.equal(err, '');
});
test('retention expiry reports closure without decrypting or qualifying expired raw receipts', async () => {
  const s = await setup();
  const r = await openReceiver({ directory: s.directory, clientSecrets: [secret] });
  await send(r.port, s.enrollment.callbackPath);
  await r.close();
  assert.deepEqual(await status(s.directory, { now: Date.now() + 180000 }), {
    status: 'RETENTION_EXPIRED',
    reserved: 1,
    committed: null,
    uncertain: null,
  });
});
test('fixed observation deadline closes listening and releases the private receiver lock', async () => {
  const s = await setup({ acceptUntil: Date.now() + 150, eraseBy: Date.now() + 3000 });
  const r = await openReceiver({ directory: s.directory, clientSecrets: [secret] });
  try {
    await new Promise((resolve) => setTimeout(resolve, 230));
    await assert.rejects(() => send(r.port, s.enrollment.callbackPath));
    await assert.rejects(() => fs.stat(s.directory + '/receiver.lock'));
  } finally {
    await r.close();
  }
});
test('unrelated and compliance topics receive private negative evidence with original label, never success ACK', async () => {
  const s = await setup();
  const r = await openReceiver({ directory: s.directory, clientSecrets: [secret] });
  try {
    for (const [index, topic] of ['customers/redact', 'shop/redact', 'products/update', 'orders/paid'].entries()) {
      assert.equal(
        (await send(r.port, s.enrollment.callbackPath, body, { ...headers(), 'x-shopify-topic': topic })).code,
        400,
      );
      const receipt = await privateReceipt(s.directory, index + 1);
      assert.equal(receipt.topicEligible, false);
      assert.equal(receipt.acceptedVerifierSucceeded, true);
      assert.equal(receipt.signedShopMatches, true);
      assert.equal(receipt.capabilityLabel, 'B_PRIMARY');
      assert.equal(receipt.binding.era, 'B');
    }
  } finally {
    await r.close();
  }
});
test('maximum 8 MiB signed body ACK remains privately reconstructable in status and export', async () => {
  const prefix = '{"id":123,"myshopify_domain":"fixture.myshopify.com","padding":"';
  const suffix = '"}';
  const maximum = 8 * 1024 * 1024;
  const raw = Buffer.from(
    prefix + 'x'.repeat(maximum - Buffer.byteLength(prefix) - Buffer.byteLength(suffix)) + suffix,
  );
  assert.equal(raw.length, maximum);
  const s = await setup({ maxBytes: maximum, bodyDeadlineMs: 5000 });
  const r = await openReceiver({ directory: s.directory, clientSecrets: [secret] });
  try {
    assert.equal((await send(r.port, s.enrollment.callbackPath, raw, headers(raw))).code, 200);
    assert.deepEqual(await status(s.directory), { status: 'OPEN', reserved: 1, committed: 1, uncertain: 0 });
    const receipt = await privateReceipt(s.directory, 1);
    assert.deepEqual(Buffer.from(receipt.rawBody, 'base64'), raw);
    const { exportReceipt } = await import('./operator.mjs');
    const destination = s.parent + '/maximum-private-export.json';
    await exportReceipt(s.directory, 1, destination);
    const exported = JSON.parse((await fs.readFile(destination)).toString());
    assert.deepEqual(Buffer.from(exported.rawBody, 'base64'), raw);
    assert.equal((await fs.stat(destination)).mode & 0o777, 0o600);
  } finally {
    await r.close();
  }
});
test('small private metadata reads reject oversized mapping and oversized signing FD refuses safely', async () => {
  const s = await setup();
  const mapping = await fs.readFile(s.directory + '/mapping.json');
  await fs.writeFile(s.directory + '/mapping.json', Buffer.concat([mapping, Buffer.alloc(64 * 1024, 32)]));
  await assert.rejects(() => privateEnrollment(s.directory));
  await fs.writeFile(s.directory + '/mapping.json', mapping);
  const child = spawn(process.execPath, [new URL('./service.mjs', import.meta.url).pathname, s.directory], {
    env: { PATH: '/usr/bin:/bin' },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  });
  let out = '',
    err = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (err += c));
  child.stdio[3].on('error', () => {});
  child.stdio[3].end('SIGNING_SECRET_SENTINEL'.repeat(300));
  const [code] = await once(child, 'exit');
  assert.equal(code, 20);
  assert.equal(out.trim(), '{"status":"REFUSED"}');
  assert.equal(err, '');
  assert.equal((await status(s.directory)).reserved, 0);
});
