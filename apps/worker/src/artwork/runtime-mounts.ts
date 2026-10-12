import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
/** Resolve the installed decoder/parser dependency closure, never the application or all node_modules. */
export function inspectionRuntimeMounts(): string[] {
  const packages = new Map<string, string>();
  const visit = (name: string, from: string, optional = false): void => {
    const require = createRequire(from);
    const path = require.resolve
      .paths(name)
      ?.map((parent) => resolve(parent, name))
      .find((candidate) => existsSync(resolve(candidate, 'package.json')));
    if (!path) {
      if (optional) return;
      throw new Error('Artwork runtime dependency unavailable');
    }
    const directory = realpathSync(path);
    const previous = packages.get(name);
    if (previous) {
      if (previous !== directory) throw new Error('Conflicting artwork dependency versions');
      return;
    }
    if (packages.size >= 64) throw new Error('Artwork runtime dependency limit');
    packages.set(name, directory);
    const manifestPath = resolve(directory, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    for (const dependency of Object.keys(manifest.dependencies ?? {})) visit(dependency, manifestPath);
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) visit(dependency, manifestPath, true);
  };
  visit('sharp', import.meta.url);
  visit('saxes', import.meta.url);
  return [...packages].flatMap(([name, path]) => ['--ro-bind', path, `/runtime/node_modules/${name}`]);
}
