import ts from 'typescript';

export function parseCatalog(source: string): unknown {
  const value: unknown = JSON.parse(source);
  const tree = ts.parseJsonText('catalog.json', source);
  function visit(node: ts.Node, path: readonly string[]): void {
    if (ts.isObjectLiteralExpression(node)) {
      const names = new Set<string>();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name)) continue;
        const name = property.name.text;
        const childPath = [...path, name];
        if (name.endsWith('_plural'))
          throw new Error(`Legacy plural suffix ${childPath.join('.')}; use _one and _other`);
        if (names.has(name)) throw new Error(`Duplicate catalog key ${childPath.join('.')}`);
        names.add(name);
        visit(property.initializer, childPath);
      }
      return;
    }
    ts.forEachChild(node, (child) => visit(child, path));
  }
  visit(tree, []);
  return value;
}
