import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { inspectDomainSource } from './domain-effects.mjs';

const root = resolve(import.meta.dirname, '../..');
const domain = resolve(root, 'packages/domain/src');
assert.ok(existsSync(domain), 'production domain source must exist');

function productionFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(path);
    if (entry.isFile() && /\.[cm]?jsx?$/.test(entry.name) && !/\.(test|spec)\.[cm]?jsx?$/.test(entry.name)) {
      throw new Error(`production domain source must be TypeScript: ${relative(root, path)}`);
    }
    return entry.isFile() && /\.[cm]?tsx?$/.test(entry.name) && !/\.(test|spec)\.[cm]?tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

const files = productionFiles(domain);
assert.ok(files.length, 'domain source scan must be nonempty');
let violations = 0;
for (const path of files) {
  const name = relative(root, path);
  for (const diagnostic of inspectDomainSource(readFileSync(path, 'utf8'), name)) {
    console.error(`${name}:${diagnostic.line}:${diagnostic.column} ${diagnostic.rule}`);
    violations++;
  }
}
if (violations) process.exitCode = 1;
else console.log(`${files.length} production domain modules have no prohibited ambient effects`);
