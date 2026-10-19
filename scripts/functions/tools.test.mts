import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
