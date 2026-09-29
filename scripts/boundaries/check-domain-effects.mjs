import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { compiledDomainFiles, inspectDomainSource } from './domain-effects.mjs';

const root = resolve(import.meta.dirname, '../..');
const domain = resolve(root, 'packages/domain/src');
assert.ok(existsSync(domain), 'production domain source must exist');

function rejectJavaScript(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      rejectJavaScript(path);
      continue;
    }
    if (entry.isFile() && /\.[cm]?jsx?$/.test(entry.name) && !/\.(test|spec)\.[cm]?jsx?$/.test(entry.name)) {
      throw new Error(`production domain source must be TypeScript: ${relative(root, path)}`);
    }
  }
}

rejectJavaScript(domain);
const files = compiledDomainFiles(resolve(root, 'packages/domain/tsconfig.json'), domain);
assert.ok(files.length, 'domain source scan must be nonempty');
let violations = 0;
for (const file of files) {
  const name = relative(root, file.fileName);
  for (const diagnostic of inspectDomainSource(file.text, name)) {
    console.error(`${name}:${diagnostic.line}:${diagnostic.column} ${diagnostic.rule}`);
    violations++;
  }
}
if (violations) process.exitCode = 1;
else console.log(`${files.length} production domain modules have no prohibited ambient effects`);
