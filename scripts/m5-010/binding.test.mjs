import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BASE, digest, freeze, verifyGate, WORKFLOWS } from './binding.mjs';

test('successor gate binds its own tree, directory, exact source and independent review/CI receipts', () => {
  const root = mkdtempSync(join(tmpdir(), 'm5010-gate-'));
  const evidenceRoot = join(root, 'receipts');
  try {
    for (const p of [
      '.github/workflows',
      'scripts/m5-004',
      'scripts/m5-009',
      'scripts/m5-010',
      'packages/shopify/src',
      'packages/shopify/dist',
      'packages/application/src',
      'packages/application/dist',
      'packages/domain/src',
      'packages/domain/dist',
      'packages/contracts/src',
      'packages/contracts/dist',
    ])
      mkdirSync(join(root, p), { recursive: true });
    mkdirSync(evidenceRoot);
    writeFileSync(join(root, '.gitignore'), 'receipts/\n');
    for (const p of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) writeFileSync(join(root, p), '{}');
    writeFileSync(join(root, 'scripts/m5-010/operator.mjs'), '// synthetic successor\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync(
      'git',
      ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'synthetic'],
      { cwd: root },
    );
    const binding = freeze(root),
      fingerprint = digest(JSON.stringify(binding));
    assert.equal(
      binding.tree,
      execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim(),
    );
    assert.ok(binding.modules['scripts/m5-010/operator.mjs']);
    const artifact = (name, text) => {
      const path = join(evidenceRoot, name);
      writeFileSync(path, text);
      return { path, sha256: digest(text) };
    };
    const gate = {
      source: binding.source,
      tree: binding.tree,
      base: BASE,
      bindingDigest: fingerprint,
      offline: {
        source: binding.source,
        bindingDigest: fingerprint,
        exitCode: 0,
        report: artifact('offline.md', 'synthetic offline receipt'),
      },
      reviews: ['spec', 'security'].map((role, i) => {
        const thread = `00000000-0000-0000-0000-00000000000${i}`;
        return {
          role,
          thread,
          base: BASE,
          head: binding.source,
          bindingDigest: fingerprint,
          model: 'gpt-6.1-sol',
          effort: 'high',
          sandbox: 'read-only',
          verdict: 'no unresolved material finding',
          report: artifact(`${role}.md`, 'synthetic review'),
          settings: artifact(
            `${role}.json`,
            JSON.stringify({
              role,
              thread,
              selectedSameLaunchContext: [
                {
                  cwd: root,
                  model: 'gpt-6.1-sol',
                  effort: 'high',
                  sandbox_policy: { type: 'read-only' },
                  approval_policy: 'never',
                },
              ],
            }),
          ),
        };
      }),
      ci: WORKFLOWS.map((workflowName, i) => ({
        workflowName,
        headSha: binding.source,
        status: 'completed',
        conclusion: 'success',
        databaseId: 9000 + i,
        url: `https://github.com/Optidigi/insignia/actions/runs/${9000 + i}`,
      })),
    };
    const verify = (g) => verifyGate(root, g, binding, { evidenceRoot });
    verify(gate);
    for (const change of [
      (g) => {
        g.tree = 'stale';
      },
      (g) => {
        g.base = 'a7b2ba236f6b7726f48af0cd50ae14e0b7cc8e30';
      },
      (g) => {
        g.ci.pop();
      },
      (g) => {
        g.reviews[0].head = 'stale';
      },
      (g) => {
        g.offline.bindingDigest = '0'.repeat(64);
      },
    ]) {
      const bad = structuredClone(gate);
      change(bad);
      assert.throws(() => verify(bad), { kind: 'offline_gate' });
    }
    writeFileSync(join(root, 'scripts/m5-010/operator.mjs'), '// changed after freeze\n');
    assert.throws(() => verify(gate), { kind: 'source_binding' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
