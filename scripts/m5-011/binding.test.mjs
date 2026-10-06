import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WORKFLOWS } from '../m5-004/binding.mjs';
import { checkGateRecord, digest } from './binding.mjs';

test('source gate requires two fresh high-effort reviews and every workflow on the frozen source', () => {
  const binding = { source: 'a'.repeat(40), tree: 'b'.repeat(40), modules: {} };
  const gate = {
    source: binding.source,
    tree: binding.tree,
    base: '1fffcb3048952ff762f1f9805f86aceed90f228f',
    bindingDigest: 'placeholder',
    offline: { exitCode: 0 },
    reviews: [],
    ci: [],
  };
  assert.throws(() => checkGateRecord(binding, gate), /offline_gate/);
  gate.bindingDigest = digest(binding);
  gate.offline = { exitCode: 0, source: binding.source, bindingDigest: gate.bindingDigest };
  gate.reviews = ['spec', 'security'].map((role, n) => ({
    role,
    head: binding.source,
    base: gate.base,
    bindingDigest: gate.bindingDigest,
    model: 'gpt-6.1-sol',
    effort: 'high',
    sandbox: 'read-only',
    verdict: 'no unresolved material finding',
    thread: `00000000-0000-0000-0000-00000000000${n}`,
  }));
  gate.ci = WORKFLOWS.map((workflowName, n) => ({
    workflowName,
    headSha: binding.source,
    status: 'completed',
    conclusion: 'success',
    runAttempt: 1,
    databaseId: n + 1,
    url: `https://github.com/Optidigi/insignia/actions/runs/${n + 1}`,
  }));
  assert.doesNotThrow(() => checkGateRecord(binding, gate));
  for (const change of [
    (x) => x.ci.pop(),
    (x) => (x.ci[0].headSha = 'c'.repeat(40)),
    (x) => (x.ci[0].runAttempt = 2),
    (x) => (x.reviews[0].effort = 'low'),
    (x) => (x.reviews[0].sandbox = 'danger-full-access'),
    (x) => (x.bindingDigest = 'changed'),
    (x) => (x.offline.exitCode = 1),
  ]) {
    const copy = structuredClone(gate);
    change(copy);
    assert.throws(() => checkGateRecord(binding, copy), /offline_gate/);
  }
});
