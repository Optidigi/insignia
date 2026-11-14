import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ensurePinnedTool } from './tools.mts';

test('a pre-existing wrong runner/trampoline rejects by exact artifact hash without execution or download', async () => {
  const root = mkdtempSync(join(tmpdir(), 'function-tool-pin-'));
  try {
    for (const kind of ['runner', 'trampoline'] as const) {
      const path = join(root, kind);
      writeFileSync(path, 'not the approved upstream executable', { mode: 0o700 });
      await assert.rejects(ensurePinnedTool(path, kind), /Pinned Function tool drift/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('trampoline requests the pinned official asset and a failed download installs nothing', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'function-tool-route-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const destination = join(root, 'trampoline');
  let requested: string | undefined;
  let accept: string | null = null;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    requested = String(input);
    accept = new Headers(init?.headers).get('Accept');
    return new Response(null, { status: 504 });
  });
  await assert.rejects(ensurePinnedTool(destination, 'trampoline'), /HTTP 504/);
  assert.equal(existsSync(destination), false);
  assert.equal(requested, 'https://api.github.com/repos/Shopify/shopify-function-wasm-api/releases/assets/298980878');
  assert.equal(accept, 'application/octet-stream');
});

test('trampoline download authenticates only when the CI download token is provided', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'function-tool-auth-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const seen: (string | null)[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
    seen.push(new Headers(init?.headers).get('Authorization'));
    return new Response(null, { status: 504 });
  });
  const previous = process.env.INSIGNIA_GITHUB_DOWNLOAD_TOKEN;
  t.after(() => {
    if (previous === undefined) delete process.env.INSIGNIA_GITHUB_DOWNLOAD_TOKEN;
    else process.env.INSIGNIA_GITHUB_DOWNLOAD_TOKEN = previous;
  });
  delete process.env.INSIGNIA_GITHUB_DOWNLOAD_TOKEN;
  await assert.rejects(ensurePinnedTool(join(root, 'a'), 'trampoline'), /HTTP 504/);
  process.env.INSIGNIA_GITHUB_DOWNLOAD_TOKEN = 'ci-token';
  await assert.rejects(ensurePinnedTool(join(root, 'b'), 'trampoline'), /HTTP 504/);
  assert.deepEqual(seen, [null, 'Bearer ci-token']);
});
