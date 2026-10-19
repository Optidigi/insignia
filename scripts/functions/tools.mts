/** Exact upstream artifact identities retained from the qualified local Function workflow. */
import assert from 'node:assert/strict';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileHash, hash } from './runtime.mts';
export const RUNNER_SHA = '728bedbcf86f57680051208f9056642c9dfb07766a21891624bf18f372e4c29b';
export const TRAMPOLINE_SHA = '1b9e07e930353a21282820362e6d0fb475766f773d6ad27b79f295b9a628248c';
export async function ensurePinnedTool(destination: string, kind: 'runner' | 'trampoline'): Promise<string> {
  assert(process.platform === 'linux' && process.arch === 'x64', 'Pinned tools require Linux x64');
  const expected = kind === 'runner' ? RUNNER_SHA : TRAMPOLINE_SHA;
  if (!existsSync(destination)) {
    mkdirSync(dirname(destination), { recursive: true });
    const url =
      kind === 'runner'
        ? 'https://github.com/Shopify/function-runner/releases/download/v9.2.2/function-runner-x86_64-linux-v9.2.2.gz'
        : 'https://github.com/Shopify/shopify-function-wasm-api/releases/download/shopify_function_trampoline/v2.0.1/shopify-function-trampoline-x86_64-linux-v2.0.1.gz';
    const response = await fetch(url);
    assert(response.ok && response.body, 'Pinned Function tool download failed');
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
        'd091bae3f6d17e4e92e3e6c4450ff1b80bd14dea02295608157e0297183236b4',
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
