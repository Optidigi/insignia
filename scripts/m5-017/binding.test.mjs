import assert from 'node:assert/strict';
import test from 'node:test';
import { BASE, checkGateRecord, digest, WORKFLOWS } from './binding.mjs';

const binding = { source: '1'.repeat(40), tree: '2'.repeat(40), modules: { 'production.js': '3'.repeat(64) } };
const gate = () => ({
  source: binding.source,
  tree: binding.tree,
  base: BASE,
  bindingDigest: digest(binding),
  offline: { source: binding.source, bindingDigest: digest(binding), exitCode: 0 },
  reviews: ['spec', 'security'].map((role, i) => ({
    role,
    base: BASE,
    head: binding.source,
    bindingDigest: digest(binding),
    model: 'gpt-6.1-sol',
    effort: 'high',
    sandbox: 'read-only',
    thread: `00000000-0000-0000-0000-00000000000${i}`,
    verdict: 'no unresolved material finding',
  })),
  ci: WORKFLOWS.map((workflowName, i) => ({
    workflowName,
    headSha: binding.source,
    status: 'completed',
    conclusion: 'success',
    runAttempt: 1,
    databaseId: i + 1,
    url: `https://github.com/Optidigi/insignia/actions/runs/${i + 1}`,
  })),
});
test('gate demands exact source/tree/binding, two actual model reviews and eleven unique attempt-one workflows', () => {
  checkGateRecord(binding, gate());
  for (const change of [
    (g) => (g.source = '0'.repeat(40)),
    (g) => (g.tree = '0'.repeat(40)),
    (g) => (g.offline.exitCode = 1),
    (g) => (g.reviews[0].model = 'substitute'),
    (g) => (g.reviews[0].effort = 'medium'),
    (g) => (g.reviews[0].sandbox = 'write'),
    (g) => (g.reviews[1].thread = g.reviews[0].thread),
    (g) => g.ci.pop(),
    (g) => (g.ci[0].runAttempt = 2),
    (g) => (g.ci[0].headSha = '0'.repeat(40)),
    (g) => (g.ci[0].conclusion = 'failure'),
    (g) => (g.ci[1].workflowName = g.ci[0].workflowName),
  ]) {
    const g = gate();
    change(g);
    assert.throws(() => checkGateRecord(binding, g), /offline_gate/);
  }
  assert.throws(
    () => checkGateRecord({ ...binding, modules: { 'production.js': '9'.repeat(64) } }, gate()),
    /offline_gate/,
  );
});

test('the slice-specific history workflow is mandatory rather than optional diagnostic CI', () => {
  const name = 'M0-007 policy and Function boundary checks';
  const missing = gate();
  missing.ci = missing.ci.filter((x) => x.workflowName !== name);
  assert.throws(() => checkGateRecord(binding, missing), /offline_gate/);
  assert.equal(WORKFLOWS.length, 11);
  checkGateRecord(binding, gate());
  for (const fault of ['pending', 'failed', 'wrong-head', 'second-attempt']) {
    const g = gate(),
      row = g.ci.find((x) => x.workflowName === name);
    assert.ok(row);
    if (fault === 'pending') row.status = 'in_progress';
    if (fault === 'failed') row.conclusion = 'failure';
    if (fault === 'wrong-head') row.headSha = '0'.repeat(40);
    if (fault === 'second-attempt') row.runAttempt = 2;
    assert.throws(() => checkGateRecord(binding, g), /offline_gate/);
  }
});
