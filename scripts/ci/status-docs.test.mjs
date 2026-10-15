import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { classifyStatusDocs } from './status-docs.mjs';

const state = 'docs/delivery/state.md';
const worklist = 'docs/delivery/evidence/m8-context-runtime/WORKLIST.md';
const root = resolve(import.meta.dirname, '../..');
const baseline = 'b1dfda98ca6631e2e426ce7d18e6bf5d00f24f80';
function fixture(run) {
  const cwd = mkdtempSync(join(tmpdir(), 'insignia-status-ci-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (file, body) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), body);
  };
  const commit = (stage = true) => {
    if (stage) git('add', '-A');
    git(
      '-c',
      'user.name=CI fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-m',
      'Synthetic status fixture',
    );
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '--initial-branch=main');
    put(
      state,
      `# Delivery state\n\nLatest integration: [PR1](https://github.com/Optidigi/insignia/pull/1), merge \`${'a'.repeat(40)}\`. [Receipt](receipt1.json).\n\nAuthority stays fixed.\n`,
    );
    put(
      worklist,
      `# Active index\n\nLatest main: [PR1](https://github.com/Optidigi/insignia/pull/1), merge \`${'a'.repeat(40)}\`. [Receipt](../../receipt1.json).\n\nAuthority stays fixed.\n`,
    );
    put('docs/delivery/receipt1.json', '{}\n');
    put('docs/delivery/receipt2.json', '{}\n');
    const base = commit();
    const update = (file) =>
      put(
        file,
        readFileSync(join(cwd, file), 'utf8')
          .replaceAll('PR1', 'PR2')
          .replaceAll('/pull/1', '/pull/2')
          .replaceAll('a'.repeat(40), 'b'.repeat(40))
          .replaceAll('receipt1.json', 'receipt2.json'),
      );
    run({ cwd, git, put, commit, base, update });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('only real existing status-line reference updates select the narrow route', () =>
  fixture(({ cwd, base, update, commit }) => {
    update(state);
    update(worklist);
    assert.deepEqual(classifyStatusDocs({ cwd, base, head: commit() }), {
      route: 'status-docs',
      reason: 'STATUS_REFERENCES_VALIDATED',
    });
  }));
test('a single status document update can qualify while both documents stay valid', () =>
  fixture(({ cwd, base, update, commit }) => {
    update(state);
    assert.equal(classifyStatusDocs({ cwd, base, head: commit() }).route, 'status-docs');
  }));
test('authority wording, other lines, unknown paths and new files all require full checks', () => {
  for (const mutation of [
    ({ cwd, put }) =>
      put(state, readFileSync(join(cwd, state), 'utf8').replace('Authority stays fixed.', 'Authority changes.')),
    ({ cwd, put }) =>
      put(
        state,
        readFileSync(join(cwd, state), 'utf8').replace(
          'Latest integration:',
          'Latest integration: Owner grants production rollout.',
        ),
      ),
    ({ put }) => put('docs/delivery/other.md', 'A new document\n'),
    ({ put }) => put('scripts/ci/changed.mjs', 'export const changed=true;\n'),
    ({ put }) => put('.github/workflows/changed.yml', 'name: changed\n'),
  ])
    fixture((f) => {
      mutation(f);
      assert.equal(classifyStatusDocs({ cwd: f.cwd, base: f.base, head: f.commit() }).route, 'full');
    });
});
test('renames, deletes and file-mode changes never qualify', () => {
  for (const [mutation, stage] of [
    [(f) => f.git('mv', state, 'docs/delivery/renamed.md'), true],
    [(f) => f.git('rm', state), true],
    [(f) => f.git('update-index', '--chmod=+x', state), false],
  ])
    fixture((f) => {
      mutation(f);
      assert.equal(classifyStatusDocs({ cwd: f.cwd, base: f.base, head: f.commit(stage) }).route, 'full');
    });
});
test('missing, invalid, absent and noncommit refs fail closed without using caller file lists', () =>
  fixture(({ cwd, base, git }) => {
    for (const bad of ['', undefined, 'main', '0'.repeat(40), '$(touch unexpected)', 'a'.repeat(39)]) {
      assert.equal(classifyStatusDocs({ cwd, base, head: bad, files: [state] }).route, 'full');
      assert.equal(classifyStatusDocs({ cwd, base: bad, head: base }).route, 'full');
    }
    const blob = git('rev-parse', `${base}:${state}`);
    assert.equal(classifyStatusDocs({ cwd, base, head: blob }).route, 'full');
    assert.equal(classifyStatusDocs({ cwd, base, head: base }).route, 'full');
  }));
test('an absent linked receipt fails validation rather than claiming docs success', () =>
  fixture(({ cwd, put, base, commit }) => {
    put(state, readFileSync(join(cwd, state), 'utf8').replace('receipt1.json', 'receipt9.json'));
    assert.throws(() => classifyStatusDocs({ cwd, base, head: commit() }), /STATUS_LINK_INVALID/);
  }));
test('both status documents require exactly one existing latest line', () =>
  fixture(({ cwd, put, base, update, commit }) => {
    update(state);
    put(worklist, `${readFileSync(join(cwd, worklist), 'utf8')}Latest main: duplicate\n`);
    assert.throws(() => classifyStatusDocs({ cwd, base, head: commit() }), /STATUS_LINE_INVALID/);
  }));
test('likely credentials are refused without printing their value', () =>
  fixture(({ cwd, put, base, commit }) => {
    const sentinel = 'shpat_SYNTHETIC_NOT_A_REAL_SECRET';
    put(
      state,
      readFileSync(join(cwd, state), 'utf8').replace('Latest integration:', `Latest integration: ${sentinel}`),
    );
    assert.throws(
      () => classifyStatusDocs({ cwd, base, head: commit() }),
      (error) => error.message === 'STATUS_SECRET_REFUSED' && !error.message.includes(sentinel),
    );
  }));

function steps(text) {
  return text
    .slice(text.indexOf('    steps:\n'))
    .split(/(?=^ {6}- )/m)
    .slice(1);
}
function ungated(step) {
  return step.replace(/^ {8}if:.*\n/gm, '');
}
test('workflow integration preserves every original full step and gates always-artifacts correctly', () => {
  for (const file of ['m1-foundation.yml', 'm3-database.yml', 'm3-runtime.yml']) {
    const name = `.github/workflows/${file}`;
    const old = execFileSync('git', ['show', `${baseline}:${name}`], { cwd: root, encoding: 'utf8' });
    const current = readFileSync(join(root, name), 'utf8');
    assert.match(current, /^ {2}pull_request:\s*\n {2}push:/m, 'all PRs must produce the existing check context');
    assert.match(current, /^ {6}- 'scripts\/ci\/\*\*'$/m);
    const actual = steps(current),
      prior = steps(old);
    assert.equal(actual.length, prior.length + 1, 'one classifier step, no extra gate jobs');
    const classifier = actual[2];
    assert.match(classifier, /id: changes/);
    assert.match(classifier, /node --test scripts\/ci\/status-docs\.test\.mjs/);
    assert.match(classifier, /node scripts\/ci\/status-docs\.mjs/);
    assert.match(classifier, /CI_BASE_SHA:/);
    assert.match(classifier, /CI_HEAD_SHA:/);
    assert.equal(actual[0], prior[0]);
    assert.equal(actual[1], prior[1]);
    for (let i = 2; i < prior.length; i++) {
      const added = actual[i + 1];
      assert.equal(ungated(added), ungated(prior[i]), 'full step body/env/action inputs remain exact');
      assert.match(
        added,
        prior[i].includes('if: always()')
          ? /if: \$\{\{ always\(\) && steps\.changes\.outputs\.route == 'full' \}\}/
          : /if: steps\.changes\.outputs\.route == 'full'/,
      );
    }
    for (const [needle, target] of [
      ['scripts/m4-003/**', 'm1-foundation.yml'],
      ['scripts/m5-017/**', 'm1-foundation.yml'],
      ['scripts/m5-003/**', 'm3-database.yml'],
    ])
      if (file === target) assert(current.includes(`      - '${needle}'`));
  }
});

test('the real CLI records explicit docs-only scope without emitting document contents', () =>
  fixture(({ cwd, base, update, commit }) => {
    update(state);
    const head = commit();
    const output = join(cwd, 'github-output');
    const summary = join(cwd, 'github-summary');
    const stdout = execFileSync(process.execPath, [join(root, 'scripts/ci/status-docs.mjs')], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        CI_BASE_SHA: base,
        CI_HEAD_SHA: head,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
      },
    });
    assert.equal(readFileSync(output, 'utf8'), 'route=status-docs\n');
    assert.match(readFileSync(summary, 'utf8'), /suites were \*\*not selected\*\*/);
    assert.match(readFileSync(summary, 'utf8'), /no new product or native qualification/);
    assert.equal(stdout.trim(), 'CI route: status-docs (STATUS_REFERENCES_VALIDATED)');
  }));
