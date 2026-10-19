import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { test } from 'node:test';
import { classifyStatusDocs } from './status-docs.mts';

const state = 'docs/delivery/state.md';
const worklist = 'docs/delivery/evidence/m8-context-runtime/WORKLIST.md';
const root = resolve(import.meta.dirname, '../..');
type Fixture = {
  cwd: string;
  git: (...args: string[]) => string;
  put: (file: string, body: string) => void;
  commit: (stage?: boolean) => string;
  base: string;
  update: (file: string) => void;
};
function fixture(run: (fixture: Fixture) => void) {
  const cwd = mkdtempSync(join(tmpdir(), 'insignia-status-ci-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (file: string, body: string) => {
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
    put(state, '# Delivery state\n\n[Receipt](receipt1.json). Working behavior is recorded here.\n');
    put(worklist, '# Current work index\n\n[State](../../state.md). [Receipt](../../receipt1.json).\n');
    put('docs/delivery/receipt1.json', '{}\n');
    put('docs/delivery/receipt2.json', '{}\n');
    const base = commit();
    const update = (file: string) =>
      put(
        file,
        `${readFileSync(join(cwd, file), 'utf8').replaceAll('receipt1.json', 'receipt2.json')}\nNext independent task: verify the current local preview.\n`,
      );
    run({ cwd, git, put, commit, base, update });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('actual current-progress prose edits select the bounded route', () =>
  fixture(({ cwd, base, update, commit }) => {
    update(state);
    update(worklist);
    assert.deepEqual(classifyStatusDocs({ cwd, base, head: commit() }), {
      route: 'status-docs',
      reason: 'CURRENT_DOCS_VALIDATED',
    });
  }));
test('a single status document update can qualify while both documents stay valid', () =>
  fixture(({ cwd, base, update, commit }) => {
    update(state);
    assert.equal(classifyStatusDocs({ cwd, base, head: commit() }).route, 'status-docs');
  }));
test('authority, executable, workflow and evidence-data edits require full checks', () => {
  const mutations: ((fixture: Fixture) => void)[] = [
    ({ put }) => put('docs/delivery/authority/owner.md', 'Owner policy changes.\n'),
    ({ put }) => put('docs/delivery/other.md', 'A new document\n'),
    ({ put }) => put('scripts/ci/changed.mts', 'export const changed=true;\n'),
    ({ put }) => put('.github/workflows/changed.yml', 'name: changed\n'),
    ({ put }) => put('docs/delivery/receipt1.json', '{"runtimeInput":"changed"}\n'),
    ({ put }) => put(state, '# Current state\n\nRun `node scripts/ci/absent.mts`.\n'),
  ];
  for (const mutation of mutations)
    fixture((f) => {
      f.update(state);
      mutation(f);
      assert.equal(classifyStatusDocs({ cwd: f.cwd, base: f.base, head: f.commit() }).route, 'full');
    });
});
test('renames, deletes and file-mode changes never qualify', () => {
  const mutations: [(fixture: Fixture) => void, boolean][] = [
    [(f) => f.git('mv', state, 'docs/delivery/renamed.md'), true],
    [(f) => f.git('rm', state), true],
    [(f) => f.git('update-index', '--chmod=+x', state), false],
  ];
  for (const [mutation, stage] of mutations)
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
test('current documents need no special status-line prefix', () =>
  fixture(({ cwd, put, base, commit }) => {
    put(state, '# Current progress\n\nComposition review is in progress.\n');
    assert.equal(classifyStatusDocs({ cwd, base, head: commit() }).route, 'status-docs');
  }));
test('likely credentials are refused without printing their value', () =>
  fixture(({ cwd, put, base, commit }) => {
    const sentinel = 'shpat_SYNTHETIC_NOT_A_REAL_SECRET';
    put(state, `${readFileSync(join(cwd, state), 'utf8')}\n${sentinel}\n`);
    assert.throws(
      () => classifyStatusDocs({ cwd, base, head: commit() }),
      (error: unknown) =>
        error instanceof Error && error.message === 'STATUS_SECRET_REFUSED' && !error.message.includes(sentinel),
    );
  }));

test('the real CLI records explicit docs-only scope without emitting document contents', () =>
  fixture(({ cwd, base, update, commit }) => {
    update(state);
    const head = commit();
    const output = join(cwd, 'github-output');
    const summary = join(cwd, 'github-summary');
    const stdout = execFileSync(process.execPath, [join(root, 'scripts/ci/status-docs.mts')], {
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
    assert.equal(stdout.trim(), 'CI route: status-docs (CURRENT_DOCS_VALIDATED)');
  }));

function workflowSafety(source: string, job: 'foundation' | 'durable-core' | 'runtime') {
  assert.match(source, new RegExp(`^  ${job}:`, 'm'));
  assert.match(source, /^ {2}pull_request:\s*\n {2}push:/m);
  assert.match(source, /^ {6}- 'scripts\/ci\/\*\*'$/m);
  assert.match(source, /runs-on: ubuntu-24\.04/);
  assert.match(source, /node-version: '24\.21\.0'/);
  const steps = source
    .slice(source.indexOf('    steps:\n'))
    .split(/(?=^ {6}- )/m)
    .slice(1);
  assert.ok(steps.length >= 4);
  assert.match(steps[0] ?? '', /uses: actions\/checkout@[a-f0-9]{40}/);
  assert.match(steps[0] ?? '', /fetch-depth: 0/);
  assert.match(steps[1] ?? '', /uses: actions\/setup-node@[a-f0-9]{40}/);
  const classifier = steps[2] ?? '';
  assert.match(classifier, /id: changes/);
  assert.match(classifier, /node --test scripts\/ci\/status-docs\.test\.mts/);
  assert.match(classifier, /node scripts\/ci\/status-docs\.mts/);
  assert.match(classifier, /CI_BASE_SHA:.*github\.event\.pull_request\.base\.sha/);
  assert.match(classifier, /CI_HEAD_SHA:.*github\.event\.pull_request\.head\.sha/);
  assert.doesNotMatch(classifier, /^ {8}if:/m);
  for (const step of steps.slice(3))
    assert.match(
      step,
      /^ {8}if: (?:steps\.changes\.outputs\.route == 'full'|\$\{\{ always\(\) && steps\.changes\.outputs\.route == 'full' \}\})$/m,
    );
  if (job === 'foundation') assert.match(source, /run: corepack pnpm check\n/);
  else {
    assert.match(
      source,
      /image: docker\.io\/library\/postgres@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336/,
    );
    if (job === 'durable-core') assert.match(source, /run: corepack pnpm check:database\n/);
    else {
      assert.match(source, /run: corepack pnpm --filter @insignia\/worker test\n/);
      assert.match(source, /corepack pnpm db:migrate\n {10}corepack pnpm db:migrate/);
    }
  }
}
test('current protected jobs retain full-route gates and required runtime boundaries', () => {
  const directory = join(root, '.github/workflows');
  for (const job of ['foundation', 'durable-core', 'runtime'] as const) {
    const sources = readdirSync(directory)
      .filter((name) => /\.ya?ml$/.test(name))
      .map((name) => readFileSync(join(directory, name), 'utf8'))
      .filter((source) => new RegExp(`^  ${job}:`, 'm').test(source));
    assert.equal(sources.length, 1);
    const source = sources[0];
    assert.ok(source);
    workflowSafety(source, job);
    assert.throws(() =>
      workflowSafety(source.replaceAll("if: steps.changes.outputs.route == 'full'", 'if: false'), job),
    );
    if (job === 'runtime')
      for (const changed of [
        source.replace('run: corepack pnpm --filter @insignia/worker test', 'run: true'),
        source.replace('          corepack pnpm db:migrate\n          corepack pnpm db:migrate', '          true'),
      ])
        assert.throws(() => workflowSafety(changed, job));
  }
});

test('the real current state and work index support prose updates with their actual local links', () =>
  fixture(({ cwd, put, commit, update }) => {
    for (const file of [state, worklist]) put(file, readFileSync(join(root, file), 'utf8'));
    for (const file of [state, worklist]) {
      const source = readFileSync(join(cwd, file), 'utf8');
      for (const match of source.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
        const target = match[1]?.split('#')[0];
        if (!target || /^[a-z]+:/i.test(target)) continue;
        const path = posix.normalize(posix.join(posix.dirname(file), target));
        if ([state, worklist].includes(path)) continue;
        if (target.endsWith('/')) put(`${path}/fixture.md`, 'Tracked fixture directory.\n');
        else put(path, 'Fixture target for actual current document link.\n');
      }
    }
    const base = commit();
    update(state);
    update(worklist);
    assert.deepEqual(classifyStatusDocs({ cwd, base, head: commit() }), {
      route: 'status-docs',
      reason: 'CURRENT_DOCS_VALIDATED',
    });
  }));
