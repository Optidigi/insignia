import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parseCatalog } from './catalog-source.mts';

interface Message {
  readonly placeholders: ReadonlySet<string>;
}

const catalogDirectory = join(process.cwd(), 'src/catalogs/en');
const generatedDirectory = join(process.cwd(), 'src/generated');
const biome = createRequire(import.meta.url).resolve('@biomejs/biome/bin/biome');
const audiences: Readonly<Record<string, readonly string[]>> = {
  Admin: [
    'common',
    'admin-shell',
    'home',
    'products',
    'methods',
    'editor',
    'orders',
    'settings',
    'artwork',
    'exports',
    'admin-preview',
  ],
  Customer: ['common', 'customer'],
  Guest: ['common', 'guest-artwork'],
};
const allowedNamespaces = new Set(Object.values(audiences).flat());
const placeholderPattern = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
const numericParameterNames = new Set([
  'count',
  'max',
  'maximum',
  'maxCount',
  'maxQuantity',
  'maxSizeMb',
  'min',
  'minimum',
  'minCount',
]);

function fail(message: string): never {
  throw new Error(`English catalog: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectMessages(value: unknown, namespace: string, prefix: string, messages: Map<string, Message>): void {
  if (typeof value === 'string') {
    if (value.trim().length === 0) fail(`${namespace}:${prefix} is empty`);
    const placeholders = new Set<string>();
    for (const match of value.matchAll(placeholderPattern)) {
      const name = match[1];
      if (name !== undefined) placeholders.add(name);
    }
    const withoutKnownPlaceholders = value.replace(placeholderPattern, '');
    if (/\{\{|\}\}/.test(withoutKnownPlaceholders)) {
      fail(`${namespace}:${prefix} has an unsupported interpolation; use {{name}}`);
    }
    messages.set(`${namespace}:${prefix}`, { placeholders });
    return;
  }

  if (!isRecord(value)) {
    fail(`${namespace}:${prefix || '<root>'} must be an object or a message string`);
  }

  const entries = Object.entries(value) as [string, unknown][];
  if (prefix === '' && entries.length === 0) return;
  for (const [key, child] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) {
      fail(`${namespace}:${prefix}${prefix ? '.' : ''}${key} has an invalid key segment`);
    }
    collectMessages(child, namespace, prefix ? `${prefix}.${key}` : key, messages);
  }
}

function typeForParameter(name: string): 'number' | 'string' {
  if (name.startsWith('formatted') || name.includes('Formatted')) return 'string';
  if (numericParameterNames.has(name) || /(?:Count|Quantity)$/.test(name)) return 'number';
  return 'string';
}

function buildAudienceTable(
  namespaces: readonly string[],
  catalogs: ReadonlyMap<string, unknown>,
): Array<[string, Message]> {
  const messages = new Map<string, Message>();
  for (const namespace of namespaces) {
    const catalog = catalogs.get(namespace);
    if (catalog !== undefined) collectMessages(catalog, namespace, '', messages);
  }

  const ordinary = new Map<string, Message>();
  const pluralGroups = new Map<string, Map<string, Message>>();
  for (const [key, message] of messages) {
    const separator = key.lastIndexOf(':');
    const namespace = key.slice(0, separator);
    const path = key.slice(separator + 1);
    const match = path.match(/_(zero|one|two|few|many|other)$/);
    if (match !== null) {
      const category = match[1];
      if (category === undefined) continue;
      const basePath = path.slice(0, -match[0].length);
      const baseKey = `${namespace}:${basePath}`;
      const group = pluralGroups.get(baseKey) ?? new Map<string, Message>();
      group.set(category, message);
      pluralGroups.set(baseKey, group);
    } else {
      ordinary.set(key, message);
    }
  }

  for (const [baseKey, categories] of pluralGroups) {
    if (!categories.has('other')) fail(`${baseKey} plural is missing the _other form`);
    if (!categories.has('one')) fail(`${baseKey} English plural is missing the _one form`);
    if (ordinary.has(baseKey)) fail(`${baseKey} is both a regular message and a plural`);

    const expected = new Set<string>(['count']);
    for (const message of categories.values()) {
      for (const parameter of message.placeholders) expected.add(parameter);
    }
    ordinary.set(baseKey, { placeholders: expected });
  }

  return [...ordinary.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function emitTable(name: string, entries: Array<[string, Message]>): string {
  const properties = entries.map(([key, message]) => {
    const parameters = [...message.placeholders]
      .sort()
      .map((parameter) => `${JSON.stringify(parameter)}: ${typeForParameter(parameter)}`);
    return `  ${JSON.stringify(key)}: ${parameters.length ? `{ ${parameters.join('; ')} }` : 'object'};`;
  });
  return `export interface ${name} {\n${properties.join('\n')}\n}`;
}

function emitParameterContracts(name: string, entries: Array<[string, Message]>): string {
  const properties = entries.map(([key, message]) => {
    const parameters = [...message.placeholders]
      .sort()
      .map((parameter) => `${JSON.stringify(parameter)}: ${JSON.stringify(typeForParameter(parameter))}`)
      .join(', ');
    return `  ${JSON.stringify(key)}: { ${parameters} },`;
  });
  return `export const ${name} = {\n${properties.join('\n')}\n} as const;\n`;
}

const files = (await readdir(catalogDirectory)).filter((file) => file.endsWith('.json')).sort();
const catalogs = new Map<string, unknown>();
for (const file of files) {
  const namespace = file.slice(0, -'.json'.length);
  if (!allowedNamespaces.has(namespace)) fail(`${namespace} is not an audience namespace`);
  try {
    catalogs.set(namespace, parseCatalog(await readFile(join(catalogDirectory, file), 'utf8')));
  } catch (error) {
    fail(`${file} could not be parsed (${error instanceof Error ? error.message : 'invalid JSON'})`);
  }
}

const tables = Object.entries(audiences).map(([name, namespaces]) => ({
  name,
  entries: buildAudienceTable(namespaces, catalogs),
}));
const typeOutput = [
  '// Generated by scripts/generate-types.mts from src/catalogs/en/*.json. Do not edit.',
  '',
  ...tables.map(({ name, entries }) => emitTable(`${name}MessageTable`, entries)),
  '',
].join('\n');
const generatedFiles = new Map<string, string>([
  ['catalog-types.ts', typeOutput],
  ...tables.map(
    ({ name, entries }) =>
      [
        `${name.toLowerCase()}-parameters.ts`,
        [
          '// Generated by scripts/generate-types.mts from the English catalog. Do not edit.',
          '',
          emitParameterContracts(`${name.toLowerCase()}ParameterContracts`, entries),
        ].join('\n'),
      ] as [string, string],
  ),
]);
for (const [file, output] of generatedFiles) {
  generatedFiles.set(
    file,
    execFileSync(process.execPath, [biome, 'format', '--stdin-file-path', join(generatedDirectory, file)], {
      input: output,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    }),
  );
}

if (process.argv.includes('--check')) {
  for (const [file, expected] of generatedFiles) {
    let current: string;
    try {
      current = await readFile(join(generatedDirectory, file), 'utf8');
    } catch {
      fail(`generated catalog output ${file} is missing; run pnpm generate:types`);
    }
    if (current !== expected) fail(`generated catalog output ${file} is stale; run pnpm generate:types`);
  }
} else {
  await mkdir(generatedDirectory, { recursive: true });
  for (const [file, output] of generatedFiles) {
    await writeFile(join(generatedDirectory, file), output);
  }
}
