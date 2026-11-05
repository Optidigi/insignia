import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parseCatalog } from './catalog-source.mts';

export type CatalogValidationCode =
  | 'invalid-locale'
  | 'missing-namespace'
  | 'unknown-namespace'
  | 'missing-message'
  | 'unknown-message'
  | 'message-kind-mismatch'
  | 'missing-plural-form'
  | 'unexpected-plural-form'
  | 'invalid-key-segment'
  | 'invalid-message-value'
  | 'blank-message'
  | 'markup'
  | 'invalid-placeholder'
  | 'parameter-mismatch'
  | 'invalid-source-catalog';

export interface CatalogValidationIssue {
  readonly code: CatalogValidationCode;
  readonly locale: string;
  readonly namespace: string;
  readonly key: string;
  readonly detail: string;
}

export interface TargetCatalogValidationInput {
  readonly locale: string;
  readonly sourceCatalogs: ReadonlyMap<string, unknown>;
  readonly targetCatalogs: ReadonlyMap<string, unknown>;
}

interface MessageLeaf {
  readonly path: string;
  readonly value: unknown;
  readonly placeholders: ReadonlySet<string>;
  readonly placeholderSyntaxValid: boolean;
}

interface CatalogLeaves {
  readonly messages: Map<string, MessageLeaf>;
  readonly branches: ReadonlySet<string>;
  readonly emptyBranches: ReadonlySet<string>;
}

interface OrdinaryUnit {
  readonly kind: 'ordinary';
  readonly message: MessageLeaf;
}

interface PluralUnit {
  readonly kind: 'plural';
  readonly forms: ReadonlyMap<string, MessageLeaf>;
}

interface MixedUnit {
  readonly kind: 'mixed';
  readonly ordinary: MessageLeaf;
  readonly forms: ReadonlyMap<string, MessageLeaf>;
}

type CatalogUnit = OrdinaryUnit | PluralUnit | MixedUnit;

const keySegmentPattern = /^[A-Za-z][A-Za-z0-9_-]*$/;
const pluralSuffixPattern = /_(zero|one|two|few|many|other)$/;
const placeholderPattern = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
const markupPattern =
  /<\s*\/?\s*[A-Za-z][A-Za-z0-9:-]*(?:\s+[^<>]*?)?\s*\/?\s*>|<!--|-->|<![A-Z][^>]*>|&(?:#[0-9]{1,7}|#x[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]+);/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrapTypeWrappers(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** Reads the actual supported-language constant without keeping a second allowlist in the build tool. */
export function parseSupportedLanguages(source: string): readonly string[] {
  const sourceFile = ts.createSourceFile('core.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'SUPPORTED_LANGUAGES') continue;
      if (declaration.initializer === undefined) break;

      let initializer = unwrapTypeWrappers(declaration.initializer);
      if (
        ts.isCallExpression(initializer) &&
        ts.isPropertyAccessExpression(initializer.expression) &&
        initializer.expression.expression.getText(sourceFile) === 'Object' &&
        initializer.expression.name.text === 'freeze' &&
        initializer.arguments.length === 1
      ) {
        const argument = initializer.arguments[0];
        if (argument !== undefined) initializer = unwrapTypeWrappers(argument);
      }
      if (!ts.isArrayLiteralExpression(initializer)) {
        throw new Error('SUPPORTED_LANGUAGES must be a literal array, optionally wrapped in Object.freeze.');
      }

      const languages: string[] = [];
      for (const element of initializer.elements) {
        const value = unwrapTypeWrappers(element);
        if (!ts.isStringLiteral(value)) throw new Error('SUPPORTED_LANGUAGES entries must be string literals.');
        languages.push(value.text);
      }
      if (!languages.includes('en') || new Set(languages).size !== languages.length) {
        throw new Error('SUPPORTED_LANGUAGES must include en and contain no duplicates.');
      }
      return languages;
    }
  }

  throw new Error('Could not find the exported SUPPORTED_LANGUAGES registry in src/core.ts.');
}

function addIssue(
  issues: CatalogValidationIssue[],
  locale: string,
  namespace: string,
  key: string,
  code: CatalogValidationCode,
  detail: string,
): void {
  issues.push({ code, locale, namespace, key, detail });
}

function parsePlaceholders(value: string): { readonly names: ReadonlySet<string>; readonly valid: boolean } {
  const names = new Set<string>();
  for (const match of value.matchAll(placeholderPattern)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  const remaining = value.replace(placeholderPattern, '');
  return { names, valid: !/[{}]/.test(remaining) };
}

function flattenCatalog(
  value: unknown,
  locale: string,
  namespace: string,
  issues: CatalogValidationIssue[],
): CatalogLeaves {
  const messages = new Map<string, MessageLeaf>();
  const branches = new Set<string>();
  const emptyBranches = new Set<string>();

  function visit(node: unknown, path: readonly string[]): void {
    const key = path.join('.');
    if (typeof node === 'string') {
      const isBlank = node.trim().length === 0;
      if (isBlank) {
        addIssue(issues, locale, namespace, key, 'blank-message', 'Message text is blank.');
      }
      if (markupPattern.test(node)) {
        addIssue(issues, locale, namespace, key, 'markup', 'Catalog messages must be plain text without HTML markup.');
      }
      const parsed = parsePlaceholders(node);
      if (!parsed.valid) {
        addIssue(
          issues,
          locale,
          namespace,
          key,
          'invalid-placeholder',
          'Use only named {{placeholder}} interpolation syntax.',
        );
      }
      messages.set(key, {
        path: key,
        value: node,
        placeholders: parsed.names,
        placeholderSyntaxValid: !isBlank && parsed.valid,
      });
      return;
    }

    if (!isRecord(node)) {
      addIssue(
        issues,
        locale,
        namespace,
        key || '<root>',
        'invalid-message-value',
        'Catalog values must be objects or message strings.',
      );
      return;
    }

    branches.add(key);
    const entries = Object.entries(node);
    if (path.length > 0 && entries.length === 0) emptyBranches.add(key);

    for (const [segment, child] of entries) {
      if (!keySegmentPattern.test(segment)) {
        addIssue(
          issues,
          locale,
          namespace,
          [...path, segment].join('.'),
          'invalid-key-segment',
          'Key segments must start with a letter and contain only letters, digits, underscores or hyphens.',
        );
      }
      visit(child, [...path, segment]);
    }
  }

  visit(value, []);
  return { messages, branches, emptyBranches };
}

function buildUnits(
  catalog: CatalogLeaves,
  locale: string,
  namespace: string,
  isSource: boolean,
  issues: CatalogValidationIssue[],
): Map<string, CatalogUnit> {
  const ordinary = new Map<string, MessageLeaf>();
  const plural = new Map<string, Map<string, MessageLeaf>>();
  for (const [path, message] of catalog.messages) {
    const match = path.match(pluralSuffixPattern);
    if (match === null) {
      ordinary.set(path, message);
      continue;
    }
    const category = match[1];
    if (category === undefined) continue;
    const basePath = path.slice(0, -match[0].length);
    const forms = plural.get(basePath) ?? new Map<string, MessageLeaf>();
    forms.set(category, message);
    plural.set(basePath, forms);
  }

  const units = new Map<string, CatalogUnit>();
  for (const [path, message] of ordinary) {
    const forms = plural.get(path);
    if (forms === undefined) units.set(path, { kind: 'ordinary', message });
    else {
      units.set(path, { kind: 'mixed', ordinary: message, forms });
      if (isSource) {
        addIssue(
          issues,
          locale,
          namespace,
          path,
          'invalid-source-catalog',
          'A message cannot be both an ordinary message and a plural group.',
        );
      }
    }
  }
  for (const [path, forms] of plural) {
    if (ordinary.has(path)) continue;
    units.set(path, { kind: 'plural', forms });
    if (isSource && (!forms.has('one') || !forms.has('other'))) {
      const missing = ['one', 'other'].filter((category) => !forms.has(category));
      addIssue(
        issues,
        locale,
        namespace,
        path,
        'invalid-source-catalog',
        `English plural source is missing ${missing.map((category) => `_${category}`).join(' and ')}.`,
      );
    }
  }
  return units;
}

function pluralCategoriesFor(locale: string): ReadonlySet<string> | null {
  try {
    const canonical = Intl.getCanonicalLocales(locale)[0];
    if (canonical !== locale || Intl.PluralRules.supportedLocalesOf([locale]).length !== 1) return null;
    return new Set(new Intl.PluralRules(locale, { type: 'cardinal' }).resolvedOptions().pluralCategories);
  } catch {
    return null;
  }
}

function sameNames(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((name) => right.has(name));
}

function parameterList(parameters: ReadonlySet<string>): string {
  return (
    [...parameters]
      .sort()
      .map((name) => `{{${name}}}`)
      .join(', ') || '(none)'
  );
}

function compareParameters(
  issues: CatalogValidationIssue[],
  locale: string,
  namespace: string,
  key: string,
  expected: MessageLeaf,
  actual: MessageLeaf,
): void {
  if (!actual.placeholderSyntaxValid) return;
  const occurrences = (value: unknown): string =>
    typeof value === 'string'
      ? [...value.matchAll(placeholderPattern)]
          .map((match) => match[1] ?? '')
          .sort()
          .join('\u0000')
      : '';
  if (
    sameNames(expected.placeholders, actual.placeholders) &&
    occurrences(expected.value) === occurrences(actual.value)
  )
    return;
  addIssue(
    issues,
    locale,
    namespace,
    key,
    'parameter-mismatch',
    `Expected the same occurrences of ${parameterList(expected.placeholders)}; found ${parameterList(actual.placeholders)}.`,
  );
}

function comparePluralForms(
  locale: string,
  namespace: string,
  key: string,
  source: PluralUnit,
  target: PluralUnit,
  requiredCategories: ReadonlySet<string> | null,
  issues: CatalogValidationIssue[],
): void {
  if (requiredCategories !== null) {
    for (const category of requiredCategories) {
      if (!target.forms.has(category)) {
        addIssue(
          issues,
          locale,
          namespace,
          key,
          'missing-plural-form',
          `Plural message is missing the required _${category} form.`,
        );
      }
    }
    for (const category of target.forms.keys()) {
      // i18next has an explicit zero override even in locales whose CLDR
      // cardinal rules do not report a `zero` category.
      if (!requiredCategories.has(category) && category !== 'zero') {
        addIssue(
          issues,
          locale,
          namespace,
          `${key}_${category}`,
          'unexpected-plural-form',
          `_${category} is not a cardinal plural category for ${locale}.`,
        );
      }
    }
  }

  for (const [category, targetForm] of target.forms) {
    const sourceForm = source.forms.get(category) ?? source.forms.get('other');
    if (sourceForm === undefined) continue;
    compareParameters(issues, locale, namespace, `${key}_${category}`, sourceForm, targetForm);
  }
}

/**
 * Checks one target catalog set against English keys and each source form's
 * exact placeholder contract. Target plural categories follow Intl's cardinal
 * rules and may differ from the English suffix set.
 */
export function validateTargetCatalogs(input: TargetCatalogValidationInput): readonly CatalogValidationIssue[] {
  const { locale, sourceCatalogs, targetCatalogs } = input;
  const issues: CatalogValidationIssue[] = [];
  const requiredCategories = pluralCategoriesFor(locale);
  if (requiredCategories === null) {
    addIssue(
      issues,
      locale,
      '<locale>',
      '<locale>',
      'invalid-locale',
      'Locale must be a supported canonical BCP 47 tag.',
    );
  }

  for (const namespace of targetCatalogs.keys()) {
    if (!sourceCatalogs.has(namespace)) {
      addIssue(
        issues,
        locale,
        namespace,
        '<namespace>',
        'unknown-namespace',
        'Namespace is not present in the English source.',
      );
    }
  }

  for (const namespace of sourceCatalogs.keys()) {
    if (!targetCatalogs.has(namespace)) {
      addIssue(issues, locale, namespace, '<namespace>', 'missing-namespace', 'Target namespace is missing.');
      continue;
    }

    const sourceIssues: CatalogValidationIssue[] = [];
    const sourceLeaves = flattenCatalog(sourceCatalogs.get(namespace), locale, namespace, sourceIssues);
    for (const issue of sourceIssues) {
      addIssue(issues, locale, namespace, issue.key, 'invalid-source-catalog', `English source: ${issue.detail}`);
    }
    const targetLeaves = flattenCatalog(targetCatalogs.get(namespace), locale, namespace, issues);
    for (const branch of targetLeaves.emptyBranches) {
      if (!sourceLeaves.branches.has(branch) && !sourceLeaves.messages.has(branch)) {
        addIssue(
          issues,
          locale,
          namespace,
          branch,
          'unknown-message',
          'Empty group is not present in the English source.',
        );
      }
    }
    const sourceUnits = buildUnits(sourceLeaves, locale, namespace, true, issues);
    const targetUnits = buildUnits(targetLeaves, locale, namespace, false, issues);

    for (const [key, target] of targetUnits) {
      if (!sourceUnits.has(key)) {
        addIssue(
          issues,
          locale,
          namespace,
          key,
          'unknown-message',
          'Message key is not present in the English source.',
        );
        continue;
      }
      if (target.kind === 'mixed') {
        addIssue(
          issues,
          locale,
          namespace,
          key,
          'message-kind-mismatch',
          'Target key cannot contain both an ordinary message and plural forms.',
        );
      }
    }

    for (const [key, source] of sourceUnits) {
      const target = targetUnits.get(key);
      if (target === undefined) {
        addIssue(issues, locale, namespace, key, 'missing-message', 'Message key is missing from the target.');
        continue;
      }
      if (source.kind === 'mixed') continue;
      if (source.kind === 'ordinary' && target.kind === 'ordinary') {
        compareParameters(issues, locale, namespace, key, source.message, target.message);
      } else if (source.kind === 'plural' && target.kind === 'plural') {
        comparePluralForms(locale, namespace, key, source, target, requiredCategories, issues);
      } else if (target.kind !== 'mixed') {
        addIssue(
          issues,
          locale,
          namespace,
          key,
          'message-kind-mismatch',
          `English uses a ${source.kind} message but the target uses a ${target.kind} message.`,
        );
      }
    }
  }

  return issues.sort(
    (left, right) =>
      left.namespace.localeCompare(right.namespace) ||
      left.key.localeCompare(right.key) ||
      left.code.localeCompare(right.code),
  );
}

async function readCatalogDirectory(directory: string): Promise<Map<string, unknown>> {
  const files = (await readdir(directory, { withFileTypes: true })).filter(
    (entry) => entry.isFile() && entry.name.endsWith('.json'),
  );
  const catalogs = new Map<string, unknown>();
  for (const file of files) {
    const namespace = file.name.slice(0, -'.json'.length);
    try {
      catalogs.set(namespace, parseCatalog(await readFile(join(directory, file.name), 'utf8')));
    } catch (error) {
      throw new Error(`${file.name}: ${error instanceof Error ? error.message : 'invalid JSON'}`);
    }
  }
  return catalogs;
}

async function main(): Promise<void> {
  const catalogRoot = join(process.cwd(), 'src/catalogs');
  const sourceCatalogs = await readCatalogDirectory(join(catalogRoot, 'en'));
  const themeDirectory = resolve(process.cwd(), '../../frontend/theme/locales');
  const themeSource = new Map<string, unknown>([
    ['theme-schema', parseCatalog(await readFile(join(themeDirectory, 'en.default.schema.json'), 'utf8'))],
  ]);
  const runtimeSource = await readFile(join(process.cwd(), 'src/core.ts'), 'utf8');
  const languages = parseSupportedLanguages(runtimeSource).filter((language) => language !== 'en');
  let failed = false;

  for (const locale of languages) {
    let targetCatalogs: Map<string, unknown>;
    try {
      targetCatalogs = await readCatalogDirectory(join(catalogRoot, locale));
    } catch (error) {
      failed = true;
      console.error(`[${locale}] ${error instanceof Error ? error.message : 'cannot read target catalogs'}`);
      continue;
    }

    let themeTarget: Map<string, unknown>;
    try {
      themeTarget = new Map([
        ['theme-schema', parseCatalog(await readFile(join(themeDirectory, `${locale}.schema.json`), 'utf8'))],
      ]);
    } catch (error) {
      failed = true;
      console.error(
        `[${locale}] Theme Editor schema: ${error instanceof Error ? error.message : 'cannot read translation'}`,
      );
      continue;
    }
    const issues = [
      ...validateTargetCatalogs({ locale, sourceCatalogs, targetCatalogs }),
      ...validateTargetCatalogs({ locale, sourceCatalogs: themeSource, targetCatalogs: themeTarget }),
    ];
    if (issues.length === 0) continue;
    failed = true;
    for (const issue of issues) {
      console.error(`[${issue.locale}] ${issue.namespace}:${issue.key} ${issue.code}: ${issue.detail}`);
    }
  }

  if (failed) process.exitCode = 1;
  else console.log(`Validated target catalogs: ${languages.join(', ') || '(none)'}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
