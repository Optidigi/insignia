import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { test } from 'node:test';

test('built web server reports an occupied port through the runtime logger and exits non-zero', async (t) => {
  const occupant = createServer();
  await new Promise<void>((resolve) => occupant.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => occupant.close(() => resolve())));
  const address = occupant.address();
  assert(address && typeof address === 'object');

  const child = spawn(process.execPath, [new URL('../dist/server/entry.mjs', import.meta.url).pathname], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(address.port), SHOPIFY_CLIENT_ID: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream.setEncoding('utf8').on('data', (chunk: string) => {
      output = (output + chunk).slice(-65536);
    });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 15_000);
  const [code, signal] = await once(child, 'close');
  clearTimeout(deadline);

  assert.equal(signal, null, output);
  assert.equal(code, 1, output);
  const failures = output
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line.event === 'web_listen_failed');
  // Exactly one error-level envelope with no address, port or error text beyond the allow-listed class.
  assert.deepEqual(
    failures.map(({ time, ...rest }) => [typeof time, rest]),
    [['number', { level: 50, event: 'web_listen_failed', errorClass: 'EADDRINUSE' }]],
    output,
  );
});
