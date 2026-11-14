import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve(import.meta.dirname, '../../deployment/m5-runtime/publication-hold.sh');
const url = 'postgresql://insignia_publication_hold:synthetic-secret@database:5432/insignia_rewrite';

function host() {
  const root = mkdtempSync(join(tmpdir(), 'publication-hold-'));
  const runtime = join(root, 'runtime');
  const bin = join(root, 'bin');
  for (const dir of [runtime, bin]) spawnSync('mkdir', ['-m', '700', dir]);
  writeFileSync(join(runtime, 'worker.private.json'), '{}', { mode: 0o600 });
  writeFileSync(join(runtime, 'publication-hold-database-url'), `${url}\n`, { mode: 0o600 });
  // A fake docker: records its arguments and the command identity it was handed, prints one line.
  writeFileSync(
    join(bin, 'docker'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${root}/args"\nprintf '%s' "$INSIGNIA_PUBLICATION_HOLD_DATABASE_URL" > "${root}/url"\necho '{"event":"publication_hold_command","outcome":"inspected"}'\nexit "\${FAKE_EXIT:-0}"\n`,
    { mode: 0o700 },
  );
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync('bash', [script, ...args], {
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: root, INSIGNIA_RUNTIME_DIR: runtime, ...env },
    });
  return { root, runtime, run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('runs the command in the worker composition as its own identity and appends the audit line', () => {
  const h = host();
  try {
    const result = h.run(['inspect', '--shop', 's', '--config', 'c']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '{"event":"publication_hold_command","outcome":"inspected"}\n');
    assert.deepEqual(readFileSync(join(h.root, 'args'), 'utf8').trim().split('\n'), [
      'compose',
      '-f',
      join(h.runtime, 'worker.private.json'),
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '-e',
      'DATABASE_URL=',
      '-e',
      'INSIGNIA_PUBLICATION_HOLD_DATABASE_URL',
      '--entrypoint',
      '/usr/local/bin/node',
      'worker',
      '/srv/insignia/worker/dist/publication-hold-main.js',
      'inspect',
      '--shop',
      's',
      '--config',
      'c',
    ]);
    // The secret travels in the environment only, never as an argument.
    assert.equal(readFileSync(join(h.root, 'url'), 'utf8'), url);
    assert.ok(!readFileSync(join(h.root, 'args'), 'utf8').includes('synthetic-secret'));
    const audit = join(h.runtime, 'publication-hold-audit.jsonl');
    assert.equal(readFileSync(audit, 'utf8'), result.stdout);
    h.run(['inspect', '--shop', 's', '--config', 'c']);
    assert.equal(readFileSync(audit, 'utf8').split('\n').length, 3);
    // The command's exit status survives the audit pipe.
    assert.equal(h.run(['restore'], { FAKE_EXIT: '1' }).status, 1);
  } finally {
    h.cleanup();
  }
});

test('refuses a URL file that is not private or not the command identity, before docker runs', () => {
  const h = host();
  try {
    const file = join(h.runtime, 'publication-hold-database-url');
    chmodSync(file, 0o644);
    let result = h.run(['inspect']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /mode 0600/);
    chmodSync(file, 0o600);
    writeFileSync(file, 'postgresql://insignia_worker:x@database:5432/insignia_rewrite\n');
    result = h.run(['inspect']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /command identity/);
    assert.throws(() => readFileSync(join(h.root, 'args')));
  } finally {
    h.cleanup();
  }
});
