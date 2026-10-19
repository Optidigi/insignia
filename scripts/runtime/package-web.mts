// Finish the offline pnpm deployment without changing compiled application bytes.
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { errorCode, object, required } from './validation.mts';

const root = resolve(import.meta.dirname, '../..');
const destination = realpathSync(required(process.argv[2]));
const targets = new Set([destination]);
const store = join(destination, 'node_modules/.pnpm');
for (const name of readdirSync(store)) {
  const scope = join(store, name, 'node_modules/@insignia');
  if (existsSync(scope)) for (const child of readdirSync(scope)) targets.add(realpathSync(join(scope, child)));
}
for (const target of targets) {
  if (relative(destination, target).startsWith('..')) throw new Error('Workspace package escaped destination');
  for (const name of readdirSync(target)) {
    if (!['dist', 'node_modules', 'package.json'].includes(name))
      rmSync(join(target, name), { recursive: true, force: true });
  }
}
cpSync(join(root, 'packages/database/migrations'), join(destination, 'migrations'), {
  recursive: true,
  errorOnExist: true,
  force: false,
});
// The flattened Astro adapter imports this dependency from the runtime root.
// Reuse the production SDK already installed for @insignia/shopify.
const sdk = join(store, '@shopify+shopify-api@15.0.0/node_modules/@shopify/shopify-api');
if (object(JSON.parse(readFileSync(join(sdk, 'package.json'), 'utf8'))).version !== '15.0.0')
  throw new Error('Pinned production SDK required');
const scope = join(destination, 'node_modules/@shopify');
mkdirSync(scope, { recursive: true });
const binding = join(scope, 'shopify-api');
if (existsSync(binding) || lstatIfPresent(binding)) throw new Error('Unexpected SDK root binding');
symlinkSync(relative(scope, sdk), binding);
function lstatIfPresent(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
}
// These server externals are declared by the production web manifest and must
// resolve at the flattened Astro runtime root, including lazy API chunks.
for (const [name, version] of [
  ['aws4fetch', '1.0.20'],
  ['pg-boss', '12.35.0'],
]) {
  const packageRoot = realpathSync(join(destination, 'node_modules', required(name)));
  if (relative(destination, packageRoot).startsWith('..')) throw new Error('Runtime dependency escaped destination');
  if (object(JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))).version !== version)
    throw new Error('Pinned production runtime dependency required');
}
function validate(directory: string) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      if (relative(destination, realpathSync(path)).startsWith('..'))
        throw new Error('Runtime symlink escaped destination');
    } else if (stat.isDirectory()) validate(path);
  }
}
validate(destination);
console.log(JSON.stringify({ runtime: 'web', productionSdkVersion: '15.0.0', newBuild: false, providerRequests: 0 }));
