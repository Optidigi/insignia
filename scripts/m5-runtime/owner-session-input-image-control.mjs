/** Dedicated synthetic CI control, not an operator or a credential consumer. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { createInterface } from 'node:readline';
import { nonce, origin, token } from './owner-session-input-fixture.mjs';

export async function qualifyOwnerInputImage(container, address) {
  const child = spawn(
    'docker',
    ['exec', '--interactive', container, '/usr/local/bin/node', '/srv/insignia/owner-session-input.mjs'],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const next = () =>
    Promise.race([
      lines.next(),
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('Owner input control deadline')), 10000);
        timer.unref();
      }),
    ]);
  try {
    child.stdin.end(JSON.stringify({ nonce, clientSecret: 'SYNTHETIC_OWNER_INPUT_SECRET' }));
    const ready = await next();
    assert.equal(ready.done, false);
    assert.deepEqual(JSON.parse(ready.value), { kind: 'INPUT_READY' });
    const url = new URL(`/__m5/owner-input/${nonce}`, address);
    url.port = '18080';
    const signed = token();
    const response = await new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'POST',
          headers: { host: new URL(origin).host, origin, authorization: `Bearer ${signed}` },
          timeout: 5000,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode, value: JSON.parse(body) }));
        },
      );
      req.on('timeout', () => req.destroy(new Error('Owner input HTTP deadline')));
      req.on('error', reject);
      req.end();
    });
    assert.equal(response.status, 202);
    assert.deepEqual(response.value, { result: 'SESSION_RECEIVED_NOT_SETUP_SUCCESS' });
    const delivered = await next();
    assert.equal(delivered.done, false);
    assert.deepEqual(JSON.parse(delivered.value), { kind: 'PRIVATE_SESSION_INPUT', idToken: signed });
  } finally {
    child.kill('SIGTERM');
    child.stdout.destroy();
    child.stderr.destroy();
    // The owned disposable container is removed by its existing outer finally.
  }
}
