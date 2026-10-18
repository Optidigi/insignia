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
// The fixed original workflows remain historical evidence. These reviewed additions
// extend full-route artifact qualification without changing existing suite bodies.
const addedSteps = {
  'm1-foundation.yml': ['Complete storefront artifact inventory controls'],
  'm3-database.yml': [],
  'm3-runtime.yml': [
    'Operations source and relocated offline runtime qualification',
    'Preserve operations runtime for later gated deployment',
    'Versioned inspector host artifact qualification (no inspection or provider effects)',
    'Preserve versioned inspector host artifact (native handover remains unqualified)',
    'Independent immutable verifier package and offline image qualification',
    'Preserve independent verifier immutable image (native handover remains unqualified)',
  ],
};
// Exact runtime repetitions retired after tracing their mandatory equivalent coverage:
// foundation check -> test:unit keeps these complete suites; durable-core keeps
// check:database on the same PostgreSQL18 image. Runtime's DB-specific worker,
// HTTP, LOGIN, crash, packaging and image checks remain unchanged.
const retiredRuntimeSteps = ['storage', 'shopify', 'application', 'observability'].map(
  (name) => `      - run: corepack pnpm --filter @insignia/${name} test\n`,
);
const runtimeMigrationStep = `      - name: Initialize runtime schema and verify migration idempotence
        # The required durable-core job runs the full database suite on the same pinned PostgreSQL18 image.
        # This job retains actual worker/HTTP/LOGIN/process/image qualification below.
        run: |
          corepack pnpm db:migrate
          corepack pnpm db:migrate
`;
function reviewedOriginalSteps(file, prior) {
  if (file !== 'm3-runtime.yml') return prior;
  for (const retired of retiredRuntimeSteps)
    assert.equal(prior.filter((step) => step === retired).length, 1, 'retire only the exact reviewed repetition');
  return prior
    .filter((step) => !retiredRuntimeSteps.includes(step))
    .map((step) => {
      if (step === '      - run: corepack pnpm check:database\n') return runtimeMigrationStep;
      return step.replace(
        '# Current check:database above qualifies schema34; the historical erasure guard stays exact20.',
        '# The required durable-core job qualifies the full current schema; this erasure guard stays exact20.',
      );
    });
}
function assertWorkflowIntegration(file, current) {
  const name = `.github/workflows/${file}`;
  const old = execFileSync('git', ['show', `${baseline}:${name}`], { cwd: root, encoding: 'utf8' });
  assert.match(current, /^ {2}pull_request:\s*\n {2}push:/m, 'all PRs must produce the existing check context');
  assert.match(current, /^ {6}- 'scripts\/ci\/\*\*'$/m);
  const all = steps(current),
    prior = reviewedOriginalSteps(file, steps(old));
  const additions = addedSteps[file];
  const extra = all.filter((step) => additions.some((name) => step.startsWith(`      - name: ${name}\n`)));
  assert.equal(extra.length, additions.length, 'every reviewed artifact step remains present');
  for (const step of extra) assert.match(step, /if: steps\.changes\.outputs\.route == 'full'/);
  const actual = all.filter((step) => !extra.includes(step));
  assert.equal(actual.length, prior.length + 1, 'one classifier step plus reviewed full-route additions');
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
    let expected = ungated(prior[i]);
    if (file === 'm1-foundation.yml' && expected.includes('name: m1-001-foundation-${{ github.sha }}')) {
      // Complete the existing owned storefront payload; no broader upload paths.
      expected = expected
        .replace(
          'extensions/insignia-theme/assets/insignia-storefront.js',
          'extensions/insignia-theme/assets/insignia-*.js\n            extensions/insignia-theme/assets/insignia-*.css',
        )
        .replace(
          'apps/storefront/dist/insignia-storefront.js',
          'apps/storefront/dist/insignia-*.js\n            apps/storefront/dist/insignia-*.css',
        );
    }
    assert.equal(ungated(added), expected, 'original suite bodies and reviewed artifact paths remain exact');
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

test('workflow integration preserves retained suites, explicit consolidation and full-route gates', () => {
  for (const file of ['m1-foundation.yml', 'm3-database.yml', 'm3-runtime.yml'])
    assertWorkflowIntegration(file, readFileSync(join(root, '.github/workflows', file), 'utf8'));
});

test('consolidated suites remain mandatory under the same pinned runner, Node and PostgreSQL', () => {
  const workflow = (file) => readFileSync(join(root, '.github/workflows', file), 'utf8');
  const foundation = workflow('m1-foundation.yml');
  const durable = workflow('m3-database.yml');
  const runtime = workflow('m3-runtime.yml');
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;
  assert(foundation.includes('run: corepack pnpm check\n'));
  assert(scripts.check.split(' && ').includes('corepack pnpm test:unit'));
  for (const name of ['storage', 'shopify', 'application', 'observability'])
    assert(scripts['test:unit'].split(' && ').includes(`corepack pnpm --filter @insignia/${name} test`));
  assert(durable.includes('run: corepack pnpm check:database\n'));
  assert.equal(
    scripts['check:database'],
    'corepack pnpm db:migrate && corepack pnpm db:migrate && corepack pnpm test:database',
  );
  assert.equal(scripts['test:database'], 'corepack pnpm --filter @insignia/database test');
  for (const current of [foundation, durable, runtime]) {
    assert.match(current, /runs-on: ubuntu-24\.04/);
    assert.match(current, /node-version: '24\.21\.0'/);
  }
  const image =
    'image: docker.io/library/postgres@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336';
  assert(durable.includes(image));
  assert(runtime.includes(image));
});

test('explicit consolidation cannot remove worker database checks or skip runtime migration setup', () => {
  const current = readFileSync(join(root, '.github/workflows/m3-runtime.yml'), 'utf8');
  for (const altered of [
    current.replace(/ {6}- run: corepack pnpm --filter @insignia\/worker test\n {8}if:.*\n/, ''),
    current.replace('          corepack pnpm db:migrate\n          corepack pnpm db:migrate', '          true'),
    current.replace('run: node --test test/shopify-webhook.test.mjs', 'run: true'),
    current.replace('run: corepack pnpm check:boundaries', 'run: true'),
  ])
    assert.throws(() => assertWorkflowIntegration('m3-runtime.yml', altered));
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
