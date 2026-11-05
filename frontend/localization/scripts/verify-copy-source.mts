import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseAstro } from '@astrojs/compiler-rs';
import ts from 'typescript';

export interface CopyLintIssue {
  file: string;
  line: number;
  column: number;
  kind:
    | 'tsx-attribute'
    | 'tsx-text'
    | 'tsx-parse'
    | 'astro-attribute'
    | 'astro-text'
    | 'astro-parse'
    | 'liquid-schema-copy'
    | 'liquid-schema-key'
    | 'liquid-schema-parse';
  text: string;
}

const visibleAttributes = new Set([
  'accessibilityLabel',
  'accessibilityDescription',
  'alt',
  'aria-description',
  'aria-label',
  'aria-valuetext',
  'buttonLabel',
  'caption',
  'description',
  'details',
  'emptyLabel',
  'error',
  'errorMessage',
  'heading',
  'helpText',
  'hint',
  'info',
  'label',
  'message',
  'placeholder',
  'summary',
  'subheading',
  'text',
  'title',
  'viewAllLabel',
]);

const excludedMarkupTags = new Set(['code', 'pre', 'script', 'style']);
const translationCalls = new Set(['adminMessage', 'customerMessage', 'guestMessage', 't']);
const technicalSchemaDefaults = new Set(['proxy_prefix']);
const fixedBranding = new Set(['Insignia']);

function containsDisplayText(value: string): boolean {
  const normalized = value.trim();
  const displayValue = normalized.includes(': ') ? normalized.slice(normalized.indexOf(': ') + 2).trim() : normalized;
  return normalized.length > 0 && !fixedBranding.has(displayValue) && /\p{L}/u.test(displayValue);
}

function issueAt(
  file: string,
  source: string,
  offset: number,
  kind: CopyLintIssue['kind'],
  text: string,
): CopyLintIssue {
  const boundedOffset = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, boundedOffset);
  const lineStart = before.lastIndexOf('\n') + 1;
  return {
    file,
    line: before.split('\n').length,
    column: boundedOffset - lineStart + 1,
    kind,
    text: text.trim(),
  };
}

function translationCallName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

/** Read only literal text reachable from a visible expression, not translator keys or formatter options. */
type LocalTextResolver = (identifier: ts.Identifier, visited: ReadonlySet<ts.VariableDeclaration>) => string[];

function unwrappedExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  )
    current = current.expression;
  return current;
}

function lexicalScopeStatements(scope: ts.Node): readonly ts.Statement[] | undefined {
  if (ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope)) return scope.statements;
  if (ts.isCaseBlock(scope)) return scope.clauses.flatMap((clause) => clause.statements);
  return undefined;
}

function bindingContainsName(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return binding.elements.some(
    (element) => !ts.isOmittedExpression(element) && bindingContainsName(element.name, name),
  );
}

/** Returns undefined when no direct binding exists and null when a binding blocks outer const lookup. */
function bindingInScope(scope: ts.Node, name: string): ts.VariableDeclaration | null | undefined {
  const statements = lexicalScopeStatements(scope);
  if (!statements) return undefined;
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!bindingContainsName(declaration.name, name)) continue;
        return ts.isIdentifier(declaration.name) &&
          (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
          declaration.initializer
          ? declaration
          : null;
      }
    }
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
      statement.name?.text === name
    )
      return null;
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (
        clause?.name?.text === name ||
        (clause?.namedBindings &&
          ((ts.isNamespaceImport(clause.namedBindings) && clause.namedBindings.name.text === name) ||
            (ts.isNamedImports(clause.namedBindings) &&
              clause.namedBindings.elements.some((specifier) => specifier.name.text === name))))
      )
        return null;
    }
  }
  return undefined;
}

function parameterShadowsName(node: ts.Node, name: string): boolean {
  if (ts.isFunctionLike(node) && node.parameters.some((parameter) => bindingContainsName(parameter.name, name)))
    return true;
  if (ts.isCatchClause(node) && node.variableDeclaration && bindingContainsName(node.variableDeclaration.name, name))
    return true;
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node)) &&
    node.name?.text === name
  )
    return true;
  return false;
}

function literalLookupValues(expression: ts.ElementAccessExpression): ts.Expression[] {
  const target = unwrappedExpression(expression.expression);
  if (ts.isArrayLiteralExpression(target))
    return target.elements.filter(
      (element): element is ts.Expression => !ts.isOmittedExpression(element) && !ts.isSpreadElement(element),
    );
  if (ts.isObjectLiteralExpression(target))
    return target.properties.flatMap((property) => (ts.isPropertyAssignment(property) ? [property.initializer] : []));
  return [];
}

function isActualTimeZoneBinding(declaration: ts.VariableDeclaration): boolean {
  if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'timeZone' || !declaration.initializer)
    return false;
  const initializer = unwrappedExpression(declaration.initializer);
  if (!ts.isBinaryExpression(initializer) || initializer.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken)
    return false;
  const source = unwrappedExpression(initializer.left);
  const fallback = unwrappedExpression(initializer.right);
  return (
    ts.isPropertyAccessExpression(source) &&
    source.name.text === 'timeZone' &&
    ts.isStringLiteralLike(fallback) &&
    fallback.text === 'UTC'
  );
}

function literalAttributeValue(element: ts.JsxElement | ts.JsxSelfClosingElement, name: string): string | undefined {
  const attributes = ts.isJsxElement(element) ? element.openingElement.attributes : element.attributes;
  const attribute = attributes.properties.find(
    (candidate): candidate is ts.JsxAttribute => ts.isJsxAttribute(candidate) && candidate.name.getText() === name,
  );
  const initializer = attribute?.initializer;
  if (initializer && ts.isStringLiteral(initializer)) return initializer.text;
  if (
    initializer &&
    ts.isJsxExpression(initializer) &&
    initializer.expression &&
    initializer.expression.kind === ts.SyntaxKind.TrueKeyword
  )
    return 'true';
  return undefined;
}

function isHiddenCalibrationSvg(element: ts.JsxElement | ts.JsxSelfClosingElement): boolean {
  const name = ts.isJsxElement(element) ? element.openingElement.tagName : element.tagName;
  if (tagName(name, element.getSourceFile()).toLowerCase() !== 'svg') return false;
  return (
    literalAttributeValue(element, 'aria-hidden') === 'true' &&
    literalAttributeValue(element, 'class')?.split(/\s+/u).includes('placement-calibration-line') === true
  );
}

function hiddenCalibrationMarker(text: string, hiddenCalibrationGraphic: boolean): boolean {
  const marker = text.trim();
  return hiddenCalibrationGraphic && (marker === 'A' || marker === 'B');
}

const stableKeyLegends = new Set([
  'Shift',
  '⇧',
  'Ctrl',
  'Control',
  '⌃',
  'Alt',
  'Option',
  '⌥',
  '⌘',
  'Command',
  'Meta',
  'Z',
  '↑',
  '↓',
  '←',
  '→',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

function isStablePhysicalKeyLegend(text: string, insideKeyLegend: boolean): boolean {
  return insideKeyLegend && stableKeyLegends.has(text.trim());
}

/** Read only literal text reachable from a visible expression, not translator keys or formatter options. */
function visibleExpressionText(
  expression: ts.Expression,
  resolveLocal?: LocalTextResolver,
  visited = new Set<ts.VariableDeclaration>(),
): string[] {
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isNoSubstitutionTemplateLiteral(expression)) return [expression.text];
  if (ts.isTemplateExpression(expression))
    return [expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)];
  if (ts.isIdentifier(expression)) return resolveLocal?.(expression, visited) ?? [];
  if (ts.isCallExpression(expression)) {
    const name = translationCallName(expression.expression);
    if (name && (translationCalls.has(name) || name === 'message')) return [];
    if (
      ts.isPropertyAccessExpression(expression.expression) &&
      expression.expression.name.text === 'join' &&
      ts.isArrayLiteralExpression(expression.expression.expression)
    ) {
      return expression.expression.expression.elements.flatMap((element) =>
        visibleExpressionText(element, resolveLocal, visited),
      );
    }
    return [];
  }
  if (ts.isConditionalExpression(expression))
    return [
      ...visibleExpressionText(expression.whenTrue, resolveLocal, visited),
      ...visibleExpressionText(expression.whenFalse, resolveLocal, visited),
    ];
  if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken)
      return visibleExpressionText(expression.right, resolveLocal, visited);
    if (
      operator === ts.SyntaxKind.PlusToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken ||
      operator === ts.SyntaxKind.BarBarToken
    )
      return [
        ...visibleExpressionText(expression.left, resolveLocal, visited),
        ...visibleExpressionText(expression.right, resolveLocal, visited),
      ];
    return [];
  }
  if (ts.isElementAccessExpression(expression))
    return literalLookupValues(expression).flatMap((value) => visibleExpressionText(value, resolveLocal, visited));
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  )
    return visibleExpressionText(expression.expression, resolveLocal, visited);
  return [];
}

function tagName(name: ts.JsxTagNameExpression, source: ts.SourceFile): string {
  return name.getText(source);
}

/** AST check for text nodes and a deliberate list of user-facing native/custom component props. */
export function lintTsxSource(source: string, file: string): CopyLintIssue[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const issues: CopyLintIssue[] = [];
  const resolveLocal: LocalTextResolver = (identifier, visited) => {
    let current: ts.Node | undefined = identifier.parent;
    while (current) {
      if (parameterShadowsName(current, identifier.text)) return [];
      const binding = bindingInScope(current, identifier.text);
      if (binding === null) return [];
      if (binding) {
        if (isActualTimeZoneBinding(binding)) return [];
        if (!binding.initializer || visited.has(binding)) return [];
        const nextVisited = new Set(visited);
        nextVisited.add(binding);
        return visibleExpressionText(binding.initializer, resolveLocal, nextVisited);
      }
      current = current.parent;
    }
    return [];
  };
  const add = (node: ts.Node, kind: CopyLintIssue['kind'], text: string) => {
    if (containsDisplayText(text)) issues.push(issueAt(file, source, node.getStart(sourceFile), kind, text));
  };
  const addAttribute = (node: ts.Node, name: string, text: string) => {
    if (containsDisplayText(text)) add(node, 'tsx-attribute', `${name}: ${text}`);
  };

  const visitAttribute = (attribute: ts.JsxAttribute) => {
    const attributeName = attribute.name.getText(sourceFile);
    if (!visibleAttributes.has(attributeName) || !attribute.initializer) return;
    if (ts.isStringLiteral(attribute.initializer)) {
      addAttribute(attribute.initializer, attributeName, attribute.initializer.text);
      return;
    }
    if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
      for (const value of visibleExpressionText(attribute.initializer.expression, resolveLocal))
        addAttribute(attribute.initializer.expression, attributeName, value);
    }
  };

  function visitNestedJsx(node: ts.Node, stableKeyLegend: boolean, hiddenCalibrationGraphic: boolean): void {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      visit(node, false, stableKeyLegend, hiddenCalibrationGraphic);
      return;
    }
    ts.forEachChild(node, (child) => visitNestedJsx(child, stableKeyLegend, hiddenCalibrationGraphic));
  }

  function visit(
    node: ts.Node,
    excludedParent: boolean,
    stableKeyLegend = false,
    hiddenCalibrationGraphic = false,
  ): void {
    if (ts.isJsxElement(node)) {
      const elementName = tagName(node.openingElement.tagName, sourceFile).toLowerCase();
      if (excludedMarkupTags.has(elementName)) return;
      for (const attribute of node.openingElement.attributes.properties)
        if (ts.isJsxAttribute(attribute)) visitAttribute(attribute);
      const childKeyLegend = stableKeyLegend || elementName === 'kbd';
      const childHiddenCalibration = hiddenCalibrationGraphic || isHiddenCalibrationSvg(node);
      for (const child of node.children) visit(child, false, childKeyLegend, childHiddenCalibration);
      return;
    }
    if (ts.isJsxSelfClosingElement(node)) {
      if (excludedMarkupTags.has(tagName(node.tagName, sourceFile).toLowerCase())) return;
      for (const attribute of node.attributes.properties) if (ts.isJsxAttribute(attribute)) visitAttribute(attribute);
      return;
    }
    if (ts.isJsxText(node)) {
      if (
        !isStablePhysicalKeyLegend(node.text, stableKeyLegend) &&
        !hiddenCalibrationMarker(node.text, hiddenCalibrationGraphic)
      )
        add(node, 'tsx-text', node.text);
      return;
    }
    if (ts.isJsxExpression(node) && node.expression) {
      for (const value of visibleExpressionText(node.expression, resolveLocal))
        if (
          !isStablePhysicalKeyLegend(value, stableKeyLegend) &&
          !hiddenCalibrationMarker(value, hiddenCalibrationGraphic)
        )
          add(node.expression, 'tsx-text', value);
      visitNestedJsx(node.expression, stableKeyLegend, hiddenCalibrationGraphic);
      return;
    }
    if (!excludedParent)
      ts.forEachChild(node, (child) => visit(child, false, stableKeyLegend, hiddenCalibrationGraphic));
  }

  visit(sourceFile, false);
  return issues;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function astroTextParts(expression: unknown): string[] {
  const node = record(expression);
  if (!node) return [];
  if (node.type === 'Literal' && typeof node.value === 'string') return [node.value];
  if (node.type === 'TemplateLiteral')
    return list(node.quasis).flatMap((quasi) => {
      const value = record(record(quasi)?.value)?.cooked;
      return typeof value === 'string' ? [value] : [];
    });
  if (node.type === 'CallExpression') return [];
  if (node.type === 'ConditionalExpression')
    return [...astroTextParts(node.consequent), ...astroTextParts(node.alternate)];
  if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression') {
    const operator = stringValue(node.operator);
    if (operator === '+' || operator === '??' || operator === '||' || operator === '&&')
      return [...astroTextParts(node.left), ...astroTextParts(node.right)];
  }
  if (node.type === 'ParenthesizedExpression' || node.type === 'ChainExpression')
    return astroTextParts(node.expression);
  return [];
}

function astroTagName(node: UnknownRecord): string | undefined {
  const openingElement = record(node.openingElement);
  const name = record(openingElement?.name);
  return stringValue(name?.name);
}

/** Astro parser adapter: the compiler AST keeps frontmatter separate from rendered markup. */
export function lintAstroSource(source: string, file: string): CopyLintIssue[] {
  const parsed = parseAstro(source);
  const issues: CopyLintIssue[] = [];
  for (const diagnostic of parsed.diagnostics) {
    if (diagnostic.severity === 'error')
      issues.push(issueAt(file, source, diagnostic.labels[0]?.start ?? 0, 'astro-parse', diagnostic.text));
  }

  const add = (offset: number, kind: CopyLintIssue['kind'], text: string) => {
    if (containsDisplayText(text)) issues.push(issueAt(file, source, offset, kind, text));
  };
  const addAttribute = (offset: number, name: string, text: string) => {
    if (containsDisplayText(text)) add(offset, 'astro-attribute', `${name}: ${text}`);
  };
  const visit = (value: unknown): void => {
    const node = record(value);
    if (!node) return;
    if (node.type === 'JSXElement') {
      const name = astroTagName(node)?.toLowerCase();
      if (name && excludedMarkupTags.has(name)) return;
      const opening = record(node.openingElement);
      for (const attribute of list(opening?.attributes)) visit(attribute);
      for (const child of list(node.children)) visit(child);
      return;
    }
    if (node.type === 'JSXAttribute') {
      const name = stringValue(record(node.name)?.name);
      if (!name || !visibleAttributes.has(name)) return;
      const attributeValue = record(node.value);
      if (attributeValue?.type === 'Literal' && typeof attributeValue.value === 'string') {
        addAttribute(typeof attributeValue.start === 'number' ? attributeValue.start : 0, name, attributeValue.value);
      } else if (attributeValue?.type === 'JSXExpressionContainer') {
        for (const text of astroTextParts(attributeValue.expression))
          addAttribute(typeof attributeValue.start === 'number' ? attributeValue.start : 0, name, text);
      }
      return;
    }
    if (node.type === 'JSXText') {
      add(typeof node.start === 'number' ? node.start : 0, 'astro-text', stringValue(node.value) ?? '');
      return;
    }
    if (node.type === 'JSXExpressionContainer') {
      const container = record(node.expressionContainer);
      for (const text of astroTextParts(container?.expression))
        add(typeof node.start === 'number' ? node.start : 0, 'astro-text', text);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'frontmatter' || key === 'comments' || key === 'start' || key === 'end') continue;
      if (Array.isArray(child)) for (const entry of child) visit(entry);
      else visit(child);
    }
  };

  for (const child of list(record(parsed.ast)?.body)) visit(child);
  return issues;
}

function translationExists(catalog: unknown, key: string): boolean {
  let current = catalog;
  for (const segment of key.split('.')) {
    const object = record(current);
    if (!object || !(segment in object)) return false;
    current = object[segment];
  }
  return typeof current === 'string' && current.trim().length > 0;
}

function jsonProperty(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  const property = object.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) && ts.isStringLiteral(candidate.name) && candidate.name.text === name,
  );
  return property && ts.isStringLiteral(property.initializer) ? property.initializer.text : undefined;
}

function schemaCopyField(name: string, settingId: string | undefined, settingType: string | undefined): boolean {
  if (name === 'name' || name === 'label' || name === 'info' || name === 'placeholder' || name === 'content')
    return true;
  if (name === 'default' && settingType && ['richtext', 'text', 'textarea'].includes(settingType))
    return !settingId || !technicalSchemaDefaults.has(settingId);
  return false;
}

/** Check only Shopify schema display fields; IDs, enum values and protocol defaults stay technical. */
export function lintLiquidSchema(source: string, locale: unknown, file: string): CopyLintIssue[] {
  const issues: CopyLintIssue[] = [];
  const schemaTags = /\{%[-]?\s*schema\s*[-]?%\}([\s\S]*?)\{%[-]?\s*endschema\s*[-]?%\}/gi;
  const schemas = [...source.matchAll(schemaTags)];
  if (schemas.length !== 1) {
    issues.push({
      file,
      line: 1,
      column: 1,
      kind: 'liquid-schema-parse',
      text:
        schemas.length === 0
          ? 'Expected one {% schema %} block.'
          : `Expected one schema block; found ${schemas.length}.`,
    });
    if (schemas.length === 0) return issues;
  }
  for (const match of schemas) {
    const json = match[1] ?? '';
    const schemaOffset = match.index ?? 0;
    const jsonOffset = schemaOffset + match[0].indexOf(json);
    try {
      JSON.parse(json);
    } catch (error) {
      issues.push(
        issueAt(
          file,
          source,
          jsonOffset,
          'liquid-schema-parse',
          error instanceof Error ? error.message : 'Invalid schema JSON',
        ),
      );
      continue;
    }
    const ast = ts.parseJsonText(file, json);
    if (!ts.isObjectLiteralExpression(ast.statements[0]?.expression ?? ast)) continue;

    const visit = (node: ts.Node, path: readonly string[]): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const settingId = jsonProperty(node, 'id');
        const settingType = jsonProperty(node, 'type');
        for (const property of node.properties) {
          if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name)) continue;
          const key = property.name.text;
          const nextPath = [...path, key];
          if (ts.isStringLiteral(property.initializer) && schemaCopyField(key, settingId, settingType)) {
            const value = property.initializer.text;
            if (value.trim()) {
              const location = jsonOffset + property.initializer.getStart(ast);
              if (!value.startsWith('t:')) {
                issues.push(issueAt(file, source, location, 'liquid-schema-copy', `${nextPath.join('.')}: ${value}`));
              } else if (!translationExists(locale, value.slice(2))) {
                issues.push(issueAt(file, source, location, 'liquid-schema-key', value));
              }
            }
          }
          visit(property.initializer, nextPath);
        }
        return;
      }
      if (ts.isArrayLiteralExpression(node))
        for (const [index, element] of node.elements.entries()) visit(element, [...path, String(index)]);
    };

    visit(ast.statements[0]?.expression ?? ast, []);
  }
  return issues;
}

async function filesUnder(directory: string, extension: string): Promise<string[]> {
  const results: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...(await filesUnder(path, extension)));
    else if (entry.isFile() && extname(entry.name) === extension) results.push(path);
  }
  return results.sort();
}

const selectedSupportComponents = [
  'method-dialog.tsx',
  'method-index.tsx',
  'method-product-picker.tsx',
  'method-summary.tsx',
  'method-workflow-preview.tsx',
  'placement-copy-destinations.tsx',
  'placement-image-picker.tsx',
  'placement-method-manager.tsx',
  'placement-setup-copy-dialog.tsx',
  'placement-setup-copy-entry.tsx',
  'placement-setup-copy-review.tsx',
  'placement-variant-photo-panel.tsx',
  'placement-workflow-canvas.tsx',
  'placement-workflow-preview.tsx',
] as const;

async function scanRepository(root: string): Promise<CopyLintIssue[]> {
  const appSource = resolve(root, 'frontend/admin/src');
  const supportRoot = resolve(root, 'frontend/admin/examples/admin/support');
  const themeRoot = resolve(root, 'frontend/theme/blocks');
  const localePath = resolve(root, 'frontend/theme/locales/en.default.schema.json');
  const locale: unknown = JSON.parse(await readFile(localePath, 'utf8'));
  const issues: CopyLintIssue[] = [];

  for (const path of await filesUnder(appSource, '.tsx'))
    issues.push(...lintTsxSource(await readFile(path, 'utf8'), relative(root, path)));
  for (const name of selectedSupportComponents) {
    const path = resolve(supportRoot, name);
    try {
      issues.push(...lintTsxSource(await readFile(path, 'utf8'), relative(root, path)));
    } catch (error) {
      if (record(error)?.code === 'ENOENT') {
        issues.push({
          file: relative(root, path),
          line: 1,
          column: 1,
          kind: 'tsx-parse',
          text: 'Selected presentation file is missing.',
        });
      } else throw error;
    }
  }
  for (const path of await filesUnder(appSource, '.astro'))
    issues.push(...lintAstroSource(await readFile(path, 'utf8'), relative(root, path)));
  for (const path of await filesUnder(themeRoot, '.liquid'))
    issues.push(...lintLiquidSchema(await readFile(path, 'utf8'), locale, relative(root, path)));
  return issues;
}

async function main(): Promise<void> {
  const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
  const issues = await scanRepository(root);
  if (issues.length === 0) {
    console.log('Copy source check passed for app TSX, Astro templates and Shopify Liquid schemas.');
    return;
  }
  for (const issue of issues) console.error(`${issue.file}:${issue.line}:${issue.column} ${issue.kind}: ${issue.text}`);
  console.error(`Found ${issues.length} unlocalized copy source issue(s).`);
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
