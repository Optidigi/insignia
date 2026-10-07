import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';
import { provider } from './provider.fixture.mjs';

for (const variant of ['missing', 'misspelled', 'imports', 'correct']) {
  test(`${variant} adapter transport / import proof uses only the guarded operator or denies locally`, async () => {
    let outbound = 0;
    const fake = provider();
    const server = createServer(async (req, res) => {
      outbound++;
      let input = '';
      for await (const bytes of req) input += bytes;
      const { url, body } = JSON.parse(input);
      const response = await fake.fetchImpl(url, { body: JSON.stringify(body) });
      res.writeHead(response.status);
      res.end(await response.text());
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [
          'scripts/m5-017/guard.fixture.mjs',
          variant,
          `http://127.0.0.1:${server.address().port}`,
        ]);
        let out = '',
          err = '';
        child.stdout.on('data', (b) => (out += b));
        child.stderr.on('data', (b) => (err += b));
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err))));
      });
      if (variant === 'correct') {
        assert.equal(result.nativeCalls, 10);
        assert.equal(outbound, 10);
        assert.equal(result.events, 10);
        assert.deepEqual(result.audit, { reserved: 10, dispatched: 10, matches: true });
      } else {
        if (variant !== 'imports') assert.equal(result.denial, 'network_escape_denied');
        assert.equal(result.nativeCalls, 0);
        assert.equal(outbound, 0);
      }
      assert.equal(result.immutable, true);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
}
