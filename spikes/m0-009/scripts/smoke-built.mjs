import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';

const secret = 'm0-009-synthetic-test-secret-only';
const port = await new Promise((resolve, reject) => {
  const listener = createServer();
  listener.once('error', reject);
  listener.listen(0, '127.0.0.1', () => {
    const address = listener.address();
    if (!address || typeof address === 'string') return reject(new Error('No loopback port'));
    listener.close(() => resolve(address.port));
  });
});
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['dist/server/entry.mjs'], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port),
    INSIGNIA_M0_009_MODE: 'synthetic', INSIGNIA_APP_ORIGIN: origin },
  stdio: ['ignore', 'pipe', 'pipe']
});
let childOutput = '';
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', chunk => { childOutput = (childOutput + chunk.toString()).slice(-2048); });
}

const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://alpha.myshopify.com/admin', dest: 'https://alpha.myshopify.com',
    aud: 'synthetic-key', sub: '1', sid: 'm0009-smoke-session',
    iat: now, nbf: now - 1, exp: now + 40, jti: 'm0009-built-smoke', ...overrides
  };
  const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
async function assets(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await assets(path));
    else result.push(path);
  }
  return result;
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`Built server exited: ${childOutput}`);
    try { const response = await fetch(origin, { signal: AbortSignal.timeout(800) });
      if (response.status === 200) { ready = true; break; } }
    catch { /* Startup is still in progress. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Built server did not start: ${childOutput}`);
  for (const path of ['/', '/draft']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const html = await response.text();
    assert.ok(!html.includes('alpha.myshopify.com'));
    assert.ok(!html.includes(secret));
  }
  assert.equal((await fetch(origin + '/private/home')).status, 401);
  const bearer = { Authorization: `Bearer ${token()}` };
  const home = await fetch(origin + '/private/home', { headers: bearer });
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.ok(html.includes('alpha.myshopify.com'));
  assert.ok(html.includes('gid://shopify/AppInstallation/99'));
  assert.equal((await fetch(origin + '/private/draft', { headers: bearer })).status, 200);
  const viewer = createHash('sha256').update(JSON.stringify(['alpha.myshopify.com', '1'])).digest('hex');
  const post = (headers, label, version = 0) => fetch(origin + '/api/draft', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
    body: JSON.stringify({ label, version, viewer })
  });
  assert.equal((await post({}, 'No token')).status, 401);
  assert.equal((await post({ ...bearer, Origin: 'https://attacker.example' }, 'Cross site')).status, 403);
  const saved = await post(bearer, 'Built output');
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { label: 'Built output', version: 1 });
  assert.ok((await (await fetch(origin + '/private/draft', { headers: bearer })).text()).includes('Built output'));
  assert.equal((await fetch(origin + '/private/home?shop=beta.myshopify.com', { headers: bearer })).status, 403);
  assert.equal((await fetch(origin + '/private/home', {
    headers: { Authorization: `Bearer ${token({ aud: 'wrong-app' })}` }
  })).status, 401);
  assert.equal((await fetch(origin + '/private/home', {
    headers: { Authorization: `Bearer ${token({ exp: Math.floor(Date.now() / 1000) - 1 })}` }
  })).status, 401);
  assert.equal((await fetch(origin + '/private/home', {
    headers: { Authorization: `Bearer ${token({ sid: 'fresh-smoke-session', jti: 'fresh-after-expiry' })}` }
  })).status, 200);
  const files = await assets('dist/client');
  for (const file of files.filter(path => path.endsWith('.js') || path.endsWith('.html'))) {
    const content = await readFile(file, 'utf8');
    for (const forbidden of [secret, 'X-Shopify-Access-Token', 'tokenExchange', 'SHOPIFY_API_SECRET'])
      assert.ok(!content.includes(forbidden), `${file} contains server-only material`);
  }
  console.log('Built Node SSR: public 200/no tenant data; private 401; verified 200; local POST 200; cross-origin/wrong tenant/wrong audience/expired denied; fresh identity recovers; client assets clean.');
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000).unref();
  });
}
