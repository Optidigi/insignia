import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { profileDirectory, requireValue } from './operator.mjs';
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function freeze(root, { profile = 'm5-004' } = {}) {
  profileDirectory(profile);
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
    '.github/workflows',
    'scripts/m5-004',
    ...(profile !== 'm5-004' ? ['scripts/m5-009'] : []),
    ...(profile === 'm5-010' ? ['scripts/m5-010'] : []),
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
    ...(profile !== 'm5-004'
      ? { tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim() }
      : {}),
    modules: Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b))),
  };
}
export const BASE = 'a7b2ba236f6b7726f48af0cd50ae14e0b7cc8e30';
export const EVIDENCE_ROOT = '/home/serveradmin/insignia-m5-004-handoff';
export const WORKFLOWS = Object.freeze([
  'M0-008 local publication and architecture checks',
  'M0-009 embedded Astro local proof',
  'M0-010 local hybrid billing proof',
  'M0-011 local provider adapter boundary',
  'M0-012 real contract local prototype',
  'M0-013 off-store protocol capacity',
  'M0-014 local public-app candidate',
  'M1-001 foundation and boundaries',
  'M3-001 PostgreSQL durable core',
  'M3-002 local runtime and ingress',
]);
export function verifyGate(
  root,
  gate,
  binding,
  { profile = 'm5-004', evidenceRoot = `/home/serveradmin/insignia-${profile}-handoff` } = {},
) {
  profileDirectory(profile);
  const base =
    profile === 'm5-004'
      ? BASE
      : profile === 'm5-009'
        ? '9ce56a1a9b8f674a3500f6592803f7a52e2ef18d'
        : '25e6c487741e1685637d351137d9671033f3c53d';
  requireValue(JSON.stringify(freeze(root, { profile })) === JSON.stringify(binding), 'source_binding');
  requireValue(
    execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() === '',
    'dirty_source',
  );
  const fingerprint = digest(JSON.stringify(binding));
  requireValue(
    gate?.source === binding.source &&
      (profile === 'm5-004' || gate.tree === binding.tree) &&
      gate.base === base &&
      gate.bindingDigest === fingerprint &&
      gate.offline?.source === binding.source &&
      gate.offline.bindingDigest === fingerprint &&
      gate.offline.exitCode === 0 &&
      Array.isArray(gate.reviews) &&
      gate.reviews.length === 2 &&
      ['spec', 'security'].every((role) =>
        gate.reviews.some(
          (x) =>
            x.role === role &&
            x.base === base &&
            x.head === binding.source &&
            x.bindingDigest === fingerprint &&
            x.model === 'gpt-6.1-sol' &&
            x.effort === 'high' &&
            x.sandbox === 'read-only' &&
            x.verdict === 'no unresolved material finding',
        ),
      ) &&
      new Set(gate.reviews.map((x) => x.thread)).size === 2 &&
      gate.reviews.every((x) => /^[a-f0-9-]{36}$/.test(x.thread)) &&
      Array.isArray(gate.ci) &&
      gate.ci.length === WORKFLOWS.length &&
      WORKFLOWS.every((name) => gate.ci.filter((x) => x.workflowName === name).length === 1) &&
      gate.ci.every(
        (x) =>
          x.headSha === binding.source &&
          x.status === 'completed' &&
          x.conclusion === 'success' &&
          Number.isInteger(x.databaseId) &&
          x.databaseId > 0 &&
          x.url === `https://github.com/Optidigi/insignia/actions/runs/${x.databaseId}`,
      ),
    'offline_gate',
  );
  function artifact(record) {
    requireValue(
      record &&
        typeof record.path === 'string' &&
        dirname(resolve(record.path)) === resolve(evidenceRoot) &&
        /^[a-f0-9]{64}$/.test(record.sha256),
      'gate_artifact',
    );
    const file = lstatSync(record.path);
    requireValue(
      file.isFile() && !file.isSymbolicLink() && file.uid === process.getuid() && file.size <= 2 * 1024 * 1024,
      'gate_artifact',
    );
    const bytes = readFileSync(record.path);
    requireValue(digest(bytes) === record.sha256, 'gate_artifact');
    return bytes;
  }
  artifact(gate.offline.report);
  for (const review of gate.reviews) {
    artifact(review.report);
    const settings = JSON.parse(artifact(review.settings));
    requireValue(
      settings.thread === review.thread &&
        settings.role === review.role &&
        Array.isArray(settings.selectedSameLaunchContext) &&
        settings.selectedSameLaunchContext.length > 0 &&
        settings.selectedSameLaunchContext.every(
          (x) =>
            x.cwd === root &&
            x.model === 'gpt-6.1-sol' &&
            x.effort === 'high' &&
            x.sandbox_policy?.type === 'read-only' &&
            x.approval_policy === 'never',
        ),
      'review_settings',
    );
  }
}
