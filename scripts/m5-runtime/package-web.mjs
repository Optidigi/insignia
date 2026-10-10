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

const root = resolve(import.meta.dirname, '../..');
const destination = realpathSync(process.argv[2]);
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
if (JSON.parse(readFileSync(join(sdk, 'package.json'))).version !== '15.0.0')
  throw new Error('Pinned production SDK required');
const scope = join(destination, 'node_modules/@shopify');
mkdirSync(scope, { recursive: true });
const binding = join(scope, 'shopify-api');
if (existsSync(binding) || lstatIfPresent(binding)) throw new Error('Unexpected SDK root binding');
symlinkSync(relative(scope, sdk), binding);
function lstatIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
function validate(directory) {
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
