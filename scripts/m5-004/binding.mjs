import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireValue } from './operator.mjs';
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function freeze(root) {
  const hashes = {};
  function walk(directory) {
    for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) hashes[path] = digest(readFileSync(resolve(root, path)));
      else throw new Error('source symlink denied');
    }
  }
  for (const directory of [
    'scripts/m5-004',
    'packages/shopify/src',
    'packages/shopify/dist',
    'packages/application/src',
    'packages/application/dist',
    'packages/domain/src',
    'packages/domain/dist',
    'packages/contracts/src',
    'packages/contracts/dist',
  ])
    walk(directory);
  for (const path of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'])
    hashes[path] = digest(readFileSync(resolve(root, path)));
  return {
    source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    modules: Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b))),
  };
}
export function verifyGate(root, gate, binding) {
  requireValue(JSON.stringify(freeze(root)) === JSON.stringify(binding), 'source_binding');
  requireValue(
    execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() === '',
    'dirty_source',
  );
  requireValue(
    gate?.source === binding.source &&
      gate.bindingDigest === digest(JSON.stringify(binding)) &&
      gate.offlineExit === 0 &&
      Array.isArray(gate.reviews) &&
      gate.reviews.length === 2 &&
      ['spec', 'security'].every((role) =>
        gate.reviews.some(
          (x) =>
            x.role === role &&
            x.model === 'gpt-6.1-sol' &&
            x.effort === 'high' &&
            x.sandbox === 'read-only' &&
            x.verdict === 'no unresolved material finding',
        ),
      ) &&
      Array.isArray(gate.ci) &&
      gate.ci.length > 0 &&
      gate.ci.every((x) => x.head === binding.source && x.conclusion === 'success' && x.status === 'completed'),
    'offline_gate',
  );
}
