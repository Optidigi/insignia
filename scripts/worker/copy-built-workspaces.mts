// pnpm legacy deploy honors gitignore and omits compiled output. Copy reviewed workspace exports explicitly.
import { cpSync, existsSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { object, required, text } from '../runtime/validation.mts';
import { assertWorkspaceOutputs, workspaceOutputs } from '../runtime/workspace-outputs.mts';

export function copyBuiltWorkspaces(root: string, output: string): void {
  const destination = realpathSync(output);
  const sources = new Map<string, string>();
  for (const top of ['apps', 'packages', 'frontend']) {
    if (!existsSync(join(root, top))) continue;
    for (const name of readdirSync(join(root, top))) {
      const path = join(root, top, name);
      if (existsSync(join(path, 'package.json')))
        sources.set(text(object(JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))).name), path);
    }
  }
  const targets = [destination];
  for (const name of readdirSync(join(destination, 'node_modules/.pnpm'))) {
    const scope = join(destination, 'node_modules/.pnpm', name, 'node_modules/@insignia');
    if (existsSync(scope)) for (const child of readdirSync(scope)) targets.push(realpathSync(join(scope, child)));
  }
  for (const target of new Set(targets)) {
    if (relative(destination, target).startsWith('..')) throw new Error('Workspace package escaped destination');
    const manifest = object(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')));
    const source = sources.get(text(manifest.name));
    if (!source) throw new Error('Compiled workspace source missing');
    const outputs = workspaceOutputs(manifest);
    const sourceManifest = object(JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')));
    if (JSON.stringify(outputs) !== JSON.stringify(workspaceOutputs(sourceManifest)))
      throw new Error('Workspace exports changed during packaging');
    assertWorkspaceOutputs(sourceManifest, source);
    for (const name of readdirSync(target)) {
      if (!['node_modules', 'package.json'].includes(name))
        rmSync(join(target, name), { recursive: true, force: true });
    }
    for (const name of outputs)
      cpSync(join(source, name), join(target, name), { recursive: true, errorOnExist: true, force: false });
    assertWorkspaceOutputs(manifest, target);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  copyBuiltWorkspaces(resolve(import.meta.dirname, '../..'), required(process.argv[2]));
