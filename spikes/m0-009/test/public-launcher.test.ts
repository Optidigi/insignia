import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const client = '1443cf6d03d39edae7c101a943c5c684';
const oldClient = '942e6668fd1177524c0fc48b104b0ac3';
const syntheticSecret = 'launcher-test-secret-only';
const launcher = fileURLToPath(new URL('../web-public/server.mjs', import.meta.url));

function run(overrides: Record<string, string | undefined> = {}, marker = client) {
  const root = mkdtempSync(join(tmpdir(), 'insignia-public-launcher-'));
  try {
    mkdirSync(join(root, 'web-public'));
    mkdirSync(join(root, 'dist/server'), { recursive: true });
    copyFileSync(launcher, join(root, 'web-public/server.mjs'));
    writeFileSync(join(root, 'dist/build-client-id'), `${marker}\n`);
    writeFileSync(join(root, 'dist/server/entry.mjs'),
      "process.stdout.write(JSON.stringify({entered:true,mode:process.env.INSIGNIA_M0_009_MODE,host:process.env.HOST,origin:process.env.INSIGNIA_APP_ORIGIN}));\n");
    const env: Record<string, string> = {
      PORT: '3001', APP_URL: 'https://controlled-tunnel.example',
      SHOPIFY_API_KEY: client, SHOPIFY_API_SECRET: syntheticSecret
    };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    const result = spawnSync(process.execPath, [join(root, 'web-public/server.mjs')], {
      env, encoding: 'utf8', timeout: 3000
    });
    return { status: result.status, output: result.stdout + result.stderr };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('new public-app launcher boundary', () => {
  it('starts only the matching built client in loopback public-bootstrap mode', () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.output)).toEqual({
      entered: true, mode: 'public-bootstrap', host: '127.0.0.1',
      origin: 'https://controlled-tunnel.example'
    });
    expect(result.output).not.toContain(syntheticSecret);
  });

  it.each([
    ['historical app client', { SHOPIFY_API_KEY: oldClient }, client],
    ['missing app client', { SHOPIFY_API_KEY: undefined }, client],
    ['historical build marker', {}, oldClient],
    ['missing secret', { SHOPIFY_API_SECRET: undefined }, client],
    ['missing controlled URL', { APP_URL: undefined }, client],
    ['plain HTTP URL', { APP_URL: 'http://controlled-tunnel.example' }, client],
    ['malformed URL', { APP_URL: 'not-a-url' }, client],
    ['Shopify initial placeholder', { APP_URL: 'https://example.com' }, client],
    ['invalid port', { PORT: '0' }, client]
  ])('rejects %s before importing the server', (_name, overrides, marker) => {
    const result = run(overrides, marker);
    expect(result.status).not.toBe(0);
    expect(result.output).not.toContain('"entered":true');
    expect(result.output).not.toContain(syntheticSecret);
  });
});
