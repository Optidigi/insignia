import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@astrojs/compiler-rs';
import ts from 'typescript';

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const structural = new Set([
  'div',
  'section',
  'main',
  'header',
  'footer',
  'nav',
  'aside',
  'html',
  'head',
  'body',
  'meta',
  'title',
  'script',
  'style',
  'slot',
  'canvas',
]);
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.astro']);
export type PolarisInspectionOptions = {
  root: string;
  tsconfig: string;
  merchantEntries: readonly string[];
  buyerEntries: readonly string[];
  runtimeLayout?: string;
  versionManifest?: string;
};
/** Read-only source inspection; callers decide how violations affect verification. */
export async function inspectPolarisPresentation(
  options: PolarisInspectionOptions,
): Promise<{ violations: string[]; merchantFiles: string[]; buyerFiles: string[] }> {
  const root = resolve(options.root);
  const configPath = resolve(root, options.tsconfig);
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
  const violations: string[] = [];
  const report = (file: string, message: string) => violations.push(`${file}: ${message}`);
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const declarations = resolve(packageRoot, 'apps/web/node_modules/@shopify/polaris-types/dist/polaris.d.ts');
  const supported = new Set<string>();
  const types = ts.createSourceFile(declarations, readFileSync(declarations, 'utf8'), ts.ScriptTarget.Latest, true);
  function collect(node: ts.Node) {
    if (ts.isStringLiteral(node) && node.text.startsWith('s-')) supported.add(node.text);
    ts.forEachChild(node, collect);
  }
  collect(types);
  function tag(file: string, name: string, saveBarChild = false) {
    if (!name || name[0] !== name[0]?.toLowerCase()) return;
    if (
      structural.has(name) ||
      supported.has(name) ||
      name === 'ui-save-bar' ||
      name === 's-app-nav' ||
      (saveBarChild && name === 'button')
    )
      return;
    report(file, `merchant presentation requires supported Polaris component: ${name}`);
  }
  function dependency(file: string, specifier: string): string | undefined {
    const resolutionHost: ts.ModuleResolutionHost = {
      ...ts.sys,
      fileExists: (path) =>
        ts.sys.fileExists(path) || (path.endsWith('.astro.ts') && ts.sys.fileExists(path.slice(0, -3))),
    };
    const resolvedName = (
      ts.resolveModuleName(specifier, file, parsed.options, resolutionHost).resolvedModule ??
      ts.resolveModuleName(`${specifier}.astro`, file, parsed.options, resolutionHost).resolvedModule
    )?.resolvedFileName;
    let resolved = resolvedName?.endsWith('.astro.ts') ? resolvedName.slice(0, -3) : resolvedName;
    // Workspace exports resolve to generated declarations; inspect their authored inputs.
    if (resolved && !resolved.includes('/node_modules/') && resolved.startsWith(`${root}${sep}`)) {
      let directory = dirname(resolved);
      while (directory.startsWith(root)) {
        const path = resolve(directory, 'tsconfig.json');
        if (existsSync(path)) {
          const config = ts.readConfigFile(path, ts.sys.readFile);
          if (config.error) throw new Error('Invalid workspace compiler configuration');
          const project = ts.parseJsonConfigFileContent(config.config, ts.sys, directory);
          if (project.options.rootDir && project.options.outDir) {
            const output = relative(project.options.outDir, resolved);
            if (!output.startsWith('..') && !output.startsWith(sep)) {
              const base = resolve(project.options.rootDir, output).replace(/(?:\.d)?\.[cm]?[jt]sx?$/, '');
              const source = ['.ts', '.tsx', '.mts', '.cts']
                .map((extension) => base + extension)
                .find((candidate) => project.fileNames.includes(candidate));
              if (source) resolved = source;
            }
          }
          break;
        }
        const parent = dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
    }
    if (
      resolved &&
      sourceExtensions.has(extname(resolved)) &&
      !resolved.includes('/node_modules/') &&
      !resolved.endsWith('.d.ts')
    )
      return resolved;
    // TypeScript does not resolve Astro component extensions; retain its paths/baseUrl for other modules.
    if (specifier.startsWith('.')) {
      const base = resolve(dirname(file), specifier);
      for (const candidate of [base, `${base}.astro`, `${base}.tsx`, `${base}.ts`])
        if (existsSync(candidate) && sourceExtensions.has(extname(candidate))) return candidate;
    }
    return undefined;
  }
  function closure(entries: readonly string[], merchant: boolean) {
    const seen = new Set<string>();
    function visit(file: string) {
      if (seen.has(file)) return;
      seen.add(file);
      if (!existsSync(file)) {
        report(file, 'presentation entry missing');
        return;
      }
      const source = readFileSync(file, 'utf8');
      function edge(specifier: string) {
        if (!merchant && /(?:@shopify\/(?:polaris|app-bridge)|shopifycloud\/(?:polaris|app-bridge))/.test(specifier))
          report(file, `buyer closure imports merchant runtime: ${specifier}`);
        const target = dependency(file, specifier);
        if (target) visit(target);
      }
      function inspectTs(text: string) {
        const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const factories = new Set(['createElement', 'h', 'jsx', 'jsxs', 'jsxDEV']);
        function downloadTransport(call: ts.CallExpression): boolean {
          if (
            !ts.isPropertyAccessExpression(call.expression) ||
            call.expression.expression.getText(ast) !== 'document' ||
            call.expression.name.text !== 'createElement'
          )
            return false;
          const declaration = call.parent;
          if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)) return false;
          const declarationName = declaration.name;
          const variable = declarationName.text;
          let block: ts.Node | undefined = declaration.parent;
          while (block && !ts.isBlock(block)) block = block.parent;
          if (!block) return false;
          let href = false,
            download = false,
            click = false,
            remove = false,
            invalid = false;
          function references(node: ts.Node) {
            if (ts.isIdentifier(node) && node.text === variable && node !== declarationName) {
              const parent = node.parent;
              if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
                const operation = parent.parent;
                if (
                  ts.isBinaryExpression(operation) &&
                  operation.left === parent &&
                  operation.operatorToken.kind === ts.SyntaxKind.EqualsToken
                ) {
                  if (parent.name.text === 'download') download = true;
                  else if (parent.name.text === 'href' && ts.isIdentifier(operation.right)) {
                    const urlName = operation.right.text;
                    const container = block;
                    if (container && ts.isBlock(container))
                      for (const statement of container.statements)
                        if (ts.isVariableStatement(statement))
                          for (const value of statement.declarationList.declarations) {
                            if (
                              ts.isIdentifier(value.name) &&
                              value.name.text === urlName &&
                              value.initializer &&
                              ts.isCallExpression(value.initializer) &&
                              value.initializer.expression.getText(ast) === 'URL.createObjectURL' &&
                              value.initializer.arguments[0] &&
                              ts.isNewExpression(value.initializer.arguments[0]) &&
                              value.initializer.arguments[0].expression.getText(ast) === 'Blob'
                            )
                              href = true;
                          }
                    if (!href) invalid = true;
                  } else invalid = true;
                } else if (
                  ts.isCallExpression(operation) &&
                  operation.expression === parent &&
                  operation.arguments.length === 0 &&
                  ts.isExpressionStatement(operation.parent)
                ) {
                  if (parent.name.text === 'click') click = true;
                  else if (parent.name.text === 'remove') remove = true;
                  else invalid = true;
                } else invalid = true;
              } else if (
                !(
                  ts.isCallExpression(parent) &&
                  parent.expression.getText(ast) === 'document.body.append' &&
                  parent.arguments.length === 1 &&
                  parent.arguments[0] === node &&
                  ts.isExpressionStatement(parent.parent)
                )
              )
                invalid = true;
            }
            ts.forEachChild(node, references);
          }
          references(block);
          return href && download && click && remove && !invalid;
        }
        function inspect(node: ts.Node) {
          if (merchant) {
            const rawProperty = (name: string) => ['dangerouslySetInnerHTML', 'innerHTML', 'outerHTML'].includes(name);
            if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'dangerouslySetInnerHTML')
              report(file, 'merchant raw HTML presentation is prohibited');
            if (ts.isPropertyAssignment(node) && rawProperty(node.name.getText(ast).replace(/^['"]|['"]$/g, '')))
              report(file, 'merchant raw HTML presentation is prohibited');
            if (
              ts.isBinaryExpression(node) &&
              node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
              ((ts.isPropertyAccessExpression(node.left) && rawProperty(node.left.name.text)) ||
                (ts.isElementAccessExpression(node.left) &&
                  node.left.argumentExpression &&
                  ts.isStringLiteralLike(node.left.argumentExpression) &&
                  rawProperty(node.left.argumentExpression.text)))
            )
              report(file, 'merchant raw HTML presentation is prohibited');
            if (
              ts.isCallExpression(node) &&
              ts.isPropertyAccessExpression(node.expression) &&
              (['insertAdjacentHTML', 'setHTMLUnsafe'].includes(node.expression.name.text) ||
                (node.expression.expression.getText(ast) === 'document' &&
                  ['write', 'writeln'].includes(node.expression.name.text)))
            )
              report(file, 'merchant raw HTML presentation is prohibited');
          }
          if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
          ) {
            edge(node.moduleSpecifier.text);
            if (ts.isImportDeclaration(node)) {
              const bindings = node.importClause?.namedBindings;
              if (bindings && ts.isNamedImports(bindings))
                for (const binding of bindings.elements)
                  if (factories.has(binding.propertyName?.text ?? binding.name.text)) factories.add(binding.name.text);
            }
          }
          if (ts.isCallExpression(node)) {
            if (
              node.expression.kind === ts.SyntaxKind.ImportKeyword &&
              node.arguments[0] &&
              ts.isStringLiteralLike(node.arguments[0])
            )
              edge(node.arguments[0].text);
            const name = ts.isIdentifier(node.expression)
              ? node.expression.text
              : ts.isPropertyAccessExpression(node.expression)
                ? node.expression.name.text
                : '';
            const first = node.arguments[0];
            if (
              merchant &&
              (factories.has(name) || name === 'createElement') &&
              first &&
              ts.isStringLiteralLike(first)
            ) {
              const parent = node.parent;
              const saveBarChild =
                ts.isCallExpression(parent) &&
                ((ts.isIdentifier(parent.expression) && factories.has(parent.expression.text)) ||
                  (ts.isPropertyAccessExpression(parent.expression) && factories.has(parent.expression.name.text))) &&
                parent.arguments.indexOf(node) >= 2 &&
                parent.arguments[0] &&
                ts.isStringLiteralLike(parent.arguments[0]) &&
                parent.arguments[0].text === 'ui-save-bar';
              if (!(first.text === 'a' && downloadTransport(node))) tag(file, first.text, Boolean(saveBarChild));
            }
          }
          if (merchant && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)))
            tag(file, node.tagName.getText(ast));
          if (!merchant && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
            const name = node.tagName.getText(ast);
            if (supported.has(name) || name === 'ui-save-bar' || name === 's-app-nav')
              report(file, `buyer closure renders merchant component: ${name}`);
          }
          if (
            !merchant &&
            ts.isCallExpression(node) &&
            node.arguments[0] &&
            ts.isStringLiteralLike(node.arguments[0])
          ) {
            const expression = node.expression;
            const name = ts.isIdentifier(expression)
              ? expression.text
              : ts.isPropertyAccessExpression(expression)
                ? expression.name.text
                : '';
            const element = node.arguments[0].text;
            if (factories.has(name) && (supported.has(element) || element === 'ui-save-bar' || element === 's-app-nav'))
              report(file, `buyer closure renders merchant component: ${element}`);
          }
          if (!merchant && ts.isStringLiteralLike(node) && /shopifycloud\/(?:polaris|app-bridge)/.test(node.text))
            report(file, 'buyer closure loads merchant runtime');
          ts.forEachChild(node, inspect);
        }
        inspect(ast);
      }
      if (file.endsWith('.astro')) {
        const ast: unknown = parse(source).ast;
        function walk(value: unknown) {
          if (Array.isArray(value)) {
            for (const item of value) walk(item);
            return;
          }
          if (!record(value)) return;
          if (merchant && value.type === 'JSXAttribute' && record(value.name) && value.name.name === 'set:html')
            report(file, 'merchant raw HTML presentation is prohibited');
          if (value.type === 'Program' && typeof value.start === 'number' && typeof value.end === 'number') {
            inspectTs(source.slice(value.start, value.end));
            return;
          }
          if (value.type === 'JSXOpeningElement' && record(value.name) && typeof value.name.name === 'string') {
            if (merchant) tag(file, value.name.name);
            else if (
              supported.has(value.name.name) ||
              value.name.name === 'ui-save-bar' ||
              value.name.name === 's-app-nav'
            )
              report(file, `buyer closure renders merchant component: ${value.name.name}`);
            if (value.name.name === 'script' && Array.isArray(value.attributes))
              for (const attribute of value.attributes) {
                if (
                  record(attribute) &&
                  record(attribute.name) &&
                  attribute.name.name === 'src' &&
                  record(attribute.value) &&
                  typeof attribute.value.value === 'string'
                )
                  edge(attribute.value.value);
              }
          }
          for (const child of Object.values(value)) walk(child);
        }
        walk(ast);
      } else inspectTs(source);
    }
    for (const entry of entries) visit(resolve(root, entry));
    return [...seen];
  }
  const merchantFiles = closure(options.merchantEntries, true);
  const buyerFiles = closure(options.buyerEntries, false);
  if (options.versionManifest && options.runtimeLayout) {
    const manifest: unknown = JSON.parse(readFileSync(resolve(root, options.versionManifest), 'utf8'));
    const dev = record(manifest) && record(manifest.devDependencies) ? manifest.devDependencies : {};
    if (dev['@shopify/polaris-types'] !== '1.1.0')
      report(options.versionManifest, 'Polaris checked types must match selected 1.1.0');
    const layout = readFileSync(resolve(root, options.runtimeLayout), 'utf8');
    const runtimeSources: string[] = [];
    function scriptSources(value: unknown) {
      if (Array.isArray(value)) {
        for (const child of value) scriptSources(child);
        return;
      }
      if (!record(value)) return;
      if (
        value.type === 'JSXOpeningElement' &&
        record(value.name) &&
        value.name.name === 'script' &&
        Array.isArray(value.attributes)
      )
        for (const attribute of value.attributes) {
          if (
            record(attribute) &&
            record(attribute.name) &&
            attribute.name.name === 'src' &&
            record(attribute.value) &&
            typeof attribute.value.value === 'string' &&
            attribute.value.value.includes('polaris')
          )
            runtimeSources.push(attribute.value.value);
        }
      for (const child of Object.values(value)) scriptSources(child);
    }
    scriptSources(parse(layout).ast);
    if (runtimeSources.length !== 1 || runtimeSources[0] !== 'https://cdn.shopify.com/shopifycloud/polaris-1.1.js')
      report(options.runtimeLayout, 'Polaris runtime must match selected 1.1.js');
  }
  return { violations, merchantFiles, buyerFiles };
}
