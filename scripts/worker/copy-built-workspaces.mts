// pnpm legacy deploy honors gitignore and omits dist. Copy reviewed compiled workspace outputs explicitly.
import { cpSync, existsSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { object, required, text } from '../runtime/validation.mts';

const root = resolve(import.meta.dirname, '../..');
const destination = realpathSync(required(process.argv[2]));
const sources = new Map<string, string>();
for (const top of ['apps', 'packages'])
  for (const name of readdirSync(join(root, top))) {
    const path = join(root, top, name);
    if (existsSync(join(path, 'package.json')))
      sources.set(text(object(JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))).name), path);
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
  if (!source || !existsSync(join(source, 'dist'))) throw new Error('Compiled workspace missing');
  rmSync(join(target, 'dist'), { recursive: true, force: true });
  cpSync(join(source, 'dist'), join(target, 'dist'), { recursive: true, errorOnExist: true, force: false });
  for (const extra of ['src', 'test']) rmSync(join(target, extra), { recursive: true, force: true });
}
