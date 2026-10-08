/** Real operator failure guards against a loopback connection counter. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const source = await readFile(new URL('./release-append.mjs', import.meta.url), 'utf8');
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const versions = [
  { versionId: 'gid://shopify/Version/1158986629121', versionTag: 'm5-019r-9b94149272d1', status: 'active' },
  ...['1158837927937', '1153019904001', '1152880803841', '1146748534785'].map((id) => ({
    versionId: 'gid://shopify/Version/' + id,
    status: 'inactive',
  })),
];
let connections = 0;
const server = createServer((socket) => {
  connections++;
  socket.destroy();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  for (const control of ['expired', 'wrong-active', 'wrong-domain', 'stale-functions', 'future-functions', 'missing-function-time', 'invalid-function-time']) {
    const input = {
      recordId: randomUUID(),
      operator: { user: 'insignia_release_operator', password: 'A'.repeat(64) },
      activeObservation: {
        observedAt: new Date(control === 'expired' ? 0 : Date.now()).toISOString(),
        versions: structuredClone(versions),
      },
      readiness: { version: 'm5-admin-technical-readiness-v1', shop: 'wrong.myshopify.com' },
    };
    if (control.endsWith('functions') || control.endsWith('function-time')) {
      input.readiness.shop = 'insignia-rewrite-dev.myshopify.com';
      input.readiness.functions = {observation: {appClientId:'1443cf6d03d39edae7c101a943c5c684',
        observedAt: control === 'stale-functions' ? new Date(Date.now()-86400000).toISOString()
          : control === 'future-functions' ? new Date(Date.now()+86400000).toISOString()
          : control === 'invalid-function-time' ? 'invalid' : undefined}};
    }
    if (control === 'wrong-active') input.activeObservation.versions[0].status = 'inactive';
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      cwd: root + 'apps/web',
      env: { ...process.env, DATABASE_URL: 'postgres://synthetic@127.0.0.1:' + server.address().port + '/synthetic' },
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stdin.end(JSON.stringify(input));
    const exit = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(exit, 1);
    const result = JSON.parse(output);
    assert.equal(result.writeAttempted, false);
    assert.equal(result.writeAcknowledged, false);
    assert.equal(result.ambiguousWrite, false);
    assert.equal(connections, 0);
    assert.doesNotMatch(output, /password|AAAA|accessToken/);
  }
  console.log('PASS: seven real append guards, zero loopback DB connections, zero writes, no secret output.');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
