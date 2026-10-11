import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

test('built startup reuses original wrapping custody and refuses browser/path/release metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'signing-config-'));
  try {
    const output = join(directory, 'configuration.mjs');
    await build({
      entryPoints: [new URL('../../src/server/admin/signing-owner-configuration.ts', import.meta.url).pathname],
      outfile: output,
      platform: 'node',
      format: 'esm',
      bundle: true,
    });
    const { parseSigningOwnerConfiguration } = await import(pathToFileURL(output));
    const metadata = {
      version: 'm5-signing-owner-plan-v1',
      binding: { shop: 'insignia-rewrite-dev.myshopify.com' },
      plan: { keyId: 7, firstDay: 20000, lastDay: 20002 },
    };
    const env = {
      INSIGNIA_CREDENTIAL_KEY_ID: 'synthetic-k1',
      INSIGNIA_CREDENTIAL_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
    };
    const config = parseSigningOwnerConfiguration(metadata, env);
    assert.equal(config.directory, '/var/lib/insignia/signing-owner/attempt');
    assert.deepEqual(config.ring.keys['synthetic-k1'], Buffer.alloc(32, 7));
    for (const extra of [
      { directory: '/tmp/browser' },
      { idToken: 'synthetic' },
      { activeAppVersionRef: 'fake' },
      { observation: {} },
    ])
      assert.throws(() => parseSigningOwnerConfiguration({ ...metadata, ...extra }, env));
    assert.throws(() => parseSigningOwnerConfiguration(metadata, {}));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
