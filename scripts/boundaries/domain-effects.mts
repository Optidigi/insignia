import { dirname, sep } from 'node:path';
import ts from 'typescript';

// This is a scoped syntax check for production domain modules, not a JavaScript sandbox.
// Imports and transitive dependencies are checked separately by dependency-cruiser.
const ambientNames = new Set([
  'Bun',
  'BroadcastChannel',
  'Deno',
  'EventSource',
  'Function',
  'Intl',
  'WebSocket',
  'Worker',
  'XMLHttpRequest',
  'console',
  'crypto',
  'document',
  'eval',
  'fetch',
  'global',
  'globalThis',
  'indexedDB',
  'localStorage',
  'location',
  'navigator',
  'performance',
  'process',
  'queueMicrotask',
  'requestAnimationFrame',
  'self',
  'sessionStorage',
  'setImmediate',
  'setInterval',
  'setTimeout',
  'window',
]);

function staticString(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
    return staticString(node.expression);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function memberName(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) return staticString(node.argumentExpression);
  return null;
}

function memberTarget(node: ts.Node): ts.Expression | null {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? node.expression : null;
}

function isDateRoot(node: ts.Node | null | undefined): boolean {
  if (!node) return false;
  const target = memberTarget(node);
  return (
    (ts.isIdentifier(node) && node.text === 'Date') ||
    (memberName(node) === 'Date' && target !== null && ts.isIdentifier(target) && target.text === 'globalThis')
  );
}
function isMathRoot(node: ts.Node | null | undefined): boolean {
  return !!node && ts.isIdentifier(node) && node.text === 'Math';
}

function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
    if (ts.isTypeNode(ancestor)) return false;
    if (ts.isExpression(ancestor) || ts.isStatement(ancestor)) break;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isPropertySignature(parent) && parent.name === node) return false;
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return false;
  if (ts.isMethodSignature(parent) && parent.name === node) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false;
  if (ts.isTypeParameterDeclaration(parent) && parent.name === node) return false;
  if (ts.isTypeAliasDeclaration(parent) && parent.name === node) return false;
  if (ts.isInterfaceDeclaration(parent) && parent.name === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.name === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return false;
  return true;
}

export function inspectDomainSource(source: string, filename = 'domain.ts') {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const diagnostics: { rule: string; line: number; column: number }[] = [];
  function report(node: ts.Node, rule: string) {
    const at = file.getLineAndCharacterOfPosition(node.getStart(file));
    diagnostics.push({ rule, line: at.line + 1, column: at.character + 1 });
  }
  function visit(node: ts.Node) {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const property = memberName(node);
      const target = memberTarget(node);
      if (property === 'now' && isDateRoot(target)) report(node, 'domain-no-implicit-clock');
      if (property === 'random' && isMathRoot(target)) report(node, 'domain-no-implicit-random');
      if (ts.isElementAccessExpression(node) && property === null && isMathRoot(target)) {
        report(node, 'domain-no-dynamic-math');
      }
      if (ts.isElementAccessExpression(node) && property === null && isDateRoot(target)) {
        report(node, 'domain-no-dynamic-date');
      }
    }
    if (
      ts.isNewExpression(node) &&
      isDateRoot(node.expression) &&
      (!node.arguments?.length || node.arguments.some(ts.isSpreadElement))
    ) {
      report(node, 'domain-no-implicit-clock');
    }
    if (ts.isCallExpression(node) && isDateRoot(node.expression)) {
      report(node, 'domain-no-implicit-clock');
    }
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
      if (
        isMathRoot(node.initializer) &&
        node.name.elements.some((element) => (element.propertyName ?? element.name).getText(file) === 'random')
      ) {
        report(node, 'domain-no-implicit-random');
      }
    }
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      report(node, 'domain-no-ambient-api');
    }
    if (ts.isIdentifier(node) && isReference(node)) {
      if (ambientNames.has(node.text)) report(node, 'domain-no-ambient-api');
      if (node.text === 'Math') {
        const parent = node.parent;
        const directMember =
          (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node;
        if (!directMember) report(node, 'domain-no-math-alias');
      }
      // Bare Date aliases can hide an implicit clock. Explicit-value constructors and
      // Date.parse/UTC remain available, but Date.now and zero-argument Date do not.
      if (node.text === 'Date') {
        const parent = node.parent;
        const explicitConstructor =
          ts.isNewExpression(parent) && parent.expression === node && !!parent.arguments?.length;
        const deterministicMember =
          (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
          parent.expression === node &&
          ['parse', 'UTC', 'now'].includes(memberName(parent) ?? '');
        const implicitConstructor =
          (ts.isNewExpression(parent) || ts.isCallExpression(parent)) && parent.expression === node;
        if (!explicitConstructor && !deterministicMember && !implicitConstructor) {
          report(node, 'domain-no-date-alias');
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return diagnostics;
}

// Resolve the compiled program, including files pulled in through imports even when
// their names match an excluded test pattern. The scanner must cover what ships.
export function compiledDomainFiles(configPath: string, domainPath: string) {
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
  if (parsed.errors.length) {
    throw new Error(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
  }
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const prefix = domainPath.endsWith(sep) ? domainPath : `${domainPath}${sep}`;
  return program.getSourceFiles().filter((file) => !file.isDeclarationFile && file.fileName.startsWith(prefix));
}

// The dependency-cruiser graph excludes test-named files. A production import can
// still pull one into the TypeScript program, so validate every compiled module's
// own static edges here as well. This includes type-only imports and re-exports.
export function inspectDomainImports(file: ts.SourceFile, options: ts.CompilerOptions, domainPath: string) {
  const prefix = domainPath.endsWith(sep) ? domainPath : `${domainPath}${sep}`;
  const diagnostics: { rule: string; line: number; column: number }[] = [];
  function report(node: ts.Node) {
    const at = file.getLineAndCharacterOfPosition(node.getStart(file));
    diagnostics.push({ rule: 'domain-no-external-import', line: at.line + 1, column: at.character + 1 });
  }
  function inspectSpecifier(node: ts.Node, specifier: string) {
    const resolved = ts.resolveModuleName(specifier, file.fileName, options, ts.sys).resolvedModule?.resolvedFileName;
    if (!resolved?.startsWith(prefix)) report(node);
  }
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) inspectSpecifier(node, node.moduleSpecifier.text);
      else report(node);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (expression && ts.isStringLiteral(expression)) inspectSpecifier(node, expression.text);
      else report(node);
    }
    if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
        inspectSpecifier(node, argument.literal.text);
      } else {
        report(node);
      }
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) report(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return diagnostics;
}
