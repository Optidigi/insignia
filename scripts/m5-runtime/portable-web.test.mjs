import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '../..');

test('current compiled web package survives relocation and serves HTTP on the configured interface and port', {
  timeout: 180_000,
}, async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'insignia-web-package-'));
  let server;
  try {
    const destination = join(scratch, 'original');
    const packaged = spawnSync('bash', ['scripts/m5-runtime/build-web.sh', destination], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
    });
    assert.equal(packaged.status, 0, packaged.stderr + packaged.stdout);
    const relocated = join(scratch, 'relocated');
    renameSync(destination, relocated);
    assert.deepEqual(
      readFileSync(join(relocated, 'dist/server/entry.mjs')),
      readFileSync(join(root, 'apps/web/dist/server/entry.mjs')),
    );
    for (const name of readdirSync(join(root, 'packages/database/migrations'))) {
      assert.deepEqual(
        readFileSync(join(relocated, 'migrations', name)),
        readFileSync(join(root, 'packages/database/migrations', name)),
      );
    }
    const walk = (directory) => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (lstatSync(path).isSymbolicLink()) {
          assert.ok(!relative(relocated, realpathSync(path)).startsWith('..'), `Escaped package: ${path}`);
        } else if (lstatSync(path).isDirectory()) walk(path);
      }
    };
    walk(relocated);
    assert.deepEqual(readdirSync(relocated).sort(), ['dist', 'migrations', 'node_modules', 'package.json']);
    for (const name of readdirSync(join(relocated, 'node_modules/.pnpm'))) {
      const scope = join(relocated, 'node_modules/.pnpm', name, 'node_modules/@insignia');
      if (!existsSync(scope)) continue;
      try {
        for (const child of readdirSync(scope)) {
          assert.ok(
            readdirSync(realpathSync(join(scope, child))).every((entry) =>
              ['dist', 'node_modules', 'package.json'].includes(entry),
            ),
          );
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const imported = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import { shopifyApi } from '@shopify/shopify-api'; if (typeof shopifyApi !== 'function') process.exit(1)",
      ],
      { cwd: relocated, encoding: 'utf8' },
    );
    assert.equal(imported.status, 0, imported.stderr);
    const portProbe = createServer();
    await new Promise((resolvePort) => portProbe.listen(0, '127.0.0.2', resolvePort));
    const port = portProbe.address().port;
    await new Promise((close) => portProbe.close(close));
    let logs = '';
    server = spawn(process.execPath, ['dist/server/entry.mjs'], {
      cwd: relocated,
      env: { PATH: process.env.PATH, NODE_ENV: 'production', HOST: '127.0.0.2', PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', (data) => {
      logs += data;
    });
    server.stderr.on('data', (data) => {
      logs += data;
    });
    let response;
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(server.exitCode, null, logs);
      try {
        response = await fetch(`http://127.0.0.2:${port}/live`, { signal: AbortSignal.timeout(1000) });
        break;
      } catch {
        await delay(100);
      }
    }
    assert.ok(response, logs);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'live' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await assert.rejects(fetch(`http://127.0.0.1:${port}/live`, { signal: AbortSignal.timeout(1000) }));
  } finally {
    if (server && server.exitCode === null) {
      const stopped = new Promise((done) => server.once('exit', done));
      server.kill('SIGTERM');
      await stopped;
    }
    rmSync(scratch, { recursive: true, force: true });
  }
});
