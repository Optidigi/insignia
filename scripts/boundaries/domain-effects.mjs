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

function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

function memberTarget(node) {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? node.expression : null;
}

function isDateRoot(node) {
  return (
    (ts.isIdentifier(node) && node.text === 'Date') ||
    (memberName(node) === 'Date' && ts.isIdentifier(memberTarget(node)) && memberTarget(node).text === 'globalThis')
  );
}

function isMathRoot(node) {
  return ts.isIdentifier(node) && node.text === 'Math';
}

function isReference(node) {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.name === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return false;
  return true;
}

export function inspectDomainSource(source, filename = 'domain.ts') {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const diagnostics = [];
  function report(node, rule) {
    const at = file.getLineAndCharacterOfPosition(node.getStart(file));
    diagnostics.push({ rule, line: at.line + 1, column: at.character + 1 });
  }
  function visit(node) {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const property = memberName(node);
      const target = memberTarget(node);
      if (property === 'now' && isDateRoot(target)) report(node, 'domain-no-implicit-clock');
      if (property === 'random' && isMathRoot(target)) report(node, 'domain-no-implicit-random');
    }
    if (ts.isNewExpression(node) && isDateRoot(node.expression) && !node.arguments?.length) {
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
          ['parse', 'UTC', 'now'].includes(memberName(parent));
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
