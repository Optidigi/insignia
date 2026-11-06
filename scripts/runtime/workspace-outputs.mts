/** Reviewed compiled runtime roots. Source/demo exports never enter a portable workspace package. */
import { existsSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { object } from './validation.mts';

function exportFiles(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value === null) return [];
  if (Array.isArray(value)) return value.flatMap(exportFiles);
  return Object.values(object(value)).flatMap(exportFiles);
}
export function workspaceOutputs(manifest: Record<string, unknown>): string[] {
  if (manifest.exports === undefined) return ['dist'];
  const roots = new Set<string>();
  for (const file of exportFiles(manifest.exports)) {
    if (file === './package.json') continue;
    if (
      !/^\.\/(?:dist|dist-library)\/[^\\*]+$/.test(file) ||
      file
        .split('/')
        .slice(1)
        .some((part) => part === '..' || part === '.')
    )
      throw new Error('Workspace export must use a reviewed compiled runtime root');
    roots.add(file.split('/')[1]!);
  }
  if (!roots.size) throw new Error('Compiled workspace exports missing');
  return [...roots].sort();
}
export function assertWorkspaceOutputs(manifest: Record<string, unknown>, directory: string): void {
  const base = realpathSync(directory);
  for (const name of workspaceOutputs(manifest)) {
    const path = join(base, name);
    if (!existsSync(path) || relative(base, realpathSync(path)).startsWith('..'))
      throw new Error('Compiled workspace missing or escaped');
  }
  for (const file of manifest.exports === undefined ? [] : exportFiles(manifest.exports)) {
    if (!existsSync(join(base, file)) || relative(base, realpathSync(join(base, file))).startsWith('..'))
      throw new Error('Compiled workspace export missing or escaped');
  }
}
