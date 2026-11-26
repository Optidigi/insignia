/** Exact upstream artifact identities retained from the qualified local Function workflow. */
import assert from 'node:assert/strict';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileHash, hash } from './runtime.mts';
export const RUNNER_SHA = '53589b1c3ec4125ea6b85930ddb5aeeb6a13dd54c1fef0431b031b64d10237ee';
export const TRAMPOLINE_SHA = '1b9e07e930353a21282820362e6d0fb475766f773d6ad27b79f295b9a628248c';
export async function ensurePinnedTool(destination: string, kind: 'runner' | 'trampoline'): Promise<string> {
  assert(process.platform === 'linux' && process.arch === 'x64', 'Pinned tools require Linux x64');
  const expected = kind === 'runner' ? RUNNER_SHA : TRAMPOLINE_SHA;
  if (!existsSync(destination)) {
    mkdirSync(dirname(destination), { recursive: true });
    const url =
      kind === 'runner'
        ? 'https://github.com/Shopify/function-runner/releases/download/v9.2.3/function-runner-x86_64-linux-v9.2.3.gz'
        : // The release download URL of API asset 298980878 (same bytes); the API route is rate limited on CI runners.
          'https://github.com/Shopify/shopify-function-wasm-api/releases/download/shopify_function_trampoline/v2.0.1/shopify-function-trampoline-x86_64-linux-v2.0.1.gz';
    const response = await fetch(url);
    assert(response.ok && response.body, `Pinned Function tool download failed (HTTP ${response.status})`);
    const chunks: Buffer[] = [],
      maximum = 128 * 1024 * 1024;
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        assert(size <= maximum, 'Pinned compressed tool exceeds bounded size');
        chunks.push(Buffer.from(value));
      }
    } catch (error) {
      await reader.cancel();
      throw error;
    } finally {
      reader.releaseLock();
    }
    const compressed = Buffer.concat(chunks);
    if (kind === 'runner')
      assert.equal(
        hash(compressed),
        '23535ee1d331fa5e090d34fc6a5eacb419bf9fb2b5b254547f40a78a93305471',
        'Pinned runner archive drift',
      );
    const bytes = gunzipSync(compressed, { maxOutputLength: maximum });
    assert.equal(hash(bytes), expected, 'Pinned Function tool drift');
    const stage = mkdtempSync(join(dirname(destination), '.tool-'));
    try {
      const temporary = join(stage, 'executable');
      writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o755 });
      chmodSync(temporary, 0o755);
      linkSync(temporary, destination);
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  }
  assert.equal(fileHash(destination), expected, 'Pinned Function tool drift');
  return destination;
}
