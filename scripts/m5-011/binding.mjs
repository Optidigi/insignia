import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { WORKFLOWS } from '../m5-004/binding.mjs';
import { digest, requireValue } from './operator.mjs';

export { digest, WORKFLOWS };
export const BASE = '1fffcb3048952ff762f1f9805f86aceed90f228f';
export const EVIDENCE_ROOT = '/home/serveradmin/insignia-m5-011-handoff';
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
export function freeze(root) {
  const modules = {};
  for (const path of git(root, ['ls-files']).split('\n')) {
    const info = lstatSync(resolve(root, path));
    if (info.isSymbolicLink()) {
      const link = readlinkSync(resolve(root, path));
      requireValue(
        realpathSync(resolve(root, path)).startsWith(`${realpathSync(root)}/`) &&
          execFileSync('git', ['show', `${BASE}:${path}`], { cwd: root, encoding: 'utf8' }) === link,
        'source_symlink',
      );
      modules[path] = digest(link);
    } else {
      requireValue(info.isFile(), 'source_shape');
      modules[path] = digest(readFileSync(resolve(root, path)));
    }
  }
  function walk(path) {
    for (const entry of readdirSync(resolve(root, path), { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else {
        requireValue(entry.isFile() && !entry.isSymbolicLink(), 'build_shape');
        modules[child] = digest(readFileSync(resolve(root, child)));
      }
    }
  }
  for (const name of ['contracts', 'domain', 'application', 'shopify']) walk(`packages/${name}/dist`);
  const adapter = 'packages/shopify/src/availability-hold.ts';
  requireValue(
    digest(execFileSync('git', ['show', `${BASE}:${adapter}`], { cwd: root })) === modules[adapter],
    'production_adapter_changed',
  );
  return {
    source: git(root, ['rev-parse', 'HEAD']),
    tree: git(root, ['rev-parse', 'HEAD^{tree}']),
    modules: Object.fromEntries(Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))),
  };
}
export function checkGateRecord(binding, gate) {
  const fingerprint = digest(binding);
  requireValue(
    gate?.source === binding.source &&
      gate.tree === binding.tree &&
      gate.base === BASE &&
      gate.bindingDigest === fingerprint &&
      gate.offline?.source === binding.source &&
      gate.offline.bindingDigest === fingerprint &&
      gate.offline.exitCode === 0 &&
      Array.isArray(gate.reviews) &&
      gate.reviews.length === 2 &&
      ['spec', 'security'].every((role) => gate.reviews.filter((x) => x.role === role).length === 1) &&
      new Set(gate.reviews.map((x) => x.thread)).size === 2 &&
      gate.reviews.every(
        (x) =>
          x.base === BASE &&
          x.head === binding.source &&
          x.bindingDigest === fingerprint &&
          x.model === 'gpt-6.1-sol' &&
          x.effort === 'high' &&
          x.sandbox === 'read-only' &&
          /^[a-f0-9-]{36}$/.test(x.thread) &&
          x.verdict === 'no unresolved material finding',
      ) &&
      Array.isArray(gate.ci) &&
      gate.ci.length === WORKFLOWS.length &&
      WORKFLOWS.every((name) => gate.ci.filter((x) => x.workflowName === name).length === 1) &&
      gate.ci.every(
        (x) =>
          x.headSha === binding.source &&
          x.status === 'completed' &&
          x.conclusion === 'success' &&
          x.runAttempt === 1 &&
          Number.isInteger(x.databaseId) &&
          x.databaseId > 0 &&
          x.url === `https://github.com/Optidigi/insignia/actions/runs/${x.databaseId}`,
      ),
    'offline_gate',
  );
}
export function verifyGate(root, binding, gate) {
  requireValue(JSON.stringify(freeze(root)) === JSON.stringify(binding), 'source_binding');
  requireValue(git(root, ['status', '--porcelain']) === '', 'dirty_source');
  checkGateRecord(binding, gate);
  function artifact(record) {
    requireValue(
      record && dirname(resolve(record.path)) === EVIDENCE_ROOT && /^[a-f0-9]{64}$/.test(record.sha256),
      'gate_artifact',
    );
    const info = lstatSync(record.path);
    requireValue(
      info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid() && info.size <= 2 * 1024 * 1024,
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
        settings.selectedSameLaunchContext?.length > 0 &&
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
