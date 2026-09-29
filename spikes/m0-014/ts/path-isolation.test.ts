import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('private key and signed output reject symlink routes into Git', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'm0-014-isolation-'));
  const repo = path.resolve(import.meta.dirname, '../../..');
  try {
    const alias = path.join(temp, 'repo-alias');
    symlinkSync(repo, alias, 'dir');
    const keys = path.join(temp, 'keys');
    mkdirSync(keys, { mode: 0o700 });
    const generate = spawnSync(process.execPath,
      [path.resolve(import.meta.dirname, '../scripts/generate-ephemeral.mjs'),
        path.join(alias, 'escaped-keys'), path.join(temp, 'unused-identity.json')],
      { encoding: 'utf8' });
    assert.notEqual(generate.status, 0);
    assert.match(generate.stderr, /key output must remain outside Git/);

    const issue = (keyDir: string, output: string) => spawnSync(process.execPath,
      [path.resolve(import.meta.dirname, '../scripts/issue-current.mjs'), 'small',
        'unused-ids', 'unused-transform', 'unused-validation', keyDir, output],
      { encoding: 'utf8' });
    const escapedQuote = issue(keys, path.join(alias, 'escaped-quote.json'));
    assert.notEqual(escapedQuote.status, 0);
    assert.match(escapedQuote.stderr, /private key and quote output must remain outside Git/);
    const keyAlias = path.join(temp, 'key-alias');
    symlinkSync(keys, keyAlias, 'dir');
    const escapedKey = issue(keyAlias, path.join(temp, 'quote.json'));
    assert.notEqual(escapedKey.status, 0);
    assert.match(escapedKey.stderr, /symlinked key directory forbidden/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
